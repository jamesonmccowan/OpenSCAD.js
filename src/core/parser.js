export class ScadError extends Error {
	constructor(message, location, code = "syntax-error") {
		super(message);
		this.name = "ScadError";
		this.code = code;
		this.location = location;
	}
}

// Statements upstream's grammar accepts as an unbraced child or after a
// modifier. include/use are expanded by upstream's lexer, so they pass too.
const INSTANTIATIONS = new Set(["call", "if", "for", "intersection_for", "include", "use"]);

function describeStatement(node) {
	switch (node.type) {
		case "assignment": return `Assignment to '${node.name}'`;
		case "module": return `Module definition '${node.name}'`;
		case "definition": return `Function definition '${node.name}'`;
		case "block": return "A { } block";
		case "empty": return "An empty statement";
		default: return `A ${node.type} statement`;
	}
}

function tokenize(source, file) {
	const tokens = [];
	let offset = 0;
	let line = 1;
	let column = 1;
	const advance = (text) => {
		for (const character of text) {
			if (character === "\n") { line++; column = 1; }
			else column++;
		}
		offset += text.length;
	};
	while (offset < source.length) {
		const rest = source.slice(offset);
		const location = { file, offset, line, column };
		const whitespace = /^\s+|^\/\/[^\n]*/.exec(rest);
		if (whitespace) { advance(whitespace[0]); continue; }
		if (rest.startsWith("/*")) {
			const end = rest.indexOf("*/", 2);
			if (end < 0) throw new ScadError("Unterminated block comment", location);
			advance(rest.slice(0, end + 2));
			continue;
		}
		if (rest[0] === "<" && ["include", "use"].includes(tokens.at(-1)?.value)) {
			const end = rest.indexOf(">");
			if (end < 0 || rest.slice(0, end).includes("\n")) throw new ScadError("Unterminated file directive", location);
			tokens.push({ type: "path", value: rest.slice(1, end), location });
			advance(rest.slice(0, end + 1));
			continue;
		}
		if (rest[0] === '"') {
			let length = 1;
			let value = "";
			while (length < rest.length && rest[length] !== '"') {
				if (rest[length] === "\\") {
					length++;
					const escape = rest[length++];
					if (["x", "u", "U"].includes(escape)) {
						const digits = { x: 2, u: 4, U: 6 }[escape];
						const hex = rest.slice(length, length + digits);
						if (!new RegExp(`^[0-9a-fA-F]{${digits}}$`).test(hex) || parseInt(hex, 16) > 0x10ffff) throw new ScadError("Invalid string escape", location);
						value += String.fromCodePoint(parseInt(hex, 16));
						length += digits;
					} else value += { n: "\n", r: "\r", t: "\t" }[escape] ?? escape ?? "";
				} else value += rest[length++];
			}
			if (rest[length] !== '"') throw new ScadError("Unterminated string", location);
			advance(rest.slice(0, length + 1));
			tokens.push({ type: "literal", value, location });
			continue;
		}
		let numeric = /^(?:0[xX][0-9a-fA-F]+|\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest);
		const legacy = /^\d+[A-Za-z_$][A-Za-z0-9_$]*/.exec(rest);
		const identifier = legacy && legacy[0].length > (numeric?.[0].length ?? 0) ? legacy : /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(rest);
		if (identifier) numeric = null;
		const symbol = /^(?:==|!=|<=|>=|&&|\|\||[(){}\[\];,=:+\-*/%^<>!?#.])/.exec(rest);
		const match = numeric ?? identifier ?? symbol;
		if (!match) throw new ScadError(`Unexpected character '${rest[0]}'`, location);
		advance(match[0]);
		tokens.push({ type: numeric ? "literal" : identifier ? "identifier" : "symbol", value: numeric ? Number(match[0]) : match[0], location });
		if (tokens.length > 100_000) throw new ScadError("Token limit exceeded", location, "resource-limit");
	}
	tokens.push({ type: "eof", value: "eof", location: { file, offset, line, column } });
	return tokens;
}

class Parser {
	constructor(tokens) { this.tokens = tokens; this.index = 0; this.depth = 0; }
	bounded(callback) {
		if (++this.depth > 256) { this.depth--; throw new ScadError("Parser nesting limit exceeded", this.current().location, "resource-limit"); }
		try { return callback(); } finally { this.depth--; }
	}
	current() { return this.tokens[this.index]; }
	check(value) { return this.current().value === value; }
	take() { return this.tokens[this.index++]; }
	match(value) { if (!this.check(value)) return false; this.take(); return true; }
	expect(value) {
		if (!this.check(value)) throw new ScadError(`Expected '${value}', found '${this.current().value}'`, this.current().location);
		return this.take();
	}
	identifier() {
		if (this.current().type !== "identifier") throw new ScadError("Expected identifier", this.current().location);
		return this.take();
	}
	statements(end = "eof") {
		const statements = [];
		while (this.current().type !== "eof" && (end === "eof" || !this.check(end))) statements.push(this.statement());
		return statements;
	}
	body() {
		if (!this.match("{")) return [this.statement()];
		const statements = this.statements("}");
		this.expect("}");
		return statements;
	}
	// Children of calls, if/else and for: like upstream, an unbraced child must
	// be ';' or another instantiation, never an assignment or definition.
	childBody(owner) {
		if (this.check("{")) return this.body();
		const statement = this.statement();
		if (statement.type !== "empty" && !INSTANTIATIONS.has(statement.type)) {
			const what = describeStatement(statement);
			throw new ScadError(`${what} cannot be the unbraced child of ${owner}; wrap it in { } or end ${owner} with ';'`, statement.location);
		}
		return [statement];
	}
	parameters() {
		this.expect("(");
		const params = [];
		if (!this.check(")")) do {
			const name = this.identifier().value;
			params.push({ name, defaultValue: this.match("=") ? this.expression() : null });
		} while (this.match(","));
		this.expect(")");
		return params;
	}
	arguments() {
		this.expect("(");
		const args = [];
		if (!this.check(")")) do {
			let name = null;
			if (this.current().type === "identifier" && this.tokens[this.index + 1].value === "=") {
				name = this.take().value;
				this.take();
			}
			args.push({ name, expression: this.expression() });
		} while (this.match(","));
		this.expect(")");
		return args;
	}
	statement() {
		return this.bounded(() => this.parseStatement());
	}
	parseStatement() {
		const location = this.current().location;
		const modifiers = [];
		while (["#", "%", "!", "*"].includes(this.current().value)) modifiers.push(this.take().value);
		let node;
		if (this.match(";")) node = { type: "empty" };
		else if (["include", "use"].includes(this.current().value)) {
			const type = this.take().value;
			if (this.current().type !== "path") throw new ScadError("Expected <file> after file directive", this.current().location);
			node = { type, path: this.take().value };
			this.match(";");
		}
		else if (this.check("{")) node = { type: "block", children: this.body() };
		else if (this.match("module")) {
			const name = this.identifier().value;
			node = { type: "module", name, params: this.parameters(), children: this.body() };
		} else if (this.match("function")) {
			const name = this.identifier().value;
			const params = this.parameters();
			this.expect("=");
			node = { type: "definition", name, params, expression: this.expression() };
			this.expect(";");
		} else if (this.match("if")) {
			this.expect("(");
			const condition = this.expression();
			this.expect(")");
			const children = this.childBody("if()");
			node = { type: "if", condition, children, alternate: this.match("else") ? this.childBody("else") : [] };
		} else if (this.match("for") || this.match("intersection_for")) {
			const type = this.tokens[this.index - 1].value === "for" ? "for" : "intersection_for";
			const bindings = this.arguments();
			if (bindings.some((binding) => !binding.name)) throw new ScadError(`${type}() requires named bindings`, location);
			node = { type, bindings, children: this.childBody(`${type}()`) };
		} else if (this.current().type === "identifier" && this.tokens[this.index + 1].value === "=") {
			const name = this.take().value;
			this.take();
			node = { type: "assignment", name, expression: this.expression() };
			this.expect(";");
		} else {
			const name = this.identifier().value;
			const args = this.arguments();
			node = { type: "call", name, args, children: this.match(";") ? [] : this.childBody(`${name}()`) };
		}
		if (modifiers.length && !INSTANTIATIONS.has(node.type)) {
			throw new ScadError(`Modifier '${modifiers[0]}' can only be applied to a module instantiation, not ${describeStatement(node).replace(/^[A-Z]/, (c) => c.toLowerCase())}`, location);
		}
		return { ...node, modifiers, location };
	}
	expression(minimum = 0) {
		return this.bounded(() => this.parseExpression(minimum));
	}
	parseExpression(minimum) {
		let left;
		const location = this.current().location;
		if (["-", "+", "!"].includes(this.current().value)) left = { type: "unary", operator: this.take().value, value: this.expression(8), location };
		else left = this.primary();
		while (true) {
			if (this.match("[")) {
				left = { type: "index", value: left, index: this.expression(), location };
				this.expect("]");
				continue;
			}
			if (this.match(".")) { left = { type: "member", value: left, name: this.identifier().value, location }; continue; }
			if (this.check("(")) { left = { type: "invoke", callee: left, args: this.arguments(), location }; continue; }
			const precedence = { "||": 1, "&&": 2, "==": 3, "!=": 3, "<": 4, "<=": 4, ">": 4, ">=": 4, "+": 5, "-": 5, "*": 6, "/": 6, "%": 6, "^": 7 };
			const operator = this.current().value;
			if ((precedence[operator] ?? -1) < minimum) break;
			this.take();
			left = { type: "binary", operator, left, right: this.expression(precedence[operator] + (operator === "^" ? 0 : 1)), location };
		}
		if (minimum === 0 && this.match("?")) {
			const consequent = this.expression();
			this.expect(":");
			left = { type: "conditional", condition: left, consequent, alternate: this.expression(), location };
		}
		return left;
	}
	primary() {
		const token = this.take();
		const location = token.location;
		if (token.type === "literal") return { type: "literal", value: token.value, location };
		if (token.value === "(") { const value = this.expression(); this.expect(")"); return value; }
		if (token.value === "[") {
			if (this.match("]")) return { type: "vector", values: [], location };
			const values = [this.listElement()];
			if (this.match(":")) {
				values.push(this.expression());
				if (this.match(":")) values.push(this.expression());
				this.expect("]");
				return { type: "range", values, location };
			}
			while (this.match(",") && !this.check("]")) values.push(this.listElement());
			this.expect("]");
			return { type: "vector", values, location };
		}
		if (token.type === "identifier") {
			if (token.value === "function") return { type: "lambda", params: this.parameters(), expression: this.expression(), location };
			if (token.value === "true" || token.value === "false" || token.value === "undef") return { type: "literal", value: token.value === "undef" ? undefined : token.value === "true", location };
			if (this.check("(")) {
				const args = this.arguments();
				return { type: "function", name: token.value, args, value: token.value === "let" ? this.expression() : null, location };
			}
			return { type: "variable", name: token.value, location };
		}
		throw new ScadError(`Expected expression, found '${token.value}'`, location);
	}
	listElement() {
		return this.bounded(() => {
			const location = this.current().location;
			if (this.match("for")) {
				const bindings = this.arguments();
				if (bindings.some((binding) => !binding.name)) throw new ScadError("Comprehension requires named bindings", location);
				return { type: "comprehension-for", bindings, value: this.listElement(), location };
			}
			if (this.match("if")) {
				this.expect("("); const condition = this.expression(); this.expect(")");
				const value = this.listElement();
				return { type: "comprehension-if", condition, value, alternate: this.match("else") ? this.listElement() : null, location };
			}
			if (this.match("each")) return { type: "comprehension-each", value: this.expression(), location };
			if (this.check("let")) {
				this.take(); return { type: "comprehension-let", bindings: this.arguments(), value: this.listElement(), location };
			}
			return this.expression();
		});
}
}

export function parse(source, { file = "main.scad" } = {}) {
	if (typeof source !== "string") throw new TypeError("SCAD source must be a string");
	if (source.length > 1_000_000) throw new ScadError("Source size limit exceeded", { file, line: 1, column: 1 }, "resource-limit");
	const parser = new Parser(tokenize(source, file));
	const statements = parser.statements();
	const legacy = new Map();
	for (const token of parser.tokens) if (token.type === "identifier" && /^\d/.test(token.value) && !legacy.has(token.value)) legacy.set(token.value, token.location);
	return [...legacy].map(([name, location]) => ({ type: "deprecation", name, location, modifiers: [] })).concat(statements);
}