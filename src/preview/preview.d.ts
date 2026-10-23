import type { CompileRequest, Diagnostic, EvaluationMode, WorkerEngineOptions } from "../index.js";

export type PreviewProject = Omit<CompileRequest, "mode" | "signal" | "auditOnly" | "auditComponents">;
export type PreviewOptions = {
	editable?: boolean;
	/** Advanced worker/asset overrides; defaults require no configuration. */
	workerOptions?: WorkerEngineOptions;
} & ({ source: string; project?: never } | { source?: never; project: PreviewProject });

export interface PreviewOutcome {
	readonly status: "success" | "error" | "cancelled" | "superseded" | "disposed";
	readonly diagnostics: readonly Diagnostic[];
}

export interface PreviewState {
	readonly status: "waiting" | "initializing" | "ready" | "busy" | "modified" | "cancelled" | "error" | "disposed";
	readonly stale: boolean;
	readonly diagnostics: readonly Diagnostic[];
	readonly echoes: readonly string[];
	/** Volume and mode of the displayed model, not of a download-only compilation. */
	readonly volume?: number;
	readonly mode?: EvaluationMode;
}

export interface Preview {
	/** Settles after the first automatic attempt, explicit operation, or disposal.
	 * Offscreen instances wait until visible or explicitly operated.
	 * Operational failures are returned and displayed, not thrown.
	 */
	readonly ready: Promise<PreviewOutcome>;
	readonly state: PreviewState;
	preview(): Promise<PreviewOutcome>;
	render(): Promise<PreviewOutcome>;
	/** Compiles a fresh render-mode snapshot; does not replace the displayed model. */
	downloadStl(): Promise<PreviewOutcome>;
	stop(): void;
	/** Idempotent; waits for pending startup and worker termination. */
	dispose(): Promise<void>;
}

/** Mounts local UI without waiting for visibility, worker startup, or compilation.
 * Invalid mount/options reject. Runtime failures are visible in state and operation outcomes.
 */
export function createPreview(container: HTMLElement, options: PreviewOptions): Promise<Preview>;
