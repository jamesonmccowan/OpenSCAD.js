import { parse } from "../core/parser.js";

const unavailable = Symbol("unavailable");

function literal(expression) {
	if (expression.type === "literal") return expression.value;
	if (expression.type === "unary" && ["+", "-"].includes(expression.operator)) {
		const value = literal(expression.value);
		return typeof value === "number" ? (expression.operator === "-" ? -value : value) : unavailable;
	}
	if (expression.type === "vector") return expression.values.map(literal);
	return unavailable;
}

function kind(value) {
	if (typeof value === "number" && Number.isFinite(value)) return "number";
	if (typeof value === "boolean") return "boolean";
	if (typeof value === "string" && value.length <= 4096) return "string";
	if (Array.isArray(value) && value.length >= 1 && value.length <= 4 && value.every((component) => typeof component === "number" && Number.isFinite(component))) return "vector";
}

function comments(source) {
	const result = [];
	const pattern = /"(?:\\.|[^"\\])*"|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;
	let previous = 0, line = 1;
	for (const match of source.matchAll(pattern)) {
		line += (source.slice(previous, match.index).match(/\n/g) ?? []).length;
		if (match[0].startsWith("/")) result.push({ line, offset: match.index, text: match[0].startsWith("//") ? match[0].slice(2).trim() : match[0].slice(2, -2).trim(), block: match[0].startsWith("/*") });
		line += (match[0].match(/\n/g) ?? []).length;
		previous = match.index + match[0].length;
	}
	return result;
}

function metadata(text, type) {
	const match = /^\[([^\]]*)\]$/.exec(text ?? "");
	if (!match) return {};
	const parts = match[1].split(":").map((value) => value.trim());
	if (["number", "vector"].includes(type) && parts.length >= 1 && parts.length <= 3 && parts.every((value) => value !== "" && Number.isFinite(Number(value))) && !match[1].includes(",")) {
		const values = parts.map(Number);
		const min = values.length === 1 ? 0 : values[0], max = values.at(-1), step = values.length === 3 ? values[1] : 1;
		if (min < max && step > 0) return { min, max, step };
	}
	if (["number", "string"].includes(type)) {
		const choices = match[1].split(",").map((choice) => {
			const [raw, ...label] = choice.trim().split(":");
			return { value: type === "number" ? Number(raw) : raw, label: label.join(":").trim() || raw };
		});
		if (choices.length && choices.every((choice) => type !== "number" || Number.isFinite(choice.value))) return { choices };
	}
	return {};
}

export function readParameters(source) {
	const statements = parse(source);
	const notes = comments(source);
	const parameters = new Map();
	for (const statement of statements) {
		if (statement.type !== "assignment" || statement.name.startsWith("$")) continue;
		parameters.delete(statement.name);
		const value = literal(statement.expression), type = kind(value);
		if (!type) continue;
		const before = notes.filter((note) => note.offset < statement.location.offset);
		const group = before.filter((note) => note.block && /^\[.*\]$/.test(note.text)).at(-1)?.text.slice(1, -1) ?? "Parameters";
		if (group === "Hidden") continue;
		const description = before.at(-1);
		const label = description && !description.block && description.line === statement.location.line - 1 && !description.text.startsWith("[") ? description.text : statement.name.replaceAll("_", " ");
		const annotation = notes.find((note) => !note.block && note.offset > statement.location.offset && note.line === statement.location.line)?.text;
		parameters.set(statement.name, { name: statement.name, type, default: value, group, label, ...metadata(annotation, type) });
		if (parameters.size > 128) throw new RangeError("Customizer parameter limit exceeded");
	}
	return [...parameters.values()];
}

function validate(parameter, value) {
	if (kind(value) !== parameter.type || (parameter.type === "vector" && value.length !== parameter.default.length)) throw new TypeError(`Invalid value for '${parameter.name}'`);
	if (parameter.choices && !parameter.choices.some((choice) => choice.value === value)) throw new RangeError(`Unknown choice for '${parameter.name}'`);
	if (parameter.min !== undefined && (Array.isArray(value) ? value : [value]).some((component) => component < parameter.min || component > parameter.max)) throw new RangeError(`Value outside range for '${parameter.name}'`);
	return structuredClone(value);
}

export class Customizer {
	constructor(source = "") { this.overrides = new Map(); this.presets = new Map(); this.update(source); }
	update(source) {
		const parameters = readParameters(source);
		const retained = new Map();
		for (const parameter of parameters) if (this.overrides.has(parameter.name)) {
			try { retained.set(parameter.name, validate(parameter, this.overrides.get(parameter.name))); } catch {}
		}
		this.parameters = parameters; this.overrides = retained;
	}
	value(parameter) { return structuredClone(this.overrides.has(parameter.name) ? this.overrides.get(parameter.name) : parameter.default); }
	set(name, value) {
		const parameter = this.parameters.find((item) => item.name === name);
		if (!parameter) throw new Error(`Unknown parameter '${name}'`);
		this.overrides.set(name, validate(parameter, value));
	}
	defines() { return structuredClone(Object.fromEntries(this.overrides)); }
	reset() { this.overrides.clear(); }
	save(name) {
		if (!name.trim() || name.length > 128 || (!this.presets.has(name) && this.presets.size >= 128)) throw new RangeError("Invalid preset name or preset limit exceeded");
		this.presets.set(name, Object.fromEntries(this.parameters.map((parameter) => [parameter.name, this.value(parameter)])));
	}
	apply(name) {
		if (!this.presets.has(name)) throw new Error(`Unknown preset '${name}'`);
		const next = new Map();
		for (const parameter of this.parameters) if (Object.hasOwn(this.presets.get(name), parameter.name)) next.set(parameter.name, validate(parameter, this.presets.get(name)[parameter.name]));
		this.overrides = next;
	}
	import(text) {
		if (text.length > 1_000_000) throw new RangeError("Preset byte limit exceeded");
		const data = JSON.parse(text);
		if (!data || data.fileFormatVersion !== "1" || !data.parameterSets || typeof data.parameterSets !== "object" || Array.isArray(data.parameterSets)) throw new TypeError("Expected OpenSCAD parameterSets JSON version 1");
		const next = new Map(this.presets);
		for (const [name, values] of Object.entries(data.parameterSets)) {
			if (!name.trim() || name.length > 128 || !values || typeof values !== "object" || Array.isArray(values)) throw new TypeError("Invalid preset");
			const converted = [];
			for (const parameter of this.parameters) if (Object.hasOwn(values, parameter.name)) {
				let value = values[parameter.name];
				if (typeof value === "string" && parameter.type !== "string") {
					const statements = parse(`preset_value=${value};`);
					if (statements.length !== 1 || statements[0].type !== "assignment") throw new TypeError("Preset values must be literals");
					value = literal(statements[0].expression);
				}
				converted.push([parameter.name, validate(parameter, value)]);
			}
			next.set(name, Object.fromEntries(converted));
		}
		if (next.size > 128) throw new RangeError("Preset limit exceeded");
		this.presets = next;
	}
	export() {
		const parameterSets = Object.fromEntries([...this.presets].map(([name, values]) => [name, Object.fromEntries(Object.entries(values).map(([key, value]) => [key, typeof value === "string" ? value : JSON.stringify(value)]))]));
		return JSON.stringify({ fileFormatVersion: "1", parameterSets }, null, 2) + "\n";
	}
}