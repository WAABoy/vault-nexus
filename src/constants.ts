export const VIEW_TYPE_RELATED = "vault-nexus-related";

export const PLUGIN_NAME = "Vault Nexus";

/** Sidebar icon (lucide id shipped with Obsidian). */
export const VIEW_ICON = "link";

/** Minimum delay between two dispatched searches. Requests inside the window are coalesced. */
export const MIN_SEARCH_INTERVAL_MS = 400;

/** Debounce for persisting settings + state to data.json. */
export const SAVE_DEBOUNCE_MS = 250;

/** How long the "undo dismiss" notice stays actionable. */
export const DISMISS_UNDO_MS = 5000;

/** Snippets kept per merged file result. */
export const MAX_SNIPPETS_PER_NOTE = 2;

/** Characters kept per snippet. */
export const SNIPPET_MAX_CHARS = 220;

/**
 * Folders never suggested, regardless of settings. The vault config folder
 * (Vault#configDir) is added at runtime because users can rename it.
 */
export const ALWAYS_IGNORED = [".trash"];
