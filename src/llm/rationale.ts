import { requestUrl } from "obsidian";
import { ProviderError, withTimeout } from "../providers/provider";
import type { VaultNexusSettings } from "../settings";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface RationaleInput {
	sourceTitle: string;
	targetTitle: string;
	targetSnippet: string;
}

/**
 * One-line explanation of why two notes are related, via an OpenAI-compatible
 * endpoint (LM Studio by default).
 *
 * Strictly optional: disabled by default, requested per row on demand, and every
 * failure degrades to "no rationale" without touching the results list.
 */
export class RationaleClient {
	private cachedModel: string | null = null;

	constructor(private settings: VaultNexusSettings) {}

	reconfigure(settings: VaultNexusSettings): void {
		this.settings = settings;
		this.cachedModel = null;
	}

	private get base(): string {
		return this.settings.llm.baseUrl.replace(/\/+$/, "");
	}

	private async resolveModel(): Promise<string> {
		if (this.settings.llm.model.trim()) return this.settings.llm.model.trim();
		if (this.cachedModel) return this.cachedModel;

		const response = await withTimeout(
			requestUrl({ url: `${this.base}/models`, method: "GET", throw: false }),
			this.settings.llm.timeoutMs,
			"The LLM endpoint",
		);
		if (response.status < 200 || response.status >= 300) {
			throw new ProviderError("serverError", `Model list failed (${response.status}).`);
		}
		const payload: unknown = JSON.parse(response.text);
		const first =
			isRecord(payload) && Array.isArray(payload.data) && isRecord(payload.data[0])
				? payload.data[0].id
				: null;
		if (typeof first !== "string" || !first) {
			throw new ProviderError("badPayload", "The LLM endpoint listed no models.");
		}
		this.cachedModel = first;
		return first;
	}

	async explain(input: RationaleInput): Promise<string> {
		const model = await this.resolveModel();
		const prompt =
			`Note A: "${input.sourceTitle}"\n` +
			`Note B: "${input.targetTitle}"\n` +
			`Excerpt from B: ${input.targetSnippet.slice(0, 500)}\n\n` +
			"In one short sentence, state how B relates to A. No preamble, no quotes.";

		let response;
		try {
			response = await withTimeout(
				requestUrl({
					url: `${this.base}/chat/completions`,
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						model,
						messages: [{ role: "user", content: prompt }],
						max_tokens: 60,
						temperature: 0.2,
						stream: false,
					}),
					throw: false,
				}),
				this.settings.llm.timeoutMs,
				"The LLM endpoint",
			);
		} catch (error) {
			if (error instanceof ProviderError) throw error;
			throw new ProviderError("unreachable", `No LLM endpoint at ${this.base}.`);
		}

		if (response.status < 200 || response.status >= 300) {
			throw new ProviderError("serverError", `The LLM endpoint returned ${response.status}.`);
		}

		const payload: unknown = JSON.parse(response.text);
		const text = firstMessageContent(payload);
		if (!text) throw new ProviderError("badPayload", "The LLM endpoint returned no text.");
		return text.replace(/\s+/g, " ").trim();
	}
}

function firstMessageContent(payload: unknown): string | null {
	if (!isRecord(payload) || !Array.isArray(payload.choices)) return null;
	const choice = payload.choices[0];
	if (!isRecord(choice) || !isRecord(choice.message)) return null;
	const content = choice.message.content;
	return typeof content === "string" && content.trim() ? content : null;
}
