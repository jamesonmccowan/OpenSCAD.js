function meshPositions(mesh) {
	if (!Number.isInteger(mesh.numProp) || mesh.numProp < 3 || mesh.vertProperties.length % mesh.numProp || mesh.triVerts.length % 3) throw new TypeError("Invalid indexed mesh layout");
	const vertices = mesh.vertProperties.length / mesh.numProp;
	return (index) => {
		if (!Number.isInteger(index) || index < 0 || index >= vertices) throw new RangeError("Invalid triangle vertex index");
		const point = Array.from(mesh.vertProperties.subarray(index * mesh.numProp, index * mesh.numProp + 3));
		if (!point.every(Number.isFinite)) throw new RangeError("STL coordinates must be finite");
		return point;
	};
}

export function exportStl(mesh, { encoding = "binary", allowEmpty = false, omitDegenerate = false } = {}) {
	if (!["binary", "ascii"].includes(encoding)) throw new TypeError("STL encoding must be binary or ascii");
	const point = meshPositions(mesh);
	const retained = [];
	for (let index = 0; index < mesh.triVerts.length; index += 3) {
		const positions = Array.from(mesh.triVerts.subarray(index, index + 3), point);
		if (positions.some((position, corner) => positions.slice(corner + 1).some((other) => position.every((coordinate, axis) => coordinate === other[axis])))) continue;
		if (omitDegenerate) {
			const first = positions[1].map((value, axis) => value - positions[0][axis]);
			const second = positions[2].map((value, axis) => value - positions[0][axis]);
			if (Math.hypot(first[1] * second[2] - first[2] * second[1], first[2] * second[0] - first[0] * second[2], first[0] * second[1] - first[1] * second[0]) === 0) continue;
		}
		retained.push(index);
	}
	const count = retained.length;
	if (!count && !allowEmpty) throw new RangeError("Cannot export empty geometry without allowEmpty=true");
	if (count > 0xffffffff) throw new RangeError("STL triangle count exceeds format capacity");
	const bytes = encoding === "binary" ? new Uint8Array(84 + count * 50) : null;
	const view = bytes ? new DataView(bytes.buffer) : null;
	if (view) {
		bytes.set(new TextEncoder().encode("OpenSCAD.js binary STL"));
		view.setUint32(80, count, true);
	}
	const lines = encoding === "ascii" ? ["solid openscad_js"] : null;
	for (let triangle = 0; triangle < count; triangle++) {
		const index = retained[triangle];
		const positions = Array.from(mesh.triVerts.subarray(index, index + 3), point);
		const firstEdge = positions[1].map((coordinate, axis) => coordinate - positions[0][axis]);
		const secondEdge = positions[2].map((coordinate, axis) => coordinate - positions[0][axis]);
		const normal = [firstEdge[1] * secondEdge[2] - firstEdge[2] * secondEdge[1], firstEdge[2] * secondEdge[0] - firstEdge[0] * secondEdge[2], firstEdge[0] * secondEdge[1] - firstEdge[1] * secondEdge[0]];
		const length = Math.hypot(...normal);
		if (!Number.isFinite(length) || length === 0) throw new RangeError("Cannot export degenerate triangles");
		const normalized = normal.map((coordinate) => coordinate / length);
		if (view) {
			[...normalized, ...positions.flat()].forEach((value, index) => {
				if (!Number.isFinite(Math.fround(value))) throw new RangeError("STL value exceeds Float32 range");
				view.setFloat32(84 + triangle * 50 + index * 4, value, true);
			});
		} else {
			lines.push(`  facet normal ${normalized.join(" ")}`, "    outer loop", ...positions.map((position) => `      vertex ${position.join(" ")}`), "    endloop", "  endfacet");
		}
	}
	if (lines) { lines.push("endsolid openscad_js"); return new TextEncoder().encode(lines.join("\n") + "\n"); }
	return bytes;
}