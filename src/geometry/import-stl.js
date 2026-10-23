export function decodeStl(input, maxTriangles = 1_000_000) {
	const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input instanceof ArrayBuffer ? new Uint8Array(input) : input;
	if (!(bytes instanceof Uint8Array)) throw new TypeError("STL asset must be text or bytes");
	const positions = [];
	const triangles = [];
	const vertices = new Map();
	let count = 0;
	const triangle = (points) => {
		if (++count > maxTriangles) throw new RangeError("Imported STL triangle limit exceeded");
		if (points.length !== 3 || points.some((point) => point.length !== 3 || !point.every((value) => Number.isFinite(value) && Number.isFinite(Math.fround(value))))) throw new TypeError("Invalid STL coordinates");
		const indices = points.map((point) => {
			const rounded = point.map(Math.fround);
			const key = rounded.join(",");
			if (!vertices.has(key)) { vertices.set(key, positions.length / 3); positions.push(...rounded); }
			return vertices.get(key);
		});
		if (new Set(indices).size === 3) triangles.push(...indices);
	};
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const binaryCount = bytes.length >= 84 ? view.getUint32(80, true) : null;
	if (binaryCount !== null && 84 + binaryCount * 50 === bytes.length) {
		if (binaryCount > maxTriangles) throw new RangeError("Imported STL triangle limit exceeded");
		for (let index = 0; index < binaryCount; index++) triangle([0, 1, 2].map((corner) => [0, 1, 2].map((axis) => view.getFloat32(84 + index * 50 + 12 + corner * 12 + axis * 4, true))));
	} else {
		const tokens = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim().split(/\s+/);
		let index = 0;
		const expect = (token) => { if (tokens[index++]?.toLowerCase() !== token) throw new TypeError(`Malformed ASCII STL: expected ${token}`); };
		const numeric = () => {
			const token = tokens[index++];
			if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(token ?? "")) throw new TypeError("Malformed ASCII STL number");
			return Number(token);
		};
		while (index < tokens.length) {
			expect("solid");
			while (index < tokens.length && !["facet", "endsolid"].includes(tokens[index].toLowerCase())) index++;
			while (tokens[index]?.toLowerCase() === "facet") {
				expect("facet"); expect("normal"); numeric(); numeric(); numeric();
				expect("outer"); expect("loop");
				const points = [];
				for (let corner = 0; corner < 3; corner++) { expect("vertex"); points.push([numeric(), numeric(), numeric()]); }
				expect("endloop"); expect("endfacet"); triangle(points);
			}
			expect("endsolid");
			while (index < tokens.length && tokens[index].toLowerCase() !== "solid") index++;
		}
	}
	return { numProp: 3, vertProperties: new Float32Array(positions), triVerts: new Uint32Array(triangles) };
}