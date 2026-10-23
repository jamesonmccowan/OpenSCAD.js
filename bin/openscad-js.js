#!/usr/bin/env node
import { runCli } from "../src/node/cli.js";

process.stdout.on("error", () => {});
process.stderr.on("error", () => {});
try {
	process.exitCode = await runCli(process.argv.slice(2));
} catch (error) {
	if (error.code !== "EPIPE") console.error(error.message);
	process.exitCode = 2;
}