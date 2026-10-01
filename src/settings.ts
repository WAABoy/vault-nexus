import type { AppliedLink } from "./types";

export type BackendMode = "local" | "localThenRelay";
export type InsertMode = "end" | "seeAlso" | "cursor";

export interface VaultNexusSettings {
	schemaVersion: 1;

	backend: {
		mode: BackendMode;
		local: { baseUrl: string; timeoutMs: number };
		relay: { enabled: boolean; url: string; token: string; toolName: string };
	};

	search: {
		limit: number;
		minScore: number;
		queryMaxChars: number;
		scopeToVault: boolean;
	};

	paths: {
		autoDetectRoot: boolean;
		miyoRootPrefix: string;
		ignoredFolders: string[];
	};

	filters: {
		skipSelf: boolean;
		skipAlreadyLinked: boolean;
	};

	dismissals: { ttlDays: number };

	linking: {
		insertMode: InsertMode;
		seeAlsoHeading: string;
		asListItem: boolean;
	};

	llm: {
		enabled: boolean;
		baseUrl: string;
		model: string;
		timeoutMs: number;
	};
}

export interface PersistedState {
	/** `${sourcePath}::${targetPath}` -> expiry timestamp (ms). */
	dismissals: Record<string, number>;
	lastApply: AppliedLink | null;
}

export interface PersistedData {
	settings: VaultNexusSettings;
	state: PersistedState;
}

export const DEFAULT_SETTINGS: VaultNexusSettings = {
	schemaVersion: 1,
	backend: {
		mode: "local",
		local: { baseUrl: "http://127.0.0.1:8742", timeoutMs: 20000 },
		relay: { enabled: false, url: "https://relay.miyo.md/mcp", token: "", toolName: "" },
	},
	search: {
		limit: 20,
		minScore: 0,
		queryMaxChars: 1200,
		scopeToVault: true,
	},
	paths: {
		autoDetectRoot: true,
		miyoRootPrefix: "",
		ignoredFolders: ["Templates"],
	},
	filters: {
		skipSelf: true,
		skipAlreadyLinked: true,
	},
	dismissals: { ttlDays: 30 },
	linking: {
		insertMode: "seeAlso",
		seeAlsoHeading: "## See also",
		asListItem: true,
	},
	llm: {
		enabled: false,
		baseUrl: "http://127.0.0.1:1234/v1",
		model: "",
		timeoutMs: 15000,
	},
};

export const DEFAULT_STATE: PersistedState = {
	dismissals: {},
	lastApply: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Deep-merges stored values over the defaults, so a data.json written by an older
 * build (or hand-edited to a partial object) never yields undefined settings.
 */
function mergeDefaults<T>(defaults: T, stored: unknown): T {
	if (!isRecord(stored) || !isRecord(defaults)) return defaults;
	const out: Record<string, unknown> = { ...(defaults as Record<string, unknown>) };
	for (const key of Object.keys(defaults as Record<string, unknown>)) {
		const defValue = (defaults as Record<string, unknown>)[key];
		const storedValue = stored[key];
		if (storedValue === undefined) continue;
		if (Array.isArray(defValue)) {
			if (Array.isArray(storedValue)) out[key] = storedValue;
		} else if (isRecord(defValue)) {
			out[key] = mergeDefaults(defValue, storedValue);
		} else if (typeof storedValue === typeof defValue) {
			out[key] = storedValue;
		}
	}
	return out as T;
}

/** Accepts anything loadData() returns, including `null` and pre-1.0 shapes. */
export function migrate(raw: unknown): PersistedData {
	if (!isRecord(raw)) {
		return { settings: { ...DEFAULT_SETTINGS }, state: { ...DEFAULT_STATE, dismissals: {} } };
	}

	// A file written before settings/state were split stored settings at the top level.
	const settingsSource = isRecord(raw.settings) ? raw.settings : raw;
	const settings = mergeDefaults(DEFAULT_SETTINGS, settingsSource);
	settings.schemaVersion = 1;

	const stateSource = isRecord(raw.state) ? raw.state : {};
	const dismissals: Record<string, number> = {};
	if (isRecord(stateSource.dismissals)) {
		for (const [key, value] of Object.entries(stateSource.dismissals)) {
			if (typeof value === "number" && Number.isFinite(value)) dismissals[key] = value;
		}
	}

	const lastApply = isValidAppliedLink(stateSource.lastApply) ? stateSource.lastApply : null;

	return { settings, state: { dismissals, lastApply } };
}

function isValidAppliedLink(value: unknown): value is AppliedLink {
	if (!isRecord(value)) return false;
	return (
		typeof value.sourcePath === "string" &&
		typeof value.targetPath === "string" &&
		typeof value.insertedText === "string" &&
		typeof value.insertOffset === "number" &&
		typeof value.createdHeading === "boolean" &&
		typeof value.appliedAt === "number"
	);
}
