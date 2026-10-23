export type EvaluationMode = "preview" | "render";
export type ScadValue = number | boolean | string | undefined | readonly ScadValue[] | ScadObjectValue;
export interface ScadObjectValue { readonly [key: string]: ScadValue; }

export interface SourceLocation {
	readonly file: string;
	readonly line: number;
	readonly column: number;
	readonly offset?: number;
}

export interface Diagnostic {
	readonly severity: "warning" | "error";
	readonly code: string;
	readonly message: string;
	readonly location?: SourceLocation;
}

export interface SemanticNode {
	readonly id: number;
	readonly kind: string;
	readonly children: readonly SemanticNode[];
	readonly location?: SourceLocation;
	readonly [key: string]: unknown;
}

export interface CapabilityManifest {
	readonly profile: string;
	readonly status: "partial";
	readonly syntax: readonly string[];
	readonly geometry: readonly string[];
	readonly unsupported: readonly string[];
}

export interface EvaluatorOptions {
	mode?: EvaluationMode;
	time?: number;
	randomSeed?: number;
	file?: string;
	specialVariables?: Readonly<Record<string, ScadValue>>;
	defines?: Readonly<Record<string, ScadValue>>;
	defineExpressions?: readonly string[];
	experimental?: readonly ("roof" | "object-function" | "import-function" | "vector-swizzle")[];
	signal?: AbortSignal;
	maxSteps?: number;
	maxDepth?: number;
}

export interface Evaluation {
	readonly tree: SemanticNode;
	readonly diagnostics: readonly Diagnostic[];
	readonly echoes: readonly string[];
	readonly mode: EvaluationMode;
	readonly profile: string;
	readonly capabilities: CapabilityManifest;
	readonly view: Readonly<Record<string, ScadValue>>;
}

export interface Statement {
	readonly type: string;
	readonly location: SourceLocation;
	readonly [key: string]: unknown;
}

export type SourceFiles = Readonly<Record<string, string>> | ReadonlyMap<string, string>;
export type SourceResolver = (path: string, context: { signal?: AbortSignal }) => string | undefined | Promise<string | undefined>;
export type FontResolver = (name: string, context: { signal?: AbortSignal }) => Uint8Array | ArrayBuffer | undefined | Promise<Uint8Array | ArrayBuffer | undefined>;

export interface ProjectOptions {
	entry?: string;
	files?: SourceFiles;
	libraryPaths?: readonly string[];
	resolver?: SourceResolver;
	signal?: AbortSignal;
	maxFiles?: number;
	maxIncludeDepth?: number;
	maxProjectBytes?: number;
	maxStatements?: number;
}

export interface ResolvedProject {
	readonly entry: string;
	readonly statements: readonly Statement[];
	readonly dependencies: readonly string[];
	readonly sourceBytes: number;
}

export interface CompileRequest extends ProjectOptions, EvaluatorOptions {
	/** Runtime font files keyed by Family:style=Style. No automatic substitution. */
	fonts?: Readonly<Record<string, Uint8Array | ArrayBuffer>> | ReadonlyMap<string, Uint8Array | ArrayBuffer>;
	fontResolver?: FontResolver;
	/** Total supplied/resolved font bytes per compile (default 20000000); at most 128 loaded faces. */
	maxFontBytes?: number;
	assets?: Readonly<Record<string, Uint8Array | ArrayBuffer | string>> | ReadonlyMap<string, Uint8Array | ArrayBuffer | string>;
	assetResolver?: (path: string, context: { signal?: AbortSignal }) => Uint8Array | ArrayBuffer | string | undefined | Promise<Uint8Array | ArrayBuffer | string | undefined>;
	maxAssetBytes?: number;
	profile?: string;
	context?: { time?: number; viewport?: { $vpt?: readonly number[]; $vpr?: readonly number[]; $vpd?: number; $vpf?: number } };
	maxTriangles?: number;
	hardWarnings?: boolean;
	auditOnly?: boolean;
	auditComponents?: boolean;
	maxAuditComponents?: number;
	interferenceEpsilon?: number;
	/** Report non-overlapping audit part pairs closer than this many mm (default 0). */
	auditClearance?: number;
}

export interface MeshData {
	numProp: number;
	vertProperties: Float32Array;
	triVerts: Uint32Array;
	runIndex?: Uint32Array;
	runOriginalID?: Uint32Array;
}

export interface PreviewOverlay {
	readonly kind: "background" | "debug";
	readonly source: number;
	readonly mesh: MeshData;
}

export interface CompileMetadata {
	readonly apiVersion: number;
	readonly id: number;
	readonly mode: string;
	readonly profile: string;
	readonly backend: string;
	readonly diagnostics: readonly Diagnostic[];
	readonly echoes: readonly string[];
	readonly dependencies: readonly string[];
	readonly timings: Readonly<{ resolveMs: number; evaluateMs: number; geometryMs: number; totalMs: number }>;
}

export interface SuccessfulCompilation extends CompileMetadata {
	readonly status: "success";
	readonly mode: EvaluationMode;
	readonly tree: SemanticNode;
	readonly layers: { readonly background: readonly SemanticNode[]; readonly debug: readonly SemanticNode[] };
	readonly bounds: readonly (readonly number[])[] | null;
	readonly volume: number;
	readonly empty: boolean;
	readonly materials: Readonly<Record<string, { readonly appearance: Readonly<Record<string, ScadValue>>; readonly source: number; readonly location?: SourceLocation }>>;
	readonly componentAudit?: ComponentAudit;
	readonly auditOnly?: boolean;
	readonly view: Readonly<Record<string, ScadValue>>;
	getMesh(): MeshData;
	getOverlays(): PreviewOverlay[];
	dispose(): void;
}

export interface ComponentAuditPart {
	readonly name: string;
	readonly volume: number;
	readonly triangles: number;
	readonly bounds: readonly (readonly number[])[];
}

export interface ComponentInterference {
	readonly parts: readonly [string, string];
	readonly volume: number;
	readonly bounds: readonly (readonly number[])[];
}

/** A non-overlapping pair: touching (gap within contactTolerance) or closer than the clearance. */
export interface ComponentProximity {
	readonly parts: readonly [string, string];
	readonly gap: number;
	/** Overlap volume at or below epsilon; only present on contacts. */
	readonly volume?: number;
}

export interface ComponentAudit {
	readonly components: readonly ComponentAuditPart[];
	readonly interferences: readonly ComponentInterference[];
	readonly contacts: readonly ComponentProximity[];
	readonly clearances: readonly ComponentProximity[];
	readonly epsilon: number;
	readonly clearance: number;
	readonly contactTolerance: number;
}

export interface FailedCompilation extends CompileMetadata {
	readonly status: "error" | "cancelled";
}

export type Compilation = SuccessfulCompilation | FailedCompilation;

export interface ExportOptions {
	format?: "stl";
	encoding?: "ascii" | "binary";
	allowEmpty?: boolean;
	signal?: AbortSignal;
}

export interface EngineOptions {
	module?: unknown;
	loadModule?: () => Promise<unknown>;
	profile?: string;
	maxPendingJobs?: number;
}

export interface Engine {
	readonly apiVersion: number;
	readonly profile: string;
	readonly backend: string;
	readonly capabilities: CapabilityManifest;
	compile(request?: CompileRequest): Promise<Compilation>;
	export(result: SuccessfulCompilation, options?: ExportOptions): Promise<Uint8Array>;
	dispose(): void;
}

export interface WorkerProgress {
	readonly id?: number;
	readonly operation?: "compile" | "export";
	readonly phase: "queued" | "started" | "finished" | "worker-ready";
}

export interface WorkerEngineOptions {
	profile?: string;
	workerUrl?: string | URL;
	workerFactory?: (url: URL) => unknown | Promise<unknown>;
	/** Defaults to the local Manifold module in browsers; normally no configuration is required. */
	manifoldModuleUrl?: string | URL;
	wasmUrl?: string | URL;
	maxPendingJobs?: number;
	timeoutMs?: number;
	startupTimeoutMs?: number;
	onProgress?: (progress: WorkerProgress) => void;
}

export interface WorkerEngine extends Omit<Engine, "dispose"> {
	compileLatest(request?: CompileRequest, key?: string): Promise<Compilation>;
	dispose(): Promise<void>;
}

export const SERVICE_API_VERSION: 1;
export const WORKER_PROTOCOL_VERSION: 1;
export const BACKEND: "manifold-3d@3.5.4";
export const CAPABILITIES: CapabilityManifest;
export function createEngine(options?: EngineOptions): Promise<Engine>;
export function createWorkerEngine(options?: WorkerEngineOptions): Promise<WorkerEngine>;
export function resolveProject(options?: ProjectOptions): Promise<ResolvedProject>;
export function parse(source: string, options?: { file?: string }): Statement[];
export function evaluate(source: string | readonly Statement[], options?: EvaluatorOptions): Evaluation;
export class Evaluator {
	constructor(options?: EvaluatorOptions);
	run(source: string | readonly Statement[]): Evaluation;
}
export class ScadError extends Error {
	readonly code: string;
	readonly location?: SourceLocation;
	constructor(message: string, location?: SourceLocation, code?: string);
}