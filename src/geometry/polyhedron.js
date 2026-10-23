import earcut from "../../node_modules/earcut/src/earcut.js";

export function polyhedronMesh({ points = [], faces, triangles }, maxTriangles) {
	if (!Array.isArray(points) || points.some((point) => !Array.isArray(point) || point.length !== 3 || !point.every(Number.isFinite))) throw new TypeError("Polyhedron points must be finite 3D vectors");
	const output = [];
	const polygons = faces ?? triangles ?? [];
	if (!Array.isArray(polygons)) throw new TypeError("Polyhedron faces must be a list");
	for (const face of polygons) {
		if (!Array.isArray(face) || face.length < 3 || face.some((index) => !Number.isInteger(index) || index < 0 || index >= points.length)) throw new TypeError("Invalid polyhedron face indices");
		const normal = [0, 0, 0];
		for (let index = 0; index < face.length; index++) {
			const current = points[face[index]]; const next = points[face[(index + 1) % face.length]];
			normal[0] += (current[1] - next[1]) * (current[2] + next[2]);
			normal[1] += (current[2] - next[2]) * (current[0] + next[0]);
			normal[2] += (current[0] - next[0]) * (current[1] + next[1]);
		}
		const dropped = normal.map(Math.abs).indexOf(Math.max(...normal.map(Math.abs)));
		if (!Math.hypot(...normal)) throw new TypeError("Degenerate polyhedron face");
		const projected = face.flatMap((index) => points[index].filter((_, axis) => axis !== dropped));
		const indices = earcut(projected);
		for (let index = 0; index < indices.length; index += 3) {
			const corners = indices.slice(index, index + 3).map((corner) => face[corner]);
			const first = points[corners[1]].map((value, axis) => value - points[corners[0]][axis]);
			const second = points[corners[2]].map((value, axis) => value - points[corners[0]][axis]);
			const cross = [first[1]*second[2]-first[2]*second[1], first[2]*second[0]-first[0]*second[2], first[0]*second[1]-first[1]*second[0]];
			if (cross.reduce((sum, value, axis) => sum + value * normal[axis], 0) > 0) [corners[1], corners[2]] = [corners[2], corners[1]];
			output.push(...corners);
			if (output.length / 3 > maxTriangles) throw new RangeError("Polyhedron triangle limit exceeded");
		}
	}
	return { numProp: 3, vertProperties: new Float32Array(points.flat()), triVerts: new Uint32Array(output) };
}