export const DEFAULT_SPECIAL_VARIABLES = Object.freeze({ $fn: 0, $fa: 12, $fs: 2 });

function number(value, name) {
	if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be a finite number`);
	return value;
}

export function fragmentCount(radius, specialVariables = {}, diagnostic = () => {}) {
	const settings = { ...DEFAULT_SPECIAL_VARIABLES, ...specialVariables };
	let count = number(settings.$fn, "$fn");
	let angle = number(settings.$fa, "$fa");
	let size = number(settings.$fs, "$fs");
	if (count < 0) {
		diagnostic({ code: "negative-fn", message: "$fn negative - setting to 0" });
		count = 0;
	}
	if (angle < 0.01) {
		diagnostic({ code: "clamped-fa", message: "$fa too small - clamping to 0.01" });
		angle = 0.01;
	}
	if (size < 0.01) {
		diagnostic({ code: "clamped-fs", message: "$fs too small - clamping to 0.01" });
		size = 0.01;
	}
	if (radius < 2 ** -20) return 3;
	if (count > 0) return Math.ceil(Math.max(3, count));
	return Math.ceil(Math.max(5, Math.min(360 / angle, 2 * Math.PI * radius / size)));
}

function cosine(degrees) {
	if (degrees % 90 === 0) return [1, 0, -1, 0][((degrees / 90) % 4 + 4) % 4];
	return Math.cos(degrees * Math.PI / 180);
}

function ring(positions, radius, height, fragments) {
	const start = positions.length / 3;
	for (let segment = 0; segment < fragments; segment++) {
		const angle = segment * 360 / fragments;
		positions.push(radius * cosine(angle), radius * cosine(90 - angle), height);
	}
	return start;
}

function cap(triangles, start, fragments, upward) {
	for (let segment = 1; segment < fragments - 1; segment++) {
		if (upward) triangles.push(start, start + segment, start + segment + 1);
		else triangles.push(start, start + segment + 1, start + segment);
	}
}

function mesh(positions = [], triangles = []) {
	return { numProp: 3, vertProperties: new Float32Array(positions), triVerts: new Uint32Array(triangles) };
}

function enforceBudget(triangles, maximum) {
	if (!Number.isSafeInteger(triangles) || triangles > maximum) throw new RangeError(`Primitive exceeds the ${maximum} triangle limit`);
}

function radiusArgument(args, radiusName, diameterName, fallback, diagnostic) {
	if (args[diameterName] !== undefined) {
		if (args[radiusName] !== undefined) diagnostic({ code: "diameter-precedence", message: `${diameterName} overrides ${radiusName}` });
		return number(args[diameterName], diameterName) / 2;
	}
	return args[radiusName] === undefined ? fallback : number(args[radiusName], radiusName);
}

export function tessellateSphere(args = {}, specialVariables = {}, { diagnostic = () => {}, maxTriangles = 1_000_000 } = {}) {
	if (args.style !== undefined && args.style !== "orig") throw new RangeError("Only sphere style='orig' is supported");
	const radius = radiusArgument(args, "r", "d", 1, diagnostic);
	const fragments = fragmentCount(radius, specialVariables, diagnostic);
	if (radius <= 0) {
		diagnostic({ code: "empty-sphere", message: "Sphere radius must be positive; producing empty geometry" });
		return mesh();
	}
	const latitudeCount = Math.ceil(fragments / 2);
	enforceBudget(2 * fragments * latitudeCount - 4, maxTriangles);
	const positions = [];
	const triangles = [];
	for (let latitude = 0; latitude < latitudeCount; latitude++) {
		const polarAngle = (latitude + 0.5) * 180 / latitudeCount;
		ring(positions, radius * cosine(90 - polarAngle), radius * cosine(polarAngle), fragments);
	}
	cap(triangles, 0, fragments, true);
	for (let latitude = 0; latitude < latitudeCount - 1; latitude++) {
		for (let segment = 0; segment < fragments; segment++) {
			const upper = latitude * fragments + segment;
			const upperNext = latitude * fragments + (segment + 1) % fragments;
			const lower = upper + fragments;
			const lowerNext = upperNext + fragments;
			triangles.push(upper, lower, upperNext, upperNext, lower, lowerNext);
		}
	}
	cap(triangles, (latitudeCount - 1) * fragments, fragments, false);
	return mesh(positions, triangles);
}

export function tessellateCylinder(args = {}, specialVariables = {}, { diagnostic = () => {}, maxTriangles = 1_000_000 } = {}) {
	const height = number(args.h ?? 1, "h");
	const radius = radiusArgument(args, "r", "d", 1, diagnostic);
	const bottomRadius = radiusArgument(args, "r1", "d1", radius, diagnostic);
	const topRadius = radiusArgument(args, "r2", "d2", radius, diagnostic);
	if ((args.r !== undefined || args.d !== undefined) && ["r1", "r2", "d1", "d2"].some((name) => args[name] !== undefined)) {
		diagnostic({ code: "ambiguous-cylinder", message: "Cylinder parameters ambiguous" });
	}
	if (args.center !== undefined && typeof args.center !== "boolean") throw new TypeError("center must be a boolean");
	const fragments = fragmentCount(Math.max(bottomRadius, topRadius), specialVariables, diagnostic);
	if (height <= 0 || bottomRadius < 0 || topRadius < 0 || (bottomRadius === 0 && topRadius === 0)) {
		diagnostic({ code: "empty-cylinder", message: "Invalid cylinder dimensions; producing empty geometry" });
		return mesh();
	}
	const pointed = bottomRadius === 0 || topRadius === 0;
	enforceBudget(pointed ? 2 * fragments - 2 : 4 * fragments - 4, maxTriangles);
	const positions = [];
	const triangles = [];
	const bottomHeight = args.center ? -height / 2 : 0;
	if (bottomRadius === 0) positions.push(0, 0, bottomHeight);
	else ring(positions, bottomRadius, bottomHeight, fragments);
	const topStart = positions.length / 3;
	if (topRadius === 0) positions.push(0, 0, bottomHeight + height);
	else ring(positions, topRadius, bottomHeight + height, fragments);
	for (let segment = 0; segment < fragments; segment++) {
		const next = (segment + 1) % fragments;
		if (bottomRadius === 0) triangles.push(0, topStart + next, topStart + segment);
		else if (topRadius === 0) triangles.push(segment, next, topStart);
		else triangles.push(segment, next, topStart + segment, next, topStart + next, topStart + segment);
	}
	if (bottomRadius > 0) cap(triangles, 0, fragments, false);
	if (topRadius > 0) cap(triangles, topStart, fragments, true);
	return mesh(positions, triangles);
}