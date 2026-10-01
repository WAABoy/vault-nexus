import type { VaultNexusSettings } from "../settings";
import { LocalHttpProvider } from "./local-http";
import type { MiyoProvider } from "./provider";
import { RelayMcpProvider } from "./relay-mcp";

/**
 * The provider chain, in the order it should be tried.
 *
 * Local is always first and always present — the plugin must be useful with no
 * relay token configured. Relay is appended only when explicitly enabled.
 */
export function buildProviderChain(settings: VaultNexusSettings): MiyoProvider[] {
	const local = new LocalHttpProvider({
		baseUrl: settings.backend.local.baseUrl,
		timeoutMs: settings.backend.local.timeoutMs,
	});

	const useRelay = settings.backend.mode === "localThenRelay" && settings.backend.relay.enabled;
	if (!useRelay) return [local];

	const relay = new RelayMcpProvider({
		url: settings.backend.relay.url,
		token: settings.backend.relay.token,
		toolName: settings.backend.relay.toolName,
		timeoutMs: settings.backend.local.timeoutMs,
	});
	return [local, relay];
}

export { LocalHttpProvider, RelayMcpProvider };
export type { MiyoProvider };
