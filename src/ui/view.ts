import { ItemView, setIcon, TFile, WorkspaceLeaf } from "obsidian";
import { PLUGIN_NAME, VIEW_ICON, VIEW_TYPE_RELATED } from "../constants";
import type { RelatedNote } from "../types";
import { renderResultRow, RowCallbacks } from "./result-item";

export type ViewState =
	| { kind: "idle" }
	| { kind: "loading"; sourcePath: string }
	| { kind: "error"; sourcePath: string | null; message: string; retryable: boolean }
	| {
			kind: "results";
			sourcePath: string;
			notes: RelatedNote[];
			backendLabel: string;
			elapsedMs: number;
			filteredOut: number;
	  };

/** What the view needs from the plugin. Keeps the view free of plugin internals. */
export interface ViewHost extends RowCallbacks {
	onRefresh: () => void;
	onCancel: () => void;
	onOpenSettings: () => void;
	onUndoLast: () => void;
	onClearDismissals: () => void;
	showExplain: () => boolean;
	canUndoLast: () => boolean;
	dismissedCount: (sourcePath: string) => number;
}

export class RelatedNotesView extends ItemView {
	private state: ViewState = { kind: "idle" };

	constructor(
		leaf: WorkspaceLeaf,
		private readonly host: ViewHost,
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_RELATED;
	}

	getDisplayText(): string {
		return PLUGIN_NAME;
	}

	getIcon(): string {
		return VIEW_ICON;
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass("vault-nexus-view");
		this.render();
	}

	setState_(state: ViewState): void {
		this.state = state;
		this.render();
	}

	/** Re-renders in place, e.g. after a row's rationale arrived. */
	refreshRows(): void {
		this.render();
	}

	currentNotes(): RelatedNote[] {
		return this.state.kind === "results" ? this.state.notes : [];
	}

	/** Drops one row without discarding the search status line. */
	removeNote(vaultPath: string): void {
		if (this.state.kind !== "results") return;
		this.state = {
			...this.state,
			notes: this.state.notes.filter((note) => note.vaultPath !== vaultPath),
		};
		this.render();
	}

	currentSourcePath(): string | null {
		return this.state.kind === "idle" ? null : this.state.sourcePath;
	}

	private render(): void {
		const root = this.contentEl;
		root.empty();

		this.renderToolbar(root);

		switch (this.state.kind) {
			case "idle":
				this.renderMessage(root, "Open a note, then press Refresh to find related notes.");
				break;
			case "loading":
				this.renderLoading(root);
				break;
			case "error":
				this.renderError(root, this.state.message, this.state.retryable);
				break;
			case "results":
				this.renderResults(root);
				break;
		}

		this.renderFooter(root);
	}

	private renderToolbar(root: HTMLElement): void {
		const bar = root.createDiv({ cls: "vn-toolbar" });
		const source = this.currentSourcePath();
		bar.createDiv({
			cls: "vn-source",
			text: source ? (source.split("/").pop() ?? source) : "No note selected",
		});

		const buttons = bar.createDiv({ cls: "vn-toolbar-buttons" });
		const refresh = buttons.createEl("button", {
			cls: "clickable-icon",
			attr: { type: "button", "aria-label": "Refresh related notes" },
		});
		setIcon(refresh, "refresh-cw");
		refresh.addEventListener("click", () => this.host.onRefresh());

		const settings = buttons.createEl("button", {
			cls: "clickable-icon",
			attr: { type: "button", "aria-label": "Open Vault Nexus settings" },
		});
		setIcon(settings, "settings");
		settings.addEventListener("click", () => this.host.onOpenSettings());
	}

	private renderMessage(root: HTMLElement, text: string): void {
		root.createDiv({ cls: "vn-empty", text });
	}

	private renderLoading(root: HTMLElement): void {
		const box = root.createDiv({ cls: "vn-empty" });
		box.createDiv({ cls: "vn-status", text: "Searching Miyo…" });
		const cancel = box.createEl("button", { text: "Cancel", attr: { type: "button" } });
		cancel.addEventListener("click", () => this.host.onCancel());
	}

	private renderError(root: HTMLElement, message: string, retryable: boolean): void {
		const box = root.createDiv({ cls: "vn-empty vn-error" });
		box.createDiv({ cls: "vn-status", text: message });
		const actions = box.createDiv({ cls: "vn-actions" });
		if (retryable) {
			const retry = actions.createEl("button", { text: "Retry", attr: { type: "button" } });
			retry.addEventListener("click", () => this.host.onRefresh());
		}
		const open = actions.createEl("button", { text: "Open settings", attr: { type: "button" } });
		open.addEventListener("click", () => this.host.onOpenSettings());
	}

	private renderResults(root: HTMLElement): void {
		if (this.state.kind !== "results") return;
		const { notes, backendLabel, elapsedMs, filteredOut } = this.state;

		root.createDiv({
			cls: "vn-status",
			text: `${backendLabel} · ${notes.length} ${notes.length === 1 ? "note" : "notes"} · ${elapsedMs} ms`,
		});

		if (notes.length === 0) {
			const text =
				filteredOut > 0
					? `No related notes to suggest. ${filteredOut} ${filteredOut === 1 ? "hit was" : "hits were"} filtered out.`
					: "No related notes found.";
			this.renderMessage(root, text);
			return;
		}

		const list = root.createDiv({ cls: "vn-list" });
		const options = { showExplain: this.host.showExplain(), canUndo: this.host.canUndoLast() };
		for (const note of notes) {
			renderResultRow(list, note, options, this.host);
		}
	}

	private renderFooter(root: HTMLElement): void {
		const footer = root.createDiv({ cls: "vn-footer" });

		const undo = footer.createEl("button", {
			text: "Undo last link",
			attr: { type: "button" },
		});
		undo.disabled = !this.host.canUndoLast();
		undo.addEventListener("click", () => this.host.onUndoLast());

		const source = this.currentSourcePath();
		const dismissed = source ? this.host.dismissedCount(source) : 0;
		footer.createSpan({ cls: "vn-footer-note", text: `Dismissed here: ${dismissed}` });

		const clear = footer.createEl("button", { text: "Clear", attr: { type: "button" } });
		clear.addEventListener("click", () => this.host.onClearDismissals());
	}
}

export function isMarkdownFile(file: TFile | null): file is TFile {
	return file !== null && file.extension === "md";
}
