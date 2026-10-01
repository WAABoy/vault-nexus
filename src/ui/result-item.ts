import { setIcon } from "obsidian";
import type { RelatedNote } from "../types";

export interface RowCallbacks {
	onOpen: (note: RelatedNote, newTab: boolean) => void;
	onLink: (note: RelatedNote) => void;
	onDismiss: (note: RelatedNote) => void;
	onUndo: (note: RelatedNote) => void;
	onExplain: (note: RelatedNote) => void;
}

export interface RowOptions {
	showExplain: boolean;
	canUndo: boolean;
}

function actionButton(
	parent: HTMLElement,
	label: string,
	icon: string,
	onClick: () => void,
): HTMLButtonElement {
	const button = parent.createEl("button", { cls: "vn-action", attr: { type: "button" } });
	const iconEl = button.createSpan({ cls: "vn-action-icon" });
	setIcon(iconEl, icon);
	button.createSpan({ cls: "vn-action-label", text: label });
	button.addEventListener("click", (event) => {
		event.preventDefault();
		event.stopPropagation();
		onClick();
	});
	return button;
}

export function renderResultRow(
	container: HTMLElement,
	note: RelatedNote,
	options: RowOptions,
	callbacks: RowCallbacks,
): void {
	const row = container.createDiv({ cls: "vn-row" });
	if (note.alreadyLinked) row.addClass("vn-row-linked");
	if (note.applied) row.addClass("vn-row-applied");

	const header = row.createDiv({ cls: "vn-row-header" });
	const title = header.createEl("a", {
		cls: "vn-row-title",
		text: note.title,
		attr: { href: "#" },
	});
	title.addEventListener("click", (event) => {
		event.preventDefault();
		callbacks.onOpen(note, event.ctrlKey || event.metaKey);
	});

	if (note.alreadyLinked) {
		header.createSpan({ cls: "vn-badge", text: "linked" });
	} else if (note.applied) {
		header.createSpan({ cls: "vn-badge vn-badge-applied", text: "added" });
	}
	header.createSpan({ cls: "vn-score", text: note.score.toFixed(2) });

	row.createDiv({ cls: "vn-row-path", text: note.vaultPath });

	for (const snippet of note.snippets) {
		row.createDiv({ cls: "vn-snippet", text: snippet });
	}

	if (note.chunkHits > 1) {
		row.createDiv({ cls: "vn-meta", text: `${note.chunkHits} matching sections` });
	}

	if (note.rationaleState === "loading") {
		row.createDiv({ cls: "vn-rationale vn-rationale-muted", text: "Thinking…" });
	} else if (note.rationaleState === "failed") {
		row.createDiv({ cls: "vn-rationale vn-rationale-muted", text: "Rationale unavailable." });
	} else if (note.rationale) {
		row.createDiv({ cls: "vn-rationale", text: note.rationale });
	}

	const actions = row.createDiv({ cls: "vn-actions" });
	actionButton(actions, "Open", "file-text", () => callbacks.onOpen(note, false));

	if (note.applied) {
		if (options.canUndo) {
			actionButton(actions, "Undo", "undo-2", () => callbacks.onUndo(note));
		}
	} else if (!note.alreadyLinked) {
		actionButton(actions, "Link", "link", () => callbacks.onLink(note));
		actionButton(actions, "Dismiss", "x", () => callbacks.onDismiss(note));
	}

	if (options.showExplain && !note.rationale && note.rationaleState !== "loading") {
		actionButton(actions, "Why?", "help-circle", () => callbacks.onExplain(note));
	}
}
