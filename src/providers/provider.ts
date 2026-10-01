import type { HealthInfo, MiyoRoot, RawHit } from "../types";

export type ProviderErrorKind =
	| "unreachable"
	| "timeout"
	| "unauthorized"
	| "badRequest"
	| "serverError"
	| "badPayload"
	| "notConfigured"
	| "cancelled";

export class ProviderError extends Error {
	constructor(
		readonly kind: ProviderErrorKind,
		message: string,
		readonly status?: number,
	) {
		super(message);
		this.name = "ProviderError";
	}
}

/** Only outages justify trying the next backend; our own bad requests must not fall through. */
export function isFailoverWorthy(kind: ProviderErrorKind): boolean {
	return kind === "unreachable" || kind === "timeout" || kind === "serverError";
}

export interface SearchRequest {
	query: string;
	limit: number;
	/** Server-side path prefix filter, e.g. ["MyVault/"]. */
	paths?: string[];
}

export interface MiyoProvider {
	readonly id: "local" | "relay";
	readonly label: string;
	health(): Promise<HealthInfo>;
	search(req: SearchRequest): Promise<RawHit[]>;
	/** Indexed roots for path mapping. Relay has no equivalent endpoint and returns []. */
	roots(): Promise<MiyoRoot[]>;
}

/**
 * requestUrl() offers neither a timeout nor an AbortSignal, so a slow backend would
 * otherwise hang the view forever. The socket keeps running; we discard the result.
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, what: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new ProviderError("timeout", `${what} did not respond within ${formatDuration(timeoutMs)}.`));
		}, timeoutMs);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

function formatDuration(ms: number): string {
	return ms < 1000 ? `${ms}ms` : `${Math.round(ms / 100) / 10}s`;
}

/** Miyo reports errors as {"detail": "..."}; fall back to whatever the body was. */
export function extractDetail(body: string): string | null {
	try {
		const parsed: unknown = JSON.parse(body);
		if (parsed && typeof parsed === "object") {
			const detail = (parsed as Record<string, unknown>).detail;
			if (typeof detail === "string") return detail;
			const error = (parsed as Record<string, unknown>).error;
			if (typeof error === "string") return error;
		}
	} catch {
		// not JSON — fall through
	}
	const trimmed = body.trim();
	return trimmed.length > 0 && trimmed.length < 200 ? trimmed : null;
}

export function errorForStatus(status: number, body: string, what: string): ProviderError {
	const detail = extractDetail(body);
	if (status === 401 || status === 403) {
		return new ProviderError("unauthorized", detail ?? `${what} rejected the credentials.`, status);
	}
	if (status >= 500) {
		return new ProviderError("serverError", detail ?? `${what} error ${status}.`, status);
	}
	if (status >= 400) {
		return new ProviderError("badRequest", detail ?? `${what} rejected the request.`, status);
	}
	return new ProviderError("badPayload", detail ?? `Unexpected response from ${what}.`, status);
}
