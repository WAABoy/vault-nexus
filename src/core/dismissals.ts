import type { PersistedState } from "../settings";

const SEPARATOR = "::";

export function dismissalKey(sourcePath: string, targetPath: string): string {
	return `${sourcePath}${SEPARATOR}${targetPath}`;
}

function splitKey(key: string): [string, string] | null {
	const index = key.indexOf(SEPARATOR);
	if (index === -1) return null;
	return [key.slice(0, index), key.slice(index + SEPARATOR.length)];
}

/**
 * Directional, TTL'd source→target dismissals.
 *
 * Keys hold vault paths, so renames have to be followed or a dismissal silently
 * stops applying (and the suggestion pops back up).
 */
export class DismissalStore {
	constructor(
		private readonly state: PersistedState,
		private readonly onChange: () => void,
	) {}

	private ttlMs(ttlDays: number): number {
		return Math.max(1, ttlDays) * 24 * 60 * 60 * 1000;
	}

	dismiss(sourcePath: string, targetPath: string, ttlDays: number): void {
		this.state.dismissals[dismissalKey(sourcePath, targetPath)] = Date.now() + this.ttlMs(ttlDays);
		this.onChange();
	}

	undismiss(sourcePath: string, targetPath: string): void {
		delete this.state.dismissals[dismissalKey(sourcePath, targetPath)];
		this.onChange();
	}

	isDismissed(sourcePath: string, targetPath: string): boolean {
		const expiry = this.state.dismissals[dismissalKey(sourcePath, targetPath)];
		if (expiry === undefined) return false;
		if (expiry <= Date.now()) {
			delete this.state.dismissals[dismissalKey(sourcePath, targetPath)];
			return false;
		}
		return true;
	}

	/** Number of live dismissals recorded for one source note. */
	countFor(sourcePath: string): number {
		const prefix = `${sourcePath}${SEPARATOR}`;
		const now = Date.now();
		let count = 0;
		for (const [key, expiry] of Object.entries(this.state.dismissals)) {
			if (key.startsWith(prefix) && expiry > now) count++;
		}
		return count;
	}

	size(): number {
		return Object.keys(this.state.dismissals).length;
	}

	clearAll(): number {
		const removed = this.size();
		this.state.dismissals = {};
		this.onChange();
		return removed;
	}

	sweepExpired(): void {
		const now = Date.now();
		let changed = false;
		for (const [key, expiry] of Object.entries(this.state.dismissals)) {
			if (expiry <= now) {
				delete this.state.dismissals[key];
				changed = true;
			}
		}
		if (changed) this.onChange();
	}

	/** Rewrites both sides of every key after a file rename or move. */
	handleRename(oldPath: string, newPath: string): void {
		let changed = false;
		const next: Record<string, number> = {};
		for (const [key, expiry] of Object.entries(this.state.dismissals)) {
			const parts = splitKey(key);
			if (!parts) continue;
			const [source, target] = parts;
			const nextSource = remap(source, oldPath, newPath);
			const nextTarget = remap(target, oldPath, newPath);
			if (nextSource !== source || nextTarget !== target) changed = true;
			next[dismissalKey(nextSource, nextTarget)] = expiry;
		}
		if (changed) {
			this.state.dismissals = next;
			this.onChange();
		}
	}
}

/** Handles both the renamed file itself and any file that moved with its folder. */
function remap(path: string, oldPath: string, newPath: string): string {
	if (path === oldPath) return newPath;
	if (path.startsWith(`${oldPath}/`)) return newPath + path.slice(oldPath.length);
	return path;
}
