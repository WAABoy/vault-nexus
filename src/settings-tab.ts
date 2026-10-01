import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type VaultNexusPlugin from "./main";
import type { BackendMode, InsertMode } from "./settings";

export class VaultNexusSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: VaultNexusPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		this.renderBackend(containerEl);
		this.renderSearch(containerEl);
		this.renderSuggestions(containerEl);
		this.renderLinking(containerEl);
		this.renderLlm(containerEl);
	}

	private async save(): Promise<void> {
		await this.plugin.persist();
		this.plugin.reconfigure();
	}

	private renderBackend(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Miyo backend").setHeading();

		new Setting(containerEl)
			.setName("Local service URL")
			.setDesc("The Miyo desktop app's local HTTP API. This is the default and only required backend.")
			.addText((text) =>
				text
					.setPlaceholder("http://127.0.0.1:8742")
					.setValue(this.plugin.settings.backend.local.baseUrl)
					.onChange(async (value) => {
						this.plugin.settings.backend.local.baseUrl = value.trim();
						await this.save();
					}),
			);

		new Setting(containerEl)
			.setName("Request timeout")
			.setDesc("Seconds to wait for Miyo before giving up.")
			.addText((text) =>
				text
					.setValue(String(Math.round(this.plugin.settings.backend.local.timeoutMs / 1000)))
					.onChange(async (value) => {
						const seconds = Number(value);
						if (Number.isFinite(seconds) && seconds > 0) {
							this.plugin.settings.backend.local.timeoutMs = Math.round(seconds * 1000);
							await this.save();
						}
					}),
			);

		new Setting(containerEl)
			.setName("Test connection")
			.setDesc("Checks the backend and refreshes the indexed-folder mapping.")
			.addButton((button) =>
				button.setButtonText("Test").onClick(async () => {
					button.setDisabled(true);
					await this.plugin.testConnection();
					button.setDisabled(false);
				}),
			);

		new Setting(containerEl)
			.setName("Fallback to Miyo Relay")
			.setDesc("Optional. Only used when the local service is unreachable. Requires a token.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.backend.mode === "localThenRelay")
					.onChange(async (value) => {
						const mode: BackendMode = value ? "localThenRelay" : "local";
						this.plugin.settings.backend.mode = mode;
						this.plugin.settings.backend.relay.enabled = value;
						await this.save();
						this.display();
					}),
			);

		if (this.plugin.settings.backend.mode !== "localThenRelay") return;

		new Setting(containerEl).setName("Relay URL").addText((text) =>
			text
				.setPlaceholder("https://relay.miyo.md/mcp")
				.setValue(this.plugin.settings.backend.relay.url)
				.onChange(async (value) => {
					this.plugin.settings.backend.relay.url = value.trim();
					await this.save();
				}),
		);

		new Setting(containerEl)
			.setName("Relay token")
			.setDesc("Stored in this vault's plugin data folder in plain text.")
			.addText((text) => {
				text.inputEl.type = "password";
				text
					.setValue(this.plugin.settings.backend.relay.token)
					.onChange(async (value) => {
						this.plugin.settings.backend.relay.token = value.trim();
						await this.save();
					});
			});

		new Setting(containerEl)
			.setName("Search tool name")
			.setDesc("Leave empty to discover it automatically via tools/list.")
			.addText((text) =>
				text
					.setPlaceholder("auto-detect")
					.setValue(this.plugin.settings.backend.relay.toolName)
					.onChange(async (value) => {
						this.plugin.settings.backend.relay.toolName = value.trim();
						await this.save();
					}),
			);
	}

	private renderSearch(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Search").setHeading();

		new Setting(containerEl)
			.setName("Result limit")
			.setDesc("How many hits to request from Miyo before filtering.")
			.addSlider((slider) =>
				slider
					.setLimits(5, 100, 5)
					.setValue(this.plugin.settings.search.limit)
					.onChange(async (value) => {
						this.plugin.settings.search.limit = value;
						await this.save();
					}),
			);

		new Setting(containerEl)
			.setName("Query length")
			.setDesc("Characters of the note (title plus opening) sent as the search query.")
			.addSlider((slider) =>
				slider
					.setLimits(200, 4000, 100)
					.setValue(this.plugin.settings.search.queryMaxChars)
					.onChange(async (value) => {
						this.plugin.settings.search.queryMaxChars = value;
						await this.save();
					}),
			);

		new Setting(containerEl)
			.setName("Restrict to this vault")
			.setDesc("Asks Miyo to search only the indexed folders that live inside this vault.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.search.scopeToVault).onChange(async (value) => {
					this.plugin.settings.search.scopeToVault = value;
					await this.save();
				}),
			);

		new Setting(containerEl)
			.setName("Detect the Miyo folder automatically")
			.setDesc("Maps Miyo paths to vault paths using its indexed-folder list. Turn off to set the prefix by hand.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.paths.autoDetectRoot).onChange(async (value) => {
					this.plugin.settings.paths.autoDetectRoot = value;
					await this.save();
					this.display();
				}),
			);

		if (!this.plugin.settings.paths.autoDetectRoot) {
			new Setting(containerEl)
				.setName("Miyo folder prefix")
				.setDesc('The folder name Miyo prefixes to results, e.g. "MyVault".')
				.addText((text) =>
					text
						.setValue(this.plugin.settings.paths.miyoRootPrefix)
						.onChange(async (value) => {
							this.plugin.settings.paths.miyoRootPrefix = value.trim();
							await this.save();
						}),
				);
		}
	}

	private renderSuggestions(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Suggestions").setHeading();

		new Setting(containerEl)
			.setName("Hide notes that are already linked")
			.setDesc("They still appear, marked as linked, but cannot be linked again.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.filters.skipAlreadyLinked).onChange(async (value) => {
					this.plugin.settings.filters.skipAlreadyLinked = value;
					await this.save();
				}),
			);

		new Setting(containerEl)
			.setName("Ignored folders")
			.setDesc("Comma-separated vault folders never suggested.")
			.addText((text) =>
				text
					.setPlaceholder("Templates, Archive")
					.setValue(this.plugin.settings.paths.ignoredFolders.join(", "))
					.onChange(async (value) => {
						this.plugin.settings.paths.ignoredFolders = value
							.split(",")
							.map((part) => part.trim())
							.filter((part) => part.length > 0);
						await this.save();
					}),
			);

		new Setting(containerEl)
			.setName("Remember dismissals for")
			.setDesc("Days a dismissed suggestion stays hidden for that note.")
			.addSlider((slider) =>
				slider
					.setLimits(1, 365, 1)
					.setValue(this.plugin.settings.dismissals.ttlDays)
					.onChange(async (value) => {
						this.plugin.settings.dismissals.ttlDays = value;
						await this.save();
					}),
			);

		new Setting(containerEl)
			.setName("Clear all dismissals")
			.addButton((button) =>
				button.setButtonText("Clear").onClick(async () => {
					const removed = this.plugin.dismissals.clearAll();
					await this.plugin.persist();
					new Notice(`Vault Nexus: cleared ${removed} dismissal${removed === 1 ? "" : "s"}.`);
				}),
			);
	}

	private renderLinking(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Linking").setHeading();

		new Setting(containerEl)
			.setName("Where to insert the link")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("seeAlso", 'Under a "See also" heading')
					.addOption("end", "At the end of the note")
					.addOption("cursor", "At the cursor")
					.setValue(this.plugin.settings.linking.insertMode)
					.onChange(async (value) => {
						this.plugin.settings.linking.insertMode = value as InsertMode;
						await this.save();
					}),
			);

		new Setting(containerEl)
			.setName("Heading text")
			.setDesc("Reused when the note already has it, created otherwise.")
			.addText((text) =>
				text
					.setPlaceholder("## See also")
					.setValue(this.plugin.settings.linking.seeAlsoHeading)
					.onChange(async (value) => {
						this.plugin.settings.linking.seeAlsoHeading = value.trim() || "## See also";
						await this.save();
					}),
			);

		new Setting(containerEl)
			.setName("Insert as a list item")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.linking.asListItem).onChange(async (value) => {
					this.plugin.settings.linking.asListItem = value;
					await this.save();
				}),
			);
	}

	private renderLlm(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Relation rationale (optional)").setHeading();

		new Setting(containerEl)
			.setName("Explain relations with a local LLM")
			.setDesc("Adds a per-result Why? button. Off by default; everything else works without it.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.llm.enabled).onChange(async (value) => {
					this.plugin.settings.llm.enabled = value;
					await this.save();
					this.display();
				}),
			);

		if (!this.plugin.settings.llm.enabled) return;

		new Setting(containerEl)
			.setName("OpenAI-compatible endpoint")
			.setDesc("LM Studio's default is http://127.0.0.1:1234/v1")
			.addText((text) =>
				text
					.setPlaceholder("http://127.0.0.1:1234/v1")
					.setValue(this.plugin.settings.llm.baseUrl)
					.onChange(async (value) => {
						this.plugin.settings.llm.baseUrl = value.trim();
						await this.save();
					}),
			);

		new Setting(containerEl)
			.setName("Model")
			.setDesc("Leave empty to use the first model the endpoint lists.")
			.addText((text) =>
				text
					.setPlaceholder("auto")
					.setValue(this.plugin.settings.llm.model)
					.onChange(async (value) => {
						this.plugin.settings.llm.model = value.trim();
						await this.save();
					}),
			);
	}
}
