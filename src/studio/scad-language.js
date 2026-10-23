import { StreamLanguage } from "@codemirror/language";

const keywords = new Set("module function if else for intersection_for let each include use".split(" "));
const builtins = new Set(("cube sphere cylinder polyhedron square circle polygon text import surface projection linear_extrude rotate_extrude " +
	"translate rotate scale resize mirror multmatrix color offset hull minkowski union difference intersection render children echo assert assign " +
	"abs sign sin cos tan asin acos atan atan2 ceil floor round sqrt pow exp ln log min max norm cross len concat lookup str chr ord search " +
	"version version_num rands is_undef is_bool is_num is_string is_list is_function parent_module roof audit_part").split(" "));

function quoted(stream, state) {
	let escaped = false;
	while (!stream.eol()) {
		const character = stream.next();
		if (character === '"' && !escaped) { state.string = false; break; }
		if (character === "\\" && !escaped) escaped = true;
		else escaped = false;
	}
	return "string";
}

export const scadLanguage = StreamLanguage.define({
	name: "OpenSCAD",
	startState: () => ({ blockComment: false, string: false, directive: false, depth: 0 }),
	token(stream, state) {
		if (state.blockComment) {
			if (stream.skipTo("*/")) { stream.match("*/"); state.blockComment = false; }
			else stream.skipToEnd();
			return "comment";
		}
		if (state.string) return quoted(stream, state);
		if (stream.eatSpace()) return null;
		if (stream.match("//")) { stream.skipToEnd(); return "comment"; }
		if (stream.match("/*")) {
			state.blockComment = true;
			if (stream.skipTo("*/")) { stream.match("*/"); state.blockComment = false; }
			else stream.skipToEnd();
			return "comment";
		}
		if (stream.eat('"')) { state.string = true; state.directive = false; return quoted(stream, state); }
		if (state.directive && stream.eat("<")) {
			stream.eatWhile((character) => character !== ">");
			stream.eat(">"); state.directive = false; return "string";
		}
		state.directive = false;
		if (stream.match(/(?:0[xX][0-9a-fA-F]+|\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/)) return "number";
		if (stream.match(/[A-Za-z_$][A-Za-z0-9_$]*/)) {
			const word = stream.current();
			if (word === "include" || word === "use") state.directive = true;
			if (keywords.has(word)) return "keyword";
			if (["true", "false", "undef"].includes(word)) return "atom";
			if (word.startsWith("$")) return "variableName.special";
			if (builtins.has(word)) return "variableName.standard";
			if (stream.match(/^\s*\(/, false)) return "variableName.function";
			return "variableName";
		}
		const character = stream.next();
		if (character === "{") state.depth++;
		if (character === "}") state.depth = Math.max(0, state.depth - 1);
		if (/[{}()[\]]/.test(character)) return "bracket";
		if (/[=:+\-*/%^<>!?#&|]/.test(character)) return "operator";
		return null;
	},
	indent(state, textAfter, context) {
		return Math.max(0, state.depth - (/^\s*}/.test(textAfter) ? 1 : 0)) * context.unit;
	},
	languageData: { commentTokens: { line: "//", block: { open: "/*", close: "*/" } }, indentOnInput: /^\s*}$/ },
});
