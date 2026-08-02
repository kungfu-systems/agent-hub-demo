import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildPassport, stableJson, verifyPassport } from "../scripts/auditable-demo-passport.mjs";
import { checkMaterialized, materialize } from "../scripts/materialize-auditable-demo.mjs";

const SOURCE_SHA = "a".repeat(40);
const BUILDCHAIN_SHA = "c".repeat(40);
const RENDERER = `ghcr.io/kungfu-systems/build-images/demo-renderer@sha256:${"d".repeat(64)}`;
const REPOSITORY = "kungfu-systems/agent-hub-demo";
const RUN_ID = "42";
const EXPIRY = "2026-08-12T00:00:00.000Z";

function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-hub-demo-publication-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, stableJson(value));
}

function artifact(id, name, digit) {
  return {
    id,
    name,
    digest: `sha256:${digit.repeat(64)}`,
    url: `https://github.com/${REPOSITORY}/actions/runs/${RUN_ID}/artifacts/${id}`,
    expiresAt: EXPIRY,
  };
}

function writeChecksums(root) {
  const names = fs.readdirSync(root).sort();
  const rows = names.map((name) => `${sha256(fs.readFileSync(path.join(root, name))).slice(7)}  ${name}`);
  const bytes = `${rows.join("\n")}\n`;
  fs.writeFileSync(path.join(root, "checksums.sha256"), bytes);
  return sha256(bytes);
}

function createBundles(root) {
  const gate = path.join(root, "gate");
  const media = path.join(root, "media");
  fs.mkdirSync(gate);
  fs.mkdirSync(media);
  const sourceArtifact = artifact("101", "agent-hub-demo-linux-x64", "1");
  const captureArtifact = artifact("202", "agent-hub-demo-auditable-source", "2");
  const gateArtifact = artifact("303", "auditable-demo-gate", "3");
  const mediaArtifact = artifact("404", "auditable-demo-media", "4");
  const primaryCapture = `sha256:${"5".repeat(64)}`;
  const responsiveCapture = `sha256:${"6".repeat(64)}`;
  const gateReceipt = {
    schema: "buildchain.auditable-demo-gate/v1",
    status: "passed",
    sourceRepository: REPOSITORY,
    sourceSha: SOURCE_SHA,
    sourceArtifact: {
      id: captureArtifact.id,
      name: captureArtifact.name,
      digest: captureArtifact.digest,
      runId: RUN_ID,
      expiresAt: EXPIRY,
    },
    adapter: { path: "scripts/auditable-demo-adapter.mjs", sha256: `sha256:${"7".repeat(64)}`, argumentsRoot: `sha256:${"8".repeat(64)}` },
    renderer: { image: RENDERER, mediaProfile: "responsive-web-delivery-v1", mediaQualificationRoot: `sha256:${"9".repeat(64)}` },
    qualifiedInputs: {
      transcript: `sha256:${"a".repeat(64)}`,
      projection: `sha256:${"b".repeat(64)}`,
      scene: `sha256:${"c".repeat(64)}`,
      evidenceClass: "exact-agent-hub-demo-standalone-binary/v1",
      claimBoundary: "bounded fixture",
      renditionSet: {
        schema: "kungfu.auditable-demo.rendition-set/v1",
        root: `sha256:${"d".repeat(64)}`,
        renditions: [
          { id: "1080p", role: "primary", captureRoot: primaryCapture },
          { id: "720p", role: "responsive", captureRoot: responsiveCapture },
        ],
      },
    },
  };
  writeJson(path.join(gate, "gate-receipt.json"), gateReceipt);
  fs.writeFileSync(path.join(gate, "complete-transcript.txt"), "qualified\n");
  const gateRoot = writeChecksums(gate);

  const publicBytes = {
    "demo.gif": Buffer.from("gif fixture"),
    "demo.mp4": Buffer.from("1080p mp4 fixture"),
    "demo.webm": Buffer.from("1080p webm fixture"),
    "demo-720p.mp4": Buffer.from("720p mp4 fixture"),
    "demo-720p.webm": Buffer.from("720p webm fixture"),
    "poster.png": Buffer.from("poster fixture"),
  };
  for (const [name, bytes] of Object.entries(publicBytes)) fs.writeFileSync(path.join(media, name), bytes);
  const roles = [
    ["readme-compatibility", "demo.gif", "image/gif", 1280, 720],
    ["primary-video", "demo.mp4", "video/mp4", 1920, 1080],
    ["alternate-video", "demo.webm", "video/webm", 1920, 1080],
    ["responsive-primary-video", "demo-720p.mp4", "video/mp4", 1280, 720],
    ["responsive-alternate-video", "demo-720p.webm", "video/webm", 1280, 720],
    ["evidence-poster", "poster.png", "image/png", 1920, 1080],
  ].map(([role, file, mimeType, width, height]) => ({
    role,
    path: file,
    mimeType,
    width,
    height,
    bytes: publicBytes[file].length,
    root: sha256(publicBytes[file]),
  }));
  const qualificationBody = {
    schema: "buildchain.auditable-demo-media-qualification/v1",
    profile: { id: "responsive-web-delivery-v1" },
    renditions: roles,
  };
  const qualification = { ...qualificationBody, qualificationRoot: sha256(stableJson(qualificationBody)) };
  const mediaReceipt = {
    schema: "buildchain.auditable-demo-media/v2",
    status: "passed",
    sourceSha: SOURCE_SHA,
    qualifiedGateRoot: gateRoot,
    rendererImage: RENDERER,
    rendererManifestRoot: `sha256:${"e".repeat(64)}`,
    qualification,
    qualificationRoot: qualification.qualificationRoot,
  };
  writeJson(path.join(media, "gate-receipt.json"), gateReceipt);
  writeJson(path.join(media, "media-receipt.json"), mediaReceipt);
  writeJson(path.join(media, "manifest.json"), {
    schema: "build-images.auditable-demo-render/v1",
    renderer: { image: RENDERER },
    policy: { evidenceClass: "exact-agent-hub-demo-standalone-binary/v1", runtimeTextAuthority: "rendition-set.json" },
    inputs: {
      renditions: [
        { role: "primary", terminalCapture: { root: primaryCapture, dimensions: { columns: 150, rows: 36 } } },
        { role: "responsive", terminalCapture: { root: responsiveCapture, dimensions: { columns: 100, rows: 28 } } },
      ],
    },
    derivation: {
      policy: "independent-native-frame-sets/v1",
      sourceFrameSets: [
        { role: "primary", width: 1920, height: 1080, captureRoot: primaryCapture },
        { role: "responsive", width: 1280, height: 720, captureRoot: responsiveCapture },
      ],
    },
  });
  writeJson(path.join(media, "media-inspection.json"), { status: "passed" });
  writeJson(path.join(media, "media-probe.json"), { passed: true });
  writeJson(path.join(media, "public-projection.json"), { evidenceClass: "exact-agent-hub-demo-standalone-binary/v1" });
  writeJson(path.join(media, "scene.json"), { width: 1920, height: 1080 });
  fs.writeFileSync(path.join(media, "complete-transcript.txt"), "qualified\n");
  fs.writeFileSync(path.join(media, "renderer-checksums.sha256"), "fixture\n");
  const mediaRoot = writeChecksums(media);
  return { gate, media, gateRoot, mediaRoot, sourceArtifact, captureArtifact, gateArtifact, mediaArtifact, qualificationRoot: qualification.qualificationRoot };
}

function envFor(bundle) {
  const env = {
    GITHUB_REPOSITORY: REPOSITORY,
    GITHUB_RUN_ID: RUN_ID,
    GITHUB_RUN_ATTEMPT: "1",
    SOURCE_SHA,
    BUILDCHAIN_SHA,
    RENDERER_IMAGE: RENDERER,
    CAPTURE_ROOT: `sha256:${"f".repeat(64)}`,
    GATE_ROOT: bundle.gateRoot,
    MEDIA_ROOT: bundle.mediaRoot,
    MEDIA_PROFILE: "responsive-web-delivery-v1",
    MEDIA_QUALIFICATION_ROOT: bundle.qualificationRoot,
  };
  for (const [prefix, coordinate] of [
    ["SOURCE", bundle.sourceArtifact],
    ["CAPTURE", bundle.captureArtifact],
    ["GATE", bundle.gateArtifact],
    ["MEDIA", bundle.mediaArtifact],
  ]) {
    for (const [key, value] of Object.entries(coordinate)) {
      env[`${prefix}_ARTIFACT_${key === "expiresAt" ? "EXPIRES_AT" : key.toUpperCase()}`] = value;
    }
  }
  return env;
}

test("Release Passport binds exact artifacts and rejects authority drift", (t) => {
  const root = temporary(t);
  const bundle = createBundles(root);
  const passport = buildPassport(envFor(bundle));
  assert.equal(passport.media.status, "rendered");
  assert.equal(passport.capture.command, "agent-hub-demo demo --root ./agent-hub-demo-run --output ./agent-hub-demo-run/report.json --presentation");
  assert.deepEqual(passport.authority.grants, []);
  assert.equal(verifyPassport(passport), passport);
  const tampered = structuredClone(passport);
  tampered.authority.grants.push("implicit-system-access");
  assert.throws(() => verifyPassport(tampered), /root mismatch|authority boundary/u);
});

test("materializer publishes content-addressed media and a receipt-driven README block", (t) => {
  const root = temporary(t);
  const bundle = createBundles(root);
  const passport = buildPassport(envFor(bundle));
  const passportPath = path.join(root, "passport.json");
  const repo = path.join(root, "repo");
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, "README.md"), "# Agent Hub Demo\n\nIntro.\n\n## Quick start\n\nRun it.\n");
  writeJson(passportPath, passport);
  const evidence = materialize({ repoRoot: repo, passportPath, gateBundle: bundle.gate, mediaBundle: bundle.media });
  assert.equal(checkMaterialized(repo).evidenceRoot, evidence.evidenceRoot);
  const readme = fs.readFileSync(path.join(repo, "README.md"), "utf8");
  assert.match(readme, /agent-hub-demo demo --root \.\/agent-hub-demo-run/u);
  assert.match(readme, /1080p MP4/u);
  assert.match(readme, /720p WebM/u);
  assert.match(readme, /reduced-motion fallback/u);
  assert.match(readme, /does not certify production security/u);
  const evidenceDirectory = path.dirname(path.join(repo, evidence.passport.path));
  for (const name of ["demo.gif", "demo.mp4", "demo.webm", "demo-720p.mp4", "demo-720p.webm", "poster.png", "release-passport.json", "public-evidence.json"]) {
    assert.equal(fs.statSync(path.join(evidenceDirectory, name)).isFile(), true);
  }
});

test("workflow uses one shared manual and promotion path with immutable toolchain coordinates", () => {
  const workflow = fs.readFileSync(new URL("../.github/workflows/build.yml", import.meta.url), "utf8");
  assert.match(workflow, /auditable-demo-mode:[\s\S]*- gate[\s\S]*- full/u);
  assert.match(workflow, /build:\n    permissions:\n      actions: read\n      contents: read/u);
  assert.match(workflow, /uses: kungfu-systems\/buildchain\/\.github\/workflows\/build\.yml@v3/u);
  assert.doesNotMatch(workflow, /buildchain-ref:/u);
  assert.match(workflow, /github\.event_name == 'workflow_dispatch'[\s\S]*startsWith\(github\.base_ref, 'alpha\/'\)[\s\S]*startsWith\(github\.base_ref, 'release\/'\)/u);
  assert.match(workflow, /uses: kungfu-systems\/buildchain\/\.github\/workflows\/\.auditable-demo\.yml@9006e8e3714d9a318c971d39392b62958bb0b045/u);
  assert.match(workflow, /renderer-image: ghcr\.io\/kungfu-systems\/build-images\/demo-renderer@sha256:e5ae5002dc0fc267e265dba1068d7476e541dddc9035ccd72cee94dfad872591/u);
  assert.match(workflow, /source-artifact\/dist\/agent-hub-demo-linux-x64/u);
  assert.match(workflow, /binary-linux-x64\.json/u);
  assert.match(workflow, /\.buildchain\/auditable-demo\.json/u);
  assert.match(workflow, /capture-auditable-demo:[\s\S]*runs-on: ubuntu-24\.04[\s\S]*timeout-minutes: 10/u);
  assert.doesNotMatch(workflow, /Check out exact external|--kungfu|external-qualification-and-recording-tool/u);
  assert.match(workflow, /auditable-demo-passport:[\s\S]*needs: \[build, resolve-auditable-demo-source, capture-auditable-demo, auditable-demo\]/u);
});

test("repository invokes Buildchain v3 only", () => {
  const repositoryFiles = [
    ".github/workflows/build.yml",
    ".github/workflows/buildchain-ref-promotion.yml",
    ".github/workflows/verify.yml",
    ".buildchain/alpha-contract-lock.json",
    ".buildchain/contract-lock.json",
    ".buildchain/kfd/kfd-2/registry.json",
    "CONTRIBUTING.md",
    "README.md",
    "docs/RELEASE_QUALIFICATION.md",
    "docs/versioning.md",
    "scripts/qualify-passport.mjs",
    "scripts/qualify-release.mjs",
  ];
  const root = path.resolve(import.meta.dirname, "..");
  const retiredMajor = String(1 + 1);
  const retiredInvocation = new RegExp([
    `@kungfu-tech/buildchain@${retiredMajor}(?:\\.|\\b)`,
    `@v${retiredMajor}\\b`,
    `Buildchain v${retiredMajor}`,
    `"ref": "v${retiredMajor}(?:-alpha)?"`,
  ].join("|"), "u");
  for (const relative of repositoryFiles) {
    const content = fs.readFileSync(path.join(root, relative), "utf8");
    assert.doesNotMatch(content, retiredInvocation, relative);
  }
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, ".buildchain/contract-lock.json"), "utf8")).buildchain.majorLine, "v3");
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, ".buildchain/alpha-contract-lock.json"), "utf8")).buildchain.majorLine, "v3");
});
