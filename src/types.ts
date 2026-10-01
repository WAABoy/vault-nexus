import type { TFile } from "obsidian";

/** One chunk hit exactly as returned by Miyo's POST /v0/search. */
export interface RawHit {
	path: string;
	score: number;
	title: string | null;
	mtime: number | null;
	file_name: string;
	chunk_index: number;
	total_chunks: number;
	chunk_text: string;
}

/** An indexed root as returned by GET /v0/folder. */
export interface MiyoRoot {
	alias: string;
	absolutePath: string;
}

export interface HealthInfo {
	ok: boolean;
	indexedFiles: number | null;
	detail: string;
}

/** A hit resolved to a real file in this vault, after filtering and chunk merging. */
export interface RelatedNote {
	file: TFile;
	vaultPath: string;
	title: string;
	score: number;
	snippets: string[];
	chunkHits: number;
	alreadyLinked: boolean;
	rationale?: string;
	rationaleState?: "idle" | "loading" | "failed";
	/** Set once the user accepts a link in this session. */
	applied?: boolean;
}

/** Everything needed to reverse exactly one link insertion. */
export interface AppliedLink {
	sourcePath: string;
	targetPath: string;
	insertedText: string;
	insertOffset: number;
	createdHeading: boolean;
	appliedAt: number;
}

export interface SearchOutcome {
	notes: RelatedNote[];
	backendId: string;
	backendLabel: string;
	elapsedMs: number;
	/** Hits dropped by filters — lets the empty state explain itself. */
	filteredOut: number;
}
