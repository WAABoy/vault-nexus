import type { App, TFile } from "obsidian";
import { ALWAYS_IGNORED } from "../constants";
import type { VaultNexusSettings } from "../settings";
import type { RawHit, RelatedNote } from "../types";
import type { DismissalStore } from "./dismissals";
import type { PathMapper } from "./path-map";
import { buildSnippets } from "./snippet";

export interface FilterContext {
	app: App;
	settings: VaultNexusSettings;
	mapper: PathMapper;
	dismissals: DismissalStore;
	sourceFile: TFile;
}

interface Grouped {
	file: TFile;
	score: number;
	chunks: { index: number; text: string }[];
}

export function isIgnored(path: string, ignoredFolders: string[]): boolean {
	const folders = [...ALWAYS_IGNORED, ...ignoredFolders];
	return folders.some((folder) => {
		const clean = folder.replace(/^\/+|\/+$/g, "");
		return clean.length > 0 && (path === clean || path.startsWith(`${clean}/`));
	});
}

/** Targets the source note already links to, per Obsidian's resolved link index. */
export function linkedTargets(app: App, sourcePath: string): Set<string> {
	const resolved = app.metadataCache.resolvedLinks[sourcePath];
	return new Set(resolved ? Object.keys(resolved) : []);
}

/**
 * Turns raw chunk hits into the notes shown in the sidebar.
 *
 * Order matters: cheap identity checks first, then vault resolution, then the
 * chunk merge — a file that produced five chunk hits must appear once.
 */
export function toRelatedNotes(
	hits: RawHit[],
	ctx: FilterContext,
): { notes: RelatedNote[]; filteredOut: number } {
	const { app, settings, mapper, dismissals, sourceFile } = ctx;
	const linked = linkedTargets(app, sourceFile.path);
	const grouped = new Map<string, Grouped>();
	let filteredOut = 0;

	for (const hit of hits) {
		const file = mapper.resolve(hit.path);
		if (!file) {
			filteredOut++;
			continue;
		}
		if (settings.filters.skipSelf && file.path === sourceFile.path) {
			filteredOut++;
			continue;
		}
		if (isIgnored(file.path, settings.paths.ignoredFolders)) {
			filteredOut++;
			continue;
		}
		if (dismissals.isDismissed(sourceFile.path, file.path)) {
			filteredOut++;
			continue;
		}
		if (hit.score < settings.search.minScore) {
			filteredOut++;
			continue;
		}

		const existing = grouped.get(file.path);
		if (existing) {
			existing.score = Math.max(existing.score, hit.score);
			existing.chunks.push({ index: hit.chunk_index, text: hit.chunk_text });
		} else {
			grouped.set(file.path, {
				file,
				score: hit.score,
				chunks: [{ index: hit.chunk_index, text: hit.chunk_text }],
			});
		}
	}

	const notes: RelatedNote[] = [];
	for (const entry of grouped.values()) {
		// When skipAlreadyLinked is off, linked notes stay ordinary linkable rows.
		const alreadyLinked = settings.filters.skipAlreadyLinked && linked.has(entry.file.path);
		entry.chunks.sort((a, b) => a.index - b.index);
		notes.push({
			file: entry.file,
			vaultPath: entry.file.path,
			title: entry.file.basename,
			score: entry.score,
			snippets: buildSnippets(entry.chunks.map((chunk) => chunk.text)),
			chunkHits: entry.chunks.length,
			alreadyLinked,
		});
	}

	notes.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
	return { notes, filteredOut };
}
