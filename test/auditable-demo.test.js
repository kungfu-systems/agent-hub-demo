import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { adapt } from "../scripts/auditable-demo-adapter.mjs";

const SOURCE_SHA = "a".repeat(40);
const PTY_CAPTURE_TEST = process.platform === "win32"
  ? { skip: "the auditable-demo capture producer uses a Linux/macOS PTY" }
  : {};

function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-hub-demo-animation-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function fakeKungfu(root) {
  const file = path.join(root, "kungfu");
  fs.writeFileSync(
    file,
    `#!/usr/bin/env python3
import json
import os
import sys

args = sys.argv[1:]
if args[:3] == ["agent", "hub", "qualify"]:
    output = args[args.index("--output-dir") + 1]
    os.makedirs(output)
    payload = {
        "schema": "kungfu.kfd-agent-hub-qualification/v1",
        "valid": True,
        "result": "pass",
        "product": {
            "name": "Kungfu Work",
            "version": "4.0.0-alpha.1",
            "executable": os.path.abspath(sys.argv[0]),
            "artifactDigest": "sha256:" + "1" * 64,
            "buildInfoDigest": "sha256:" + "2" * 64,
            "sourceCommit": "${SOURCE_SHA}",
            "platform": {"os": "linux", "arch": "x86_64"},
            "provenance": "installed-product",
        },
        "kfd": {"package": "@kungfu-tech/kfd", "version": "1.0.0-alpha.47", "profile": "agent-hub", "suite": "hub-20", "offline": True},
        "testedResponsibilities": ["two rooted hubs"],
        "coverage": {"passed": 20, "total": 20},
        "meaning": "bounded local qualification",
        "nonClaims": ["production fitness"],
        "isolation": {"topology": "two-isolated-local-peer-authority-domains", "realHomeUnchanged": True},
        "evidence": {"directory": os.path.abspath(output), "reportDigest": "sha256:" + "3" * 64, "verificationDigest": "sha256:" + "4" * 64},
        "next": {"verify": "kungfu agent hub verify"},
    }
    with open(os.path.join(output, "qualification.json"), "w", encoding="utf-8") as handle:
        json.dump(payload, handle)
    print("\\x1b[32mKFD Agent Hub Qualification  PASSED\\x1b[0m")
    print("20 of 20 scenarios passed")
    print("Evidence: " + os.path.abspath(output))
    raise SystemExit(0)
if args[:3] == ["agent", "hub", "verify"]:
    print(json.dumps({
        "schema": "kungfu.kfd-agent-hub-qualification-verification/v1",
        "valid": True,
        "result": "pass",
        "checks": [{"id": "report-root", "passed": True}, {"id": "offline-verifier", "passed": True}],
    }))
    raise SystemExit(0)
raise SystemExit(2)
`,
  );
  fs.chmodSync(file, 0o755);
  return file;
}

function sourceCoordinate() {
  return {
    schema: "buildchain.github-artifact-coordinate-set/v1",
    repository: "kungfu-systems/agent-hub-demo",
    runId: "42",
    runAttempt: "1",
    sourceSha: SOURCE_SHA,
    artifacts: [
      {
        platformId: "linux-x64",
        id: "101",
        name: `agent-hub-demo-linux-x64-${SOURCE_SHA}`,
        digest: `sha256:${"b".repeat(64)}`,
        url: "https://github.com/kungfu-systems/agent-hub-demo/actions/runs/42/artifacts/101",
        expiresAt: "2026-08-12T00:00:00.000Z",
      },
    ],
  };
}

function gateCoordinate() {
  return {
    schema: "buildchain.github-artifact-coordinate/v1",
    repository: "kungfu-systems/agent-hub-demo",
    runId: "42",
    runAttempt: "1",
    sourceSha: SOURCE_SHA,
    id: "202",
    nodeId: "artifact-node",
    name: `agent-hub-demo-auditable-source-${SOURCE_SHA}`,
    digest: `sha256:${"c".repeat(64)}`,
    sizeInBytes: 1000,
    createdAt: "2026-08-02T00:00:00.000Z",
    expiresAt: "2026-08-12T00:00:00.000Z",
  };
}

test("capture producer runs exact argv, verifies evidence, and emits native captures", PTY_CAPTURE_TEST, (t) => {
  const root = temporary(t);
  const sourceArtifact = path.join(root, "source-artifact");
  const output = path.join(root, "capture-source");
  const coordinate = path.join(root, "source-coordinate.json");
  fs.mkdirSync(sourceArtifact);
  fs.writeFileSync(path.join(sourceArtifact, "artifact.txt"), "agent hub demo artifact\n");
  writeJson(coordinate, sourceCoordinate());
  const result = spawnSync(
    "python3",
    [
      "scripts/capture-kungfu-agent-hub-demo.py",
      "--kungfu",
      fakeKungfu(root),
      "--kungfu-source-sha",
      SOURCE_SHA,
      "--source-artifact",
      sourceArtifact,
      "--source-coordinate",
      coordinate,
      "--output",
      output,
    ],
    { cwd: path.resolve(import.meta.dirname, ".."), encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(output, "manifest.json"), "utf8"));
  assert.equal(manifest.status, "qualified");
  assert.deepEqual(
    manifest.renditions.map(({ columns, rows }) => [columns, rows]),
    [[150, 36], [100, 28]],
  );
  assert.notEqual(manifest.renditions[0].terminalCaptureRoot, manifest.renditions[1].terminalCaptureRoot);
  const bytes = fs.readFileSync(path.join(output, "renditions/1080p/terminal-capture.json"), "utf8");
  assert.match(bytes, /kungfu\.kfd-agent-hub-qualification\/v1/u);
  assert.doesNotMatch(bytes, /agent-hub-demo-animation-/u);
  assert.equal(fs.existsSync(path.join(output, "renditions/1080p/kungfu-agent-hub-check")), false);
});

test("adapter projects two exact Buildchain renditions and fails closed on drift", PTY_CAPTURE_TEST, (t) => {
  const root = temporary(t);
  const sourceArtifact = path.join(root, "source-artifact");
  const captureSource = path.join(root, "capture-source");
  const coordinate = path.join(root, "source-coordinate.json");
  const gate = path.join(root, "gate-coordinate.json");
  const output = path.join(root, "adapter-output");
  fs.mkdirSync(sourceArtifact);
  fs.writeFileSync(path.join(sourceArtifact, "artifact.txt"), "agent hub demo artifact\n");
  writeJson(coordinate, sourceCoordinate());
  writeJson(gate, gateCoordinate());
  const capture = spawnSync(
    "python3",
    ["scripts/capture-kungfu-agent-hub-demo.py", "--kungfu", fakeKungfu(root), "--kungfu-source-sha", SOURCE_SHA, "--source-artifact", sourceArtifact, "--source-coordinate", coordinate, "--output", captureSource],
    { cwd: path.resolve(import.meta.dirname, ".."), encoding: "utf8" },
  );
  assert.equal(capture.status, 0, capture.stderr);
  adapt({ artifactRoot: captureSource, output, sourceCoordinate: gate });
  const renditionSet = JSON.parse(fs.readFileSync(path.join(output, "rendition-set.json"), "utf8"));
  assert.deepEqual(renditionSet.renditions.map(({ id, role }) => [id, role]), [["1080p", "primary"], ["720p", "responsive"]]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(output, "scene.json"), "utf8")).width, 1920);
  assert.equal(JSON.parse(fs.readFileSync(path.join(output, "scene-720p.json"), "utf8")).width, 1280);
  assert.deepEqual(renditionSet.authority.grants, []);

  const qualificationPath = path.join(captureSource, "renditions/720p/qualification-summary.json");
  const qualification = JSON.parse(fs.readFileSync(qualificationPath, "utf8"));
  qualification.coverage.passed = 19;
  writeJson(qualificationPath, qualification);
  assert.throws(
    () => adapt({ artifactRoot: captureSource, output: path.join(root, "tampered"), sourceCoordinate: gate }),
    /not 20\/20/u,
  );
});
