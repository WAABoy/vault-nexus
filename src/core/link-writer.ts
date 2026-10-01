import type { App, HeadingCache, TFile } from "obsidian";
import { MarkdownView } from "obsidian";
import type { InsertMode, VaultNexusSettings } from "../settings";
import type { AppliedLink } from "../types";

export interface ApplyResult {
	applied: AppliedLink | null;
	/** Set when nothing was written and the user should be told why. */
	skippedReason?: string;
	/** Set when the requested mode could not be honoured. */
	fellBackToEnd?: boolean;
}

/** Where in the pre-write content the link goes, and what exactly gets inserted. */
interface Insertion {
	offset: number;
	text: string;
	createdHeading: boolean;
}

function headingLevel(heading: string): number {
	const match = heading.match(/^(#{1,6})\s/);
	return match ? match[1].length : 2;
}

function headingTitle(heading: string): string {
	return heading.replace(/^#{1,6}\s*/, "").trim();
}

/** Offset just past the end of the section that starts at `heading`. */
function sectionEndOffset(content: string, heading: HeadingCache, headings: HeadingCache[]): number {
	const index = headings.indexOf(heading);
	for (let i = index + 1; i < headings.length; i++) {
		if (headings[i].level <= heading.level) return headings[i].position.start.offset;
	}
	return content.length;
}

export function buildLinkLine(linkText: string, asListItem: boolean): string {
	return asListItem ? `- ${linkText}` : linkText;
}

function planInsertion(
	app: App,
	sourceFile: TFile,
	content: string,
	linkLine: string,
	settings: VaultNexusSettings,
	mode: InsertMode,
): Insertion {
	if (mode === "seeAlso") {
		const wanted = headingTitle(settings.linking.seeAlsoHeading);
		const cache = app.metadataCache.getFileCache(sourceFile);
		const headings = cache?.headings ?? [];
		const match = headings.find(
			(heading) => heading.heading.trim().toLowerCase() === wanted.toLowerCase(),
		);

		if (match) {
			const end = sectionEndOffset(content, match, headings);
			const before = content.slice(0, end);
			// Insert after the section's last non-empty line, keeping trailing blank
			// lines that separate this section from the next heading.
			const trimmedEnd = before.replace(/\s*$/, "").length;
			return {
				offset: trimmedEnd,
				text: `\n${linkLine}`,
				createdHeading: false,
			};
		}

		const level = headingLevel(settings.linking.seeAlsoHeading) || 2;
		const heading = `${"#".repeat(level)} ${wanted}`;
		return {
			offset: content.length,
			text: `${separatorFor(content)}${heading}\n${linkLine}\n`,
			createdHeading: true,
		};
	}

	// "end" (and the fallback target for "cursor")
	return {
		offset: content.length,
		text: `${separatorFor(content)}${linkLine}\n`,
		createdHeading: false,
	};
}

/** Exactly one blank line between existing content and what we append. */
function separatorFor(content: string): string {
	if (content.length === 0) return "";
	if (content.endsWith("\n\n")) return "";
	if (content.endsWith("\n")) return "\n";
	return "\n\n";
}

/**
 * Inserts a link to `target` into `sourceFile` and returns everything needed to undo it.
 *
 * The write goes through Vault.process so a concurrent editor change cannot be
 * clobbered by a read-modify-write race.
 */
export async function applyLink(
	app: App,
	sourceFile: TFile,
	target: TFile,
	settings: VaultNexusSettings,
): Promise<ApplyResult> {
	const linkText = app.fileManager.generateMarkdownLink(target, sourceFile.path);

	// Re-check right before writing: the link may have appeared since the search ran.
	const resolved = app.metadataCache.resolvedLinks[sourceFile.path];
	if (settings.filters.skipAlreadyLinked && resolved && resolved[target.path]) {
		return { applied: null, skippedReason: "Already linked." };
	}

	let mode: InsertMode = settings.linking.insertMode;
	let fellBackToEnd = false;

	if (mode === "cursor") {
		const view = app.workspace.getActiveViewOfType(MarkdownView);
		if (view && view.file && view.file.path === sourceFile.path) {
			const editor = view.editor;
			const cursor = editor.getCursor();
			editor.replaceRange(linkText, cursor);
			const offset = editor.posToOffset(cursor);
			return {
				applied: {
					sourcePath: sourceFile.path,
					targetPath: target.path,
					insertedText: linkText,
					insertOffset: offset,
					createdHeading: false,
					appliedAt: Date.now(),
				},
			};
		}
		mode = "end";
		fellBackToEnd = true;
	}

	const linkLine = buildLinkLine(linkText, settings.linking.asListItem);
	let insertion: Insertion | null = null;

	await app.vault.process(sourceFile, (content) => {
		insertion = planInsertion(app, sourceFile, content, linkLine, settings, mode);
		return content.slice(0, insertion.offset) + insertion.text + content.slice(insertion.offset);
	});

	if (!insertion) return { applied: null, skippedReason: "Nothing was written." };
	const done: Insertion = insertion;

	return {
		applied: {
			sourcePath: sourceFile.path,
			targetPath: target.path,
			insertedText: done.text,
			insertOffset: done.offset,
			createdHeading: done.createdHeading,
			appliedAt: Date.now(),
		},
		fellBackToEnd,
	};
}
