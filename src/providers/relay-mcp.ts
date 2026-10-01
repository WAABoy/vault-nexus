import { requestUrl } from "obsidian";
import type { HealthInfo, MiyoRoot, RawHit } from "../types";
import { toRawHit } from "./local-http";
import {
	errorForStatus,
	MiyoProvider,
	ProviderError,
	SearchRequest,
	withTimeout,
} from "./provider";

interface RelayConfig {
	url: string;
	token: string;
	toolName: string;
	timeoutMs: number;
}

interface McpTool {
	name: string;
	description?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Optional fallback over the authenticated Miyo Relay MCP endpoint.
 *
 * Deliberately not on the happy path: the plugin is fully usable without a token,
 * and this provider is only reached when the local service is down and the user
 * has opted in.
 */
export class RelayMcpProvider implements MiyoProvider {
	readonly id = "relay" as const;
	readonly label = "relay";

	private toolCache: string | null = null;
	private nextId = 1;

	constructor(private readonly config: RelayConfig) {}

	private ensureConfigured(): void {
		if (!this.config.url.trim()) {
			throw new ProviderError("notConfigured", "No relay URL is set.");
		}
		if (!this.config.token.trim()) {
			throw new ProviderError("notConfigured", "Relay is enabled but no token is set.");
		}
	}

	private async rpc(method: string, params: unknown): Promise<unknown> {
		this.ensureConfigured();
		let response;
		try {
			response = await withTimeout(
				requestUrl({
					url: this.config.url,
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Accept: "application/json, text/event-stream",
						Authorization: `Bearer ${this.config.token}`,
					},
					body: JSON.stringify({
						jsonrpc: "2.0",
						id: this.nextId++,
						method,
						params,
					}),
					throw: false,
				}),
				this.config.timeoutMs,
				"Miyo Relay",
			);
		} catch (error) {
			if (error instanceof ProviderError) throw error;
			throw new ProviderError("unreachable", `Miyo Relay is not reachable at ${this.config.url}.`);
		}

		if (response.status < 200 || response.status >= 300) {
			throw errorForStatus(response.status, response.text ?? "", "Miyo Relay");
		}

		const payload = parseRpcBody(response.text);
		if (!isRecord(payload)) {
			throw new ProviderError("badPayload", "Unexpected relay response.");
		}
		if (isRecord(payload.error)) {
			const message =
				typeof payload.error.message === "string" ? payload.error.message : "Relay call failed.";
			throw new ProviderError("badRequest", message);
		}
		return payload.result;
	}

	async health(): Promise<HealthInfo> {
		const tool = await this.resolveTool();
		return { ok: true, indexedFiles: null, detail: `relay reachable, tool "${tool}"` };
	}

	private async resolveTool(): Promise<string> {
		if (this.config.toolName.trim()) return this.config.toolName.trim();
		if (this.toolCache) return this.toolCache;

		const result = await this.rpc("tools/list", {});
		const tools: McpTool[] = [];
		if (isRecord(result) && Array.isArray(result.tools)) {
			for (const entry of result.tools) {
				if (isRecord(entry) && typeof entry.name === "string") {
					tools.push({ name: entry.name });
				}
			}
		}
		const match = tools.find((tool) => /search/i.test(tool.name));
		if (!match) {
			throw new ProviderError(
				"notConfigured",
				tools.length === 0
					? "The relay exposed no tools."
					: `No search tool found. Available: ${tools.map((t) => t.name).join(", ")}. Set the tool name in settings.`,
			);
		}
		this.toolCache = match.name;
		return match.name;
	}

	async search(req: SearchRequest): Promise<RawHit[]> {
		const toolName = await this.resolveTool();
		const args: Record<string, unknown> = {
			query: req.query,
			limit: req.limit,
			source: "documents",
		};
		if (req.paths && req.paths.length > 0) args.paths = req.paths;

		const result = await this.rpc("tools/call", { name: toolName, arguments: args });
		return extractHits(result);
	}

	async roots(): Promise<MiyoRoot[]> {
		// The relay exposes no folder endpoint; PathMapper falls back to prefix mode.
		return [];
	}
}

/** The relay may answer a POST with SSE framing; take the last data: line if so. */
export function parseRpcBody(text: string): unknown {
	const trimmed = text.trim();
	if (!trimmed) return null;
	if (!trimmed.startsWith("event:") && !trimmed.startsWith("data:")) {
		try {
			return JSON.parse(trimmed);
		} catch {
			return null;
		}
	}
	const dataLines = trimmed
		.split("\n")
		.filter((line) => line.startsWith("data:"))
		.map((line) => line.slice(5).trim());
	for (let i = dataLines.length - 1; i >= 0; i--) {
		try {
			return JSON.parse(dataLines[i]);
		} catch {
			continue;
		}
	}
	return null;
}

/** MCP wraps results in content blocks; the search payload is JSON inside a text block. */
export function extractHits(result: unknown): RawHit[] {
	if (!isRecord(result)) {
		throw new ProviderError("badPayload", "Unexpected relay search result.");
	}

	if (isRecord(result.structuredContent)) {
		const hits = hitsFromPayload(result.structuredContent);
		if (hits) return hits;
	}

	if (Array.isArray(result.content)) {
		for (const block of result.content) {
			if (!isRecord(block) || block.type !== "text" || typeof block.text !== "string") continue;
			let parsed: unknown;
			try {
				parsed = JSON.parse(block.text);
			} catch {
				continue;
			}
			const hits = hitsFromPayload(parsed);
			if (hits) return hits;
		}
	}

	throw new ProviderError("badPayload", "The relay returned no readable search results.");
}

function hitsFromPayload(payload: unknown): RawHit[] | null {
	const list = Array.isArray(payload)
		? payload
		: isRecord(payload) && Array.isArray(payload.results)
			? payload.results
			: null;
	if (!list) return null;
	const hits = list.filter(isRecord).map(toRawHit);
	return hits.every((hit) => hit.path.length > 0) ? hits : null;
}
