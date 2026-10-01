/** Frontmatter carries no semantic signal worth embedding, and often a lot of noise. */
function stripFrontmatter(content: string): string {
	if (!content.startsWith("---")) return content;
	const end = content.indexOf("\n---", 3);
	if (end === -1) return content;
	const afterFence = content.indexOf("\n", end + 1);
	return afterFence === -1 ? "" : content.slice(afterFence + 1);
}

/**
 * Builds the search query for a note: its title plus the opening of its body.
 *
 * Miyo embeds the query as a single vector, so padding it with the whole note
 * blurs the match; the opening carries the note's topic most reliably.
 */
export function buildQuery(title: string, content: string, maxChars: number): string {
	const body = stripFrontmatter(content)
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/!\[\[[^\]]*\]\]/g, " ")
		.replace(/\s+/g, " ")
		.trim();

	const budget = Math.max(0, maxChars - title.length - 2);
	const opening = body.length <= budget ? body : body.slice(0, budget);
	return `${title}\n\n${opening}`.trim();
}

export function isQueryUsable(query: string): boolean {
	return query.trim().length >= 3;
}
