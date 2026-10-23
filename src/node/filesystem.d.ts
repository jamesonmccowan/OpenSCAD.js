import type { SourceResolver } from "../index.js";

export interface FilesystemProjectOptions {
	input?: string;
	root?: string;
	libraryPaths?: readonly string[];
	maxFileBytes?: number;
	maxAssetBytes?: number;
}

export interface FilesystemProject {
	readonly entry: string;
	readonly resolver: SourceResolver;
	readonly assetResolver: (path: string, context?: {signal?:AbortSignal}) => Promise<Uint8Array | undefined>;
	readonly libraryPaths: readonly string[];
	readonly root: string;
}

export function createFilesystemProject(options?: FilesystemProjectOptions): Promise<FilesystemProject>;