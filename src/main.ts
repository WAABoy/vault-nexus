import { Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { DISMISS_UNDO_MS, PLUGIN_NAME, SAVE_DEBOUNCE_MS, VIEW_TYPE_RELATED } from "./constants";
import { DismissalStore } from "./core/dismissals";
import { applyLink } from "./core/link-writer";
import { RelatedService } from "./core/related";
import { UndoStore } from "./core/undo";
import { RationaleClient } from "./llm/rationale";
import { LocalHttpProvider } from "./providers";
import { ProviderError } from "./providers/provider";
import {
	DEFAULT_SETTINGS,
	DEFAULT_STATE,
	migrate,
	PersistedState,
	VaultNexusSettings,
} from "./settings";
import { VaultNexusSettingTab } from "./settings-tab";
import type { RelatedNote } from "./types";
import { isMarkdownFile, RelatedNotesView, ViewHost } from "./ui/view";

function notice(message: string): void {
	new Notice(`${PLUGIN_NAME}: ${message}`);
}

export default class VaultNexusPlugin extends Plugin {
	settings: VaultNexusSettings = { ...DEFAULT_SETTINGS };
	state: PersistedState = { ...DEFAULT_STATE, dismissals: {} };

	dismissals!: DismissalStore;
	undoStore!: UndoStore;
	private service!: RelatedService;
	private rationale!: RationaleClient;
	private saveTimer: number | null = null;

	async onload(): Promise<void> {
		const data = migrate(await this.loadData());
		this.settings = data.settings;
		this.state = data.state;

		this.dismissals = new DismissalStore(this.state, () => this.schedulePersist());
		this.undoStore = new UndoStore(this.app, this.state, () => this.schedulePersist());
		this.service = new RelatedService(this.app, this.settings, this.dismissals);
		this.rationale = new RationaleClient(this.settings);

		this.dismissals.sweepExpired();

		this.registerView(VIEW_TYPE_RELATED, (leaf) => new RelatedNotesView(leaf, this.viewHost()));
		this.addSettingTab(new VaultNexusSettingTab(this.app, this));
		this.addRibbonIcon("link", `${PLUGIN_NAME}: related notes`, () => void this.showRelated());
		this.registerCommands();

		// Dismissals and the undo record are keyed by path, so renames must be followed.
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				if (!(file instanceof TFile)) return;
				this.dismissals.handleRename(oldPath, file.path);
				this.undoStore.handleRename(oldPath, file.path);
			}),
		);
	}

	onunload(): void {
		if (this.saveTimer !== null) {
			window.clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
	}

	private registerCommands(): void {
		this.addCommand({
			id: "show-related",
			name: "Show related notes for the current note",
			callback: () => void this.showRelated(),
		});

		this.addCommand({
			id: "open-view",
			name: "Open the related notes panel",
			callback: () => void this.activateView(true),
		});

		this.addCommand({
			id: "test-connection",
			name: "Test Miyo connection",
			callback: () => void this.testConnection(),
		});

		this.addCommand({
			id: "clear-dismissals",
			name: "Clear dismissed suggestions",
			callback: () => {
				const removed = this.dismissals.clearAll();
				void this.persist();
				notice(`cleared ${removed} dismissal${removed === 1 ? "" : "s"}.`);
				void this.refreshView();
			},
		});

		this.addCommand({
			id: "undo-last-link",
			name: "Undo the last link that was added",
			callback: () => void this.undoLastLink(),
		});
	}

	// --- persistence -------------------------------------------------------

	private schedulePersist(): void {
		if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
		this.saveTimer = window.setTimeout(() => {
			this.saveTimer = null;
			void this.persist();
		}, SAVE_DEBOUNCE_MS);
	}

	async persist(): Promise<void> {
		if (this.saveTimer !== null) {
			window.clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
		await this.saveData({ settings: this.settings, state: this.state });
	}

	/** Rebuilds backend-dependent objects after the settings changed. */
	reconfigure(): void {
		this.service.reconfigure(this.settings);
		this.rationale.reconfigure(this.settings);
	}

	// --- view --------------------------------------------------------------

	private getView(): RelatedNotesView | null {
		const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_RELATED)[0];
		return leaf && leaf.view instanceof RelatedNotesView ? leaf.view : null;
	}

	private async activateView(reveal: boolean): Promise<RelatedNotesView | null> {
		let leaf: WorkspaceLeaf | null = this.app.workspace.getLeavesOfType(VIEW_TYPE_RELATED)[0] ?? null;
		if (!leaf) {
			leaf = this.app.workspace.getRightLeaf(false);
			await leaf?.setViewState({ type: VIEW_TYPE_RELATED, active: true });
		}
		if (leaf && reveal) await this.app.workspace.revealLeaf(leaf);
		return this.getView();
	}

	private viewHost(): ViewHost {
		return {
			onRefresh: () => void this.showRelated(),
			onCancel: () => {
				this.service.cancel();
				const view = this.getView();
				view?.setState_({ kind: "idle" });
			},
			onOpenSettings: () => this.openSettings(),
			onUndoLast: () => void this.undoLastLink(),
			onClearDismissals: () => {
				const removed = this.dismissals.clearAll();
				void this.persist();
				notice(`cleared ${removed} dismissal${removed === 1 ? "" : "s"}.`);
				void this.refreshView();
			},
			showExplain: () => this.settings.llm.enabled,
			canUndoLast: () => this.undoStore.peek() !== null,
			dismissedCount: (sourcePath) => this.dismissals.countFor(sourcePath),
			onOpen: (note, newTab) => void this.openNote(note, newTab),
			onLink: (note) => void this.linkNote(note),
			onDismiss: (note) => void this.dismissNote(note),
			onUndo: () => void this.undoLastLink(),
			onExplain: (note) => void this.explainNote(note),
		};
	}

	private openSettings(): void {
		// setting.open()/openTabById are not in the public typings but are stable.
		const setting = (this.app as unknown as { setting?: { open(): void; openTabById(id: string): void } })
			.setting;
		if (!setting) return;
		setting.open();
		setting.openTabById(this.manifest.id);
	}

	// --- actions -----------------------------------------------------------

	private activeMarkdownFile(): TFile | null {
		const file = this.app.workspace.getActiveFile();
		return isMarkdownFile(file) ? file : null;
	}

	async showRelated(): Promise<void> {
		const view = await this.activateView(true);
		if (!view) return;

		const file = this.activeMarkdownFile();
		if (!file) {
			view.setState_({ kind: "idle" });
			notice("open a Markdown note first.");
			return;
		}

		view.setState_({ kind: "loading", sourcePath: file.path });

		try {
			const outcome = await this.service.searchFor(file);
			view.setState_({
				kind: "results",
				sourcePath: file.path,
				notes: outcome.notes,
				backendLabel: outcome.backendLabel,
				elapsedMs: outcome.elapsedMs,
				filteredOut: outcome.filteredOut,
			});
		} catch (error) {
			if (error instanceof ProviderError && error.kind === "cancelled") return;
			const message = describeError(error);
			view.setState_({
				kind: "error",
				sourcePath: file.path,
				message,
				retryable: isRetryable(error),
			});
			notice(message);
		}
	}

	private async refreshView(): Promise<void> {
		this.getView()?.refreshRows();
	}

	private async openNote(note: RelatedNote, newTab: boolean): Promise<void> {
		const leaf = this.app.workspace.getLeaf(newTab ? "tab" : false);
		await leaf.openFile(note.file);
	}

	private async linkNote(note: RelatedNote): Promise<void> {
		const source = this.activeMarkdownFile();
		if (!source) {
			notice("open the note you want to add the link to.");
			return;
		}
		const view = this.getView();
		if (view && view.currentSourcePath() !== source.path) {
			notice("the active note changed — refresh before linking.");
			return;
		}

		try {
			const result = await applyLink(this.app, source, note.file, this.settings);
			if (!result.applied) {
				notice(result.skippedReason ?? "nothing was written.");
				return;
			}
			this.undoStore.record(result.applied);
			note.applied = true;
			note.alreadyLinked = false;
			await this.refreshView();
			if (result.fellBackToEnd) {
				notice("the note is not open in the editor — the link was added at the end.");
			}
		} catch (error) {
			notice(`could not add the link — ${describeError(error)}`);
		}
	}

	private async dismissNote(note: RelatedNote): Promise<void> {
		const view = this.getView();
		if (!view) return;
		const sourcePath = view.currentSourcePath();
		if (!sourcePath) return;

		this.dismissals.dismiss(sourcePath, note.vaultPath, this.settings.dismissals.ttlDays);
		view.removeNote(note.vaultPath);

		const undoNotice = new Notice(`${PLUGIN_NAME}: dismissed ${note.title}. Click to undo.`, DISMISS_UNDO_MS);
		undoNotice.noticeEl.addEventListener("click", () => {
			this.dismissals.undismiss(sourcePath, note.vaultPath);
			undoNotice.hide();
			void this.showRelated();
		});
	}

	private async explainNote(note: RelatedNote): Promise<void> {
		const sourcePath = this.getView()?.currentSourcePath();
		if (!sourcePath) return;

		note.rationaleState = "loading";
		await this.refreshView();

		try {
			note.rationale = await this.rationale.explain({
				sourceTitle: sourcePath.split("/").pop() ?? sourcePath,
				targetTitle: note.title,
				targetSnippet: note.snippets[0] ?? "",
			});
			note.rationaleState = "idle";
		} catch {
			// A missing LLM must never degrade the list itself.
			note.rationaleState = "failed";
		}
		await this.refreshView();
	}

	private async undoLastLink(): Promise<void> {
		const result = await this.undoStore.undoLast();
		if (!result.ok) {
			notice(result.reason);
			await this.refreshView();
			return;
		}
		const view = this.getView();
		for (const note of view?.currentNotes() ?? []) {
			if (note.vaultPath === result.targetPath) note.applied = false;
		}
		notice("link removed.");
		await this.refreshView();
	}

	async testConnection(): Promise<void> {
		const primary = this.service.primary;
		if (primary instanceof LocalHttpProvider) primary.invalidateRoots();
		this.service.reconfigure(this.settings);

		try {
			const { provider, info } = await this.service.health();
			const files = info.indexedFiles === null ? "" : ` · ${info.indexedFiles} indexed files`;
			notice(`${provider.label} ${info.ok ? "ok" : "reachable"}${files} (${info.detail})`);
		} catch (error) {
			notice(describeError(error));
		}
	}
}

function describeError(error: unknown): string {
	if (error instanceof ProviderError) return error.message;
	if (error instanceof Error) return error.message;
	return "Unexpected error.";
}

function isRetryable(error: unknown): boolean {
	if (!(error instanceof ProviderError)) return true;
	return error.kind === "unreachable" || error.kind === "timeout" || error.kind === "serverError";
}
