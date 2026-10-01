import type { App } from "obsidian";
import { TFile } from "obsidian";
import type { PersistedState } from "../settings";
import type { AppliedLink } from "../types";

export type UndoResult =
	| { ok: true; sourcePath: string; targetPath: string }
	| { ok: false; reason: string };

/**
 * Single-level, content-verified undo of the last accepted link.
 *
 * Verification is by exact content match, never by mtime: our own write always
 * bumps the mtime, so it tells us nothing about later edits by the user.
 */
export class UndoStore {
	constructor(
		private readonly app: App,
		private readonly state: PersistedState,
		private readonly onChange: () => void,
	) {}

	record(applied: AppliedLink): void {
		this.state.lastApply = applied;
		this.onChange();
	}

	peek(): AppliedLink | null {
		return this.state.lastApply;
	}

	clear(): void {
		if (this.state.lastApply === null) return;
		this.state.lastApply = null;
		this.onChange();
	}

	/** Follows renames so the record keeps pointing at the right files. */
	handleRename(oldPath: string, newPath: string): void {
		const last = this.state.lastApply;
		if (!last) return;
		const nextSource = remap(last.sourcePath, oldPath, newPath);
		const nextTarget = remap(last.targetPath, oldPath, newPath);
		if (nextSource === last.sourcePath && nextTarget === last.targetPath) return;
		this.state.lastApply = { ...last, sourcePath: nextSource, targetPath: nextTarget };
		this.onChange();
	}

	async undoLast(): Promise<UndoResult> {
		const last = this.state.lastApply;
		if (!last) return { ok: false, reason: "There is no link to undo." };

		const file = this.app.vault.getAbstractFileByPath(last.sourcePath);
		if (!(file instanceof TFile)) {
			this.clear();
			return { ok: false, reason: "The note that was edited no longer exists." };
		}

		let removed = false;
		await this.app.vault.process(file, (content) => {
			const next = removeInsertion(content, last);
			if (next === null) return content;
			removed = true;
			return next;
		});

		if (!removed) {
			this.clear();
			return {
				ok: false,
				reason: "Could not undo — the note has changed since the link was added.",
			};
		}

		const result: UndoResult = { ok: true, sourcePath: last.sourcePath, targetPath: last.targetPath };
		this.clear();
		return result;
	}
}

/**
 * Returns the content with the insertion removed, or null when it can no longer be
 * located — in which case nothing is touched.
 */
export function removeInsertion(content: string, applied: AppliedLink): string | null {
	const { insertedText, insertOffset, createdHeading } = applied;

	const at = (offset: number): boolean =>
		offset >= 0 && content.slice(offset, offset + insertedText.length) === insertedText;

	let offset = at(insertOffset) ? insertOffset : content.lastIndexOf(insertedText);
	if (offset === -1) return null;

	if (createdHeading) {
		// We added the heading, but the user may have put their own links under it
		// since. Removing the whole block would orphan those, so drop only our line.
		const after = content.slice(offset + insertedText.length);
		const nextLine = after.split("\n", 1)[0].trim();
		if (nextLine.length > 0 && !nextLine.startsWith("#")) {
			const lineOnly = lastLineOf(insertedText);
			const lineOffset = content.indexOf(lineOnly, offset);
			if (lineOffset === -1) return null;
			return content.slice(0, lineOffset) + content.slice(lineOffset + lineOnly.length);
		}
	}

	return content.slice(0, offset) + content.slice(offset + insertedText.length);
}

/** The link line of a multi-line insertion, with its trailing newline. */
function lastLineOf(text: string): string {
	const lines = text.split("\n");
	while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
	const line = lines[lines.length - 1] ?? "";
	return `${line}\n`;
}

function remap(path: string, oldPath: string, newPath: string): string {
	if (path === oldPath) return newPath;
	if (path.startsWith(`${oldPath}/`)) return newPath + path.slice(oldPath.length);
	return path;
}
