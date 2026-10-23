export function withResources(callback) {
	const resources = new Set();
	const own = (resource) => { resources.add(resource); return resource; };
	try {
		return callback(own);
	} finally {
		for (const resource of [...resources].reverse()) resource.delete();
	}
}

export function copyMesh(mesh) {
	const positions = new Float32Array(mesh.vertProperties.length / mesh.numProp * 3);
	for (let vertex = 0; vertex < positions.length / 3; vertex++) {
		positions.set(mesh.vertProperties.subarray(vertex * mesh.numProp, vertex * mesh.numProp + 3), vertex * 3);
	}
	return { positions, triangles: new Uint32Array(mesh.triVerts) };
}

export function measureMesh({ positions, triangles }) {
	const minimum = [Infinity, Infinity, Infinity];
	const maximum = [-Infinity, -Infinity, -Infinity];
	const edges = new Map();
	let volume = 0;
	let degenerateTriangles = 0;
	const point = (vertex) => Array.from(positions.subarray(vertex * 3, vertex * 3 + 3));
	for (const coordinate of positions) {
		if (!Number.isFinite(coordinate)) throw new Error("Mesh has a non-finite coordinate");
	}
	for (let index = 0; index < triangles.length; index += 3) {
		const vertices = Array.from(triangles.subarray(index, index + 3));
		if (vertices.some((vertex) => vertex * 3 + 2 >= positions.length)) throw new Error("Invalid vertex index");
		const [first, second, third] = vertices.map(point);
		const cross = [second[1] * third[2] - second[2] * third[1], second[2] * third[0] - second[0] * third[2], second[0] * third[1] - second[1] * third[0]];
		volume += first.reduce((sum, coordinate, axis) => sum + coordinate * cross[axis], 0) / 6;
		const normal = triangleNormal(first, second, third);
		if (Math.hypot(...normal) === 0) degenerateTriangles++;
		for (const position of [first, second, third]) {
			position.forEach((coordinate, axis) => {
				minimum[axis] = Math.min(minimum[axis], coordinate);
				maximum[axis] = Math.max(maximum[axis], coordinate);
			});
		}
		for (let corner = 0; corner < 3; corner++) {
			const from = point(vertices[corner]).join(",");
			const to = point(vertices[(corner + 1) % 3]).join(",");
			const key = from < to ? `${from}|${to}` : `${to}|${from}`;
			const edge = edges.get(key) ?? { count: 0, orientation: 0 };
			edge.count++;
			edge.orientation += from < to ? 1 : -1;
			edges.set(key, edge);
		}
	}
	return {
		volume,
		bounds: triangles.length ? [minimum, maximum] : null,
		triangles: triangles.length / 3,
		degenerateTriangles,
		closed: [...edges.values()].every((edge) => edge.count === 2 && edge.orientation === 0),
	};
}

function triangleNormal(first, second, third) {
	const firstEdge = second.map((coordinate, axis) => coordinate - first[axis]);
	const secondEdge = third.map((coordinate, axis) => coordinate - first[axis]);
	return [
		firstEdge[1] * secondEdge[2] - firstEdge[2] * secondEdge[1],
		firstEdge[2] * secondEdge[0] - firstEdge[0] * secondEdge[2],
		firstEdge[0] * secondEdge[1] - firstEdge[1] * secondEdge[0],
	];
}

export function encodeBinaryStl(mesh) {
	const count = mesh.triangles.length / 3;
	const bytes = new Uint8Array(84 + count * 50);
	const view = new DataView(bytes.buffer);
	view.setUint32(80, count, true);
	for (let triangle = 0; triangle < count; triangle++) {
		const points = Array.from(mesh.triangles.subarray(triangle * 3, triangle * 3 + 3), (vertex) =>
			Array.from(mesh.positions.subarray(vertex * 3, vertex * 3 + 3)));
		const normal = triangleNormal(...points);
		const length = Math.hypot(...normal);
		if (!length || !Number.isFinite(length)) throw new Error("Cannot export a degenerate triangle");
		const values = [...normal.map((coordinate) => coordinate / length), ...points.flat()];
		values.forEach((value, index) => view.setFloat32(84 + triangle * 50 + index * 4, value, true));
	}
	return bytes;
}

export function decodeBinaryStl(bytes) {
	if (bytes.byteLength < 84) throw new Error("Truncated binary STL header");
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const count = view.getUint32(80, true);
	if (bytes.byteLength !== 84 + count * 50) throw new Error("Invalid binary STL length");
	const positions = [];
	const triangles = [];
	const vertices = new Map();
	for (let triangle = 0; triangle < count; triangle++) {
		for (let corner = 0; corner < 3; corner++) {
			const point = [0, 1, 2].map((axis) => view.getFloat32(84 + triangle * 50 + 12 + corner * 12 + axis * 4, true));
			if (!point.every(Number.isFinite)) throw new Error("Non-finite STL coordinate");
			const key = point.join(",");
			if (!vertices.has(key)) {
				vertices.set(key, positions.length / 3);
				positions.push(...point);
			}
			triangles.push(vertices.get(key));
		}
	}
	return { positions: new Float32Array(positions), triangles: new Uint32Array(triangles) };
}

export function runGeometryCase(module, fixture) {
	return withResources((own) => {
		const solid = fixture.build(module, own);
		const status = solid.status();
		if (status !== "NoError") throw new Error(`${fixture.id}: ${status}`);
		const mesh = copyMesh(solid.getMesh());
		const bytes = encodeBinaryStl(mesh);
		const roundTrip = decodeBinaryStl(bytes);
		const reconstructed = own(new module.Manifold(new module.Mesh({
			numProp: 3, vertProperties: roundTrip.positions, triVerts: roundTrip.triangles,
		})));
		if (reconstructed.status() !== "NoError") throw new Error("STL reimport failed");
		return { id: fixture.id, status, ...measureMesh(mesh), roundTrip: measureMesh(roundTrip), bytes: bytes.length };
	});
}