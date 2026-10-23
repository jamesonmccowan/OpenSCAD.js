import type { FontResolver } from "../index.js";

export interface AvailableFont {
	readonly family: string;
	readonly style: string;
	readonly name: string;
	readonly source: "bundled" | "directory" | "system";
}

export interface SystemFontResolver extends FontResolver {
	/** Enumerates parser-readable faces plus bundled faces. Create a new resolver to refresh directory discovery. */
	listFonts(options?: { signal?: AbortSignal }): Promise<AvailableFont[]>;
}

export interface SystemFontOptions {
	fontDirectories?: readonly string[];
	systemFonts?: boolean;
	maxFontBytes?: number;
	onWarning?: (message: string) => void;
}

/** Searches configured directories first, then installed fonts. Does not substitute families/styles. */
export function createSystemFontResolver(options?: SystemFontOptions): SystemFontResolver;
