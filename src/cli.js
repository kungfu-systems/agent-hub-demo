#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { canonicalJson } from "./canonical.js";
import { runCoreDemo } from "./scenarios.js";

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const command = process.argv[2] ?? "demo";
if (command !== "demo") throw new Error(`unknown command: ${command}`);
const root = resolve(arg("--root", `.demo/run-${Date.now()}`));
const output = resolve(arg("--output", `${root}/report.json`));
mkdirSync(root, { recursive: true });
const report = runCoreDemo(root);
writeFileSync(output, `${canonicalJson(report)}\n`);
process.stdout.write(`${JSON.stringify({ status: "passed", root, output, results: report.results }, null, 2)}\n`);
