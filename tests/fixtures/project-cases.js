export const projectCases = [
	{
		id: "include-shared-scope", entry: "main.scad",
		files: { "main.scad": "include <settings.scad> echo(size); shape();", "settings.scad": "size=3; echo(size); module shape() { cube(size); }" },
		echoes: ["ECHO: 3", "ECHO: 3"], volume: 27,
	},
	{
		id: "use-library-bindings", entry: "main.scad",
		files: { "main.scad": "use <lib.scad> size=9; echo(size, value()); shape();", "lib.scad": "size=3; echo(999); cube(100); function value()=size; module shape() { cube(size); }" },
		echoes: ["ECHO: 9, 3"], volume: 27,
	},
	{
		id: "nested-relative-library", entry: "parts/main.scad", libraryPaths: ["libraries"],
		files: { "parts/main.scad": "include <../settings.scad> use <shape.scad> echo(size, value()); shape();", "settings.scad": "size=2;", "libraries/shape.scad": "use <nested/values.scad> function value()=nested(); module shape() { cube(value()); }", "libraries/nested/values.scad": "function nested()=2; cube(100);" },
		echoes: ["ECHO: 2, 2"], volume: 8,
	},
	{
		id: "use-dynamic-specials", entry: "main.scad",
		files: { "main.scad": "$fn=8; use <shape.scad> shape($fn=12);", "shape.scad": "module shape() { echo($fn); cylinder(h=1, r=2); }" },
		echoes: ["ECHO: 12"], volume: 12,
	},
	{
		id: "include-module-scope", entry: "main.scad",
		files: { "main.scad": "size=9; module part() { include <settings.scad> echo(size); cube(size); } part(); echo(size);", "settings.scad": "size=2;" },
		echoes: ["ECHO: 2", "ECHO: 9"], volume: 8,
	},
	{
		id: "definition-defaults", entry: "main.scad",
		files: { "main.scad": "use <values.scad> echo(value(3), value(first=4, second=5)); cube(2);", "values.scad": "offset=2; function value(first, second=offset)=first+second;" },
		echoes: ["ECHO: 5, 9"], volume: 8,
	},
];