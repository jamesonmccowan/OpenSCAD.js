import { evaluate } from "./evaluator.js";
import { ScadError } from "./parser.js";
import { GeometryAdapter } from "../geometry/manifold.js";
import { fragmentCount } from "../geometry/tessellation.js";
import { decodeStl } from "../geometry/import-stl.js";
import { normalizePath } from "./project.js";
import { polyhedronMesh } from "../geometry/polyhedron.js";
import { textContours } from "../geometry/text.js";
import { fontName } from "../geometry/font-data.js";
import { straightRoofMesh, voronoiRoofMesh } from "../geometry/roof.js";

// Non-overlapping audit parts closer than this (mm) are reported as touching.
export const AUDIT_CONTACT_TOLERANCE = 1e-3;

function vector(value, dimensions, fallback) {
	const result = value === undefined ? fallback : Array.isArray(value) ? value.slice(0, dimensions) : Array(dimensions).fill(value);
	if (result.length !== dimensions || !result.every(Number.isFinite)) throw new TypeError(`Expected ${dimensions} finite coordinates`);
	return result;
}

function collectRoots(node, roots) {
	if (node.kind === "modifier" && node.modifiers.includes("*")) return;
	if (node.kind === "modifier" && node.modifiers.includes("!")) { roots.push(node); return; }
	node.children.forEach((child) => collectRoots(child, roots));
}

function previewLayers(node, layers, wrappers = []) {
	if (node.kind === "modifier" && node.modifiers.includes("%")) {
		layers.background.push(wrappers.reduceRight((child, parent) => Object.freeze({ ...parent, children: Object.freeze([child]) }), node));
		return;
	}
	if (node.kind === "modifier" && node.modifiers.includes("#")) layers.debug.push(wrappers.reduceRight((child, parent) => Object.freeze({ ...parent, children: Object.freeze([child]) }), node));
	const next = ["transform", "appearance"].includes(node.kind) ? [...wrappers, node] : wrappers;
	node.children.forEach((child) => previewLayers(child, layers, next));
}

export function compileGeometry(evaluation, module, { maxTriangles = 1_000_000, assets = new Map(), fonts = new Map(), roofBackend, includeBackground = false, buildPreview = true, auditComponents = false, maxAuditComponents = 32, interferenceEpsilon = 1e-4, auditClearance = 0 } = {}) {
	const resources = new Set();
	const own = (resource) => { resources.add(resource); return resource; };
	const diagnostics = [...evaluation.diagnostics];
	const materials = Object.create(null);
	const componentNames = new Set();
	let componentDepth = 0;
	let currentLocation;
	const adapter = new GeometryAdapter(module, { maxTriangles, onDiagnostic: (warning) => diagnostics.push({ severity: "warning", ...warning, location: currentLocation }) });
	const combine = (records, operation = "union") => {
		records = records.filter((record) => record !== undefined);
		if (operation === "difference" && !records[0]) return null;
		if (operation === "intersection" && records.some((record) => !record)) return null;
		const operands = records.filter(Boolean);
		if (!operands.length) return null;
		if (operands.some((record) => record.dimension !== operands[0].dimension)) throw new ScadError("Cannot mix 2D and 3D geometry", currentLocation, "mixed-dimensions");
		let result = operands[0].value;
		for (const operand of operands.slice(1)) result = own(result[{ union: "add", difference: "subtract", intersection: "intersect" }[operation]](operand.value));
		return { dimension: operands[0].dimension, value: result, appearance: operands[0].appearance, components: operands.flatMap((record) => record.components ?? []) };
	};
	const primitive = (node) => {
		const args = node.args;
		if (node.name === "text") {
			const font = fonts.get(fontName(args.font).key);
			if (!font) throw new ScadError("Text requires font preparation through the service", node.location, "unresolved-font");
			return { dimension: 2, value: own(new module.CrossSection(textContours(args, font, Math.min(maxTriangles,100_000), node.resolution), "NonZero")) };
		}
		if (node.name === "polyhedron") {
			const value = own(new module.Manifold(new module.Mesh(polyhedronMesh(args, maxTriangles))));
			if (value.status() !== "NoError") throw new ScadError(`Invalid polyhedron: ${value.status()}`, node.location, "geometry-error");
			return { dimension: 3, value };
		}
		if (node.name === "import") {
			const path = normalizePath(args.file, node.location.file.split("/").slice(0, -1).join("/"));
			const bytes = assets instanceof Map ? assets.get(path) : assets[path];
			if (bytes === undefined) throw new ScadError(`Unresolved geometry asset '${path}'`, node.location, "missing-asset");
			const mesh = new module.Mesh(decodeStl(bytes, maxTriangles)); mesh.merge();
			const value = own(new module.Manifold(mesh));
			if (value.status() !== "NoError") throw new ScadError(`Invalid imported STL: ${value.status()}`, node.location, "geometry-error");
			return { dimension: 3, value };
		}
		if (node.name === "sphere" || node.name === "cylinder") return { dimension: 3, value: own(adapter[node.name](args, node.resolution)) };
		if (node.name === "cube" || node.name === "square") {
			const dimension = node.name === "cube" ? 3 : 2;
			const size = vector(args.size, dimension, Array(dimension).fill(1));
			if (size.some((entry) => entry <= 0)) return null;
			return { dimension, value: own(dimension === 3 ? module.Manifold.cube(size, args.center ?? false) : module.CrossSection.square(size, args.center ?? false)) };
		}
		if (node.name === "circle") {
			const radius = args.d !== undefined ? args.d / 2 : args.r ?? 1;
			if (!Number.isFinite(radius)) throw new TypeError("Circle radius must be finite");
			if (radius <= 0) return null;
			const fragments = fragmentCount(radius, node.resolution);
			if (!Number.isSafeInteger(fragments) || fragments > maxTriangles) throw new RangeError("Circle fragment limit exceeded");
			return { dimension: 2, value: own(module.CrossSection.circle(radius, fragments)) };
		}
		if (node.name === "polygon") {
			const points = args.points ?? [];
			const contours = args.paths ? args.paths.map((path) => path.map((index) => points[index])) : [points];
			return { dimension: 2, value: own(new module.CrossSection(contours, "EvenOdd")) };
		}
		throw new ScadError(`Unsupported primitive '${node.name}'`, node.location, "unsupported-feature");
	};
	const transform = (node, record) => {
		if (!record) return null;
		const { args, name } = node;
		const dimensions = record.dimension;
		let result;
		if (name === "rotate") {
			if (dimensions === 2) {
				if (Array.isArray(args.a) && (args.a[0] !== 0 || args.a[1] !== 0)) throw new ScadError("Nonplanar 2D rotation is not implemented", node.location, "unsupported-feature");
				result = record.value.rotate(Array.isArray(args.a) ? args.a[2] : args.a ?? 0);
			} else if (Array.isArray(args.a) || args.v === undefined) result = record.value.rotate(Array.isArray(args.a) ? vector(args.a, 3) : [0, 0, args.a ?? 0]);
			else {
				const axis = vector(args.v, 3);
				const length = Math.hypot(...axis);
				if (!length) return record;
				const unit = axis.map((coordinate) => coordinate / length);
				const angle = (args.a ?? 0) * Math.PI / 180;
				const cosine = Math.cos(angle);
				const sine = Math.sin(angle);
				const matrix = Array.from({ length: 16 }, (_, index) => {
					const row = index % 4;
					const column = Math.floor(index / 4);
					if (row === 3 || column === 3) return row === column ? 1 : 0;
					const skew = [[0, -unit[2], unit[1]], [unit[2], 0, -unit[0]], [-unit[1], unit[0], 0]];
					return (row === column ? cosine : 0) + unit[row] * unit[column] * (1 - cosine) + skew[row][column] * sine;
				});
				result = record.value.transform(matrix);
			}
		} else if (name === "multmatrix") {
			if (dimensions !== 3) throw new ScadError("2D multmatrix is not implemented", node.location, "unsupported-feature");
			const matrix = args.m;
			if (!Array.isArray(matrix) || matrix.length !== 4 || matrix.some((row) => !Array.isArray(row) || row.length !== 4 || !row.every(Number.isFinite))) throw new TypeError("Expected a finite 4x4 matrix");
			result = record.value.transform(Array.from({ length: 16 }, (_, index) => matrix[index % 4][Math.floor(index / 4)]));
		} else {
			const value = vector(args.v, dimensions, Array(dimensions).fill(name === "scale" ? 1 : 0));
			result = record.value[name](value);
		}
		const components = record.components?.map((component) => ({ ...component, value: own(transform(node, component).value) }));
		return { ...record, value: own(result), ...(components ? { components } : {}) };
	};
	const tag = (record, appearance, node) => {
		if (!record) return record;
		record.appearance = appearance;
		if (record.dimension === 3 && evaluation.mode === "preview") {
			if (record.value.originalID() < 0) record.value = own(record.value.asOriginal());
			materials[record.value.originalID()] = { appearance: appearance ?? {}, source: node.id, location: node.location };
		}
		return record;
	};
	const build = (node, appearance) => {
		currentLocation = node.location;
		if (!includeBackground && node.kind === "modifier" && node.modifiers.includes("%")) return undefined;
		if (node.kind === "component") {
			if (!auditComponents) return combine(node.children.map((child) => build(child, appearance)));
			if (componentDepth) throw new ScadError("audit_part() markers cannot be nested", node.location, "invalid-component");
			componentDepth++;
			let component;
			try { component = combine(node.children.map((child) => build(child, appearance))); }
			finally { componentDepth--; }
			if (!component) return null;
			if (component.dimension !== 3) throw new ScadError("audit_part() requires 3D geometry", node.location, "invalid-component");
			if (componentNames.has(node.name)) throw new ScadError(`Duplicate audit_part name '${node.name}'`, node.location, "invalid-component");
			componentNames.add(node.name);
			const copy = own(new module.Manifold(component.value.getMesh()));
			if (copy.status() !== "NoError") throw new ScadError(`Invalid audit part '${node.name}': ${copy.status()}`, node.location, "geometry-error");
			return { ...component, components: [...(component.components ?? []), { name: node.name, dimension: 3, value: copy }] };
		}
		if (node.kind === "appearance" && appearance === undefined && node.args.c !== undefined) appearance = node.args;
		if (node.kind === "primitive") return tag(primitive(node), appearance, node);
		const children = node.children.map((child) => build(child, appearance));
		currentLocation = node.location;
		if (node.kind === "boolean") return combine(children, node.operation);
		const combined = combine(children);
		if (node.kind === "hull") return combined ? { ...combined, value: own(combined.value.hull()) } : null;
		if (node.kind === "offset") {
			if (!combined) return null;
			if (combined.dimension !== 2) throw new ScadError("offset requires 2D children", node.location, "mixed-dimensions");
			const args = node.args;
			const round = args.r !== undefined || (args.r === undefined && args.delta === undefined);
			const delta = args.r ?? args.delta ?? 1;
			if (!Number.isFinite(delta) || (args.chamfer !== undefined && typeof args.chamfer !== "boolean")) throw new ScadError("Invalid offset arguments", node.location, "invalid-arguments");
			const segments = round ? fragmentCount(Math.abs(delta), node.resolution, (warning) => diagnostics.push({ severity: "warning", ...warning, location: node.location })) : 0;
			if (segments > maxTriangles) throw new ScadError("Offset segment limit exceeded", node.location, "resource-limit");
			const join = round ? "Round" : args.chamfer ? "Square" : "Miter";
			const value = own(combined.value.offset(delta, join, 2, segments));
			if (value.numVert() > maxTriangles) throw new ScadError("Offset vertex limit exceeded", node.location, "resource-limit");
			return { ...combined, value };
		}
		if (node.kind === "fill") {
			if (!combined) return null;
			if (combined.dimension !== 2) throw new ScadError("fill requires 2D children", node.location, "unsupported-feature");
			const contours = combined.value.toPolygons();
			const area = (ring) => ring.reduce((sum, point, index) => { const next = ring[(index + 1) % ring.length]; return sum + point[0] * next[1] - point[1] * next[0]; }, 0);
			const contains = (point, ring) => {
				let inside = false;
				for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
					const first = ring[index], second = ring[previous];
					if ((first[1] > point[1]) !== (second[1] > point[1]) && point[0] < (second[0] - first[0]) * (point[1] - first[1]) / (second[1] - first[1]) + first[0]) inside = !inside;
				}
				return inside;
			};
			const filled = contours.filter((ring, index) => {
				const depth = contours.reduce((count, other, otherIndex) => count + (otherIndex !== index && Math.abs(area(other)) > Math.abs(area(ring)) && contains(ring[0], other) ? 1 : 0), 0);
				return depth === 0;
			});
			return { ...combined, value: own(new module.CrossSection(filled, "EvenOdd")) };
		}
		if (node.kind === "resize") {
			if (!combined) return null;
			const dimensions = combined.dimension;
			const requested = node.args.newsize ?? [];
			if (!Array.isArray(requested) || requested.length > 3 || requested.some((value) => !Number.isFinite(value))) throw new ScadError("resize newsize must be a finite vector", node.location, "invalid-arguments");
			let autosize = node.args.auto ?? false;
			if (typeof autosize === "boolean") autosize = Array(dimensions).fill(autosize);
			else if (Array.isArray(autosize) && autosize.length <= 3 && autosize.every((value) => typeof value === "boolean")) autosize = Array.from({ length: dimensions }, (_, axis) => autosize[axis] ?? false);
			else throw new ScadError("resize auto must be boolean or a boolean vector", node.location, "invalid-arguments");
			const target = Array.from({ length: dimensions }, (_, axis) => requested[axis] ?? 0);
			let minimum, maximum;
			if (dimensions === 2) {
				const points = combined.value.toPolygons().flat();
				if (!points.length) return null;
				minimum = [0, 1].map((axis) => Math.min(...points.map((point) => point[axis])));
				maximum = [0, 1].map((axis) => Math.max(...points.map((point) => point[axis])));
			} else {
				const bounds = combined.value.boundingBox();
				minimum = Array.from(bounds.min); maximum = Array.from(bounds.max);
			}
			const extent = maximum.map((value, axis) => value - minimum[axis]);
			if (extent.some((value) => value <= 0)) throw new ScadError("Cannot resize geometry with zero extent", node.location, "geometry-error");
			let maxAxis = 0;
			for (let axis = 1; axis < dimensions; axis++) if (target[axis] > target[maxAxis]) maxAxis = axis;
			const autoscale = target[maxAxis] > 0 ? target[maxAxis] / extent[maxAxis] : 1;
			const factors = target.map((size, axis) => autosize[axis] && size <= 0 ? autoscale : size > 0 ? size / extent[axis] : 1);
			return { ...combined, value: own(combined.value.scale(factors)) };
		}
		if (node.kind === "transform") return transform(node, combined);
		if (node.kind === "roof") {
			if (!combined || combined.value.isEmpty()) return null;
			if (combined.dimension !== 2) throw new ScadError("roof requires 2D children",node.location,"mixed-dimensions");
			if (node.args.method !== undefined && !["voronoi","straight"].includes(node.args.method)) throw new ScadError("Unsupported roof method",node.location,"unsupported-feature");
			const data = node.args.method === "straight" ? straightRoofMesh(combined.value,maxTriangles) : voronoiRoofMesh(combined.value,roofBackend,node.resolution,maxTriangles);
			const mesh = new module.Mesh(data); mesh.merge();
			const value = own(new module.Manifold(mesh));
			if (value.status() !== "NoError") throw new ScadError(`Invalid roof: ${value.status()}`,node.location,"geometry-error");
			return tag({dimension:3,value},appearance ?? combined.appearance,node);
		}
		if (node.kind === "extrusion") {
			if (!combined) return null;
			if (combined.dimension !== 2) throw new ScadError("linear_extrude requires 2D children", node.location, "mixed-dimensions");
			const args = node.args;
			if (args.v !== undefined || (args.segments !== undefined && args.segments !== 0)) throw new ScadError("Extrusion direction and nonzero segments are not implemented", node.location, "unsupported-feature");
			const height = args.height ?? args.h ?? 100;
			if (!Number.isFinite(height)) throw new ScadError("Extrusion height must be finite", node.location, "invalid-arguments");
			if (height <= 0) return null;
			if (args.slices !== undefined && (!Number.isSafeInteger(args.slices) || args.slices < 1 || args.slices > maxTriangles)) throw new ScadError("Extrusion slice limit exceeded", node.location, "resource-limit");
			if (args.twist && args.slices === undefined) throw new ScadError("Twisted extrusion requires explicit slices in this subset", node.location, "unsupported-feature");
			const slices = args.slices ?? 1, contours = combined.value.toPolygons();
			let vertices = 0, holes = 0, outers = 0;
			for (const contour of contours) {
				vertices += contour.length;
				const area = contour.reduce((sum, point, index) => { const next = contour[(index + 1) % contour.length]; return sum + point[0] * next[1] - point[1] * next[0]; }, 0);
				if (area < 0) holes++; else outers++;
			}
			const estimatedTriangles = 2 * vertices * slices + 2 * Math.max(0, vertices + 2 * holes - 2 * outers);
			if (!Number.isSafeInteger(estimatedTriangles) || estimatedTriangles > maxTriangles) throw new ScadError("Extrusion triangle estimate exceeds limit", node.location, "resource-limit");
			const value = own(combined.value.extrude(height, slices - 1, args.twist ?? 0, vector(args.scale, 2, [1, 1]), args.center ?? false));
			if (value.numTri() > maxTriangles) throw new ScadError("Extrusion triangle limit exceeded", node.location, "resource-limit");
			return tag({ dimension: 3, value }, appearance ?? combined.appearance, node);
		}
		if (node.kind === "revolution") {
			if (!combined) return null;
			if (combined.dimension !== 2) throw new ScadError("rotate_extrude requires 2D children", node.location, "mixed-dimensions");
			const args = node.args;
			let angle = args.angle ?? 360;
			if (!Number.isFinite(angle)) throw new ScadError("rotate_extrude angle must be finite", node.location, "invalid-arguments");
			if (angle <= -360 || angle > 360) angle = 360;
			if (angle === 0) return null;
			const contours = combined.value.toPolygons();
			if (!contours.length) return null;
			let minX = Infinity, maxX = -Infinity;
			for (const contour of contours) for (const point of contour) { minX = Math.min(minX, point[0]); maxX = Math.max(maxX, point[0]); }
			if (minX < 0 && maxX > 0) throw new ScadError("rotate_extrude profile must not cross the Y axis", node.location, "geometry-error");
			const reflected = maxX <= 0;
			const profile = reflected ? own(combined.value.mirror([1, 0])) : combined.value;
			const fullSegments = fragmentCount(maxX - minX, node.resolution, (warning) => diagnostics.push({ severity: "warning", ...warning, location: node.location }));
			if (!Number.isSafeInteger(fullSegments) || fullSegments > maxTriangles) throw new ScadError("rotate_extrude segment limit exceeded", node.location, "resource-limit");
			const segments = Math.max(1, Math.ceil(fullSegments * Math.abs(angle) / 360));
			let value = own(module.Manifold.revolve(profile, segments, Math.abs(angle)));
			const start = (args.start ?? (args.angle === undefined ? 180 : 0)) + (angle < 0 ? angle : 0);
			if (!Number.isFinite(start)) throw new ScadError("rotate_extrude start must be finite", node.location, "invalid-arguments");
			if (start || reflected) value = own(value.rotate([0, 0, start + (reflected ? 180 : 0)]));
			if (value.status() !== "NoError") throw new ScadError(`Invalid rotate_extrude result: ${value.status()}`, node.location, "geometry-error");
			if (value.numTri() > maxTriangles) throw new ScadError("rotate_extrude triangle limit exceeded", node.location, "resource-limit");
			return tag({ dimension: 3, value }, appearance ?? combined.appearance, node);
		}
		if (node.kind === "projection") {
			if (!combined) return null;
			if (combined.dimension !== 3) throw new ScadError("projection requires 3D children", node.location, "mixed-dimensions");
			return { dimension: 2, value: own(node.args.cut ? combined.value.slice(0) : combined.value.project()) };
		}
		if (node.kind === "minkowski") {
			const operands = children.filter(Boolean);
			if (!operands.length) return null;
			const dimension = operands[0].dimension;
			if (operands.some((operand) => operand.dimension !== dimension)) throw new ScadError("Cannot mix 2D and 3D geometry", node.location, "mixed-dimensions");
			if (dimension !== 3) throw new ScadError("2D minkowski is not implemented", node.location, "unsupported-feature");
			if (operands.length === 1) return operands[0];
			const center = [0, 0, 0];
			const normalized = operands.map((operand) => {
				const bounds = operand.value.boundingBox();
				const offset = bounds.min.map((minimum, axis) => (minimum + bounds.max[axis]) / 2);
				offset.forEach((value, axis) => { center[axis] += value; });
				return own(operand.value.translate(offset.map((value) => -value)));
			});
			let value = normalized[0];
			for (const operand of normalized.slice(1)) value = own(value.minkowskiSum(operand));
			if (center.some((coordinate) => coordinate !== 0)) value = own(value.translate(center));
			if (value.numTri() > maxTriangles) throw new ScadError("Minkowski triangle limit exceeded", node.location, "resource-limit");
			return tag({ dimension, value, appearance: operands[0].appearance }, operands[0].appearance, node);
		}
		return combined;
	};
	let solid;
	try {
		const roots = [];
		collectRoots(evaluation.tree, roots);
		const selected = roots.length ? { ...evaluation.tree, children: roots } : evaluation.tree;
		const record = build(selected);
		if (record && record.dimension !== 3) throw new ScadError("STL solid compilation requires 3D geometry", currentLocation, "mixed-dimensions");
		solid = record?.value ?? own(new module.Manifold(new module.Mesh({ numProp: 3, vertProperties: new Float32Array(), triVerts: new Uint32Array() })));
		if (solid.status() !== "NoError") throw new ScadError(`Kernel failed: ${solid.status()}`, currentLocation, "geometry-error");
		let componentAudit;
		if (auditComponents) {
			const parts = record?.components ?? [];
			if (parts.length > maxAuditComponents) throw new ScadError(`Interference audit supports at most ${maxAuditComponents} named components`, undefined, "resource-limit");
			if (!Number.isFinite(interferenceEpsilon) || interferenceEpsilon < 0) throw new TypeError("interferenceEpsilon must be a nonnegative finite volume");
			const metadata = parts.map((part) => {
				const bounds = part.value.boundingBox();
				return { name: part.name, volume: part.value.volume(), triangles: part.value.numTri(), bounds: [Array.from(bounds.min), Array.from(bounds.max)] };
			});
			if (!Number.isFinite(auditClearance) || auditClearance < 0) throw new TypeError("auditClearance must be a nonnegative finite distance");
			// Pairs that do not overlap are classified by their minimum gap: touching
			// (within AUDIT_CONTACT_TOLERANCE) or closer than the requested clearance.
			const search = Math.max(auditClearance, AUDIT_CONTACT_TOLERANCE);
			const interferences = [], contacts = [], clearances = [];
			for (let first = 0; first < parts.length; first++) for (let second = first + 1; second < parts.length; second++) {
				const a = parts[first].value.boundingBox(), b = parts[second].value.boundingBox();
				if (a.max.some((coordinate, axis) => coordinate + search <= b.min[axis]) || b.max.some((coordinate, axis) => coordinate + search <= a.min[axis])) continue;
				const pair = [parts[first].name, parts[second].name];
				const boxesOverlap = a.max.every((coordinate, axis) => coordinate > b.min[axis]) && b.max.every((coordinate, axis) => coordinate > a.min[axis]);
				let volume = 0;
				if (boxesOverlap) {
					const overlap = own(parts[first].value.intersect(parts[second].value));
					if (overlap.status() !== "NoError") throw new ScadError(`Interference kernel failed for '${pair[0]}' and '${pair[1]}': ${overlap.status()}`, undefined, "geometry-error");
					volume = overlap.volume();
					if (volume > interferenceEpsilon) {
						const bounds = overlap.boundingBox();
						interferences.push({ parts: pair, volume, bounds: [Array.from(bounds.min), Array.from(bounds.max)] });
						continue;
					}
				}
				const gap = volume > 0 ? 0 : parts[first].value.minGap(parts[second].value, search);
				if (gap <= AUDIT_CONTACT_TOLERANCE) contacts.push({ parts: pair, gap, volume });
				else if (gap < auditClearance) clearances.push({ parts: pair, gap });
			}
			componentAudit = { components: metadata, interferences, contacts, clearances, epsilon: interferenceEpsilon, clearance: auditClearance, contactTolerance: AUDIT_CONTACT_TOLERANCE };
		}
		const layers = { background: [], debug: [] };
		if (evaluation.mode === "preview") previewLayers(selected, layers);
		const overlays = [];
		if (evaluation.mode === "preview" && buildPreview) {
			for (const kind of ["background", "debug"]) for (const tree of layers[kind]) {
				const overlay = compileGeometry({ ...evaluation, tree, mode: "render" }, module, { maxTriangles, assets, fonts, roofBackend, includeBackground: true, buildPreview: false });
				try {
					const mesh = overlay.getMesh();
					if (mesh.triVerts.length) overlays.push({ kind, source: tree.id, mesh: { numProp: mesh.numProp, vertProperties: new Float32Array(mesh.vertProperties), triVerts: new Uint32Array(mesh.triVerts) } });
				} finally { overlay.dispose(); }
			}
		}
		let disposed = false;
		return {
			 evaluation, diagnostics, layers, solid, materials, overlays, componentAudit,
			getMesh() { if (disposed) throw new Error("Compilation result is disposed"); return solid.getMesh(); },
			dispose() { if (!disposed) { solid.delete(); overlays.length = 0; disposed = true; } },
		};
	} catch (error) {
		if (solid) { resources.delete(solid); solid.delete(); }
		if (error instanceof ScadError) throw error;
		throw new ScadError(error.message, currentLocation, "geometry-error");
	} finally {
		for (const resource of [...resources].reverse()) if (resource !== solid) resource.delete();
	}
}

export function compileScad(source, module, options = {}) {
	return compileGeometry(evaluate(source, options), module, options);
}