#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { handshake, runAdapterCli } from "./adapter.js";
import { adapterArtifact } from "./artifact.js";
import { canonicalJson, digest } from "./canonical.js";
import { loadPublicKfdProfile } from "./public-kfd.js";
import { PRODUCT_VERSION } from "./product.js";
import { runCoreDemo } from "./scenarios.js";

function valueFor(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : fallback;
}

function emit(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function describe() {
  const kfd = loadPublicKfdProfile();
  return {
    schemaVersion: 1,
    contract: "agent-hub-demo.self-description/v1",
    product: "agent-hub-demo",
    version: PRODUCT_VERSION,
    distribution: "standalone-binary",
    runtimeDependency: "none",
    commands: [
      "version",
      "capabilities",
      "demo",
      "adapter inspect",
      "adapter jsonl",
      "adapter run",
      "self-describe",
      "self-verify",
    ],
    kfd: {
      standards: ["KFD-1", "KFD-2", "KFD-3"],
      package: kfd.package,
      packageVersion: kfd.packageVersion,
      profileId: kfd.profileId,
      profileVersion: kfd.profileVersion,
      manifestDigest: kfd.manifestDigest,
    },
  };
}

function verifyEmbeddedFacts() {
  const kfd = loadPublicKfdProfile();
  const artifact = adapterArtifact();
  const checks = [
    {
      id: "kfd-manifest-digest",
      passed: /^sha256:[a-f0-9]{64}$/.test(kfd.manifestDigest),
    },
    {
      id: "adapter-artifact-root",
      passed:
        artifact.root ===
        digest({
          contract: artifact.contract,
          entry: artifact.entry,
          files: artifact.files,
        }),
    },
    {
      id: "kfd-123-declaration",
      passed: describe().kfd.standards.join(",") === "KFD-1,KFD-2,KFD-3",
    },
  ];
  return {
    schemaVersion: 1,
    contract: "agent-hub-demo.self-verification/v1",
    ok: checks.every((entry) => entry.passed),
    checks,
    adapterRoot: artifact.root,
    kfdManifestDigest: kfd.manifestDigest,
  };
}

async function runDemo(argv) {
  const root = resolve(
    valueFor(argv, "--root", `.demo/run-${Date.now()}`),
  );
  const output = resolve(valueFor(argv, "--output", `${root}/report.json`));
  mkdirSync(root, { recursive: true });
  const report = runCoreDemo(root);
  writeFileSync(output, `${canonicalJson(report)}\n`);
  emit({ status: "passed", root, output, results: report.results });
}

export async function main(argv = process.argv.slice(2)) {
  const command = argv[0] ?? "demo";
  if (command === "version" || command === "--version" || command === "-v") {
    emit({ product: "agent-hub-demo", version: PRODUCT_VERSION });
    return;
  }
  if (command === "self-describe") {
    emit(describe());
    return;
  }
  if (command === "self-verify") {
    const result = verifyEmbeddedFacts();
    emit(result);
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (command === "capabilities") {
    const root = resolve(
      valueFor(argv, "--root", `.demo/capabilities-${process.pid}`),
    );
    emit(handshake(root));
    return;
  }
  if (command === "adapter") {
    await runAdapterCli(argv.slice(1));
    return;
  }
  if (command === "demo") {
    await runDemo(argv.slice(1));
    return;
  }
  throw new Error(`unknown command: ${command}`);
}

const sourceMain =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
const seaMain = typeof require !== "undefined" && Boolean(require.main);
if (sourceMain || seaMain) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
