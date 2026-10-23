import earcut from "../../node_modules/earcut/src/earcut.js";
import loadVoronoi from "./roof-voronoi-wasm.js";
import straightSkeleton from "./roof-straight-bundle.js";

let backendPromise;
export function loadRoofBackend() {
	return backendPromise ??= (async () => {
		const options = {};
		if (typeof process !== "undefined" && process.versions?.node) {
			const { readFile } = await import("node:fs/promises");
			options.wasmBinary = await readFile(new URL("./roof-voronoi-wasm.wasm", import.meta.url));
		}
		return loadVoronoi(options);
	})();
}

function signedArea(ring) {
	return ring.reduce((sum, point, index) => { const next = ring[(index + 1) % ring.length]; return sum + point[0] * next[1] - point[1] * next[0]; }, 0);
}

function inside(point, ring) {
	let contained = false;
	for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
		const first = ring[index], second = ring[previous];
		if ((first[1] > point[1]) !== (second[1] > point[1]) && point[0] < (second[0] - first[0]) * (point[1] - first[1]) / (second[1] - first[1]) + first[0]) contained = !contained;
	}
	return contained;
}

function roofGroups(contours) {
	const groups = contours.filter((ring) => signedArea(ring) > 0).map((ring) => [ring]);
	for (const hole of contours.filter((ring) => signedArea(ring) < 0)) {
		const enclosing = groups.filter(([outer]) => inside(hole[0], outer)).sort((first, second) => signedArea(first[0]) - signedArea(second[0]))[0];
		if (!enclosing) throw new TypeError("Uncontained roof hole");
		enclosing.push(hole);
	}
	return groups;
}

function meshBuilder(maxTriangles) {
	const positions = [], triangles = [], vertices = new Map();
	const vertex = (point) => {
		const rounded = point.map(Math.fround), key = rounded.join(",");
		if (!rounded.every(Number.isFinite)) throw new RangeError("Roof coordinates exceed mesh precision");
		if (!vertices.has(key)) { vertices.set(key, positions.length / 3); positions.push(...rounded); }
		return vertices.get(key);
	};
	const triangle = (first, second, third) => {
		if (triangles.length / 3 >= maxTriangles) throw new RangeError("Roof triangle limit exceeded");
		const corners = [first, second, third].map(vertex);
		if (new Set(corners).size === 3) triangles.push(...corners);
	};
	const face = (rings, base = false, apex) => {
		if (!rings[0] || rings[0].length < 3) return;
		if (apex) {
			const ring = rings[0];
			for (let index = 0; index < ring.length; index++) triangle(apex, ring[index], ring[(index + 1) % ring.length]);
			return;
		}
		const points = rings.flat(), holes = [];
		let offset = rings[0].length;
		for (const ring of rings.slice(1)) { holes.push(offset); offset += ring.length; }
		const indices = earcut(points.flatMap((point) => point.slice(0, 2)), holes);
		for (let index = 0; index < indices.length; index += 3) {
			const corners = indices.slice(index, index + 3).map((corner) => points[corner]);
			if (base) [corners[1], corners[2]] = [corners[2], corners[1]];
			const pending = [corners];
			while (pending.length) {
				const current = pending.pop();
				let split = false;
				for (let edge = 0; edge < 3 && !split; edge++) {
					const first = current[edge], last = current[(edge + 1) % 3], opposite = current[(edge + 2) % 3];
					const delta = [last[0] - first[0], last[1] - first[1]], lengthSquared = delta[0] ** 2 + delta[1] ** 2;
					const interior = points.map((point) => ({ point, time: ((point[0] - first[0]) * delta[0] + (point[1] - first[1]) * delta[1]) / lengthSquared }))
						.filter(({ point, time }) => time > 1e-10 && time < 1 - 1e-10 && Math.abs((point[0] - first[0]) * delta[1] - (point[1] - first[1]) * delta[0]) <= lengthSquared * 1e-12)
						.sort((left, right) => left.time - right.time);
					if (interior.length) {
						const chain = [first, ...interior.map(({ point }) => point), last];
						for (let part = 0; part < chain.length - 1; part++) pending.push([chain[part], chain[part + 1], opposite]);
						split = true;
					}
				}
				if (!split) triangle(...current);
			}
		}
	};
	return { face, result: () => ({ numProp: 3, vertProperties: new Float32Array(positions), triVerts: new Uint32Array(triangles) }) };
}

export function straightRoofMesh(profile, maxTriangles) {
	const contours = profile.toPolygons();
	if (contours.reduce((count, ring) => count + ring.length, 0) > 10_000) throw new RangeError("Roof contour vertex limit exceeded");
	const groups = roofGroups(contours), mesh = meshBuilder(maxTriangles);
	for (const group of groups) {
		mesh.face(group.map((ring) => ring.map((point) => [...point, 0])), true);
		const skeleton = straightSkeleton.SkeletonBuilder.BuildFromGeoJSON([group]);
		const heights = new Map([...skeleton.Distances].map(([point, distance]) => [`${point.X},${point.Y}`, distance]));
		for (const edge of skeleton.Edges) {
			const ring = [...edge.Polygon].map((point) => [point.X, point.Y, heights.get(`${point.X},${point.Y}`)]);
			if (signedArea(ring) < 0) ring.reverse();
			mesh.face([ring]);
		}
	}
	return mesh.result();
}

export function voronoiRoofMesh(profile, backend, resolution = {}, maxTriangles = 1_000_000) {
	if (!backend) return convexRoofMesh(profile, maxTriangles);
	const originals = profile.toPolygons();
	if (originals.reduce((count, ring) => count + ring.length, 0) > 10_000) throw new RangeError("Roof contour vertex limit exceeded");
	const coordinates = originals.flat();
	const bounds = [0, 1].map((axis) => [Math.min(...coordinates.map((point) => point[axis])), Math.max(...coordinates.map((point) => point[axis]))]);
	const origin = bounds.map(([minimum, maximum]) => minimum + (maximum - minimum) / 2);
	const extent = Math.max(...bounds.map(([minimum, maximum]) => maximum - minimum));
	const scale = Math.min(2 ** 30, 2 ** Math.floor(Math.log2(2 ** 29 / extent)));
	if (!Number.isFinite(scale) || scale <= 0) throw new RangeError("Roof coordinate range is unsupported");
	const contours = originals.map((ring) => ring.map((point) => point.map((value, axis) => Math.round((value - origin[axis]) * scale) / scale)));
	const segments = contours.flatMap((ring) => ring.map((point, index) => [point, ring[(index + 1) % ring.length]]));
	const graph = backend.diagram(segments.flat(2).map((value) => Math.round(value * scale)));
	const pointSite = (source, category) => segments[source][category === 1 ? 0 : 1];
	const material = (point) => contours.reduce((value, ring) => value !== inside(point, ring), false);
	const distance = (point) => Math.min(...segments.map(([first, second]) => {
		const delta = second.map((value, axis) => value - first[axis]);
		const time = Math.max(0, Math.min(1, ((point[0] - first[0]) * delta[0] + (point[1] - first[1]) * delta[1]) / (delta[0] ** 2 + delta[1] ** 2)));
		return Math.hypot(...point.map((value, axis) => value - first[axis] - time * delta[axis]));
	}));
	const elevate = (point) => [...point.map((value, axis) => value + origin[axis]), distance(point)];
	const fn = resolution.$fn ?? 0, fa = resolution.$fa ?? 12, fs = resolution.$fs ?? 2;
	if (![fn, fa, fs].every(Number.isFinite) || (fn <= 0 && (fa <= 0 || fs <= 0))) throw new TypeError("Roof resolution must be finite and positive");
	const maxAngle = (fn > 0 ? 360 / fn : fa) * Math.PI / 360;
	const maxLength = fn > 0 ? Infinity : fs;
	const cached = new Map();
	let samples = 0;
	const edgePoints = (edge, cell) => {
		const [identifier, startX, startY, endX, endY, otherSource, otherCategory, otherSegment, curved] = edge;
		const first = [startX / scale, startY / scale], last = [endX / scale, endY / scale];
		if (cached.has(identifier)) {
			const cachedEdge = cached.get(identifier);
			if (!cachedEdge.length) return cachedEdge;
			return cachedEdge[0][0] === first[0] && cachedEdge[0][1] === first[1] ? cachedEdge : [...cachedEdge].reverse();
		}
		let at = (time) => first.map((value, axis) => value + time * (last[axis] - value));
		if (curved) {
			const focus = cell.segment ? pointSite(otherSource, otherCategory) : pointSite(cell.source, cell.category);
			const [begin, end] = segments[cell.segment ? cell.source : otherSource];
			const length = Math.hypot(end[0] - begin[0], end[1] - begin[1]);
			const direction = end.map((value, axis) => (value - begin[axis]) / length), normal = [-direction[1], direction[0]];
			const dot = (point, vector) => (point[0] - begin[0]) * vector[0] + (point[1] - begin[1]) * vector[1];
			const focusX = dot(focus, direction), focusY = dot(focus, normal), initialX = dot(first, direction), finalX = dot(last, direction);
			if (!focusY) throw new TypeError("Degenerate roof parabola");
			at = (time) => {
				const horizontal = initialX + time * (finalX - initialX), vertical = ((horizontal - focusX) ** 2 + focusY ** 2) / (2 * focusY);
				return begin.map((value, axis) => value + horizontal * direction[axis] + vertical * normal[axis]);
			};
		}
		const points = [first];
		const split = (start, end, left, right, depth) => {
			if (++samples > maxTriangles * 3 || depth > 32) throw new RangeError("Roof subdivision limit exceeded");
			const middle = at((start + end) / 2);
			const firstDirection = [middle[0] - left[0], middle[1] - left[1]], secondDirection = [right[0] - middle[0], right[1] - middle[1]];
			const angle = Math.abs(Math.atan2(firstDirection[0] * secondDirection[1] - firstDirection[1] * secondDirection[0], firstDirection[0] * secondDirection[0] + firstDirection[1] * secondDirection[1]));
			const length = Math.hypot(right[0] - left[0], right[1] - left[1]);
			if (curved && length > 4 / scale && (angle > maxAngle || length > maxLength)) {
				split(start, (start + end) / 2, left, middle, depth + 1); split((start + end) / 2, end, middle, right, depth + 1);
			} else points.push(right);
		};
		if (material(at(0.5))) split(0, 1, first, last, 0);
		else points.length = 0;
		cached.set(identifier, points);
		return points;
	};
	const mesh = meshBuilder(maxTriangles);
	for (const group of roofGroups(contours)) mesh.face(group.map((ring) => ring.map((point) => [...point.map((value, axis) => value + origin[axis]), 0])), true);
	for (const cell of graph) {
		const points = cell.edges.flatMap((edge) => edgePoints(edge, cell));
		const ring = points.filter((point, index) => !index || point[0] !== points[index - 1][0] || point[1] !== points[index - 1][1]);
		if (ring.length > 1 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1]) ring.pop();
		if (ring.length < 3) continue;
		if (signedArea(ring) < 0) ring.reverse();
		mesh.face([ring.map(elevate)], false, cell.segment ? undefined : [...pointSite(cell.source, cell.category).map((value, axis) => value + origin[axis]), 0]);
	}
	return mesh.result();
}

export function convexRoofMesh(profile, maxTriangles) {
	const contours = profile.toPolygons();
	if (contours.length !== 1) throw new TypeError("Experimental roof currently requires one convex contour without holes");
	let ring = contours[0];
	if (ring.length < 3 || ring.length > 256) throw new RangeError("Experimental roof supports 3 to 256 contour vertices");
	const area = ring.reduce((sum, point, index) => { const next = ring[(index + 1) % ring.length]; return sum + point[0]*next[1]-point[1]*next[0]; }, 0);
	if (area < 0) ring = [...ring].reverse();
	for (let index = 0; index < ring.length; index++) {
		const first = ring[index], second = ring[(index+1)%ring.length], third = ring[(index+2)%ring.length];
		if ((second[0]-first[0])*(third[1]-second[1])-(second[1]-first[1])*(third[0]-second[0]) < -1e-8) throw new TypeError("Concave experimental roofs are not implemented");
	}
	const edges = ring.map((point, index) => {
		const next = ring[(index + 1) % ring.length]; const length = Math.hypot(next[0]-point[0],next[1]-point[1]);
		if (!length) throw new TypeError("Degenerate roof edge");
		const normal = [-(next[1]-point[1])/length,(next[0]-point[0])/length];
		return { normal, constant: -(normal[0]*point[0]+normal[1]*point[1]) };
	});
	const positions = []; const triangles = []; const vertices = new Map();
	const vertex = (point) => { const rounded = point.map((value) => Math.round(value * 1e9) / 1e9); const key = rounded.join(","); if (!vertices.has(key)) { vertices.set(key,positions.length/3); positions.push(...rounded); } return vertices.get(key); };
	const face = (points, base = false) => {
		const indices = earcut(points.flatMap((point) => point.slice(0,2)));
		for (let index = 0; index < indices.length; index += 3) {
			const corners = indices.slice(index,index+3).map((corner) => vertex(points[corner]));
			if (base) [corners[1],corners[2]] = [corners[2],corners[1]];
			triangles.push(...corners);
			if (triangles.length/3 > maxTriangles) throw new RangeError("Roof triangle limit exceeded");
		}
	};
	face(ring.map((point) => [...point,0]),true);
	for (const edge of edges) {
		let polygon = ring.map((point) => [...point]);
		for (const other of edges) {
			if (other === edge) continue;
			const value = (point) => (edge.normal[0]-other.normal[0])*point[0]+(edge.normal[1]-other.normal[1])*point[1]+edge.constant-other.constant;
			const clipped = [];
			for (let index = 0; index < polygon.length; index++) {
				const current = polygon[index], next = polygon[(index+1)%polygon.length]; const currentValue = value(current), nextValue = value(next);
				if (currentValue <= 1e-9) clipped.push(current);
				if ((currentValue <= 0) !== (nextValue <= 0)) { const time = currentValue/(currentValue-nextValue); clipped.push(current.map((coordinate,axis) => coordinate+time*(next[axis]-coordinate))); }
			}
			polygon = clipped;
		}
		if (polygon.length >= 3) face(polygon.map((point) => [...point,Math.max(0,edge.normal[0]*point[0]+edge.normal[1]*point[1]+edge.constant)]));
	}
	return {numProp:3,vertProperties:new Float32Array(positions),triVerts:new Uint32Array(triangles)};
}