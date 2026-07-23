import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const runtimeRoot = resolve(root, process.env.BUILDCHAIN_RUNTIME_ROOT || ".buildchain/runtime");
const buildchain = resolve(runtimeRoot, "bin/buildchain.mjs");
const sourceSha = process.env.BUILDCHAIN_SOURCE_SHA || process.env.GITHUB_SHA || "unknown";
const { version } = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const releaseTag = `v${version}`;

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${result.status}`);
  }
}

function bc(...args) {
  run(process.execPath, [buildchain, ...args]);
}

bc("kfd", "hub", "test", "--cwd", root, "--output-dir", ".buildchain/artifacts/kfd-agent-hub", "--for", "agent");
bc("kfd", "2", "product-claims", "write", "--source-sha", sourceSha, "--tag", releaseTag, "--json");
bc("kfd", "3", "witness", "--kind", "prebuild", "--source-sha", sourceSha, "--output", ".buildchain/release-qualification/kfd-3-prebuild.json");
run(process.execPath, ["scripts/prepare-release-evidence.mjs", "--source-sha", sourceSha]);
bc(
  "kfd", "1", "gate",
  "--witness-json", ".buildchain/release-qualification/kfd-1-witness.json",
  "--artifact-root", "dist",
  "--output", ".buildchain/release-qualification/kfd-1-gate.json",
  "--json",
);

const gate = JSON.parse(readFileSync(resolve(root, ".buildchain/release-qualification/kfd-1-gate.json"), "utf8"));
writeFileSync(
  resolve(root, ".buildchain/release-qualification/kfd-1-gate-section.json"),
  `${JSON.stringify(gate.passportSection, null, 2)}\n`,
);
bc("kfd", "1", "verify", "--gate-json", ".buildchain/release-qualification/kfd-1-gate-section.json", "--json");
run(process.execPath, ["scripts/qualify-release.mjs"]);
