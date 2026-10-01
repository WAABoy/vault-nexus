import { requestUrl } from "obsidian";
import type { HealthInfo, MiyoRoot, RawHit } from "../types";
import {
	errorForStatus,
	MiyoProvider,
	ProviderError,
	SearchRequest,
	withTimeout,
} from "./provider";

interface LocalConfig {
	baseUrl: string;
	timeoutMs: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function str(value: unknown, fallback: string): string {
	return typeof value === "string" ? value : fallback;
}

/**
 * Talks to the Miyo desktop app's local HTTP API.
 *
 * requestUrl() is mandatory here: the service sends no CORS headers and answers
 * OPTIONS with 501, so a renderer fetch() would be blocked by the preflight.
 */
export class LocalHttpProvider implements MiyoProvider {
	readonly id = "local" as const;
	readonly label = "local";

	private rootsCache: MiyoRoot[] | null = null;

	constructor(private readonly config: LocalConfig) {}

	private get base(): string {
		return this.config.baseUrl.replace(/\/+$/, "");
	}

	private async call(path: string, method: "GET" | "POST", body?: unknown): Promise<unknown> {
		const url = `${this.base}${path}`;
		let response;
		try {
			response = await withTimeout(
				requestUrl({
					url,
					method,
					headers: body === undefined ? {} : { "Content-Type": "application/json" },
					body: body === undefined ? undefined : JSON.stringify(body),
					throw: false,
				}),
				this.config.timeoutMs,
				"Miyo",
			);
		} catch (error) {
			if (error instanceof ProviderError) throw error;
			// requestUrl still rejects on transport failures even with throw:false.
			throw new ProviderError(
				"unreachable",
				`Miyo is not reachable at ${this.base}. Is the Miyo app running?`,
			);
		}

		if (response.status < 200 || response.status >= 300) {
			throw errorForStatus(response.status, response.text ?? "", "Miyo");
		}

		try {
			return JSON.parse(response.text);
		} catch {
			throw new ProviderError("badPayload", "Miyo returned a response that is not JSON.");
		}
	}

	async health(): Promise<HealthInfo> {
		const payload = await this.call("/v0/health", "GET");
		if (!isRecord(payload)) {
			throw new ProviderError("badPayload", "Unexpected health response from Miyo.");
		}
		const status = str(payload.status, "unknown");
		const qdrant = str(payload.qdrant, "unknown");
		const indexedFiles = typeof payload.indexed_files === "number" ? payload.indexed_files : null;
		return {
			ok: status === "ok",
			indexedFiles,
			detail: `status ${status}, qdrant ${qdrant}`,
		};
	}

	async search(req: SearchRequest): Promise<RawHit[]> {
		const body: Record<string, unknown> = {
			query: req.query,
			limit: req.limit,
			source: "documents",
		};
		if (req.paths && req.paths.length > 0) body.paths = req.paths;

		const payload = await this.call("/v0/search", "POST", body);
		if (!isRecord(payload) || !Array.isArray(payload.results)) {
			throw new ProviderError("badPayload", "Unexpected search response from Miyo.");
		}
		return payload.results.filter(isRecord).map(toRawHit);
	}

	async roots(): Promise<MiyoRoot[]> {
		if (this.rootsCache) return this.rootsCache;
		const payload = await this.call("/v0/folder", "GET");
		if (!isRecord(payload) || !Array.isArray(payload.folders)) {
			throw new ProviderError("badPayload", "Unexpected folder response from Miyo.");
		}
		const roots: MiyoRoot[] = [];
		for (const folder of payload.folders) {
			if (!isRecord(folder)) continue;
			const alias = str(folder.path, "");
			const absolutePath = str(folder.absolute_path, "");
			if (alias && absolutePath) roots.push({ alias, absolutePath });
		}
		this.rootsCache = roots;
		return roots;
	}

	/** Forces the next roots() call to hit the service again (used by the Test command). */
	invalidateRoots(): void {
		this.rootsCache = null;
	}
}

export function toRawHit(raw: Record<string, unknown>): RawHit {
	const path = str(raw.path, "");
	return {
		path,
		score: num(raw.score, 0),
		title: typeof raw.title === "string" ? raw.title : null,
		mtime: typeof raw.mtime === "number" ? raw.mtime : null,
		file_name: str(raw.file_name, path.split("/").pop() ?? ""),
		chunk_index: num(raw.chunk_index, 0),
		total_chunks: num(raw.total_chunks, 1),
		chunk_text: str(raw.chunk_text, ""),
	};
}
