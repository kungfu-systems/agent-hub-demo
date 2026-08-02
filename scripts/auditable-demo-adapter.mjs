#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const NON_AUTHORITIES = [
  "first-party-identity",
  "system-identity",
  "kfd-compliance",
  "product-system-metadata",
  "package-metadata",
  "registry-history",
  "scan-output",
  "standalone-generation",
];
const RENDITION_NON_AUTHORITIES = [
  "publication-authority",
  "runtime-authority",
  ...NON_AUTHORITIES,
];

function fail(message) {
  throw new Error(`auditable demo adapter: ${message}`);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function stableJson(value) {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}

function rootBytes(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function rootJson(value) {
  return rootBytes(Buffer.from(stableJson(value)));
}

function regular(file, label, maximum = 8 * 1024 * 1024) {
  const metadata = fs.lstatSync(file);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > maximum) {
    fail(`${label} must be a bounded regular file`);
  }
  return fs.readFileSync(file);
}

function readJson(file, label) {
  try {
    const value = JSON.parse(regular(file, label).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must contain an object`);
    return value;
  } catch (error) {
    if (error instanceof SyntaxError) fail(`${label} is invalid JSON`);
    throw error;
  }
}

function requireValue(condition, message) {
  if (!condition) fail(message);
}

function prepareOutput(output) {
  if (!fs.existsSync(output)) {
    fs.mkdirSync(output);
    return;
  }
  const metadata = fs.lstatSync(output);
  requireValue(metadata.isDirectory() && !metadata.isSymbolicLink(), "adapter output must be a directory");
  requireValue(fs.readdirSync(output).length === 0, "adapter output must be empty");
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    requireValue(key?.startsWith("--") && value !== undefined && !(key in values), `invalid argument near ${key || "<empty>"}`);
    values[key] = value;
  }
  for (const key of ["--artifact-root", "--output", "--source-coordinate"]) {
    requireValue(values[key], `${key} is required`);
  }
  return values;
}

function inside(root, relative, label) {
  requireValue(typeof relative === "string" && relative.length > 0 && !path.isAbsolute(relative), `${label} is invalid`);
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relative);
  requireValue(resolved.startsWith(`${resolvedRoot}${path.sep}`), `${label} escapes the artifact`);
  return resolved;
}

function validateRunSummary(value, label) {
  requireValue(value.schema === "agent-hub-demo.capture-summary/v1", `${label} schema mismatch`);
  requireValue(value.status === "passed" && DIGEST.test(value.reportRoot || ""), `${label} did not pass`);
  requireValue(value.results?.fact === "admitted" && value.results?.episode === "admitted", `${label} admitted deliveries are missing`);
  requireValue(value.results?.conflict === "conflicted", `${label} visible conflict is missing`);
  for (const name of ["amplification", "expired", "revoked", "unknownFeature", "disclosureConflation"]) {
    requireValue(value.results?.[name] === "rejected", `${label} ${name} rejection is missing`);
  }
  requireValue(value.duplicateIdempotent === true && value.driftRejected === true && value.recoveredObjects > 0, `${label} recovery boundary failed`);
}

function validateCapture(value, descriptor, label) {
  requireValue(value.schema === "agent-hub-demo.terminal-capture/v1", `${label} schema mismatch`);
  requireValue(value.command === "agent-hub-demo demo --root ./agent-hub-demo-run --output ./agent-hub-demo-run/report.json --presentation", `${label} command mismatch`);
  requireValue(value.dimensions?.columns === descriptor.columns && value.dimensions?.rows === descriptor.rows, `${label} dimensions mismatch`);
  requireValue(value.completion?.schema === "agent-hub-demo.capture-summary/v1" && value.completion?.status === "passed" && DIGEST.test(value.completion?.summaryRoot || ""), `${label} completion mismatch`);
  requireValue(value.completion.summaryRoot === descriptor.runSummaryRoot, `${label} completion root mismatch`);
  requireValue(value.exitCode === 0, `${label} exit code mismatch`);
  requireValue(value.authority?.classification === "volatile-terminal-observation" && Array.isArray(value.authority?.grants) && value.authority.grants.length === 0, `${label} grants authority`);
  requireValue(JSON.stringify(value.authority?.nonAuthorities) === JSON.stringify(NON_AUTHORITIES), `${label} non-authority boundary mismatch`);
  requireValue(Array.isArray(value.events) && value.events.length === value.completion.eventCount, `${label} event count mismatch`);
  const bytes = value.events.reduce((total, event) => total + Buffer.from(event.data, "base64").length, 0);
  requireValue(bytes > 0 && bytes <= 4 * 1024 * 1024, `${label} byte bound mismatch`);
}

function projectTerminalCapture(capture) {
  return {
    schema: "kungfu.terminal-capture/v1",
    command: capture.command,
    dimensions: capture.dimensions,
    durationMs: capture.durationMs,
    encoding: capture.encoding,
    events: capture.events,
    completion: {
      schema: capture.completion.schema,
      status: "qualified",
      reportRoot: capture.completion.summaryRoot,
      eventCount: capture.completion.eventCount,
    },
    exitCode: capture.exitCode,
    authority: capture.authority,
  };
}

function writeRendition(output, artifactRoot, manifest, descriptor, role) {
  const label = `rendition ${descriptor.id}`;
  const summary = readJson(inside(artifactRoot, descriptor.runSummary, `${label} summary path`), `${label} summary`);
  const capture = readJson(inside(artifactRoot, descriptor.terminalCapture, `${label} capture path`), `${label} capture`);
  validateRunSummary(summary, label);
  validateCapture(capture, descriptor, label);
  requireValue(rootJson(summary) === descriptor.runSummaryRoot, `${label} summary root mismatch`);
  requireValue(rootJson(capture) === descriptor.terminalCaptureRoot, `${label} capture root mismatch`);

  const suffix = descriptor.id === "1080p" ? "" : "-720p";
  const transcriptName = `complete-transcript${suffix}.txt`;
  const projectionName = `public-projection${suffix}.json`;
  const sceneName = `scene${suffix}.json`;
  const captureName = `terminal-capture${suffix}.json`;
  const terminalCapture = projectTerminalCapture(capture);
  const transcript = [
    "$ agent-hub-demo demo --root ./agent-hub-demo-run --output ./agent-hub-demo-run/report.json --presentation",
    "Agent Hub Demo PASSED",
    "Fact and Episode delivery admitted; duplicate idempotent",
    "Semantic conflict visible; invalid authority rejected",
    "Export/import recovery verified; drifted bundle rejected",
    "Scope: one exact standalone Agent Hub Demo binary; no authorization or production certification",
  ].join("\n") + "\n";
  const durationMs = Math.min(60_000, capture.durationMs + 750);
  const scene = {
    schema: "build-images.demo-scene/v1",
    id: descriptor.id === "1080p" ? "agent-hub-qualification" : "agent-hub-qualification-720p",
    width: descriptor.id === "1080p" ? 1920 : 1280,
    height: descriptor.id === "1080p" ? 1080 : 720,
    fps: 15,
    durationMs,
    title: "Agent Hub Demo — standalone binary",
    commandLabel: manifest.command,
    background: "#0B1020",
    accent: "#67E8A5",
  };
  const projection = {
    schema: "build-images.demo-projection/v1",
    evidenceClass: "exact-agent-hub-demo-standalone-binary/v1",
    claimBoundary: "This presentation proves one exact same-run Agent Hub Demo standalone binary completed its deterministic local demonstration. It does not grant authorization, certify security, prove production fitness, remote interoperability, external adoption, or unobserved platforms.",
    cues: [{ startMs: 0, endMs: durationMs, transcriptLines: [1, 2, 3, 4, 5, 6], annotation: descriptor.id === "1080p" ? "native 150x36 capture" : "native 100x28 capture" }],
  };
  fs.writeFileSync(path.join(output, transcriptName), transcript);
  fs.writeFileSync(path.join(output, projectionName), stableJson(projection));
  fs.writeFileSync(path.join(output, sceneName), stableJson(scene));
  fs.writeFileSync(path.join(output, captureName), stableJson(terminalCapture));
  return {
    id: descriptor.id,
    role,
    transcript: transcriptName,
    projection: projectionName,
    scene: sceneName,
    terminalCapture: captureName,
    captureRoot: rootBytes(fs.readFileSync(path.join(output, captureName))),
  };
}

export function adapt({ artifactRoot, output, sourceCoordinate }) {
  const manifest = readJson(path.join(artifactRoot, "manifest.json"), "capture source manifest");
  const coordinate = readJson(sourceCoordinate, "Gate source coordinate");
  const originalCoordinate = readJson(path.join(artifactRoot, "source-coordinate.json"), "original source coordinate");
  requireValue(manifest.schema === "agent-hub-demo.auditable-demo-source/v1" && manifest.status === "passed", "capture source manifest mismatch");
  const { root, ...manifestBody } = manifest;
  requireValue(root === rootJson(manifestBody), "capture source manifest root mismatch");
  requireValue(manifest.sourceCoordinateRoot === rootJson(originalCoordinate), "original source coordinate root mismatch");
  requireValue(coordinate.sourceSha === originalCoordinate.sourceSha, "Gate and original source SHA differ");
  requireValue(manifest.product?.name === "agent-hub-demo" && manifest.product?.distribution === "standalone-binary" && JSON.stringify(manifest.product?.runtimeDependencies) === "[]", "standalone product boundary mismatch");
  requireValue(JSON.stringify(manifest.authority?.grants) === "[]", "capture source grants authority");
  requireValue(Array.isArray(manifest.renditions) && manifest.renditions.length === 2, "capture source must have two renditions");
  prepareOutput(output);
  const primary = writeRendition(output, artifactRoot, manifest, manifest.renditions[0], "primary");
  const responsive = writeRendition(output, artifactRoot, manifest, manifest.renditions[1], "responsive");
  requireValue(primary.id === "1080p" && responsive.id === "720p" && primary.captureRoot !== responsive.captureRoot, "native rendition roots are invalid");
  const renditionSet = {
    schema: "kungfu.auditable-demo.rendition-set/v1",
    renditions: [primary, responsive],
    authority: {
      classification: "capture-routing-metadata",
      grants: [],
      nonAuthorities: RENDITION_NON_AUTHORITIES,
    },
  };
  fs.writeFileSync(path.join(output, "rendition-set.json"), stableJson(renditionSet));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  adapt({
    artifactRoot: path.resolve(args["--artifact-root"]),
    output: path.resolve(args["--output"]),
    sourceCoordinate: path.resolve(args["--source-coordinate"]),
  });
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
