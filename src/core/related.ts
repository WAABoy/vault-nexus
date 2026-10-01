import type { App, TFile } from "obsidian";
import { MIN_SEARCH_INTERVAL_MS } from "../constants";
import { buildProviderChain } from "../providers";
import { isFailoverWorthy, MiyoProvider, ProviderError } from "../providers/provider";
import type { VaultNexusSettings } from "../settings";
import type { HealthInfo, SearchOutcome } from "../types";
import type { DismissalStore } from "./dismissals";
import { toRelatedNotes } from "./filters";
import { PathMapper } from "./path-map";
import { buildQuery, isQueryUsable } from "./query";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs one search at a time and guarantees only the newest one reaches the UI.
 *
 * Obsidian's requestUrl() takes no AbortSignal, so a superseded request cannot be
 * torn down at the socket. A monotonic generation counter gives the same
 * observable behaviour: a stale response is dropped instead of rendered.
 */
export class RelatedService {
	private generation = 0;
	private lastDispatch = 0;
	private providers: MiyoProvider[];
	private mapper: PathMapper;
	private rootsLoaded = false;

	constructor(
		private readonly app: App,
		private settings: VaultNexusSettings,
		private readonly dismissals: DismissalStore,
	) {
		this.providers = buildProviderChain(settings);
		this.mapper = new PathMapper(app.vault, settings.paths.miyoRootPrefix);
	}

	/** Rebuilds the backend chain and drops cached roots after a settings change. */
	reconfigure(settings: VaultNexusSettings): void {
		this.settings = settings;
		this.providers = buildProviderChain(settings);
		this.mapper = new PathMapper(this.app.vault, settings.paths.miyoRootPrefix);
		this.rootsLoaded = false;
	}

	/** Invalidates the newest in-flight search; its result will be discarded. */
	cancel(): void {
		this.generation++;
	}

	get primary(): MiyoProvider {
		return this.providers[0];
	}

	async health(): Promise<{ provider: MiyoProvider; info: HealthInfo }> {
		let lastError: unknown = null;
		for (const provider of this.providers) {
			try {
				const info = await provider.health();
				return { provider, info };
			} catch (error) {
				lastError = error;
				if (error instanceof ProviderError && !isFailoverWorthy(error.kind)) throw error;
			}
		}
		throw lastError ?? new ProviderError("unreachable", "No backend answered.");
	}

	private async ensureRoots(provider: MiyoProvider): Promise<void> {
		if (this.rootsLoaded || !this.settings.paths.autoDetectRoot) return;
		try {
			this.mapper.setRoots(await provider.roots());
			this.rootsLoaded = true;
		} catch {
			// Root discovery is best-effort: the mapper still verifies every candidate
			// against the vault, so search stays usable without it.
			this.rootsLoaded = true;
		}
	}

	async searchFor(file: TFile): Promise<SearchOutcome> {
		const myGen = ++this.generation;
		const started = Date.now();

		// Rate limit: never dispatch two searches inside the same short window.
		const sinceLast = Date.now() - this.lastDispatch;
		if (sinceLast < MIN_SEARCH_INTERVAL_MS) {
			await sleep(MIN_SEARCH_INTERVAL_MS - sinceLast);
			this.assertCurrent(myGen);
		}
		this.lastDispatch = Date.now();

		const content = await this.app.vault.cachedRead(file);
		this.assertCurrent(myGen);

		const query = buildQuery(file.basename, content, this.settings.search.queryMaxChars);
		if (!isQueryUsable(query)) {
			return {
				notes: [],
				backendId: "none",
				backendLabel: "none",
				elapsedMs: Date.now() - started,
				filteredOut: 0,
			};
		}

		let lastError: unknown = null;
		for (const provider of this.providers) {
			try {
				await this.ensureRoots(provider);
				this.assertCurrent(myGen);

				const aliases = this.mapper.vaultRootAliases();
				const paths =
					this.settings.search.scopeToVault && aliases.length > 0
						? aliases.map((alias) => `${alias}/`)
						: undefined;

				const hits = await provider.search({
					query,
					limit: this.settings.search.limit,
					paths,
				});
				this.assertCurrent(myGen);

				this.dismissals.sweepExpired();
				const { notes, filteredOut } = toRelatedNotes(hits, {
					app: this.app,
					settings: this.settings,
					mapper: this.mapper,
					dismissals: this.dismissals,
					sourceFile: file,
				});

				return {
					notes,
					backendId: provider.id,
					backendLabel: provider.label,
					elapsedMs: Date.now() - started,
					filteredOut,
				};
			} catch (error) {
				lastError = error;
				if (error instanceof ProviderError) {
					if (error.kind === "cancelled") throw error;
					if (!isFailoverWorthy(error.kind)) throw error;
				} else {
					throw error;
				}
			}
		}

		throw lastError ?? new ProviderError("unreachable", "No backend answered.");
	}

	private assertCurrent(myGen: number): void {
		if (myGen !== this.generation) {
			throw new ProviderError("cancelled", "Superseded by a newer search.");
		}
	}
}
