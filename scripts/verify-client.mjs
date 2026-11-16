/**
 * Static verification for the browser half.
 *
 * Nobody in this environment can look at the Electron UI, so the checks that
 * ARE decidable are made explicit and fail the build when they regress:
 *
 * 1. `lib/client.js` exists and is byte-identical to `src/client.js`;
 * 2. it is CJS-shaped: no top-level import/export, module-loader registration;
 * 3. it only `require`s host-injected modules (react + jsx runtime);
 * 4. it exports apply / inject / name / translator / zh / en;
 * 5. `inject` is exactly `["slots", "locale"]`;
 * 6. it registers the `settings.section` slot;
 * 7. `package.json` exposes `./client` and declares `dsh.client` with
 *    `platform: "web"` and the same inject list as the reference plugin;
 * 8. it never references a credential-bearing field (app secret, STS token,
 *    refresh token) nor a route this plugin does not serve.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(join(root, relative), "utf8");
const failures = [];
const notes = [];

function check(label, condition, detail) {
	if (condition) {
		notes.push(`OK   ${label}${detail === undefined ? "" : ` — ${detail}`}`);
	} else {
		failures.push(`FAIL ${label}${detail === undefined ? "" : ` — ${detail}`}`);
	}
}

const source = read("src/client.js");
const built = read("lib/client.js");
const pkg = JSON.parse(read("package.json"));

// 1. artifact
check("lib/client.js 与 src/client.js 一致", built === source, `${Buffer.byteLength(built)} bytes`);

// 2. CJS shape
const lines = source.split(/\r?\n/u);
const badLines = lines
	.map((line, index) => ({ line, index }))
	.filter(({ line }) => /^\s*import\s/u.test(line) || /^\s*export\s/u.test(line));
check("无顶层 import/export", badLines.length === 0, badLines.map(({ index }) => `line ${index + 1}`).join(", "));
check(
	"通过 window.__ModuleLoader__.load 注册",
	source.includes("window.__ModuleLoader__.load("),
);

// 3. require whitelist
const requires = new Set([...source.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/gu)].map((m) => m[1]));
const allowed = new Set(["react", "react/jsx-runtime"]);
const foreign = [...requires].filter((id) => !allowed.has(id));
check("require 只用宿主注入的模块", foreign.length === 0, `used: ${[...requires].join(", ")}`);

// 4. exports
for (const name of ["apply", "inject", "name", "translator", "zh", "en"]) {
	check(`导出 ${name}`, source.includes(`exports.${name} =`));
}

// 5. inject list
const injectMatch = /const inject = (\[[^\]]*\]);/u.exec(source);
const injectValue = injectMatch === null ? undefined : JSON.parse(injectMatch[1].replaceAll("'", '"'));
check(
	'inject = ["slots","locale"]',
	JSON.stringify(injectValue) === JSON.stringify(["slots", "locale"]),
	JSON.stringify(injectValue),
);

// 6. settings.section
check("注册 settings.section slot", source.includes('"settings.section"'));

// 7. package.json contract
const exportsClient = pkg.exports?.["./client"];
check(
	'package.json exports["./client"]',
	exportsClient === "./lib/client.js",
	String(exportsClient),
);
const clientInject = pkg.dsh?.client?.inject;
const expectedInject = [
	"@deepseek-ai/dsh-client-ui-settings",
	"@deepseek-ai/dsh-client-ui-slots",
	"@deepseek-ai/dsh-client-ui-settings-plugins",
	"@deepseek-ai/dsh-client-locale",
];
check(
	"dsh.client.inject 与参考实现一致",
	JSON.stringify(clientInject) === JSON.stringify(expectedInject),
	`${Array.isArray(clientInject) ? clientInject.length : 0} entries`,
);
check("dsh.client.platform = web", pkg.dsh?.client?.platform === "web", String(pkg.dsh?.client?.platform));
check("dsh.bundle.patch 仍在", pkg.dsh?.bundle?.patch === "./cordis.patch.yml");

// 8. no credential-bearing fields / unknown routes
const forbidden = ["model_app_secret", "sts_token", "refresh_token", "appSecret", "accessKey"];
const hits = forbidden.filter((token) => source.includes(token));
check("浏览器脚本不含凭据字段", hits.length === 0, hits.join(", "));
const routes = [...source.matchAll(/["'](\/plugins\/[^"']+)["']/gu)].map((m) => m[1]);
const allowedRoutes = new Set([
	"/plugins/dsh-connect-officeace/status",
	"/plugins/dsh-connect-officeace/catalog",
	"/plugins/dsh-connect-officeace/__save",
]);
const unknownRoutes = [...new Set(routes)].filter((route) => !allowedRoutes.has(route));
check("只引用已存在的三条路由", unknownRoutes.length === 0, [...new Set(routes)].join(", "));

for (const line of notes) console.log(line);
for (const line of failures) console.error(line);
if (failures.length > 0) {
	console.error(`client verification failed: ${failures.length} check(s)`);
	process.exitCode = 1;
} else {
	console.log(`client verification passed: ${notes.length} checks`);
}
