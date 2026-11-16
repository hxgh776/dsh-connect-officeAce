/**
 * Copy the hand-written browser script into `lib/`.
 *
 * `lib/` is gitignored (it is build output), so `src/client.js` is the source of
 * truth and this step is what makes `lib/client.js` exist in the installed
 * plugin. It also refuses to copy a file that would break the desktop web boot:
 *
 * - a top-level `import`/`export` (the file must stay CJS-shaped plain script);
 * - a missing `window.__ModuleLoader__.load(...)` registration;
 * - a `require(...)` outside the host-injected set (react + the packages the
 *   host maps from `dsh.client.inject`).
 */

import { copyFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "src", "client.js");
const target = join(root, "lib", "client.js");

/** Packages the host's `require` serves to this plugin's factory. */
const ALLOWED_REQUIRES = new Set(["react", "react/jsx-runtime"]);

export function assertClientShape(text, label) {
	const lines = text.split(/\r?\n/u);
	lines.forEach((line, index) => {
		if (/^\s*import\s/u.test(line) || /^\s*export\s/u.test(line)) {
			throw new Error(
				`${label}:${index + 1} 出现顶层 import/export —— 浏览器端必须是 CJS-shaped 普通脚本，否则整个 web boot 会挂`,
			);
		}
	});
	if (!text.includes("window.__ModuleLoader__.load(")) {
		throw new Error(`${label} 缺少 window.__ModuleLoader__.load({ id, factory }) 注册`);
	}
	for (const match of text.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/gu)) {
		const id = match[1];
		if (!ALLOWED_REQUIRES.has(id)) {
			throw new Error(`${label} 用到了宿主未注入的模块 require("${id}")`);
		}
	}
	for (const name of ["apply", "inject", "name", "translator", "zh", "en"]) {
		if (!text.includes(`exports.${name} =`)) {
			throw new Error(`${label} 缺少导出 exports.${name}`);
		}
	}
}

const text = readFileSync(source, "utf8");
assertClientShape(text, "src/client.js");
mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
console.log(`copied src/client.js -> lib/client.js (${statSync(target).size} bytes)`);
