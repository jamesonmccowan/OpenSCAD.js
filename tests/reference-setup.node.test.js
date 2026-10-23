import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const exec = promisify(execFile);
const revision = "7d44e5796cd489bcbfb8cef0720abe4db60ce35e";

async function setupFixture(run) {
	const directory = await mkdtemp(path.join(tmpdir(), "openscad-js-reference-"));
	try {
		const tools = path.join(directory, "tools"), build = path.join(directory, "reference build");
		await mkdir(path.join(directory, "scripts"), { recursive: true });
		await mkdir(path.join(directory, "references/openscad"), { recursive: true });
		await mkdir(tools);
		await mkdir(build);
		await writeFile(path.join(directory, "references/openscad/.git"), "fixture");
		await copyFile(new URL("../scripts/build-reference.sh", import.meta.url), path.join(directory, "scripts/build-reference.sh"));
		const mock = `#!${process.execPath}
const fs = require("node:fs"), path = require("node:path");
const tool = path.basename(process.argv[1]), args = process.argv.slice(2);
fs.appendFileSync(process.env.SETUP_LOG, JSON.stringify({ tool, args, env: Object.fromEntries(["LD_LIBRARY_PATH", "LD_RUN_PATH", "LD_PRELOAD", "OPENSCAD_LIBRARIES", "GLEWDIR", "CMAKE_PREFIX_PATH"].map(key => [key, process.env[key] ?? null])) }) + "\\n");
if (tool === "git" && args.includes("rev-parse")) console.log(process.env.SETUP_REVISION);
if (tool === "git" && args.includes("diff") && process.env.SETUP_DIRTY) process.exit(1);
if (tool === "openscad" && args.includes("--version")) console.log(process.env.SETUP_VERSION || "OpenSCAD version 2026.10.02");
if (tool === "openscad" && args.includes("--help")) console.log(process.env.SETUP_NO_EXPERIMENTAL ? "Usage: openscad" : "--enable arg");
if (tool === "sudo") {
  const result = require("node:child_process").spawnSync(args[1], args.slice(2), { stdio: "inherit" });
  process.exit(result.status ?? 1);
}
`;
		for (const tool of ["git", "cmake", "ninja", "c++", "pkg-config", "bison", "flex", "msgfmt", "apt-get", "sudo"]) {
			await writeFile(path.join(tools, tool), mock, { mode: 0o755 });
		}
		await writeFile(path.join(build, "openscad"), mock, { mode: 0o755 });
		const log = path.join(directory, "calls.jsonl");
		await writeFile(log, "");
		const invoke = (args = [], overrides = {}) => exec("/bin/bash", [path.join(directory, "scripts/build-reference.sh"), ...args], {
			env: { ...process.env, PATH: `${tools}:/usr/bin:/bin`, REFERENCE_BUILD_DIR: build, REFERENCE_BUILD_JOBS: "2", SETUP_LOG: log, SETUP_REVISION: revision, ...overrides },
		});
		const calls = async () => (await readFile(log, "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
		await run({ directory, build, invoke, calls });
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

test("reference setup help and invalid options never invoke build tools", async () => {
	await setupFixture(async ({ invoke, calls }) => {
		assert.match((await invoke(["--help"])).stdout, /--install-deps/);
		await assert.rejects(invoke(["--unknown"]), error => /Unknown argument/.test(error.stderr));
		await assert.rejects(invoke([], { REFERENCE_BUILD_JOBS: "8" }), error => /must be 1-4/.test(error.stderr));
		assert.deepEqual(await calls(), []);
	});
});

test("reference setup initializes submodules and sanitizes native build environment", async () => {
	await setupFixture(async ({ invoke, calls, build }) => {
		const result = await invoke([], { LD_LIBRARY_PATH: build, LD_RUN_PATH: build, LD_PRELOAD: "", OPENSCAD_LIBRARIES: build, GLEWDIR: build, CMAKE_PREFIX_PATH: build });
		assert.match(result.stdout, /Native reference ready/);
		const commands = await calls();
		assert.ok(commands.some(command => command.tool === "git" && command.args.join(" ") === "submodule update --init --recursive -- references/openscad"));
		const configure = commands.find(command => command.tool === "cmake" && command.args.includes("-S"));
		assert.ok(configure.args.includes("Ninja"));
		for (const option of ["GMP*", "Eigen3_DIR", "-DCMAKE_SKIP_RPATH=ON", "-DHEADLESS=ON", "-DEXPERIMENTAL=ON", "-DOPENSCAD_VERSION=2026.10.02"]) assert.ok(configure.args.includes(option), option);
		for (const command of commands.filter(command => ["cmake", "openscad"].includes(command.tool))) assert.ok(Object.values(command.env).every(value => value === null));
		const compile = commands.find(command => command.tool === "cmake" && command.args.includes("--build"));
		assert.deepEqual(compile.args, ["--build", build, "--target", "OpenSCADExe", "--parallel", "2"]);
		assert.ok(!commands.some(command => command.tool === "apt-get"));
	});
});

test("reference setup reports missing msgfmt before initializing or building", async () => {
	await setupFixture(async ({ directory, invoke, calls }) => {
		const tools = path.join(directory, "tools");
		await symlink("/usr/bin/dirname", path.join(tools, "dirname"));
		await rm(path.join(tools, "msgfmt"));
		await assert.rejects(invoke([], { PATH: tools }), error => {
			assert.equal(error.code, 1);
			assert.match(error.stderr, /Missing build tool: msgfmt/);
			return true;
		});
		assert.deepEqual(await calls(), []);
	});
});

test("reference setup preserves existing build generators and files", async () => {
	await setupFixture(async ({ invoke, calls, build }) => {
		await writeFile(path.join(build, "CMakeCache.txt"), "CMAKE_GENERATOR:INTERNAL=Unix Makefiles\n");
		await invoke([], { REFERENCE_BUILD_JOBS: "1" });
		const configure = (await calls()).find(command => command.tool === "cmake" && command.args.includes("-S"));
		assert.ok(!configure.args.includes("-G"));
		assert.match(await readFile(path.join(build, "CMakeCache.txt"), "utf8"), /Unix Makefiles/);
	});
});

test("reference setup refuses mismatched or modified source checkouts", async () => {
	await setupFixture(async ({ invoke, calls }) => {
		await assert.rejects(invoke([], { SETUP_REVISION: "different" }), error => /refusing to change/.test(error.stderr));
		assert.ok(!(await calls()).some(command => command.args.includes("submodule")));
		await assert.rejects(invoke([], { SETUP_DIRTY: "1" }), error => /tracked source changes/.test(error.stderr));
		assert.ok(!(await calls()).some(command => command.tool === "cmake"));
	});
});

test("reference setup verifies the native version and experimental CLI", async () => {
	await setupFixture(async ({ invoke }) => {
		await assert.rejects(invoke([], { SETUP_VERSION: "OpenSCAD version 2026.10.05" }));
		await assert.rejects(invoke([], { SETUP_NO_EXPERIMENTAL: "1" }));
	});
});

test("reference setup installs build packages only when explicitly requested", async () => {
	await setupFixture(async ({ invoke, calls, build }) => {
		await invoke(["--install-deps"], { LD_LIBRARY_PATH: build, LD_RUN_PATH: build });
		const installs = (await calls()).filter(command => command.tool === "apt-get");
		assert.equal(installs.length, 2);
		assert.ok(installs.every(command => command.env.LD_LIBRARY_PATH === null && command.env.LD_RUN_PATH === null));
		assert.deepEqual(installs[0].args, ["update"]);
		assert.ok(installs[1].args.includes("libgmp-dev"));
		assert.ok(installs[1].args.includes("ninja-build"));
		assert.ok(installs[1].args.includes("gettext"));
	});
});