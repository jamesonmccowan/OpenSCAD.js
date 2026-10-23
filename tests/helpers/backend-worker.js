import createModule from "../../node_modules/manifold-3d/manifold.js";
import { geometryCases, languageCases } from "../fixtures/backend-cases.js";
import { copyMesh, measureMesh, runGeometryCase } from "./backend.js";
import { compileScad } from "../../src/core/compiler.js";
import { evaluate } from "../../src/core/evaluator.js";
import { createEngine } from "../../src/index.js";
import { projectCases } from "../fixtures/project-cases.js";

const started = performance.now();
const module = await createModule({
	locateFile: (file) => new URL(`../../node_modules/manifold-3d/${file}`, import.meta.url).href,
});
module.setup();

self.onmessage = ({ data }) => {
	if (data.type === "service") {
		(async () => {
			const engine = await createEngine({ module });
			try {
				const results = [];
				let binary;
				for (const fixture of projectCases) {
					const result = await engine.compile({ ...fixture, mode: "render" });
					if (result.status !== "success") throw new Error(JSON.stringify(result.diagnostics));
					try {
						binary = await engine.export(result);
						const ascii = await engine.export(result, { encoding: "ascii" });
						results.push({ id: fixture.id, volume: result.volume, echoes: result.echoes, dependencies: result.dependencies, ascii: new TextDecoder().decode(ascii).startsWith("solid openscad_js\n") });
					} finally { result.dispose(); }
				}
				self.postMessage({ type: "result", id: data.id, results, binary }, [binary.buffer]);
			} finally { engine.dispose(); }
		})().catch((error) => self.postMessage({ type: "error", id: data.id, message: error.message }));
		return;
	}
	try {
		if (data.type === "compile") {
			const results = geometryCases.map((fixture) => {
				const result = compileScad(fixture.source, module, { mode: "render" });
				try { return { id: fixture.id, ...measureMesh(copyMesh(result.getMesh())) }; }
				finally { result.dispose(); }
			});
			const language = languageCases.map((fixture) => ({ id: fixture.id, echoes: evaluate(fixture.source).echoes }));
			self.postMessage({ type: "result", id: data.id, results, language });
			return;
		}
		if (data.type !== "run") throw new Error("Unknown request type");
		self.postMessage({ type: "started", id: data.id });
		const started = performance.now();
		const results = [];
		for (let cycle = 0; cycle < (data.cycles ?? 1); cycle++) {
			for (const fixture of geometryCases) {
				const result = runGeometryCase(module, fixture);
				if (cycle === 0) results.push(result);
			}
		}
		self.postMessage({ type: "result", id: data.id, results, elapsedMs: performance.now() - started });
	} catch (error) {
		self.postMessage({ type: "error", id: data.id, message: error.message });
	}
};

self.postMessage({ type: "ready", initializationMs: performance.now() - started, isolated: self.crossOriginIsolated });