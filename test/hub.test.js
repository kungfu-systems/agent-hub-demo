import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { digest } from "../src/canonical.js";
import { handshake, isMainModule, respond } from "../src/adapter.js";
import { adapterArtifact } from "../src/artifact.js";
import { PRODUCT_VERSION } from "../src/product.js";
import { runCoreDemo, runRuntime100 } from "../src/scenarios.js";
import {
  matchesPayload,
  releasePlatforms,
} from "../scripts/release-platforms.mjs";
import { evaluatePublicationQualification } from "../scripts/qualify-publication.mjs";

function temporary(name) {
  return mkdtempSync(join(tmpdir(), `agent-hub-demo-${name}-`));
}

test("two independent Hubs exchange facts and Episodes without inferring completion", () => {
  const report = runCoreDemo(temporary("core"));
  assert.equal(report.results.fact.status, "admitted");
  assert.equal(report.results.episode.status, "admitted");
  assert.equal(report.results.duplicate.duplicate, true);
  assert.equal(report.objectSeparation.independent, true);
  assert.equal(report.objectSeparation.completion, "unassessed");
  assert.notEqual(report.hubs[0].identityRoot, report.hubs[1].identityRoot);
  assert.notEqual(report.hubs[0].capabilityRoot, report.hubs[1].capabilityRoot);
});

test("negative cases are explicit and fail closed", () => {
  const report = runCoreDemo(temporary("negative"));
  assert.deepEqual(report.results.conflict.reasonCodes, ["conflict-visible"]);
  assert.deepEqual(report.results.idempotencyConflict.reasonCodes, ["idempotency-conflict"]);
  assert.deepEqual(report.results.amplification.reasonCodes, ["authority-amplification"]);
  assert.deepEqual(report.results.revoked.reasonCodes, ["authority-revoked"]);
  assert.deepEqual(report.results.expired.reasonCodes, ["authority-expired"]);
  assert.deepEqual(report.results.unknownFeature.reasonCodes, ["required-feature-unsupported"]);
  assert.deepEqual(report.results.disclosureConflation.reasonCodes, ["disclosure-insufficient"]);
  assert.equal(report.results.driftRejected, true);
});

test("adapter handshake roots match its capability documents", () => {
  const result = handshake(temporary("inspect"));
  assert.equal(result.binding, "jsonl-stdio/v1");
  assert.equal(result.hubs.length, 2);
  for (const hub of result.hubs) assert.equal(hub.capabilityRoot, digest(hub.capabilities));
});

test("adapter uses the frozen request and response envelope contracts", () => {
  const response = respond({
    schemaVersion: 1,
    contract: "kfd.agent-hub-adapter-request/v1",
    requestId: "test-handshake",
    operation: "handshake",
    input: {},
  }, temporary("jsonl"));
  assert.equal(response.contract, "kfd.agent-hub-adapter-response/v1");
  assert.equal(response.code, "adapter-ready");
  assert.equal(response.hubs.length, 2);
});

test("adapter main-module detection uses a standard Windows file URL", () => {
  const argvPath = String.raw`D:\a\agent-hub-demo\agent-hub-demo\src\adapter.js`;
  const moduleUrl = "file:///D:/a/agent-hub-demo/agent-hub-demo/src/adapter.js";
  const windowsPathToFileURL = (value) => {
    assert.equal(value, argvPath);
    return new URL(moduleUrl);
  };

  assert.equal(isMainModule(moduleUrl, argvPath, windowsPathToFileURL), true);
  assert.notEqual(`file://${argvPath}`, moduleUrl);
  assert.equal(isMainModule(moduleUrl, undefined, windowsPathToFileURL), false);
});

test("product-local 100-delivery soak admits every delivery", () => {
  const report = runRuntime100(temporary("runtime100"));
  assert.equal(report.total, 100);
  assert.equal(report.admitted, 100);
  assert.match(report.boundary, /does not replace/);
});

test("publishable Buildchain artifacts never host Hub runtime identities", () => {
  const declaration = JSON.parse(readFileSync(new URL("../.buildchain/kfd/agent-hub.json", import.meta.url)));
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
  assert.equal(declaration.adapter.version, packageJson.version);
  const strings = [];
  JSON.stringify(declaration, (_key, value) => {
    if (typeof value === "string") strings.push(value);
    return value;
  });
  for (const value of strings) {
    assert.doesNotMatch(value, /\.buildchain\/artifacts/);
  }
});

test("public CLI exposes the same embedded facts used by standalone binaries", () => {
  const run = (command) => {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("../src/cli.js", import.meta.url)), command, "--json"],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  assert.equal(run("version").product, "agent-hub-demo");
  assert.equal(run("self-verify").ok, true);
  const description = run("self-describe");
  assert.deepEqual(description.kfd.standards, ["KFD-1", "KFD-2", "KFD-3"]);
  assert.equal(description.runtimeDependency, "none");
});

test("KFD-3 declares one CLI distributed as three standalone binaries", () => {
  const registry = JSON.parse(
    readFileSync(
      new URL("../.buildchain/kfd/kfd-3/surfaces.json", import.meta.url),
    ),
  );
  const cli = registry.surfaces.find(
    (entry) => entry.id === "cli:agent-hub-demo",
  );
  assert.equal(cli.kind, "cli");
  assert.deepEqual(
    cli.distribution.artifacts.map((entry) => entry.platform),
    ["linux-x64", "macos-arm64", "windows-x64"],
  );
  assert.deepEqual(
    cli.distribution.artifacts.map((entry) => entry.pathGlob),
    [
      "dist/agent-hub-demo-linux-x64",
      "dist/agent-hub-demo-macos-arm64",
      "dist/agent-hub-demo-windows-x64.exe",
    ],
  );
});

test("release version state does not rewrite embedded protocol facts", () => {
  const packageJson = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url)),
  );
  const generatedFacts = readFileSync(
    new URL("../src/generated-facts.js", import.meta.url),
    "utf8",
  );
  assert.equal(packageJson.scripts.precheck, "npm run generate:embedded");
  assert.equal(packageJson.scripts.pretest, "npm run check:embedded");
  assert.equal(PRODUCT_VERSION, packageJson.version);
  assert.doesNotMatch(generatedFacts, /PRODUCT_VERSION/);
  assert.equal(
    adapterArtifact().files.some((entry) => entry.path === "package.json"),
    false,
  );
});

test("release publication separates Buildchain artifact IDs from product targets", () => {
  assert.deepEqual(releasePlatforms, [
    { artifact: "linux-x64", target: "linux-x64" },
    { artifact: "macos", target: "macos-arm64" },
    { artifact: "windows-x64", target: "windows-x64" },
  ]);
  assert.equal(
    matchesPayload(
      "/payloads/agent-hub-demo-macos-123/dist/agent-hub-demo-macos-arm64",
      "macos",
      "/dist/agent-hub-demo-macos-arm64",
    ),
    true,
  );
});

test("release recovery rematerializes ephemeral Passport inputs", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/buildchain-ref-promotion.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /release-candidate-promote\.yml@fea8e21dcec2cbf21b9e7fca8fefb537b6b6999c/);
  assert.match(workflow, /publish-rematerialize-on-resume: true/);
});

test("Verify pins the reviewed Buildchain v4 runtime", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/verify.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /check\.yml@fea8e21dcec2cbf21b9e7fca8fefb537b6b6999c/);
  assert.match(
    workflow,
    /buildchain-ref: fea8e21dcec2cbf21b9e7fca8fefb537b6b6999c/,
  );
  assert.doesNotMatch(workflow, /buildchain-ref:\s*v2(?:\s|$)/);
});

test("publication qualification binds binaries to the exact governed version", () => {
  const base = {
    capability: {
      target: "github-release:kungfu-systems/agent-hub-demo",
      capabilityIds: ["github-release"],
      version: "0.2.0-alpha.7",
    },
    packageJson: {
      private: true,
      version: "0.2.0-alpha.7",
    },
    missing: [],
  };
  assert.equal(evaluatePublicationQualification(base).allow, true);
  assert.equal(
    evaluatePublicationQualification({
      ...base,
      capability: {
        ...base.capability,
        version: "0.2.0-alpha.8",
      },
    }).allow,
    false,
  );
});
