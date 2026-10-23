import { normalizePath } from "../core/project.js";

export class StudioProject {
	constructor(source = "", name = "model.scad") {
		this.files = new Map([[normalizePath(name), source]]);
		this.assets = new Map();
		this.original = new Map(this.files);
		this.entry = normalizePath(name);
		this.active = this.entry;
		this.dependencies = new Set([this.entry]);
		this.revision = 0;
		this.lastSuccess = false;
		this.compileDirty = true;
	}
	edit(text) {
		if (this.files.get(this.active) === text) return false;
		this.compileDirty ||= this.needsCompile(this.active);
		this.files.set(this.active, text); this.revision++;
		return true;
	}
	select(path) {
		if (!this.files.has(path)) throw new Error(`Unknown source '${path}'`);
		this.active = path;
		return this.files.get(path);
	}
	setEntry(path) {
		if (!this.files.has(path)) throw new Error(`Unknown entry '${path}'`);
		if (this.entry !== path) { this.entry = path; this.revision++; this.lastSuccess = false; this.compileDirty = true; }
	}
	dirty() { return [...this.files].some(([path, text]) => this.original.get(path) !== text); }
	isDirty(path) { return this.files.get(path) !== this.original.get(path); }
	needsCompile(path) { return this.compileDirty || !this.lastSuccess || this.dependencies.has(path) || path === this.entry; }
	accept(result) {
		this.dependencies = new Set([this.entry, ...result.dependencies]);
		this.lastSuccess = result.status === "success";
		this.compileDirty = !this.lastSuccess;
	}
	snapshot() {
		return { entry: this.entry, files: Object.fromEntries(this.files), assets: Object.fromEntries([...this.assets].map(([path, bytes]) => [path, new Uint8Array(bytes)])) };
	}
	async withFiles(selected, { folder = false, merge = false, maxFiles = 128, maxSourceBytes = 5_000_000, maxAssetBytes = 20_000_000 } = {}) {
		const candidates = Array.from(selected).filter((file) => /\.(scad|stl)$/i.test(file.name));
		if (!candidates.length) throw new Error("Select SCAD sources or STL assets");
		if (candidates.length > maxFiles) throw new Error("Project file limit exceeded");
		const paths = candidates.map((file) => folder ? file.webkitRelativePath || file.name : file.name);
		let root;
		if (folder && paths.every((path) => path.includes("/"))) {
			root = paths[0].split("/")[0];
			if (!paths.every((path) => path.startsWith(root + "/"))) throw new Error("Select one project folder");
		}
		const sources = merge ? new Map(this.files) : new Map();
		const assets = merge ? new Map(this.assets) : new Map();
		const loaded = new Set();
		let sourceBytes = 0; let assetBytes = 0;
		for (let index = 0; index < candidates.length; index++) {
			const file = candidates[index];
			const path = normalizePath(root ? paths[index].slice(root.length + 1) : paths[index]);
			if (loaded.has(path)) throw new Error(`Duplicate selected path '${path}'`);
			loaded.add(path);
			if (merge && this.files.has(path) && this.isDirty(path)) throw new Error(`Cannot replace edited source '${path}'; save or discard it first`);
			if (/\.scad$/i.test(path)) {
				sourceBytes += file.size;
				if (file.size > 1_000_000 || sourceBytes > maxSourceBytes) throw new Error("Project source byte limit exceeded");
				sources.set(path, await file.text());
			} else {
				assetBytes += file.size;
				if (assetBytes > maxAssetBytes) throw new Error("Project asset byte limit exceeded");
				assets.set(path, new Uint8Array(await file.arrayBuffer()));
			}
		}
		if (!sources.size) throw new Error("A project needs at least one SCAD source");
		if (sources.size + assets.size > maxFiles) throw new Error("Project file limit exceeded");
		const encoder = new TextEncoder();
		if ([...sources.values()].reduce((sum, text) => sum + encoder.encode(text).length, 0) > maxSourceBytes || [...assets.values()].reduce((sum, bytes) => sum + bytes.length, 0) > maxAssetBytes) throw new Error("Combined project byte limit exceeded");
		const entry = merge && sources.has(this.entry) ? this.entry : [...sources.keys()].find((path) => /(?:^|\/)main\.scad$/i.test(path)) ?? sources.keys().next().value;
		const result = new StudioProject(sources.get(entry), entry);
		result.files = sources; result.assets = assets;
		result.original = merge ? new Map(this.original) : new Map();
		for (const [path, text] of sources) if (!merge || loaded.has(path)) result.original.set(path, text);
		result.active = merge && sources.has(this.active) ? this.active : entry;
		result.revision = this.revision + 1;
		return result;
	}
}