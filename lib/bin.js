#!/usr/bin/env node
/**
 * `dsh-connect-officeace` — thin dispatcher over the two diagnostic CLIs.
 *
 * The real work lives in `cli-doctor.ts` / `cli-probe.ts` so either can be run
 * directly without this file.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const command = process.argv[2] ?? "";
const rest = process.argv.slice(3);
const targets = {
    doctor: join(here, "cli-doctor.js"),
    probe: join(here, "cli-probe.js"),
};
if (command === "" || command === "-h" || command === "--help" || command === "help") {
    console.log("用法: dsh-connect-officeace <doctor|probe> [options]");
    console.log("  doctor  只读体检（不消耗推理额度）");
    console.log("  probe   发起一次真实流式对话（消耗额度）");
    process.exitCode = command === "" ? 2 : 0;
}
else if (targets[command] !== undefined) {
    const result = spawnSync(process.execPath, [targets[command], ...rest], { stdio: "inherit" });
    process.exitCode = result.status ?? 1;
}
else {
    console.error(`未知子命令: ${command}（可用: doctor, probe）`);
    process.exitCode = 2;
}
