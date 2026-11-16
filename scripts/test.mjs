/**
 * Test entrypoint that runs every compiled test file in ONE process.
 *
 * `node --test <dir>` spawns a child process per file, and this Windows sandbox
 * denies piped child stdio. Importing the compiled `*.test.js` files directly
 * keeps `node:test` semantics (it still reports and sets a failing exit code)
 * without spawning anything.
 */

import { readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "out-test");

const files = readdirSync(outDir)
	.filter((name) => name.endsWith(".test.js"))
	.sort();

if (files.length === 0) {
	console.error("no compiled test files in out-test/ — run `tsc -p tsconfig.test.json` first");
	process.exitCode = 1;
} else {
	for (const file of files) {
		await import(pathToFileURL(join(outDir, file)).href);
	}
}
