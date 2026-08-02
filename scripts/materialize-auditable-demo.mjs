#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { stableJson, verifyPassport } from "./auditable-demo-passport.mjs";

const START = "<!-- agent-hub-demo:auditable-demo:start -->";
const END = "<!-- agent-hub-demo:auditable-demo:end -->";
const INSERT_BEFORE = "## Quick start";
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const MEDIA_MEMBERS = [
  "checksums.sha256",
  "complete-transcript.txt",
  "demo-720p.mp4",
  "demo-720p.webm",
  "demo.gif",
  "demo.mp4",
  "demo.webm",
  "gate-receipt.json",
  "manifest.json",
  "media-inspection.json",
  "media-probe.json",
  "media-receipt.json",
  "poster.png",
  "public-projection.json",
  "renderer-checksums.sha256",
  "scene.json",
];
const PUBLIC_MEDIA = [
  "demo.gif",
  "demo.mp4",
  "demo.webm",
  "demo-720p.mp4",
  "demo-720p.webm",
  "poster.png",
];
const REQUIRED_ROLES = new Map([
  ["readme-compatibility", ["demo.gif", "image/gif", 1280, 720]],
  ["primary-video", ["demo.mp4", "video/mp4", 1920, 1080]],
  ["alternate-video", ["demo.webm", "video/webm", 1920, 1080]],
  ["responsive-primary-video", ["demo-720p.mp4", "video/mp4", 1280, 720]],
  ["responsive-alternate-video", ["demo-720p.webm", "video/webm", 1280, 720]],
  ["evidence-poster", ["poster.png", "image/png", 1920, 1080]],
]);

function fail(message) {
  throw new Error(`auditable demo materializer: ${message}`);
}

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function regular(file, label, maximum = 64 * 1024 * 1024) {
  const metadata = fs.lstatSync(file);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > maximum) {
    fail(`${label} must be a bounded regular non-symlink file`);
  }
  return fs.readFileSync(file);
}

function json(file, label) {
  try {
    const value = JSON.parse(regular(file, label).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must contain an object`);
    return value;
  } catch (error) {
    if (error instanceof SyntaxError) fail(`${label} is invalid JSON`);
    throw error;
  }
}

function listFiles(root, prefix = "") {
  const entries = fs.readdirSync(path.join(root, prefix), { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "en"))) {
    const relative = path.join(prefix, entry.name);
    if (entry.isSymbolicLink()) fail(`bundle member is a symlink: ${relative}`);
    if (entry.isDirectory()) files.push(...listFiles(root, relative));
    else if (entry.isFile()) files.push(relative.split(path.sep).join("/"));
    else fail(`bundle member is not regular: ${relative}`);
  }
  return files;
}

function inside(root, relative, label) {
  if (typeof relative !== "string" || !relative || path.isAbsolute(relative) || relative.includes("\\")) {
    fail(`${label} is invalid`);
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relative);
  if (!resolved.startsWith(`${resolvedRoot}${path.sep}`)) fail(`${label} escapes its bundle`);
  return resolved;
}

function verifyChecksums(root, expectedRoot, exactMembers = null) {
  const bytes = regular(path.join(root, "checksums.sha256"), "bundle checksums");
  if (sha256(bytes) !== expectedRoot) fail("bundle root does not match its checksums");
  const text = bytes.toString("utf8");
  if (!text.endsWith("\n")) fail("bundle checksums must end with a newline");
  const declared = new Set();
  for (const row of text.slice(0, -1).split("\n").filter(Boolean)) {
    const match = /^([0-9a-f]{64})  ([A-Za-z0-9._/-]+)$/u.exec(row);
    if (!match || match[2] === "checksums.sha256" || declared.has(match[2])) fail(`invalid checksum row: ${row}`);
    const target = inside(root, match[2], "checksum member");
    if (sha256(regular(target, match[2])).slice(7) !== match[1]) fail(`checksum mismatch: ${match[2]}`);
    declared.add(match[2]);
  }
  const actual = listFiles(root).filter((name) => name !== "checksums.sha256");
  if (actual.length !== declared.size || actual.some((name) => !declared.has(name))) {
    fail("checksums do not cover every bundle member exactly once");
  }
  if (exactMembers && JSON.stringify(["checksums.sha256", ...actual].sort()) !== JSON.stringify([...exactMembers].sort())) {
    fail("media bundle member set is not exact");
  }
}

function verifyGateBundle(root, passport) {
  verifyChecksums(root, passport.gate.root);
  const receipt = json(path.join(root, "gate-receipt.json"), "Gate receipt");
  if (
    receipt.schema !== "buildchain.auditable-demo-gate/v1" ||
    receipt.status !== "passed" ||
    receipt.sourceSha !== passport.source.sha ||
    receipt.sourceArtifact?.id !== passport.capture.artifact.id ||
    receipt.sourceArtifact?.name !== passport.capture.artifact.name ||
    receipt.sourceArtifact?.digest !== passport.capture.artifact.digest ||
    receipt.renderer?.image !== passport.toolchain.rendererImage ||
    receipt.renderer?.mediaProfile !== "responsive-web-delivery-v1" ||
    receipt.qualifiedInputs?.evidenceClass !== passport.authority.evidenceClass ||
    receipt.qualifiedInputs?.renditionSet?.schema !== "kungfu.auditable-demo.rendition-set/v1" ||
    !DIGEST.test(receipt.qualifiedInputs?.renditionSet?.root || "") ||
    !Array.isArray(receipt.qualifiedInputs?.renditionSet?.renditions) ||
    receipt.qualifiedInputs.renditionSet.renditions.length !== 2
  ) {
    fail("Gate receipt does not bind the exact capture, toolchain, and native renditions");
  }
  const renditions = receipt.qualifiedInputs.renditionSet.renditions;
  if (
    renditions[0]?.id !== "1080p" ||
    renditions[0]?.role !== "primary" ||
    renditions[1]?.id !== "720p" ||
    renditions[1]?.role !== "responsive" ||
    renditions[0]?.captureRoot === renditions[1]?.captureRoot
  ) {
    fail("Gate receipt native rendition identity is invalid");
  }
  return receipt;
}

function verifyMediaBundle(root, passport) {
  verifyChecksums(root, passport.media.root, MEDIA_MEMBERS);
  const receipt = json(path.join(root, "media-receipt.json"), "media receipt");
  if (
    receipt.schema !== "buildchain.auditable-demo-media/v2" ||
    receipt.status !== "passed" ||
    receipt.sourceSha !== passport.source.sha ||
    receipt.qualifiedGateRoot !== passport.gate.root ||
    receipt.rendererImage !== passport.toolchain.rendererImage ||
    receipt.qualification?.profile?.id !== passport.media.profile ||
    receipt.qualificationRoot !== passport.media.qualificationRoot ||
    receipt.qualification?.qualificationRoot !== receipt.qualificationRoot
  ) {
    fail("media receipt does not bind the Passport");
  }
  const { qualificationRoot, ...qualificationBody } = receipt.qualification;
  if (qualificationRoot !== sha256(stableJson(qualificationBody))) fail("media qualification root does not verify");
  const observed = new Map();
  for (const rendition of receipt.qualification.renditions || []) {
    if (observed.has(rendition.role) || !REQUIRED_ROLES.has(rendition.role)) fail("media role mapping is invalid");
    const [expectedPath, mimeType, width, height] = REQUIRED_ROLES.get(rendition.role);
    const bytes = regular(path.join(root, expectedPath), rendition.role);
    if (
      rendition.path !== expectedPath ||
      rendition.mimeType !== mimeType ||
      rendition.width !== width ||
      rendition.height !== height ||
      rendition.bytes !== bytes.length ||
      rendition.root !== sha256(bytes)
    ) {
      fail(`media role ${rendition.role} drifted`);
    }
    observed.set(rendition.role, rendition);
  }
  if (observed.size !== REQUIRED_ROLES.size) fail("media qualification does not cover every public rendition");
  const manifest = json(path.join(root, "manifest.json"), "renderer manifest");
  const inputs = manifest.inputs?.renditions;
  const frames = manifest.derivation?.sourceFrameSets;
  if (
    manifest.schema !== "build-images.auditable-demo-render/v1" ||
    manifest.renderer?.image !== passport.toolchain.rendererImage ||
    manifest.policy?.evidenceClass !== passport.authority.evidenceClass ||
    manifest.policy?.runtimeTextAuthority !== "rendition-set.json" ||
    manifest.derivation?.policy !== "independent-native-frame-sets/v1" ||
    !Array.isArray(inputs) ||
    inputs.length !== 2 ||
    inputs[0]?.role !== "primary" ||
    inputs[0]?.terminalCapture?.dimensions?.columns !== 150 ||
    inputs[0]?.terminalCapture?.dimensions?.rows !== 36 ||
    inputs[1]?.role !== "responsive" ||
    inputs[1]?.terminalCapture?.dimensions?.columns !== 100 ||
    inputs[1]?.terminalCapture?.dimensions?.rows !== 28 ||
    inputs[0]?.terminalCapture?.root === inputs[1]?.terminalCapture?.root ||
    !Array.isArray(frames) ||
    frames.length !== 2 ||
    frames[0]?.width !== 1920 ||
    frames[0]?.height !== 1080 ||
    frames[1]?.width !== 1280 ||
    frames[1]?.height !== 720 ||
    frames[0]?.captureRoot !== inputs[0]?.terminalCapture?.root ||
    frames[1]?.captureRoot !== inputs[1]?.terminalCapture?.root
  ) {
    fail("renderer manifest does not prove two independent native frame sets");
  }
  return { receipt, manifest };
}

function relative(directory, name) {
  return `${directory.split(path.sep).join("/")}/${name}`;
}

function buildEvidence(passport, mediaRoot, directory) {
  const files = Object.fromEntries(
    PUBLIC_MEDIA.map((name) => [name, { path: relative(directory, name), digest: sha256(regular(path.join(mediaRoot, name), name)) }]),
  );
  const body = {
    schema: "agent-hub-demo.auditable-demo.public-evidence/v1",
    status: "qualified",
    sourceSha: passport.source.sha,
    workflowUrl: passport.workflow.url,
    command: passport.capture.command,
    gate: passport.gate,
    media: passport.media,
    passport: {
      root: passport.passportRoot,
      path: relative(directory, "release-passport.json"),
    },
    toolchain: passport.toolchain,
    authority: passport.authority,
    renditionPolicy: passport.capture.renditionPolicy,
    files,
  };
  return { ...body, evidenceRoot: sha256(stableJson(body)) };
}

function verifyEvidence(value, repoRoot) {
  const { evidenceRoot, ...body } = value || {};
  if (
    evidenceRoot !== sha256(stableJson(body)) ||
    value.schema !== "agent-hub-demo.auditable-demo.public-evidence/v1" ||
    value.status !== "qualified" ||
    value.command !== "kungfu agent hub qualify --output-dir ./kungfu-agent-hub-check" ||
    !DIGEST.test(value.passport?.root || "") ||
    value.media?.status !== "rendered" ||
    value.renditionPolicy !== "independent-native-pty-captures/v1"
  ) {
    fail("public evidence is invalid");
  }
  const passportPath = inside(repoRoot, value.passport.path, "public Passport path");
  const passport = verifyPassport(json(passportPath, "public Release Passport"));
  if (passport.passportRoot !== value.passport.root || passport.source.sha !== value.sourceSha) {
    fail("public Passport does not bind the evidence");
  }
  for (const name of PUBLIC_MEDIA) {
    const entry = value.files?.[name];
    if (!entry || !DIGEST.test(entry.digest || "") || sha256(regular(inside(repoRoot, entry.path, name), name)) !== entry.digest) {
      fail(`public media drifted: ${name}`);
    }
  }
  const mediaReceipt = json(path.join(path.dirname(passportPath), "media-receipt.json"), "public media receipt");
  const gateReceipt = json(path.join(path.dirname(passportPath), "gate-receipt.json"), "public Gate receipt");
  if (
    mediaReceipt.status !== "passed" ||
    mediaReceipt.qualifiedGateRoot !== value.gate.root ||
    mediaReceipt.qualificationRoot !== value.media.qualificationRoot ||
    gateReceipt.status !== "passed" ||
    gateReceipt.sourceSha !== value.sourceSha
  ) {
    fail("public receipts do not bind the evidence");
  }
  return value;
}

export function renderReadmeBlock(evidence) {
  const root = path.posix.dirname(evidence.passport.path);
  const source = evidence.sourceSha.slice(0, 12);
  return [
    START,
    "## Auditable Agent Hub qualification",
    "",
    `[![Kungfu Agent Hub qualifier passing all 20 offline scenarios](${root}/demo.gif)](${root}/public-evidence.json)`,
    "",
    `Animation subject: \`${evidence.command}\``,
    "",
    `Native renditions: [1080p MP4](${root}/demo.mp4) · [1080p WebM](${root}/demo.webm) · [720p MP4](${root}/demo-720p.mp4) · [720p WebM](${root}/demo-720p.webm)`,
    "",
    `[Static poster / reduced-motion fallback](${root}/poster.png)`,
    "",
    "<details>",
    "<summary>Evidence and claim boundary</summary>",
    "",
    "This animation records one exact installed Kungfu artifact running its bundled,",
    "offline 20-scenario Agent Hub qualification in isolated homes. The 1080p and",
    "720p videos come from independent native PTY captures, not a scaled recording.",
    "It validates the recording pipeline; it does not certify or authorize Agent Hub",
    "Demo, prove production security, or grant permission from first-party/System",
    "identity, KFD compliance, Product System metadata, package metadata, registry",
    "history, scan output, or standalone generation.",
    "",
    `[Source \`${source}\`](https://github.com/kungfu-systems/agent-hub-demo/commit/${evidence.sourceSha}) · [workflow run](${evidence.workflowUrl}) · [Gate artifact](${evidence.gate.artifact.url}) · [media artifact](${evidence.media.artifact.url}) · [Release Passport](${root}/release-passport.json) · [public evidence](${root}/public-evidence.json)`,
    "",
    "</details>",
    END,
  ].join("\n");
}

function updateReadme(readme, evidence) {
  const block = renderReadmeBlock(evidence);
  const start = readme.indexOf(START);
  const end = readme.indexOf(END);
  if ((start >= 0) !== (end >= 0) || (start >= 0 && end < start)) fail("README managed markers are malformed");
  if (start >= 0) {
    if (readme.indexOf(START, start + START.length) >= 0) fail("README managed block is duplicated");
    return `${readme.slice(0, start)}${block}${readme.slice(end + END.length)}`;
  }
  const insertion = readme.indexOf(INSERT_BEFORE);
  if (insertion < 0) fail(`README insertion heading is missing: ${INSERT_BEFORE}`);
  return `${readme.slice(0, insertion)}${block}\n\n${readme.slice(insertion)}`;
}

function writeExclusiveOrEqual(file, bytes, label) {
  if (fs.existsSync(file)) {
    if (!regular(file, label).equals(bytes)) fail(`${label} already exists with different bytes`);
    return;
  }
  fs.writeFileSync(file, bytes, { flag: "wx", mode: 0o644 });
}

export function materialize({ repoRoot, passportPath, gateBundle, mediaBundle }) {
  const root = path.resolve(repoRoot);
  const passport = verifyPassport(json(path.resolve(passportPath), "Release Passport"));
  if (passport.media.status !== "rendered") fail("Release Passport has no rendered media");
  const gateReceipt = verifyGateBundle(path.resolve(gateBundle), passport);
  const { receipt: mediaReceipt } = verifyMediaBundle(path.resolve(mediaBundle), passport);
  const directory = `docs/evidence/auditable-demo/${passport.passportRoot.slice(7)}`;
  const destination = path.resolve(root, directory);
  if (!destination.startsWith(`${root}${path.sep}`)) fail("content-addressed destination escapes the repository");
  fs.mkdirSync(destination, { recursive: true });
  for (const name of PUBLIC_MEDIA) {
    writeExclusiveOrEqual(path.join(destination, name), regular(path.join(mediaBundle, name), name), name);
  }
  writeExclusiveOrEqual(path.join(destination, "gate-receipt.json"), Buffer.from(stableJson(gateReceipt)), "Gate receipt");
  writeExclusiveOrEqual(path.join(destination, "media-receipt.json"), Buffer.from(stableJson(mediaReceipt)), "media receipt");
  writeExclusiveOrEqual(path.join(destination, "release-passport.json"), Buffer.from(stableJson(passport)), "Release Passport");
  const evidence = buildEvidence(passport, path.resolve(mediaBundle), directory);
  writeExclusiveOrEqual(path.join(destination, "public-evidence.json"), Buffer.from(stableJson(evidence)), "public evidence");
  const readmePath = path.join(root, "README.md");
  const currentReadme = regular(readmePath, "README", 4 * 1024 * 1024).toString("utf8");
  fs.writeFileSync(readmePath, updateReadme(currentReadme, evidence));
  verifyEvidence(evidence, root);
  return evidence;
}

function discoverEvidence(repoRoot) {
  const base = path.join(repoRoot, "docs/evidence/auditable-demo");
  if (!fs.existsSync(base)) fail("no materialized auditable demo evidence exists");
  const files = [];
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    if (entry.isDirectory() && /^[0-9a-f]{64}$/u.test(entry.name)) {
      const candidate = path.join(base, entry.name, "public-evidence.json");
      if (fs.existsSync(candidate)) files.push(candidate);
    }
  }
  if (files.length !== 1) fail(`expected one materialized public evidence file, found ${files.length}`);
  return files[0];
}

export function checkMaterialized(repoRoot) {
  const root = path.resolve(repoRoot);
  const evidence = verifyEvidence(json(discoverEvidence(root), "public evidence"), root);
  const readme = regular(path.join(root, "README.md"), "README", 4 * 1024 * 1024).toString("utf8");
  if (!readme.includes(renderReadmeBlock(evidence))) fail("README managed block drifted from public evidence");
  return evidence;
}

function parse(argv) {
  const [command, ...rest] = argv;
  const values = new Map();
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key?.startsWith("--") || value === undefined || values.has(key)) fail("invalid arguments");
    values.set(key, value);
  }
  return { command, values };
}

function main() {
  const { command, values } = parse(process.argv.slice(2));
  if (command === "update" && ["--repo-root", "--passport", "--gate-bundle", "--media-bundle"].every((key) => values.has(key)) && values.size === 4) {
    process.stdout.write(stableJson(materialize({
      repoRoot: values.get("--repo-root"),
      passportPath: values.get("--passport"),
      gateBundle: values.get("--gate-bundle"),
      mediaBundle: values.get("--media-bundle"),
    })));
    return;
  }
  if (command === "check" && values.size === 1 && values.has("--repo-root")) {
    process.stdout.write(stableJson({ status: "qualified", evidenceRoot: checkMaterialized(values.get("--repo-root")).evidenceRoot }));
    return;
  }
  fail("usage: materialize-auditable-demo.mjs update --repo-root PATH --passport PATH --gate-bundle PATH --media-bundle PATH | check --repo-root PATH");
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] || "")).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
