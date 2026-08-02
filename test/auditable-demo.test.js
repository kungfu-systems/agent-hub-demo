import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { adapt } from "../scripts/auditable-demo-adapter.mjs";

const SOURCE_SHA = "a".repeat(40);
const PTY = process.platform === "win32" ? { skip: "capture producer requires a Unix PTY" } : {};

function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-hub-demo-animation-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function fakeBinary(root) {
  const file = path.join(root, "agent-hub-demo");
  fs.writeFileSync(file, `#!/usr/bin/env python3
import json, os, sys
args = sys.argv[1:]
if args[:2] == ["self-verify", "--json"]:
    print(json.dumps({"schemaVersion":1,"contract":"agent-hub-demo.self-verification/v1","ok":True,"checks":[{"id":"embedded","passed":True}]}))
    raise SystemExit(0)
if args and args[0] == "demo":
    output = args[args.index("--output") + 1]
    os.makedirs(os.path.dirname(output))
    verdict = lambda status: {"status": status}
    report = {"contract":"agent-hub-demo.report/v1","results":{
      "fact":verdict("admitted"),"episode":verdict("admitted"),"duplicate":{"duplicate":True},
      "conflict":verdict("conflicted"),"amplification":verdict("rejected"),
      "expired":verdict("rejected"),"revoked":verdict("rejected"),
      "unknownFeature":verdict("rejected"),"disclosureConflation":verdict("rejected"),
      "recovery":{"importedObjects":11},"driftRejected":True}}
    with open(output, "w", encoding="utf-8") as handle: json.dump(report, handle)
    for line in ["Agent Hub Demo  PASSED","Fact delivery admitted","Episode delivery admitted","Semantic conflict visible","Invalid authority rejected","Recovery verified"]:
      print("\\x1b[32m" + line + "\\x1b[0m")
    raise SystemExit(0)
raise SystemExit(2)
`);
  fs.chmodSync(file, 0o755);
  const digest = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  const metadata = path.join(root, "binary-linux-x64.json");
  writeJson(metadata, {
    schemaVersion: 1,
    contract: "agent-hub-demo.binary-artifact/v1",
    platform: "linux-x64",
    file: "dist/agent-hub-demo-linux-x64",
    sha256: digest,
    runtimeDependencies: [],
  });
  return { file, metadata };
}

function sourceCoordinate() {
  return {
    schema: "buildchain.github-artifact-coordinate-set/v1",
    repository: "kungfu-systems/agent-hub-demo",
    runId: "42",
    runAttempt: "1",
    sourceSha: SOURCE_SHA,
    artifacts: [{
      platformId: "linux-x64", id: "101", name: `agent-hub-demo-linux-x64-${SOURCE_SHA}`,
      digest: `sha256:${"b".repeat(64)}`,
      url: "https://github.com/kungfu-systems/agent-hub-demo/actions/runs/42/artifacts/101",
      expiresAt: "2026-08-12T00:00:00.000Z",
    }],
  };
}

function gateCoordinate() {
  return {
    schema: "buildchain.github-artifact-coordinate/v1",
    repository: "kungfu-systems/agent-hub-demo", runId: "42", runAttempt: "1", sourceSha: SOURCE_SHA,
    id: "202", nodeId: "artifact-node", name: `agent-hub-demo-auditable-source-${SOURCE_SHA}`,
    digest: `sha256:${"c".repeat(64)}`, sizeInBytes: 1000,
    createdAt: "2026-08-02T00:00:00.000Z", expiresAt: "2026-08-12T00:00:00.000Z",
  };
}

function captureFixture(t) {
  const root = temporary(t);
  const sourceArtifact = path.join(root, "source-artifact");
  const output = path.join(root, "capture-source");
  const coordinate = path.join(root, "source-coordinate.json");
  fs.mkdirSync(sourceArtifact);
  fs.writeFileSync(path.join(sourceArtifact, "artifact.txt"), "same-run standalone binary artifact\n");
  writeJson(coordinate, sourceCoordinate());
  const binary = fakeBinary(sourceArtifact);
  const result = spawnSync("python3", [
    "scripts/capture-agent-hub-demo.py", "--binary", binary.file, "--binary-metadata", binary.metadata,
    "--demo-config", ".buildchain/auditable-demo.json",
    "--source-artifact", sourceArtifact, "--source-coordinate", coordinate, "--output", output,
  ], { cwd: path.resolve(import.meta.dirname, ".."), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return { root, output };
}

test("capture producer executes and verifies the standalone binary for both native renditions", PTY, (t) => {
  const { output } = captureFixture(t);
  const manifest = JSON.parse(fs.readFileSync(path.join(output, "manifest.json"), "utf8"));
  assert.equal(manifest.status, "passed");
  assert.equal(manifest.product.distribution, "standalone-binary");
  assert.deepEqual(manifest.product.runtimeDependencies, []);
  assert.deepEqual(manifest.renditions.map(({ columns, rows }) => [columns, rows]), [[150, 36], [100, 28]]);
  assert.notEqual(manifest.renditions[0].terminalCaptureRoot, manifest.renditions[1].terminalCaptureRoot);
  const bytes = fs.readFileSync(path.join(output, "renditions/1080p/terminal-capture.json"), "utf8");
  assert.match(bytes, /agent-hub-demo\.terminal-capture\/v1/u);
  assert.doesNotMatch(bytes, /agent-hub-demo-animation-/u);
  assert.equal(fs.existsSync(path.join(output, "renditions/1080p/agent-hub-demo-run")), false);
});

test("adapter projects the two exact binary captures and fails closed on drift", PTY, (t) => {
  const { root, output: captureSource } = captureFixture(t);
  const gate = path.join(root, "gate-coordinate.json");
  const output = path.join(root, "adapter-output");
  writeJson(gate, gateCoordinate());
  fs.mkdirSync(output);
  adapt({ artifactRoot: captureSource, output, sourceCoordinate: gate });
  const set = JSON.parse(fs.readFileSync(path.join(output, "rendition-set.json"), "utf8"));
  assert.deepEqual(set.renditions.map(({ id, role }) => [id, role]), [["1080p", "primary"], ["720p", "responsive"]]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(output, "scene.json"), "utf8")).width, 1920);
  assert.equal(JSON.parse(fs.readFileSync(path.join(output, "scene-720p.json"), "utf8")).width, 1280);
  assert.deepEqual(set.authority.grants, []);
  const summaryPath = path.join(captureSource, "renditions/720p/run-summary.json");
  const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  summary.results.fact = "rejected";
  writeJson(summaryPath, summary);
  assert.throws(() => adapt({ artifactRoot: captureSource, output: path.join(root, "tampered"), sourceCoordinate: gate }), /admitted deliveries/u);
});

test("adapter rejects a pre-populated output directory", PTY, (t) => {
  const { root, output: captureSource } = captureFixture(t);
  const gate = path.join(root, "gate-coordinate.json");
  const output = path.join(root, "adapter-output");
  writeJson(gate, gateCoordinate());
  fs.mkdirSync(output);
  fs.writeFileSync(path.join(output, "foreign.txt"), "not adapter output\n");
  assert.throws(() => adapt({ artifactRoot: captureSource, output, sourceCoordinate: gate }), /output must be empty/u);
});
