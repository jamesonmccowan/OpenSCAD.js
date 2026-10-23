import assert from "node:assert/strict";
import { test } from "node:test";
import { StudioProject } from "../src/studio/project.js";
import { Customizer, readParameters } from "../src/studio/customizer.js";
import { Animation } from "../src/studio/animation.js";

test("Customizer reads literal defaults, groups, ranges and choices without exposing computed or hidden bindings", () => {
	const parameters = readParameters('/* [Dimensions] */\n// Width\nwidth=12; // [2:2:30]\ncolor="red"; // [red:Red,green:Green]\nshow=true;\nposition=[-1,2,3]; // [-10:0.5:10]\ncomputed=width*2;\n$fn=24;\n/* [Hidden] */\nsecret=10;\nmodule child(){local=2;}');
	assert.deepEqual(parameters.map((parameter) => parameter.name), ["width", "color", "show", "position"]);
	assert.equal(parameters[0].label, "Width"); assert.equal(parameters[0].group, "Dimensions");
	assert.equal(parameters[0].step, 2); assert.equal(parameters[3].min, -10);
	assert.deepEqual(parameters[1].choices, [{ value: "red", label: "Red" }, { value: "green", label: "Green" }]);
	assert.equal(readParameters('label="// [Hidden]";\nwidth=4;').length, 2);
});

test("Customizer overrides and native JSON presets are typed, bounded, atomic and source-independent", () => {
	const source = 'width=12; // [2:2:30]\nlabel="red";\nshow=true;\nposition=[1,2];';
	const customizer = new Customizer(source);
	customizer.set("width", 20); customizer.set("position", [3,4]); customizer.save("Large");
	customizer.reset(); assert.deepEqual(customizer.defines(), {});
	customizer.apply("Large"); assert.equal(customizer.defines().width, 20);
	const other = new Customizer(source); other.import(customizer.export()); other.apply("Large");
	assert.deepEqual(other.defines(), { width: 20, label: "red", show: true, position: [3,4] });
	assert.throws(() => customizer.set("width", 100), /range/);
	assert.throws(() => other.import('{"fileFormatVersion":"1","parameterSets":{"Bad":{"width":"cube(9)"}}}'), /Invalid value/);
	assert.equal(other.presets.has("Bad"), false);
	customizer.update('width=12; // [2:2:30]\nposition="changed";');
	assert.deepEqual(customizer.defines(), { width: 20 });
});

test("animation renders one frame at a time and loops without a duplicate endpoint", async () => {
	const frames = [], pending = [];
	let finish, running = 0, peak = 0;
	const animation = new Animation({ render: async (time) => { frames.push(time); peak = Math.max(peak, ++running); await new Promise((resolve) => { finish = resolve; }); --running; }, setTimer: (callback) => { pending.push(callback); return callback; }, clearTimer: (callback) => { const index = pending.indexOf(callback); if (index >= 0) pending.splice(index, 1); }, now: () => 0 });
	animation.configure({ fps: 24, steps: 3 }); animation.play(); animation.play();
	assert.deepEqual(frames, [0]); assert.equal(pending.length, 0);
	for (let frame = 0; frame < 3; frame++) { finish(); await new Promise((resolve) => setImmediate(resolve)); pending.shift()(); }
	assert.deepEqual(frames, [0, 1/3, 2/3, 0]); assert.equal(peak, 1);
	animation.seek(1); finish(); await new Promise((resolve) => setImmediate(resolve));
	assert.equal(animation.time, 1); assert.equal(pending.length, 0); assert.equal(animation.playing, false);
	assert.throws(() => animation.configure({ steps: 0 }), /steps/);
	animation.dispose(); animation.play(); assert.equal(animation.playing, false);
});

function file(name, content, relative = "") {
	const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
	return { name, webkitRelativePath: relative, size: bytes.length, text: async () => new TextDecoder().decode(bytes), arrayBuffer: async () => bytes.slice().buffer };
}

test("folder paths, entry selection, source edits and binary snapshots are independent", async () => {
	const project = await new StudioProject().withFiles([file("main.scad", "use <lib/shape.scad> shape();", "project/main.scad"), file("shape.scad", "module shape(){cube(2);}", "project/lib/shape.scad"), file("shape.STL", new Uint8Array([1,2,3]), "project/assets/shape.STL")], { folder: true });
	assert.equal(project.entry, "main.scad");
	assert.equal(project.select("lib/shape.scad"), "module shape(){cube(2);}");
	project.edit("module shape(){cube(3);}");
	project.select("main.scad");
	assert.equal(project.files.get("lib/shape.scad"), "module shape(){cube(3);}");
	assert.equal(project.dirty(), true);
	const snapshot = project.snapshot(); snapshot.assets["assets/shape.STL"][0] = 99;
	assert.equal(project.assets.get("assets/shape.STL")[0], 1);
	project.accept({ status: "success", dependencies: ["main.scad", "lib/shape.scad", "assets/shape.STL"] });
	assert.equal(project.needsCompile("lib/shape.scad"), true); assert.equal(project.needsCompile("unused.scad"), false);
});

test("additions preserve edits and failing loads cannot mutate the current project", async () => {
	const project = new StudioProject("cube(2);"); project.edit("cube(3);");
	const added = await project.withFiles([file("shape.stl", new Uint8Array([1,2]))], { merge: true });
	assert.equal(added.files.get("model.scad"), "cube(3);"); assert.equal(added.dirty(), true);
	await assert.rejects(project.withFiles([file("model.scad", "cube(5);")], { merge: true }), /edited source/);
	await assert.rejects(project.withFiles([file("main.scad", "cube();"), file("main.scad", "cube(2);")] ), /Duplicate/);
	await assert.rejects(project.withFiles([file("shape.stl", new Uint8Array([1]))]), /SCAD source/);
	assert.equal(project.files.get("model.scad"), "cube(3);"); assert.equal(project.assets.size, 0);
});

test("untrusted paths and size/file limits are enforced before reading", async () => {
	const project = new StudioProject();
	await assert.rejects(project.withFiles([file("../escape.scad", "cube();")]), /root/);
	await assert.rejects(project.withFiles([file("main.scad", "cube();")], { maxSourceBytes: 2 }), /limit/);
	await assert.rejects(project.withFiles([file("one.scad", ""), file("two.scad", "")], { maxFiles: 1 }), /limit/);
	await assert.rejects(project.withFiles([file("readme.txt", "ignored")]), /Select SCAD/);
});

test("pending dependency changes survive editing an unrelated source", async () => {
	const project = await new StudioProject().withFiles([file("main.scad", "use <shape.scad> shape();"), file("shape.scad", "module shape(){cube(2);}"), file("unused.scad", "cube(10);")]);
	project.accept({ status: "success", dependencies: ["main.scad", "shape.scad"] });
	project.select("shape.scad"); project.edit("module shape(){cube(3);}");
	project.select("unused.scad"); project.edit("cube(20);");
	assert.equal(project.needsCompile("unused.scad"), true);
	project.accept({ status: "success", dependencies: ["main.scad", "shape.scad"] });
	assert.equal(project.needsCompile("unused.scad"), false);
});