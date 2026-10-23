import { ScadError } from "./parser.js";

const maxGroupPairs = 500_000;

function parseEntities(source) {
	const lines = source.replace(/\r\n?/g, "\n").split("\n");
	if (lines.at(-1) === "") lines.pop();
	if (lines.length % 2 !== 0 || lines.length / 2 > maxGroupPairs) throw new ScadError("Malformed or oversized DXF group data", undefined, "invalid-dxf");
	const entities = [];
	let section = "", sectionHeader = false, current;
	const finish = () => { if (current) entities.push(current); current = undefined; };
	for (let index = 0; index < lines.length; index += 2) {
		const code = Number(lines[index].trim()), value = lines[index + 1].trim();
		if (!Number.isSafeInteger(code)) throw new ScadError(`Invalid DXF group code '${lines[index]}'`, undefined, "invalid-dxf");
		if (code === 0) {
			finish();
			const marker = value.toUpperCase();
			if (marker === "SECTION") sectionHeader = true;
			else if (marker === "ENDSEC") { section = ""; sectionHeader = false; }
			else if (marker === "EOF") break;
			else if (section === "ENTITIES") current = { type: marker, groups: [] };
		} else if (sectionHeader && code === 2) {
			section = value.toUpperCase();
			sectionHeader = false;
		} else if (current) current.groups.push([code, value]);
	}
	finish();
	return entities;
}

function group(entity, code) {
	return entity.groups.find(([entry]) => entry === code)?.[1];
}

function number(value, field) {
	const parsed = Number(value);
	if (value === undefined || value.trim() === "" || !Number.isFinite(parsed)) throw new ScadError(`Invalid numeric DXF value for group ${field}`, undefined, "invalid-dxf");
	return parsed;
}

function transformedPoint(x, y, origin, scale) {
	return [(x - origin[0]) * scale, (y - origin[1]) * scale];
}

function dimensionCoordinates(entity, origin, scale) {
	const coordinates = Array.from({ length: 7 }, () => [0, 0]);
	for (const [code, raw] of entity.groups) {
		if (code >= 10 && code <= 16) {
			const subtract = ![11, 12, 16].includes(code);
			coordinates[code - 10][0] = (number(raw, code) - (subtract ? origin[0] : 0)) * scale;
		} else if (code >= 20 && code <= 26) {
			const subtract = ![21, 22, 26].includes(code);
			coordinates[code - 20][1] = (number(raw, code) - (subtract ? origin[1] : 0)) * scale;
		}
	}
	return coordinates;
}

function layerEntities(source, layer) {
	return parseEntities(source).filter((entity) => !layer || (group(entity, 8) ?? "") === layer);
}

export function dimensionValue(source, { layer = "", name = "", origin = [0, 0], scale = 1 } = {}) {
	for (const entity of layerEntities(source, layer)) {
		if (entity.type !== "DIMENSION" || (name && (group(entity, 1) ?? "") !== name)) continue;
		const type = Math.trunc(number(group(entity, 70) ?? "0", 70)) & 7;
		const coordinates = dimensionCoordinates(entity, origin, scale);
		const dx = coordinates[4][0] - coordinates[3][0], dy = coordinates[4][1] - coordinates[3][1];
		if (type === 0) {
			const angle = number(group(entity, 50) ?? "0", 50) * Math.PI / 180;
			return { value: Math.abs(dx * Math.cos(angle) + dy * Math.sin(angle)) };
		}
		if (type === 1) return { value: Math.hypot(dx, dy) };
		if (type === 2) {
			const first = Math.atan2(coordinates[0][0] - coordinates[5][0], coordinates[0][1] - coordinates[5][1]);
			const second = Math.atan2(dx, dy);
			return { value: Math.abs((first - second) * 180 / Math.PI) };
		}
		if (type === 3 || type === 4) return { value: Math.hypot(coordinates[5][0] - coordinates[0][0], coordinates[5][1] - coordinates[0][1]) };
		if (type === 6) return { value: coordinates[3][(Math.trunc(number(group(entity, 70) ?? "0", 70)) & 64) ? 0 : 1] };
		return { warning: `Dimension '${name}' has unsupported type` };
	}
	return { warning: `Can't find dimension '${name}'` };
}

function lineSegments(entities, origin, scale) {
	const segments = [];
	for (const entity of entities) {
		if (entity.type === "LINE") {
			segments.push([
				transformedPoint(number(group(entity, 10), 10), number(group(entity, 20), 20), origin, scale),
				transformedPoint(number(group(entity, 11), 11), number(group(entity, 21), 21), origin, scale),
			]);
		} else if (entity.type === "LWPOLYLINE") {
			const xs = entity.groups.filter(([code]) => code === 10).map(([, value]) => number(value, 10));
			const ys = entity.groups.filter(([code]) => code === 20).map(([, value]) => number(value, 20));
			if (xs.length !== ys.length) throw new ScadError("DXF LWPOLYLINE has mismatched coordinates", undefined, "invalid-dxf");
			const points = xs.map((x, index) => transformedPoint(x, ys[index], origin, scale));
			for (let index = 1; index < points.length; index++) segments.push([points[index - 1], points[index]]);
			if (points.length > 1 && (Math.trunc(number(group(entity, 70) ?? "0", 70)) & 1)) segments.push([points.at(-1), points[0]]);
		}
	}
	return segments;
}

function pointKey(point) {
	return `${Math.round(point[0] * 1e8)},${Math.round(point[1] * 1e8)}`;
}

function openLinePaths(segments) {
	const adjacent = new Map();
	segments.forEach((segment, index) => segment.forEach((point) => {
		const key = pointKey(point), indices = adjacent.get(key) ?? [];
		indices.push(index);
		adjacent.set(key, indices);
	}));
	const remaining = new Set(segments.map((_, index) => index)), paths = [];
	while (remaining.size) {
		let start;
		for (const index of remaining) {
			for (let side = 0; side < 2; side++) {
				const point = segments[index][side];
				if (!(adjacent.get(pointKey(point)) ?? []).some((candidate) => candidate !== index && remaining.has(candidate))) {
					start = { index, side, point };
					break;
				}
			}
			if (start) break;
		}
		if (!start) break;
		const points = [start.point];
		let current = start.index, side = start.side;
		while (remaining.has(current)) {
			remaining.delete(current);
			const endpoint = segments[current][1 - side];
			points.push(endpoint);
			const next = (adjacent.get(pointKey(endpoint)) ?? []).find((candidate) => remaining.has(candidate));
			if (next === undefined) break;
			current = next;
			side = pointKey(segments[next][0]) === pointKey(endpoint) ? 0 : 1;
		}
		paths.push(points);
	}
	return paths;
}

export function crossValue(source, { layer = "", origin = [0, 0], scale = 1 } = {}) {
	const entities = layerEntities(source, layer);
	const paths = openLinePaths(lineSegments(entities, origin, scale)).filter((points) => points.length === 2);
	if (paths.length < 2) return { warning: "Can't find cross" };
	const [[first, second], [third, fourth]] = paths;
	const denominator = (fourth[1] - third[1]) * (second[0] - first[0]) - (fourth[0] - third[0]) * (second[1] - first[1]);
	if (denominator === 0) return { warning: "Can't find cross" };
	const parameter = ((fourth[0] - third[0]) * (first[1] - third[1]) - (fourth[1] - third[1]) * (first[0] - third[0])) / denominator;
	return { value: [first[0] + parameter * (second[0] - first[0]), first[1] + parameter * (second[1] - first[1])] };
}