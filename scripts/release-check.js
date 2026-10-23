import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, open, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { clean } from "./clean.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const exec = promisify(execFile);
const output = path.join(root, ".release-check");
const report = { schemaVersion: 1, status: "running", startedAt: new Date().toISOString(), node: process.version, stages: [],
	limitations: ["The configured Marketplace publisher is OuroborosProductions; this gate does not authenticate publisher access or publish the extension.",
		"Safari/iOS is unsupported. Does not publish, rewrite history, certify physical mobile devices/strict CSP, or replace Desktop/Remote SSH extension-host smoke tests."] };
const save = () => writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");

function execute(command, args, options = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { cwd: root, env: { ...process.env, FORCE_COLOR: "0", OPENSCAD_RELEASE_CHECK: "1" }, ...options });
		child.once("error", reject);
		child.once("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} failed (${signal ?? code})`)));
	});
}

async function stage(name, command, args, browser = false) {
	const record = { name, status: "running", startedAt: new Date().toISOString(), log: `${name}.log` };
	report.stages.push(record);
	await save();
	const log = await open(path.join(output, record.log), "w");
	console.log(`\n=== ${name} ===`);
	try {
		if (browser && process.platform === "linux" && !process.env.DISPLAY) {
			args = ["-a", command, ...args];
			command = "xvfb-run";
		}
		await execute(command, args, { stdio: ["ignore", log.fd, log.fd] });
		record.status = "passed";
		console.log(`Passed ${name}`);
	} catch (error) {
		record.status = "failed";
		record.error = error.message;
		throw error;
	} finally {
		await log.close();
		record.completedAt = new Date().toISOString();
		await save();
	}
}

async function preflight() {
	if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("Use Node 22 or newer for the release gate.");
	for (const name of ["node_modules/esbuild/package.json", "node_modules/typescript/package.json", "extension/node_modules/@vscode/vsce/package.json"]) {
		try { await access(path.join(root, name)); }
		catch (error) { throw new Error(`Missing ${name}; install root and extension dependencies first.`, { cause: error }); }
	}
	const { chromium, firefox, webkit } = await import("@playwright/test");
	for (const browser of [chromium, firefox, webkit]) {
		try { await access(browser.executablePath()); }
		catch (error) { throw new Error("Missing Playwright browser; run npx playwright install chromium firefox webkit.", { cause: error }); }
	}
	await execute("python3", ["--version"], { stdio: "ignore" });
	await execute("tar", ["--version"], { stdio: "ignore" });
	if (process.platform === "linux" && !process.env.DISPLAY) await execute("xvfb-run", ["--help"], { stdio: "ignore" });
	const native = path.join(root, "references/openscad");
	const revision = (await exec("git", ["-C", native, "rev-parse", "HEAD"])).stdout.trim();
	assert.equal(revision, "7d44e5796cd489bcbfb8cef0720abe4db60ce35e", "Run npm run setup:reference");
	await exec("git", ["-C", native, "diff", "--quiet", "HEAD", "--"]);
	const oracle = path.join(native, "build/openscad");
	const version = await exec(oracle, ["--version"]);
	assert.match(version.stdout + version.stderr, /OpenSCAD version 2026\.10\.02/);
	const help = await exec(oracle, ["--help"]);
	assert.match(help.stdout + help.stderr, /--enable/, "Native reference must support experimental features");
	report.oracleRevision = revision;
	report.projectRevision = (await exec("git", ["-C", root, "rev-parse", "HEAD"])).stdout.trim();
	report.worktreeStatus = (await exec("git", ["-C", root, "status", "--short", "--untracked-files=normal"])).stdout;
}

if (process.argv.length !== 2) throw new Error("Usage: npm run release:check (no skip or publish options)");
await mkdir(output, { recursive: true });
const lock = await open(path.join(output, "running.lock"), "wx");
await lock.writeFile(`${process.pid}\n`);
try {
	await save();
	// Invalidate old success artifacts before checking prerequisites.
	for (const name of ["extension.vsix", "SHA256SUMS"]) await rm(path.join(output, name), { force: true });
	for (const entry of await readdir(output)) {
		if (/^openscad-js-studio-[a-zA-Z0-9.+-]+\.tgz$/.test(entry) || /^[a-z-]+\.log$/.test(entry)) await rm(path.join(output, entry));
	}
	await preflight();
	await clean();
	await stage("build", "npm", ["run", "build"]);
	await stage("node-native", "npm", ["run", "test:node"]);
	await stage("types", "npm", ["run", "test:types"]);
	await stage("browsers", "npm", ["run", "test:browser", "--", "--workers=2"], true);
	await stage("extension-build", "npm", ["--prefix", "extension", "run", "build"]);
	await stage("extension-unit", "npm", ["--prefix", "extension", "test"]);
	await stage("extension-payload", "npm", ["--prefix", "extension", "run", "test:occt"]);
	await stage("extension-browser", "npm", ["--prefix", "extension", "run", "test:browser", "--", "--workers=2"], true);
	await stage("extension-package", "npm", ["--prefix", "extension", "run", "package", "--", "--out", path.join(output, "extension.vsix")]);
	await stage("extension-archive", process.execPath, ["scripts/verify-release-artifacts.js", path.join(output, "extension.vsix")]);
	await stage("standalone-package", "npm", ["pack", "./dist", "--ignore-scripts", "--pack-destination", output, "--json"]);
	const pack = JSON.parse(await readFile(path.join(output, "standalone-package.log"), "utf8"));
	assertPack(pack);
	await stage("standalone-archive", process.execPath, ["scripts/verify-release-artifacts.js", path.join(output, pack[0].filename)]);
	const artifacts = [pack[0].filename, "extension.vsix"];
	const sums = [];
	for (const filename of artifacts) {
		const bytes = await readFile(path.join(output, filename));
		sums.push(`${createHash("sha256").update(bytes).digest("hex")}  ${filename}`);
	}
	await writeFile(path.join(output, "SHA256SUMS"), sums.join("\n") + "\n");
	report.artifacts = artifacts;
	report.status = "passed";
	console.log(`\nLocal release gate passed. Candidate artifacts, checksums, logs and report: ${output}`);
} catch (error) {
	report.status = "failed";
	report.error = error.message;
	console.error(`\nRelease gate FAILED: ${error.message}\nSee ${output}/report.json and the failing stage log. No release is certified.`);
	process.exitCode = 1;
} finally {
	report.completedAt = new Date().toISOString();
	await save();
	await lock.close();
	await rm(path.join(output, "running.lock"));
}

function assertPack(pack) {
	if (pack.length !== 1 || path.basename(pack[0].filename) !== pack[0].filename || !pack[0].filename.endsWith(".tgz")) throw new Error("Unexpected npm pack output");
}
