import { FileSystemAdapter, TFile, Vault } from "obsidian";
import type { MiyoRoot } from "../types";

function normalizeSeparators(input: string): string {
	return input.replace(/\\/g, "/").replace(/\/+$/, "");
}

/**
 * Translates a Miyo hit path into a file inside this vault.
 *
 * Miyo returns paths prefixed with the *alias* of the indexed root, e.g.
 * "MyVault/Projects/Home.md" for a root whose absolute_path is
 * "/home/user/Documents/Obsidian/MyVault". Those prefixes have to come off, and
 * hits from roots outside the vault (Miyo also indexes the chat archives) must
 * be dropped rather than guessed at.
 */
export class PathMapper {
	private roots: MiyoRoot[] = [];
	private readonly vaultBase: string | null;

	constructor(
		private readonly vault: Vault,
		private readonly manualPrefix: string,
	) {
		const adapter = this.vault.adapter;
		this.vaultBase =
			adapter instanceof FileSystemAdapter ? normalizeSeparators(adapter.getBasePath()) : null;
	}

	setRoots(roots: MiyoRoot[]): void {
		this.roots = roots.map((root) => ({
			alias: normalizeSeparators(root.alias),
			absolutePath: normalizeSeparators(root.absolutePath),
		}));
	}

	/** Roots whose absolute path lies inside (or is) the vault — used to scope searches. */
	vaultRootAliases(): string[] {
		if (!this.vaultBase) return [];
		return this.roots
			.filter(
				(root) =>
					root.absolutePath === this.vaultBase ||
					root.absolutePath.startsWith(`${this.vaultBase}/`),
			)
			.map((root) => root.alias);
	}

	/**
	 * Returns the vault file for a hit path, or null when the hit lives outside the
	 * vault (or no longer exists). Every candidate is verified against the vault, so
	 * an imperfect prefix guess can never produce a broken row.
	 */
	resolve(hitPath: string): TFile | null {
		const raw = normalizeSeparators(hitPath);
		if (!raw) return null;

		for (const candidate of this.candidates(raw)) {
			const file = this.vault.getAbstractFileByPath(candidate);
			if (file instanceof TFile) return file;
		}
		return null;
	}

	/** Candidate vault-relative paths, most trustworthy first. */
	private candidates(raw: string): string[] {
		const out: string[] = [];
		const push = (value: string) => {
			const cleaned = value.replace(/^\/+/, "");
			if (cleaned && !out.includes(cleaned)) out.push(cleaned);
		};

		// 1. Exact root mapping via /v0/folder — the authoritative path.
		if (this.vaultBase) {
			for (const root of this.roots) {
				if (raw !== root.alias && !raw.startsWith(`${root.alias}/`)) continue;
				const absolute = root.absolutePath + raw.slice(root.alias.length);
				if (absolute === this.vaultBase) continue;
				if (absolute.startsWith(`${this.vaultBase}/`)) {
					push(absolute.slice(this.vaultBase.length + 1));
				}
				// Matched a root but landed outside the vault: a genuine outside-vault hit.
				return out;
			}
		}

		// 2. Manual prefix override (also the relay path, which has no /v0/folder).
		const prefix = normalizeSeparators(this.manualPrefix);
		if (prefix && raw.startsWith(`${prefix}/`)) push(raw.slice(prefix.length + 1));

		// 3. Absolute path that happens to sit under the vault.
		if (this.vaultBase && raw.startsWith(`${this.vaultBase}/`)) {
			push(raw.slice(this.vaultBase.length + 1));
		}

		// 4. The path as given, then progressively stripped leading segments. Each is
		//    verified against the vault by the caller, so this stays safe.
		push(raw);
		const segments = raw.split("/");
		for (let i = 1; i < segments.length && i <= 3; i++) {
			push(segments.slice(i).join("/"));
		}

		return out;
	}
}
