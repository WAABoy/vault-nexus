import { MAX_SNIPPETS_PER_NOTE, SNIPPET_MAX_CHARS } from "../constants";

/**
 * Miyo wraps every chunk in an indexing preamble:
 *
 *   NOTE TITLE: [[Runen-Index]]
 *
 *   NOTE BLOCK CONTENT:
 *
 *   # Runen-Index ...
 *
 * None of that belongs in the UI.
 */
export function stripChunkPreamble(chunk: string): string {
	let text = chunk.replace(/^\s*NOTE TITLE:.*$/im, "");
	const marker = text.match(/^\s*NOTE BLOCK CONTENT:\s*$/im);
	if (marker && marker.index !== undefined) {
		text = text.slice(marker.index + marker[0].length);
	}
	return text;
}

/** Collapses markdown noise and whitespace into a single readable line. */
export function trimSnippet(chunk: string, maxChars = SNIPPET_MAX_CHARS): string {
	const text = stripChunkPreamble(chunk)
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/^\s{0,3}#{1,6}\s+/gm, "")
		.replace(/^\s{0,3}>\s?/gm, "")
		.replace(/\|/g, " ")
		.replace(/\s+/g, " ")
		.trim();

	if (text.length <= maxChars) return text;
	const cut = text.slice(0, maxChars);
	const lastSpace = cut.lastIndexOf(" ");
	return `${(lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export function buildSnippets(chunks: string[]): string[] {
	const out: string[] = [];
	for (const chunk of chunks) {
		const snippet = trimSnippet(chunk);
		if (snippet && !out.includes(snippet)) out.push(snippet);
		if (out.length >= MAX_SNIPPETS_PER_NOTE) break;
	}
	return out;
}
