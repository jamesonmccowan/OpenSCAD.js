import { parse, ScadError } from "./parser.js";
import { normalizePath } from "./project.js";
import { DEFAULT_SPECIAL_VARIABLES } from "../geometry/tessellation.js";
import { crossValue, dimensionValue } from "./dxf.js";

export const CAPABILITIES = Object.freeze({
	profile: "openscad-2026.10.02",
	status: "partial",
	syntax: Object.freeze(["assignments", "modules", "functions", "anonymous-functions:closures", "callable-expressions", "objects:experimental-object-function", "object-methods:experimental-object-function", "import-function:experimental-json", "vector-swizzle:experimental", "parent_module", "textmetrics:liberation-fonts", "fontmetrics:liberation-fonts", "dxf-functions:dimension-and-line-cross", "built-in-functions:cross-lookup-search-chr-ord-rands-version_num", "hexadecimal-integer-literals", "if", "for", "intersection_for", "let", "ranges", "vectors", "indexing", "ternary", "modifiers", "include:project", "use:project", "matrix-multiplication", "defines:api", "numeric-prefix-identifiers:deprecated", "list-comprehensions:for-if-each-let", "named-built-in-function-arguments"]),
	geometry: Object.freeze(["cube", "sphere:orig", "cylinder", "square", "circle", "polygon", "polyhedron", "import:stl", "text:liberation-latin-fonts", "roof:experimental-voronoi-straight", "linear_extrude", "rotate_extrude", "projection", "minkowski:3d", "offset:2d", "resize:2d-3d", "fill:2d", "union", "difference", "intersection", "hull", "translate", "rotate", "scale", "mirror", "multmatrix:3d", "audit_part:extension-interference" ]),
	unsupported: Object.freeze(["minkowski:2d", "text:unicode-or-complex-shaping", "surface", "non-stl-imports", "multmatrix:2d", "linear_extrude:auto-slices", "linear_extrude:v", "linear_extrude:segments", "mixed-type-or-vector-ordering"]),
});

export function truthy(value) {
	return value !== undefined && value !== false && value !== 0 && value !== "" && (!Array.isArray(value) || value.length > 0);
}

export function formatValue(value) {
	if (value === undefined) return "undef";
	if (typeof value === "number" && !Number.isFinite(value)) return Number.isNaN(value) ? "nan" : value < 0 ? "-inf" : "inf";
	if (typeof value === "string") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(formatValue).join(", ")}]`;
	if (value instanceof ScadRange) return `[${value.start} : ${value.step} : ${value.end}]`;
	if (value instanceof ScadObject) return `{ ${Object.keys(value.values).map((key) => `${key} = ${formatValue(value.values[key])};`).join(" ")} }`;
	return String(value);
}

function formatScadNumber(value) {
	if (!Number.isFinite(value)) return Number.isNaN(value) ? "nan" : value < 0 ? "-inf" : "inf";
	if (Object.is(value, -0)) return "0";
	const rounded = value.toPrecision(6);
	const [mantissa, exponentText] = rounded.split("e");
	let exponent = exponentText === undefined ? Math.floor(Math.log10(Math.abs(Number(rounded)))) : Number(exponentText);
	if (exponent < -5 || exponent >= 6) {
		const scientific = Number(rounded).toExponential(5).split("e");
		exponent = Number(scientific[1]);
		return `${scientific[0].replace(/\.?0+$/, "")}e${exponent >= 0 ? "+" : ""}${exponent}`;
	}
	if (exponentText === undefined) return mantissa.replace(/\.?0+$/, "");
	return Number(rounded).toFixed(Math.max(0, 5 - exponent)).replace(/\.?0+$/, "");
}

function formatScadExpression(node) {
	if (!node) return "undef";
	switch (node.type) {
		case "literal": return typeof node.value === "string" ? JSON.stringify(node.value) : node.value === undefined ? "undef" : typeof node.value === "number" ? formatScadNumber(node.value) : String(node.value);
		case "variable": return node.name;
		case "vector": return `[${node.values.map(formatScadExpression).join(", ")}]`;
		case "range": return `[${node.values.map(formatScadExpression).join(" : ")}]`;
		case "unary": return `(${node.operator}${formatScadExpression(node.value)})`;
		case "binary": return `(${formatScadExpression(node.left)} ${node.operator} ${formatScadExpression(node.right)})`;
		case "conditional": return `(${formatScadExpression(node.condition)} ? ${formatScadExpression(node.consequent)} : ${formatScadExpression(node.alternate)})`;
		case "index": return `${formatScadExpression(node.value)}[${formatScadExpression(node.index)}]`;
		case "member": return `${formatScadExpression(node.value)}.${node.name}`;
		case "invoke": return `${formatScadExpression(node.callee)}(${node.args.map((arg) => formatScadExpression(arg.expression)).join(", ")})`;
		case "function": return `${node.name}(${node.args.map((arg) => formatScadExpression(arg.expression)).join(", ")})`;
		default: return "undef";
	}
}

function formatScadString(value) {
	if (value === undefined) return "undef";
	if (typeof value === "string") return value;
	if (typeof value === "number") return formatScadNumber(value);
	if (typeof value === "boolean") return String(value);
	if (Array.isArray(value)) return `[${value.map((entry) => typeof entry === "string" ? `"${entry}"` : formatScadString(entry)).join(", ")}]`;
	if (value instanceof ScadRange) return `[${formatScadNumber(value.start)} : ${formatScadNumber(value.step)} : ${formatScadNumber(value.end)}]`;
	if (value instanceof ScadObject) return `{ ${Object.keys(value.values).map((key) => `${key} = ${typeof value.values[key] === "string" ? `"${value.values[key]}"` : formatScadString(value.values[key])};`).join(" ")} }`;
	if (value instanceof ScadFunction) {
		const { params, expression } = value.statement;
		const formattedParams = params.map(({ name, defaultValue }) => `${name}${defaultValue ? ` = ${formatScadExpression(defaultValue)}` : ""}`).join(", ");
		return `function(${formattedParams}) ${formatScadExpression(expression)}`;
	}
	if (value instanceof ScadMethod) return formatScadString(value.callable);
	return String(value);
}

export class ScadObject {
	constructor(entries = {}) { this.values = Object.assign(Object.create(null), entries); }
	get(key) { return this.values[key]; }
	has(key) { return Object.hasOwn(this.values, key); }
	set(key, value) { this.values[key] = value; }
	delete(key) { delete this.values[key]; }
	entries() { return Object.entries(this.values); }
}

class ScadFunction {
	constructor(statement, scope) { this.statement = statement; this.scope = scope; Object.freeze(this); }
}

class ScadMethod {
	constructor(callable, receiver) { this.callable = callable; this.receiver = receiver; Object.freeze(this); }
}

function normalizeValue(value) {
	if (value instanceof ScadObject) return value;
	if (Array.isArray(value)) return value.map(normalizeValue);
	if (value && typeof value === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
		return new ScadObject(Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, normalizeValue(entry)])));
	}
	return value;
}

export class ScadRange {
	constructor(start, step, end) { this.start = start; this.step = step; this.end = end; Object.freeze(this); }
}

function seedHash(value) {
	if (!Number.isFinite(value)) return value === Infinity ? 314159 : value === -Infinity ? -314159 : 0;
	if (value === 0) return 0;
	const view = new DataView(new ArrayBuffer(8));
	view.setFloat64(0, Math.abs(value));
	const high = view.getUint32(0), low = view.getUint32(4);
	const exponentBits = (high >>> 20) & 0x7ff;
	const fraction = (high & 0xfffff) * 4294967296 + low;
	let mantissa, exponent;
	if (exponentBits) { mantissa = 0.5 + fraction / 9007199254740992; exponent = exponentBits - 1022; }
	else {
		const leading = Math.floor(Math.log2(fraction));
		mantissa = fraction / 2 ** (leading + 1); exponent = leading - 1073;
	}
	let hash = 0;
	while (mantissa) {
		hash = ((((hash << 28) >>> 0) & 0x7fffffff) | (hash >>> 3)) >>> 0;
		mantissa *= 268435456; exponent -= 28;
		const integer = Math.trunc(mantissa);
		mantissa -= integer;
		hash = (hash + integer) % 0x7fffffff;
	}
	const shift = exponent >= 0 ? exponent % 31 : 30 - ((-1 - exponent) % 31);
	if (shift) hash = ((((hash << shift) >>> 0) & 0x7fffffff) | (hash >>> (31 - shift))) >>> 0;
	return value < 0 ? -hash : hash;
}

function formatRandsResetBound(value) {
	const view = new DataView(new ArrayBuffer(8));
	view.setFloat64(0, Math.abs(value));
	const bits = view.getBigUint64(0);
	const exponent = Number((bits >> 52n) & 0x7ffn) - 1023 - 52;
	const significand = (1n << 52n) | (bits & ((1n << 52n) - 1n));
	return `${value < 0 ? "-" : ""}${significand << BigInt(exponent)}.000000`;
}

function mt19937(seed, snapshot) {
	const state = snapshot ? snapshot.state.slice() : new Uint32Array(624);
	if (!snapshot) {
		state[0] = seed >>> 0;
		for (let index = 1; index < state.length; index++) state[index] = (Math.imul(1812433253, state[index - 1] ^ (state[index - 1] >>> 30)) + index) >>> 0;
	}
	let position = snapshot?.position ?? 624;
	const next = () => {
		if (position >= 624) {
			for (let index = 0; index < 624; index++) {
				const value = (state[index] & 0x80000000) | (state[(index + 1) % 624] & 0x7fffffff);
				state[index] = (state[(index + 397) % 624] ^ (value >>> 1) ^ ((value & 1) ? 0x9908b0df : 0)) >>> 0;
			}
			position = 0;
		}
		let value = state[position++];
		value ^= value >>> 11;
		value ^= (value << 7) & 0x9d2c5680;
		value ^= (value << 15) & 0xefc60000;
		value ^= value >>> 18;
		return value >>> 0;
	};
	next.snapshot = () => ({ state: state.slice(), position });
	return next;
}

let randomStream = mt19937(Math.floor(Math.random() * 4294967296));

export function randomCheckpoint() {
	const snapshot = randomStream.snapshot();
	return () => { randomStream = mt19937(0, snapshot); };
}

function freeze(value) {
	if (value && typeof value === "object" && !Object.isFrozen(value)) {
		Object.values(value).forEach(freeze);
		Object.freeze(value);
	}
	return value;
}

class Scope {
	constructor(evaluator, parent = null, dynamicParent = parent) {
		this.evaluator = evaluator;
		this.parent = parent;
		this.dynamicParent = dynamicParent;
		this.bindings = new Map();
		this.definitions = new Map();
		this.active = new Set();
		this.children = parent?.children ?? null;
	}
	get(name, location, warnUnknown = true) {
		if (this.bindings.has(name) && !this.active.has(name)) {
			const binding = this.bindings.get(name);
			if (Object.hasOwn(binding, "value")) return binding.value;
			this.active.add(name);
			try { return this.evaluator.expression(binding.expression, this); }
			finally { this.active.delete(name); }
		}
		const parent = name.startsWith("$") ? this.dynamicParent : this.parent;
		if (parent) return parent.get(name, location, warnUnknown);
		if (warnUnknown) this.evaluator.warn("unknown-variable", `Ignoring unknown variable '${name}'`, location);
		return undefined;
	}
	set(name, value) { this.bindings.set(name, { value: normalizeValue(value) }); }
	has(name) { return this.bindings.has(name) || Boolean(this.parent?.has(name)); }
	definition(name) { return this.definitions.get(name) ?? this.parent?.definition(name); }
	resolution() { return Object.fromEntries(["$fn", "$fa", "$fs"].map((name) => [name, this.get(name)])); }
}

const signatures = {
	cube: ["size", "center"], sphere: ["r"], cylinder: ["h", "r1", "r2", "center"],
	translate: ["v"], rotate: ["a", "v"], scale: ["v"], mirror: ["v"], multmatrix: ["m"],
	color: ["c", "alpha"], square: ["size", "center"], circle: ["r"], polygon: ["points", "paths", "convexity"],
	linear_extrude: ["height", "v", "scale", "center", "twist", "slices", "segments"], children: ["index"],
	import: ["file", "convexity"],
	polyhedron: ["points", "faces", "convexity"],
	text: ["text", "size", "font", "halign", "valign", "spacing", "direction", "language", "script"], roof: ["method"], rotate_extrude: ["angle", "start", "convexity"], projection: ["cut", "convexity"], minkowski: ["convexity"], offset: ["r", "delta", "chamfer"], resize: ["newsize", "auto", "convexity"],
};
const typePredicateNames = new Set(["is_undef", "is_list", "is_num", "is_bool", "is_string", "is_function", "is_object"]);

export class Evaluator {
	constructor({ mode = "preview", time = 0, randomSeed, specialVariables = {}, defines = {}, defineExpressions = [], experimental = [], importedData, dxfData, measureTextMetrics, measureFontMetrics, signal, maxSteps = 100_000, maxDepth = 128, file = "main.scad" } = {}) {
		if (!["preview", "render"].includes(mode)) throw new TypeError("mode must be preview or render");
		if (![maxSteps, maxDepth].every((value) => Number.isSafeInteger(value) && value > 0)) throw new TypeError("Evaluation limits must be positive safe integers");
		if (randomSeed !== undefined && typeof randomSeed !== "number") throw new TypeError("randomSeed must be a number");
		if (!Array.isArray(experimental) || experimental.some((feature) => !["roof", "object-function", "import-function", "vector-swizzle"].includes(feature))) throw new TypeError("Unknown experimental feature");
		this.options = { mode, time, randomSeed, specialVariables, defines, defineExpressions, experimental, importedData, dxfData, measureTextMetrics, measureFontMetrics, signal, maxSteps, maxDepth, file };
		this.steps = 0;
		this.depth = 0;
		this.nextId = 0;
		this.diagnostics = [];
		this.echoes = [];
		this.moduleStack = [];
	}
	warn(code, message, location) { this.diagnostics.push({ severity: "warning", code, message, location }); }
	tick(location) {
		if (this.options.signal?.aborted) throw new ScadError("Evaluation cancelled", location, "cancelled");
		if (++this.steps > this.options.maxSteps) throw new ScadError("Evaluation step limit exceeded", location, "resource-limit");
	}
	node(kind, data, children, location) {
		return freeze({ id: this.nextId++, kind, ...data, children, location });
	}
	run(source) {
		this.steps = 0; this.depth = 0; this.nextId = 0; this.diagnostics = []; this.echoes = []; this.moduleStack = [];
		if (this.options.randomSeed !== undefined) randomStream = mt19937(seedHash(this.options.randomSeed));
		const statements = typeof source === "string" ? parse(source, { file: this.options.file }) : source;
		const root = new Scope(this);
		this.root = root;
		root.set("PI", Math.PI);
		for (const [name, value] of Object.entries({ ...DEFAULT_SPECIAL_VARIABLES, $vpt: [0, 0, 0], $vpr: [0, 0, 0], $vpd: 500, $vpf: 22.5, ...this.options.specialVariables, $t: this.options.time, $preview: this.options.mode === "preview" })) root.set(name, value);
		const main = new Scope(this, root);
		const children = this.statements(statements, main, this.options.defines, this.options.defineExpressions);
		const view = Object.fromEntries(["$vpt", "$vpr", "$vpd", "$vpf"].filter((name) => main.bindings.has(name)).map((name) => [name, main.get(name)]));
		return freeze({ tree: this.node("group", {}, children), echoes: this.echoes, diagnostics: this.diagnostics, mode: this.options.mode, view, profile: CAPABILITIES.profile, capabilities: CAPABILITIES });
	}
	statements(statements, scope, overrides = {}, expressions = []) {
		this.prepare(statements, scope);
		if (!Array.isArray(expressions) || expressions.length > 128 || expressions.some((expression) => typeof expression !== "string")) throw new ScadError("Invalid expression overrides", undefined, "invalid-arguments");
		for (const expression of expressions) {
			const parsed = parse(expression + ";", { file: "<command-line>" });
			for (const marker of parsed.filter((statement) => statement.type === "deprecation")) this.warn("deprecated-identifier", `Variable names starting with digits ("${marker.name}") will be removed in future releases.`,marker.location);
			const assignments = parsed.filter((statement) => statement.type !== "deprecation");
			if (assignments.length !== 1 || assignments[0].type !== "assignment") throw new ScadError("Expression overrides must be exactly NAME=SCAD_EXPRESSION", assignments[0]?.location, "invalid-arguments");
			scope.bindings.set(assignments[0].name, assignments[0]);
		}
		for (const [name, value] of Object.entries(overrides)) scope.set(name, value);
		return statements.flatMap((statement) => this.statement(statement, scope));
	}
	prepare(statements, scope) {
		for (const statement of statements) {
			if (statement.type === "deprecation") this.warn("deprecated-identifier", `Variable names starting with digits ("${statement.name}") will be removed in future releases.`, statement.location);
			if (statement.type === "library") {
				const library = new Scope(this, this.root);
				this.prepare(statement.children, library);
				for (const [name, definition] of library.definitions) scope.definitions.set(name, definition);
			}
			if (statement.type === "assignment") {
				const previous = scope.bindings.get(statement.name);
				if (previous?.expression) this.warn("overwritten-assignment", `"${statement.name}" was assigned on line ${previous.location.line} but was overwritten`, statement.location);
				scope.bindings.set(statement.name, statement);
			}
			if (statement.type === "module" || statement.type === "definition") scope.definitions.set(statement.name, { statement, scope });
		}
	}
	body(statements, scope) { return this.statements(statements, new Scope(this, scope)); }
	statement(statement, scope) {
		this.tick(statement.location);
		if (["assignment", "definition", "module", "empty", "library", "deprecation"].includes(statement.type) || statement.modifiers.includes("*")) return [];
		if (["include", "use"].includes(statement.type)) throw new ScadError("File directives require project resolution", statement.location, "unresolved-project");
		let result;
		if (statement.type === "block") result = this.node("group", {}, this.body(statement.children, scope), statement.location);
		else if (statement.type === "if") result = this.node("group", {}, this.body(truthy(this.expression(statement.condition, scope)) ? statement.children : statement.alternate, scope), statement.location);
		else if (["for", "intersection_for"].includes(statement.type)) {
			const children = [];
			const intersection = statement.type === "intersection_for";
			const iterate = (index, environment) => {
				this.tick(statement.location);
				if (index === statement.bindings.length) {
					const body = this.body(statement.children, environment);
					if (intersection) children.push(this.node("group", {}, body, statement.location));
					else children.push(...body);
					return;
				}
				const binding = statement.bindings[index];
				for (const value of this.iterable(this.expression(binding.expression, environment), statement.location)) {
					const child = new Scope(this, environment);
					child.set(binding.name, value);
					iterate(index + 1, child);
				}
			};
			iterate(0, scope);
			result = intersection ? this.node("boolean", { operation: "intersection" }, children, statement.location) : this.node("group", {}, children, statement.location);
		} else result = this.call(statement, scope);
		if (!result) return [];
		if (statement.modifiers.length) result = this.node("modifier", { modifiers: statement.modifiers }, [result], statement.location);
		return [result];
	}
	args(args, scope) { return args.map((arg) => ({ name: arg.name, value: this.expression(arg.expression, scope) })); }
	bind(args, names, location) {
		const values = Object.create(null);
		let position = 0;
		for (const arg of args) {
			const name = arg.name ?? names[position++];
			if (!name) throw new ScadError("Too many positional arguments", location, "invalid-arguments");
			values[name] = arg.value;
		}
		return values;
	}
	invoke(definition, args, caller, location, callback) {
		if (++this.depth > this.options.maxDepth) { this.depth--; throw new ScadError("Call depth limit exceeded", location, "resource-limit"); }
		try {
			const params = definition.statement.params;
			const values = this.bind(args, params.map((param) => param.name), location);
			const scope = new Scope(this, definition.scope, caller);
			for (const [name, value] of Object.entries(values)) scope.set(name, value);
			for (const param of params) if (!Object.hasOwn(values, param.name)) scope.set(param.name, param.defaultValue ? this.expression(param.defaultValue, scope) : undefined);
			return callback(scope);
		} finally { this.depth--; }
	}
	invokeMethod(method, args, caller, location) {
		const parameters = method.callable.statement.params;
		const boundArgs = parameters.some((parameter) => parameter.name === "this") && !args.some((arg) => arg.name === "this")
			? [...args, { name: "this", value: method.receiver }]
			: args;
		return this.invoke(method.callable, boundArgs, caller, location, (child) => this.expression(method.callable.statement.expression, child));
	}
	call(statement, scope) {
		const { name, location } = statement;
		if (name === "audit_part") {
			const values = this.bind(this.args(statement.args, scope), ["name"], location);
			if (typeof values.name !== "string" || !values.name.trim() || values.name.length > 128) throw new ScadError("audit_part() requires a nonempty name up to 128 characters", location, "invalid-component");
			if (!statement.children.length) throw new ScadError("audit_part() requires child geometry", location, "invalid-component");
			return this.node("component", { name: values.name.trim() }, this.body(statement.children, scope), location);
		}
		if (name === "let") {
			const child = new Scope(this, scope);
			for (const arg of statement.args) {
				if (!arg.name) throw new ScadError("let() requires named bindings", location);
				child.set(arg.name, this.expression(arg.expression, child));
			}
			return this.node("group", {}, this.body(statement.children, child), location);
		}
		const definition = scope.definition(name);
		if (definition?.statement.type === "module") {
			this.moduleStack.push(name);
			try {
				const args = this.args(statement.args, scope);
				return this.invoke(definition, args, scope, location, (child) => {
					child.children = { statements: statement.children, scope };
					child.set("$children", statement.children.length);
					return this.node("group", { module: name }, this.body(definition.statement.children, child), location);
				});
			}
			finally { this.moduleStack.pop(); }
		}
		const args = this.args(statement.args, scope);
		if (name === "echo") {
			this.echoes.push(`ECHO: ${args.map((arg) => `${arg.name ? `${arg.name} = ` : ""}${formatValue(arg.value)}`).join(", ")}`);
			return this.node("group", {}, this.body(statement.children, scope), location);
		}
		if (name === "assert") {
			if (!truthy(args[0]?.value)) throw new ScadError(`Assertion failed: ${formatValue(args[1]?.value)}`, location, "assertion-failed");
			return this.node("group", {}, this.body(statement.children, scope), location);
		}
		if (name === "children") {
			if (!scope.children) return this.node("group", {}, [], location);
			const input = scope.children;
			const indices = args.length ? this.iterable(args[0].value, location) : input.statements.map((_, index) => index);
			return this.node("group", {}, indices.flatMap((index) => input.statements[index] ? this.body([input.statements[index]], input.scope) : []), location);
		}
		const values = this.bind(args, Object.hasOwn(signatures, name) ? signatures[name] : [], location);
		const childScope = new Scope(this, scope);
		for (const [key, value] of Object.entries(values)) if (key.startsWith("$")) childScope.set(key, value);
		if (["cube", "sphere", "cylinder", "square", "circle", "polygon", "import", "polyhedron", "text"].includes(name)) return this.node("primitive", { name, args: values, resolution: childScope.resolution() }, [], location);
		if (name === "roof") {
			if (!this.options.experimental.includes("roof")) throw new ScadError("roof requires explicit experimental=['roof']", location, "experimental-disabled");
			return this.node("roof", { args: values, resolution: childScope.resolution() }, this.body(statement.children, childScope), location);
		}
		if (["translate", "rotate", "scale", "mirror", "multmatrix"].includes(name)) return this.node("transform", { name, args: values }, this.body(statement.children, childScope), location);
		if (["union", "difference", "intersection"].includes(name)) return this.node("boolean", { operation: name }, this.body(statement.children, childScope), location);
		if (name === "hull") return this.node("hull", {}, this.body(statement.children, childScope), location);
		if (name === "minkowski") return this.node("minkowski", {}, this.body(statement.children, childScope), location);
		if (name === "projection") return this.node("projection", { args: values }, this.body(statement.children, childScope), location);
		if (name === "fill") return this.node("fill", {}, this.body(statement.children, childScope), location);
		if (["offset", "resize"].includes(name)) return this.node(name, { args: values, resolution: childScope.resolution() }, this.body(statement.children, childScope), location);
		if (name === "color") return this.node("appearance", { args: values }, this.body(statement.children, childScope), location);
		if (name === "linear_extrude") return this.node("extrusion", { args: values, resolution: childScope.resolution() }, this.body(statement.children, childScope), location);
		if (name === "rotate_extrude") return this.node("revolution", { args: values, resolution: childScope.resolution() }, this.body(statement.children, childScope), location);
		if (name === "render") return this.node("group", {}, this.body(statement.children, childScope), location);
		throw new ScadError(`Unsupported module '${name}'`, location, "unsupported-feature");
	}
	iterable(value, location) {
		if (value instanceof ScadRange) {
			if (![value.start, value.step, value.end].every(Number.isFinite) || value.step === 0) throw new ScadError("Invalid range", location, "invalid-range");
			const count = Math.max(0, Math.floor((value.end - value.start) / value.step + 1e-12) + 1);
			if (count > this.options.maxSteps - this.steps) throw new ScadError("Range expansion limit exceeded", location, "resource-limit");
			return Array.from({ length: count }, (_, index) => value.start + index * value.step);
		}
		if (Array.isArray(value)) return value;
		return value === undefined ? [] : [value];
	}
	listValues(node, scope) {
		this.tick(node.location);
		if (node.type === "comprehension-for") {
			const values = [];
			const iterate = (index, current) => {
				if (index === node.bindings.length) { values.push(...this.listValues(node.value, current)); return; }
				const binding = node.bindings[index];
				for (const value of this.iterable(this.expression(binding.expression, current), node.location)) {
					this.tick(node.location); const child = new Scope(this, current); child.set(binding.name, value); iterate(index + 1, child);
				}
			};
			iterate(0, scope); return values;
		}
		if (node.type === "comprehension-if") {
			const selected = truthy(this.expression(node.condition, scope)) ? node.value : node.alternate;
			return selected ? this.listValues(selected, scope) : [];
		}
		if (node.type === "comprehension-each") return this.iterable(this.expression(node.value, scope), node.location);
		if (node.type === "comprehension-let") {
			const child = new Scope(this, scope);
			for (const binding of node.bindings) { if (!binding.name) throw new ScadError("let requires named bindings", node.location); child.set(binding.name, this.expression(binding.expression, child)); }
			return this.listValues(node.value, child);
		}
		return [this.expression(node, scope)];
	}
	expression(node, scope) {
		this.tick(node.location);
		switch (node.type) {
			case "literal": return node.value;
			case "variable": return scope.get(node.name, node.location);
			case "lambda": return new ScadFunction(node, scope);
			case "vector": return node.values.flatMap((value) => this.listValues(value, scope));
			case "range": {
				const values = node.values.map((value) => this.expression(value, scope));
				return new ScadRange(values[0], values.length === 2 ? 1 : values[1], values.at(-1));
			}
			case "index": {
				const value = this.expression(node.value, scope);
				const index = this.expression(node.index, scope);
				if (value instanceof ScadObject && typeof index === "string") return this.objectProperty(value, index);
				return Number.isInteger(index) ? (typeof value === "string" ? Array.from(value) : value)?.[index] : undefined;
			}
			case "member": {
				const value = this.expression(node.value, scope);
				if (value instanceof ScadObject) return this.objectProperty(value, node.name);
				if (!Array.isArray(value)) return value?.[{ x: 0, y: 1, z: 2 }[node.name]];
				if (["x", "y", "z"].includes(node.name)) return value[{ x: 0, y: 1, z: 2 }[node.name]];
				if (!/^[xyzw]+$/.test(node.name)) return undefined;
				if (!this.options.experimental.includes("vector-swizzle")) throw new ScadError("Vector swizzling requires explicit experimental=['vector-swizzle']", node.location, "experimental-disabled");
				const indices = [...node.name].map((axis) => ({ x: 0, y: 1, z: 2, w: 3 })[axis]);
				if (indices.some((index) => index >= value.length)) return undefined;
				const selected = indices.map((index) => value[index]);
				return node.name.length === 1 ? selected[0] : selected;
			}
			case "unary": {
				const value = this.expression(node.value, scope);
				if (node.operator === "!") return !truthy(value);
				const apply = (entry) => Array.isArray(entry) ? entry.map(apply) : typeof entry === "number" ? (node.operator === "-" ? -entry : entry) : undefined;
				return apply(value);
			}
			case "conditional": return this.expression(truthy(this.expression(node.condition, scope)) ? node.consequent : node.alternate, scope);
			case "binary": {
				const left = this.expression(node.left, scope);
				if (node.operator === "&&") return truthy(left) && truthy(this.expression(node.right, scope));
				if (node.operator === "||") return truthy(left) || truthy(this.expression(node.right, scope));
				return this.binary(node.operator, left, this.expression(node.right, scope), node.location);
			}
			case "function": return this.functionCall(node, scope);
			case "invoke": return this.invokeExpression(node, scope);
			default: throw new ScadError(`Unsupported expression '${node.type}'`, node.location, "unsupported-feature");
		}
	}
	objectProperty(object, key) {
		const value = object.get(key);
		return value instanceof ScadFunction ? new ScadMethod(value, object) : value;
	}
	invokeExpression(node, scope) {
		const callable = this.expression(node.callee, scope);
		const args = this.args(node.args, scope);
		if (callable instanceof ScadMethod) return this.invokeMethod(callable, args, scope, node.location);
		if (!(callable instanceof ScadFunction)) throw new ScadError("Expression is not callable", node.location, "not-callable");
		return this.invoke(callable, args, scope, node.location, (child) => this.expression(callable.statement.expression, child));
	}
	binary(operator, left, right, location) {
		const equal = (first, second) => {
			if (Array.isArray(first) && Array.isArray(second)) return first.length === second.length && first.every((value, index) => equal(value, second[index]));
			if (first instanceof ScadObject && second instanceof ScadObject) {
				const firstEntries = first.entries(), secondEntries = second.entries();
				return firstEntries.length === secondEntries.length && firstEntries.every(([key, value], index) => key === secondEntries[index][0] && equal(value, secondEntries[index][1]));
			}
			return first === second;
		};
		if (operator === "==") return equal(left, right);
		if (operator === "!=") return !equal(left, right);
		if (["<", "<=", ">", ">="].includes(operator)) {
			if (typeof left !== typeof right || Array.isArray(left) || typeof left === "object") throw new ScadError("Mixed-type and vector ordering are not implemented", location, "unsupported-feature");
			return { "<": left < right, "<=": left <= right, ">": left > right, ">=": left >= right }[operator];
		}
		if (Array.isArray(left) && Array.isArray(right)) {
			if (operator === "*" && (left.some(Array.isArray) || right.some(Array.isArray))) {
				const matrix = (value) => value.length > 0 && value.every((row) => Array.isArray(row) && row.length === value[0].length && row.every((entry) => typeof entry === "number"));
				const numericVector = (value) => value.every((entry) => typeof entry === "number");
				const leftMatrix = matrix(left);
				const rightMatrix = matrix(right);
				if ((!leftMatrix && !numericVector(left)) || (!rightMatrix && !numericVector(right))) return undefined;
				if (leftMatrix) return left.every((row) => row.length === right.length) ? left.map((row) => this.binary("*", row, right, location)) : undefined;
				if (rightMatrix) return left.length === right.length ? right[0].map((_, column) => this.binary("*", left, right.map((row) => row[column]), location)) : undefined;
				return undefined;
			}
			if (left.length !== right.length) return undefined;
			if (operator === "*") return left.every((value, index) => typeof value === "number" && typeof right[index] === "number") ? left.reduce((sum, value, index) => sum + value * right[index], 0) : undefined;
			if (["+", "-"].includes(operator)) return left.map((value, index) => this.binary(operator, value, right[index]));
			return undefined;
		}
		if (Array.isArray(left) && ["*", "/"].includes(operator)) return left.map((value) => this.binary(operator, value, right));
		if (Array.isArray(right) && operator === "*") return right.map((value) => this.binary(operator, left, value));
		if (typeof left !== "number" || typeof right !== "number") return undefined;
		return { "+": () => left + right, "-": () => left - right, "*": () => left * right, "/": () => left / right, "%": () => left % right, "^": () => left ** right }[operator]?.();
	}
	rands(args, location) {
		if (args.length < 3 || args.length > 4) {
			this.warn("rands-arguments", `rands() number of parameters does not match: expected 3 or 4, found ${args.length}`, location);
			return undefined;
		}
		for (let index = 0; index < args.length; index++) {
			const value = args[index];
			if (typeof value !== "number") {
				const type = value === undefined ? "undefined" : typeof value === "boolean" ? "bool" : Array.isArray(value) ? "vector" : value instanceof ScadRange ? "range" : value instanceof ScadObject ? "object" : value instanceof ScadFunction || value instanceof ScadMethod ? "function" : typeof value;
				this.warn("rands-arguments", `rands() parameter could not be converted: argument ${index}: expected number, found ${type} (${formatValue(value)})`, location);
				return undefined;
			}
		}
		let [minimum, maximum, requested, seed] = args;
		if (!Number.isFinite(minimum)) {
			this.warn("rands-range", "rands() range min cannot be infinite", location);
			minimum = -Number.MAX_VALUE / 2;
			this.warn("rands-range", `resetting to ${formatRandsResetBound(minimum)}`, location);
		}
		if (!Number.isFinite(maximum)) {
			this.warn("rands-range", "rands() range max cannot be infinite", location);
			maximum = Number.MAX_VALUE / 2;
			this.warn("rands-range", `resetting to ${formatRandsResetBound(maximum)}`, location);
		}
		requested = Math.abs(requested);
		if (!Number.isFinite(requested)) {
			this.warn("rands-range", "rands() cannot create an infinite number of results", location);
			this.warn("rands-range", "resetting number of results to 1", location);
			requested = 1;
		}
		requested = Math.trunc(Math.abs(requested));
		if (requested > this.options.maxSteps - this.steps) throw new ScadError("Random result limit exceeded", location, "resource-limit");
		this.steps += requested;
		if (maximum < minimum) [minimum, maximum] = [maximum, minimum];
		if (minimum >= maximum) return Array(requested).fill(minimum);
		if (args.length === 4) randomStream = mt19937(seedHash(seed));
		return Array.from({ length: requested }, () => {
			const first = randomStream(), second = randomStream();
			const unit = (first + second * 4294967296) / 18446744073709551616;
			return minimum + (maximum - minimum) * unit;
		});
	}
	functionCall(node, scope) {
		if (node.name === "let") {
			const child = new Scope(this, scope);
			for (const arg of node.args) child.set(arg.name, this.expression(arg.expression, child));
			return this.expression(node.value, child);
		}
		const definition = scope.definition(node.name);
		if (definition?.statement.type === "definition") return this.invoke(definition, this.args(node.args, scope), scope, node.location, (child) => this.expression(definition.statement.expression, child));
		if (scope.has(node.name)) {
			const value = scope.get(node.name, node.location);
			if (value instanceof ScadFunction) return this.invoke(value, this.args(node.args, scope), scope, node.location, (child) => this.expression(value.statement.expression, child));
			if (value instanceof ScadMethod) return this.invokeMethod(value, this.args(node.args, scope), scope, node.location);
			throw new ScadError(`'${node.name}' is not a function`, node.location, "not-callable");
		}
		if (typePredicateNames.has(node.name)) {
			if (node.args.length !== 1) {
				this.warn(`${node.name.replaceAll("_", "-")}-arguments`, `${node.name}() number of parameters does not match: expected 1, found ${node.args.length}`, node.location);
				return undefined;
			}
			const argument = node.args[0].expression;
			const value = node.name === "is_undef" && argument.type === "variable" ? scope.get(argument.name, node.location, false) : this.expression(argument, scope);
			if (node.name === "is_undef") return value === undefined;
			if (node.name === "is_list") return Array.isArray(value);
			if (node.name === "is_num") return typeof value === "number" && !Number.isNaN(value);
			if (node.name === "is_bool") return typeof value === "boolean";
			if (node.name === "is_string") return typeof value === "string";
			if (node.name === "is_function") return value instanceof ScadFunction || value instanceof ScadMethod;
			return value instanceof ScadObject;
		}
		const args = this.args(node.args, scope);
		if (node.name === "import") {
			if (!this.options.experimental.includes("import-function")) throw new ScadError("import() data requires explicit experimental=['import-function']", node.location, "experimental-disabled");
			const values = this.bind(args, ["file", "type"], node.location);
			if (typeof values.file !== "string") throw new ScadError("import() file must be a string", node.location, "invalid-arguments");
			const directory = node.location.file.split("/").slice(0, -1).join("/");
			const path = normalizePath(values.file, directory);
			const extension = path.split(".").at(-1)?.toLowerCase();
			const type = values.type ?? (extension === "json" ? "json" : "");
			if (type !== "json") { this.warn("unsupported-import-type", `Unsupported data import type '${type || extension || ""}'`, node.location); return undefined; }
			if (!this.options.importedData?.has(path)) {
				const error = new ScadError(`JSON data import '${path}' must be resolved by the compiler service`, node.location, "unresolved-data-import");
				error.importRequest = { path, location: node.location };
				throw error;
			}
			const imported = this.options.importedData.get(path);
			if (imported.warning) this.warn("invalid-json-import", imported.warning, node.location);
			return normalizeValue(imported.value);
		}
		if (node.name === "dxf_dim" || node.name === "dxf_cross") {
			const values = this.bind(args, [], node.location);
			const allowed = new Set(["file", "layer", "origin", "scale", "name"]);
			for (const key of Object.keys(values)) if (!allowed.has(key)) throw new ScadError(`Unknown ${node.name} parameter '${key}'`, node.location, "invalid-arguments");
			if (typeof values.file !== "string" || !values.file) { this.warn("invalid-dxf-arguments", `${node.name} requires a file path`, node.location); return undefined; }
			const directory = node.location.file.split("/").slice(0, -1).join("/");
			const path = normalizePath(values.file, directory);
			if (!this.options.dxfData?.has(path)) {
				const error = new ScadError(`DXF file '${path}' must be resolved by the compiler service`, node.location, "unresolved-dxf-file");
				error.dxfRequest = { path, location: node.location };
				throw error;
			}
			const file = this.options.dxfData.get(path);
			if (file.warning) { this.warn("missing-dxf", file.warning, node.location); return undefined; }
			const layer = values.layer ?? "", name = values.name ?? "", scale = values.scale ?? 1;
			if (typeof layer !== "string" || typeof name !== "string" || typeof scale !== "number" || !Number.isFinite(scale)) {
				this.warn("invalid-dxf-arguments", `${node.name} has invalid layer, name, or scale`, node.location);
				return undefined;
			}
			let origin = [0, 0];
			if (values.origin !== undefined) {
				if (!Array.isArray(values.origin) || values.origin.length !== 2 || !values.origin.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate))) {
					this.warn("invalid-dxf-origin", `${node.name} origin must be a finite two-component vector`, node.location);
				} else origin = values.origin;
			}
			try {
				const result = node.name === "dxf_dim" ? dimensionValue(file.text, { layer, name, origin, scale }) : crossValue(file.text, { layer, origin, scale });
				if (result.warning) this.warn("dxf-lookup", result.warning, node.location);
				return result.value;
			} catch (error) {
				if (error instanceof ScadError) { error.location ??= node.location; throw error; }
				throw new ScadError(error.message, node.location, "invalid-dxf");
			}
		}
		if (node.name === "object" || node.name === "has_key") {
			if (!this.options.experimental.includes("object-function")) throw new ScadError(`${node.name} requires explicit experimental=['object-function']`, node.location, "experimental-disabled");
			if (node.name === "has_key") {
				const object = args[0]?.value, key = args[1]?.value;
				if (!(object instanceof ScadObject) || typeof key !== "string") return undefined;
				return object.has(key);
			}
			const result = new ScadObject();
			const invalid = (message) => { this.warn("invalid-object", message, node.location); return undefined; };
			for (const arg of args) {
				if (arg.name !== null) { result.set(arg.name, arg.value); continue; }
				if (arg.value instanceof ScadObject) {
					for (const [key, value] of arg.value.entries()) result.set(key, value);
					continue;
				}
				if (!Array.isArray(arg.value)) return invalid("Unnamed object() arguments must be objects or key/value lists");
				for (const entry of arg.value) {
					if (!Array.isArray(entry) || (entry.length !== 1 && entry.length !== 2) || typeof entry[0] !== "string") return invalid("Object entries must be [string] or [string, value]");
					if (entry.length === 1) result.delete(entry[0]);
					else result.set(entry[0], entry[1]);
				}
			}
			return result;
		}
		if (node.name === "textmetrics" || node.name === "fontmetrics") {
			const names = node.name === "textmetrics" ? ["text", "size", "font", "direction", "language", "script", "halign", "valign", "spacing", "em"] : ["size", "font", "em"];
			const values = Object.create(null); let position = 0;
			for (const arg of args) {
				const name = arg.name ?? names[position++];
				if (!name || !names.includes(name)) { this.warn("invalid-metric-argument", `Unknown ${node.name} argument '${name ?? ""}'`, node.location); return undefined; }
				values[name] = arg.value;
			}
			const measure = node.name === "textmetrics" ? this.options.measureTextMetrics : this.options.measureFontMetrics;
			if (!measure) throw new ScadError(`${node.name} requires font preparation through the service`, node.location, "unresolved-font");
			let result;
			try { result = measure(values); }
			catch (error) { error.location ??= node.location; throw error; }
			if (result === undefined) this.warn("invalid-text-metrics", `${node.name} could not resolve supported text/font metrics`, node.location);
			return normalizeValue(result);
		}
		const radians = (value) => value * Math.PI / 180;
		const degrees = (value) => value * 180 / Math.PI;
		const trigHuge = 2 ** 52 * 360;
		const reduceDegrees = (value, period) => {
			if (value < period && value >= 0) return { value, cycles: 0 };
			if (!(value < trigHuge && value > -trigHuge)) return { value: NaN, cycles: 0 };
			const cycles = Math.floor(value / period);
			return { value: value - period * cycles, cycles };
		};
		const sinDegrees = (value) => {
			let x = reduceDegrees(value, 360).value;
			const oppose = x >= 180;
			if (oppose) x -= 180;
			if (x > 90) x = 180 - x;
			if (x < 45) x = x === 30 ? 0.5 : Math.sin(radians(x));
			else if (x === 45) x = Math.SQRT1_2;
			else if (x === 60) x = Math.sqrt(3) / 2;
			else x = Math.cos(radians(90 - x));
			return oppose ? -x : x;
		};
		const cosDegrees = (value) => {
			let x = reduceDegrees(value, 360).value;
			let oppose = x >= 180;
			if (oppose) x -= 180;
			if (x > 90) { x = 180 - x; oppose = !oppose; }
			if (x > 45) x = x === 60 ? 0.5 : Math.sin(radians(90 - x));
			else if (x === 45) x = Math.SQRT1_2;
			else if (x === 30) x = Math.sqrt(3) / 2;
			else x = Math.cos(radians(x));
			return oppose ? -x : x;
		};
		const tanDegrees = (value) => {
			const reduced = reduceDegrees(value, 180);
			const cycles = reduced.cycles;
			let x = reduced.value;
			const oppose = x > 90;
			if (oppose) x = 180 - x;
			if (x === 0) x = cycles % 2 === 0 ? 0 : -0;
			else if (x === 30) x = 1 / Math.sqrt(3);
			else if (x === 45) x = 1;
			else if (x === 60) x = Math.sqrt(3);
			else if (x === 90) x = cycles % 2 === 0 ? Infinity : -Infinity;
			else x = Math.tan(radians(x));
			return oppose ? -x : x;
		};
		const roundAway = (value) => value < 0 ? -Math.floor(-value + 0.5) : Math.floor(value + 0.5);
		const asinDegrees = (value) => {
			const result = degrees(Math.asin(value)), whole = roundAway(result);
			return sinDegrees(whole) === value ? whole : result;
		};
		const acosDegrees = (value) => {
			const result = degrees(Math.acos(value)), whole = roundAway(result);
			return cosDegrees(whole) === value ? whole : result;
		};
		const atanDegrees = (value) => {
			const result = degrees(Math.atan(value)), whole = roundAway(result);
			return tanDegrees(whole) === value ? whole : result;
		};
		const atan2Degrees = (first, second) => {
			const result = degrees(Math.atan2(first, second)), whole = roundAway(result);
			return Math.abs(result - whole) < 3e-14 ? whole : result;
		};
		const character = (value) => {
			if (value instanceof ScadRange) return this.iterable(value, node.location).map(character).join("");
			if (Array.isArray(value)) return value.map(character).join("");
			if (typeof value !== "number" || value <= 0) return "";
			const code = Math.trunc(value) >>> 0;
			return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "";
		};
		const ordinal = (values) => {
			if (values.length !== 1) {
				this.warn("ord-arguments", `ord() number of parameters does not match: expected 1, found ${values.length}`, node.location);
				return undefined;
			}
			const value = values[0];
			if (typeof value !== "string") {
				const type = value === undefined ? "undefined" : typeof value === "boolean" ? "bool" : Array.isArray(value) ? "vector" : value instanceof ScadObject ? "object" : value instanceof ScadFunction || value instanceof ScadMethod ? "function" : typeof value;
				this.warn("ord-arguments", `ord() parameter could not be converted: argument 0: expected string, found ${type} (${formatValue(value)})`, node.location);
				return undefined;
			}
			if (!value.length) return undefined;
			const first = value.charCodeAt(0);
			if (first >= 0xd800 && first <= 0xdbff && !(value.charCodeAt(1) >= 0xdc00 && value.charCodeAt(1) <= 0xdfff) || first >= 0xdc00 && first <= 0xdfff) {
				this.warn("ord-invalid-utf8", `ord() argument '${value}' is not a valid utf8 string`, node.location);
				return undefined;
			}
			return value.codePointAt(0);
		};
		const search = (...callArguments) => {
			if (callArguments.length < 2 || callArguments.length > 4) {
				this.warn("search-arguments", `search() number of parameters does not match: expected between 2 and 4, found ${callArguments.length}`, node.location);
				return undefined;
			}
			const [find, table, requested = 1, column = 0] = callArguments;
			if (!(typeof find === "number" || typeof find === "string" || Array.isArray(find))) return undefined;
			const toUnsigned = (value) => typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) >>> 0 : 0;
			const count = toUnsigned(requested);
			const index = toUnsigned(column);
			const strings = typeof find === "string", many = Array.isArray(find);
			const needles = strings ? Array.from(find) : many ? find : [find];
			const rows = typeof table === "string" ? (strings ? Array.from(table) : []) : Array.isArray(table) ? table : [];
			const equal = (first, second) => Array.isArray(first) && Array.isArray(second) ? first.length === second.length && first.every((value, at) => equal(value, second[at])) : first === second;
			const output = [];
			for (const needle of needles) {
				const matches = [];
				for (let at = 0; at < rows.length; at++) {
					const row = rows[at];
					if (strings && Array.isArray(table) && (!Array.isArray(row) || row.length <= index)) {
						this.warn("search-invalid-entry", `Invalid entry in search vector at index ${at}, required number of values in the entry: ${(index + 1) >>> 0}. Invalid entry: ${formatValue(row)}`, node.location);
						return [];
					}
					const candidate = typeof table === "string" ? row : strings ? row[index] : index === 0 && equal(needle, row) ? row : Array.isArray(row) && index < row.length ? row[index] : undefined;
					if ((strings && typeof candidate === "string" && equal(needle, candidate)) || (!strings && ((index === 0 && equal(needle, row)) || (Array.isArray(row) && index < row.length && equal(needle, row[index]))))) {
						matches.push(at);
						if (count > 0 && matches.length >= count) break;
					}
				}
				if (typeof find === "number") return matches;
				if (count === 1) {
					if (many && !matches.length) output.push([]);
					else output.push(...matches);
				} else output.push(matches);
			}
			return output;
		};
		const minMax = (name, args) => {
			let values;
			let vectorInput = false;
			if (args.length === 0) {
				this.warn("min-max-arguments", `${name}() number of parameters does not match: expected at least 1, found 0`, node.location);
				return undefined;
			}
			if (args.length === 1 && Array.isArray(args[0])) {
				vectorInput = true;
				values = args[0];
				if (!values.length) {
					this.warn("min-max-arguments", `${name}() number of parameters does not match: expected at least 1 vector element, found 0`, node.location);
					return undefined;
				}
			} else values = args;
			for (let index = 0; index < values.length; index++) {
				const value = values[index];
				if (typeof value !== "number") {
					const type = value === undefined ? "undefined" : typeof value === "boolean" ? "bool" : Array.isArray(value) ? "vector" : value instanceof ScadObject ? "object" : value instanceof ScadFunction || value instanceof ScadMethod ? "function" : typeof value;
					const position = vectorInput ? `vector element ${index}` : `argument ${index}`;
					this.warn("min-max-arguments", `${name}() parameter could not be converted: ${position}: expected number, found ${type} (${formatValue(value)})`, node.location);
					return undefined;
				}
			}
			let result = values[0];
			for (const value of values.slice(1)) {
				if (name === "min" ? value < result : value > result) result = value;
			}
			return result;
		};
		const unaryNumber = (name, args, operation) => {
			if (args.length !== 1) {
				this.warn("numeric-arguments", `${name}() number of parameters does not match: expected 1, found ${args.length}`, node.location);
				return undefined;
			}
			const value = args[0];
			if (typeof value !== "number") {
				const type = value === undefined ? "undefined" : typeof value === "boolean" ? "bool" : Array.isArray(value) ? "vector" : value instanceof ScadObject ? "object" : value instanceof ScadFunction || value instanceof ScadMethod ? "function" : typeof value;
				this.warn("numeric-arguments", `${name}() parameter could not be converted: argument 0: expected number, found ${type} (${formatValue(value)})`, node.location);
				return undefined;
			}
			return operation(value);
		};
		const logarithm = (args) => {
			if (args.length !== 1 && args.length !== 2) {
				this.warn("numeric-arguments", `log() number of parameters does not match: expected 2, found ${args.length}`, node.location);
				return undefined;
			}
			const values = args.length === 1 ? [10, args[0]] : args;
			for (let index = 0; index < values.length; index++) {
				const value = values[index];
				if (typeof value !== "number") {
					const type = value === undefined ? "undefined" : typeof value === "boolean" ? "bool" : Array.isArray(value) ? "vector" : value instanceof ScadObject ? "object" : value instanceof ScadFunction || value instanceof ScadMethod ? "function" : typeof value;
					const argument = args.length === 1 ? 0 : index;
					this.warn("numeric-arguments", `log() parameter could not be converted: argument ${argument}: expected number, found ${type} (${formatValue(value)})`, node.location);
					return undefined;
				}
			}
			return Math.log(values[1]) / Math.log(values[0]);
		};
		const binaryNumber = (name, args, operation) => {
			if (args.length !== 2) {
				this.warn("numeric-arguments", `${name}() number of parameters does not match: expected 2, found ${args.length}`, node.location);
				return undefined;
			}
			for (let index = 0; index < args.length; index++) {
				const value = args[index];
				if (typeof value !== "number") {
					const type = value === undefined ? "undefined" : typeof value === "boolean" ? "bool" : Array.isArray(value) ? "vector" : value instanceof ScadObject ? "object" : value instanceof ScadFunction || value instanceof ScadMethod ? "function" : typeof value;
					this.warn("numeric-arguments", `${name}() parameter could not be converted: argument ${index}: expected number, found ${type} (${formatValue(value)})`, node.location);
					return undefined;
				}
			}
			return operation(args[0], args[1]);
		};
		const length = (args) => {
			if (args.length !== 1) {
				this.warn("len-arguments", `len() number of parameters does not match: expected 1, found ${args.length}`, node.location);
				return undefined;
			}
			const value = args[0];
			if (typeof value === "string") return Array.from(value).length;
			if (Array.isArray(value)) return value.length;
			if (value instanceof ScadObject) return value.entries().length;
			const type = value === undefined ? "undefined" : typeof value === "boolean" ? "bool" : value instanceof ScadRange ? "range" : value instanceof ScadFunction || value instanceof ScadMethod ? "function" : typeof value;
			this.warn("len-arguments", `len() parameter could not be converted: argument 0: expected string, found ${type} (${formatValue(value)})`, node.location);
			return undefined;
		};
		const lookup = (args) => {
			if (args.length !== 2) {
				this.warn("lookup-arguments", `lookup() number of parameters does not match: expected 2, found ${args.length}`, node.location);
				return undefined;
			}
			const [value, table] = args;
			if (typeof value !== "number") {
				const type = value === undefined ? "undefined" : typeof value === "boolean" ? "bool" : Array.isArray(value) ? "vector" : value instanceof ScadObject ? "object" : value instanceof ScadFunction || value instanceof ScadMethod ? "function" : typeof value;
				this.warn("lookup-arguments", `lookup() parameter could not be converted: argument 0: expected number, found ${type} (${formatValue(value)})`, node.location);
				return undefined;
			}
			if (!Number.isFinite(value)) {
				this.warn("lookup-value", `lookup(${formatValue(value)}, ...) first argument is not a number`, node.location);
				return undefined;
			}
			if (!Array.isArray(table)) {
				const type = table === undefined ? "undefined" : typeof table === "boolean" ? "bool" : table instanceof ScadObject ? "object" : typeof table;
				this.warn("lookup-arguments", `lookup() parameter could not be converted: argument 1: expected vector, found ${type} (${formatValue(table)})`, node.location);
				return undefined;
			}
			const pair = (row) => Array.isArray(row) && row.length === 2 && row.every((item) => typeof item === "number") ? row : undefined;
			const first = pair(table[0]);
			if (!first) return undefined;
			let [lowX, lowY] = first, [highX, highY] = first;
			for (const row of table.slice(1)) {
				const point = pair(row);
				if (!point) continue;
				const [key, result] = point;
				if (key <= value && (key > lowX || lowX > value)) [lowX, lowY] = [key, result];
				if (key >= value && (key < highX || highX < value)) [highX, highY] = [key, result];
			}
			if (value <= lowX) return highY;
			if (value >= highX) return lowY;
			const factor = (value - lowX) / (highX - lowX);
			return highY * factor + lowY * (1 - factor);
		};
		const functions = {
			abs: (...values) => unaryNumber("abs", values, Math.abs),
			sign: (...values) => unaryNumber("sign", values, (value) => value < 0 ? -1 : value > 0 ? 1 : 0),
			floor: (...values) => unaryNumber("floor", values, Math.floor),
			ceil: (...values) => unaryNumber("ceil", values, Math.ceil),
			round: (...values) => unaryNumber("round", values, (value) => Math.sign(value) * Math.floor(Math.abs(value) + 0.5)),
			sqrt: (...values) => unaryNumber("sqrt", values, Math.sqrt),
			exp: (...values) => unaryNumber("exp", values, Math.exp),
			ln: (...values) => unaryNumber("ln", values, Math.log),
			log: (...values) => logarithm(values),
			pow: (...values) => binaryNumber("pow", values, (base, exponent) => base === 1 || (base === -1 && (exponent === Infinity || exponent === -Infinity)) ? 1 : Math.pow(base, exponent)),
			sin: (...values) => unaryNumber("sin", values, sinDegrees),
			cos: (...values) => unaryNumber("cos", values, cosDegrees),
			tan: (...values) => unaryNumber("tan", values, tanDegrees),
			asin: (...values) => unaryNumber("asin", values, asinDegrees),
			acos: (...values) => unaryNumber("acos", values, acosDegrees),
			atan: (...values) => unaryNumber("atan", values, atanDegrees),
			atan2: (...values) => binaryNumber("atan2", values, atan2Degrees),
			min: (...values) => minMax("min", values), max: (...values) => minMax("max", values),
			len: (...values) => length(values),
			norm: (...values) => {
				const vector = values[0];
				if (values.length !== 1 || !Array.isArray(vector) || vector.some((component) => typeof component !== "number")) {
					this.warn("norm-arguments", "norm() requires one numeric vector", node.location);
					return undefined;
				}
				return Math.sqrt(vector.reduce((sum, component) => sum + component ** 2, 0));
			},
			cross: (...vectors) => {
				const invalid = (message) => { this.warn("cross-arguments", message, node.location); return undefined; };
				if (vectors.length !== 2) return invalid(`cross() number of parameters does not match: expected 2, found ${vectors.length}`);
				for (let index = 0; index < vectors.length; index++) {
					if (!Array.isArray(vectors[index])) {
						const value = vectors[index];
						const type = value === undefined ? "undefined" : typeof value === "boolean" ? "bool" : value instanceof ScadObject ? "object" : value instanceof ScadFunction || value instanceof ScadMethod ? "function" : typeof value;
						return invalid(`cross() parameter could not be converted: argument ${index}: expected vector, found ${type} (${formatValue(value)})`);
					}
				}
				const [first, second] = vectors;
				if (first.length === 2 && second.length === 2) {
					const [firstX, firstY] = first.map((value) => typeof value === "number" ? value : 0);
					const [secondX, secondY] = second.map((value) => typeof value === "number" ? value : 0);
					return firstX * secondY - firstY * secondX;
				}
				if (first.length !== 3 || second.length !== 3) return invalid("Invalid vector size of parameter for cross()");
				for (let index = 0; index < 3; index++) {
					if (typeof first[index] !== "number" || typeof second[index] !== "number") return invalid("Invalid value in parameter vector for cross()");
					if (Number.isNaN(first[index]) || Number.isNaN(second[index])) return invalid("Invalid value (NaN) in parameter vector for cross()");
					if (!Number.isFinite(first[index]) || !Number.isFinite(second[index])) return invalid("Invalid value (INF) in parameter vector for cross()");
				}
				return [first[1] * second[2] - first[2] * second[1], first[2] * second[0] - first[0] * second[2], first[0] * second[1] - first[1] * second[0]];
			},
			lookup: (...values) => lookup(values),
			parent_module: (...args) => {
				if (args.length > 1) {
					this.warn("parent-module-arguments", `parent_module() number of parameters does not match: expected 1, found ${args.length}`, node.location);
					return undefined;
				}
				let index = args.length === 0 ? 1 : args[0];
				if (typeof index !== "number") {
					const type = index === undefined ? "undefined" : typeof index === "boolean" ? "bool" : Array.isArray(index) ? "vector" : index instanceof ScadObject ? "object" : index instanceof ScadFunction || index instanceof ScadMethod ? "function" : typeof index;
					this.warn("parent-module-arguments", `parent_module() parameter could not be converted: argument 0: expected number, found ${type} (${formatValue(index)})`, node.location);
					return undefined;
				}
				const depth = Number.isFinite(index) && index <= 2147483647 && index >= -2147483648 ? Math.trunc(index) : -2147483648;
				if (depth < 0 || depth >= this.moduleStack.length) {
					if (depth < 0) this.warn("parent-module-range", `Negative parent module index (${depth}) not allowed`, node.location);
					else this.warn("parent-module-range", `Parent module index (${depth}) greater than the number of modules on the stack`, node.location);
					return undefined;
				}
				return this.moduleStack[this.moduleStack.length - 1 - depth];
			},
			rands: (...values) => this.rands(values, node.location),
			search,
			chr: (...values) => values.map(character).join(""),
			ord: (...values) => ordinal(values),
			concat: (...values) => values.flat(), str: (...values) => values.map(formatScadString).join(""),
			version: () => [2026, 10, 2], version_num: (...values) => {
				if (values.length === 0) return 2026 * 10000 + 10 * 100 + 2;
				const value = values[0];
				if (!Array.isArray(value) || (value.length !== 2 && value.length !== 3) || value.some((component) => typeof component !== "number")) return undefined;
				const [year, month, day = 0] = value;
				return year * 10000 + month * 100 + day;
			},
		};
		if (!Object.hasOwn(functions, node.name)) throw new ScadError(`Unsupported function '${node.name}'`, node.location, "unsupported-feature");
		return functions[node.name](...args.map((arg) => arg.value));
	}
}

export function evaluate(source, options) { return new Evaluator(options).run(source); }