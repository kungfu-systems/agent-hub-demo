#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const ID = /^[1-9][0-9]*$/u;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const ARTIFACT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/u;
const RENDERER = /^ghcr\.io\/kungfu-systems\/build-images\/demo-renderer@sha256:[0-9a-f]{64}$/u;
const COMMAND = "kungfu agent hub qualify --output-dir ./kungfu-agent-hub-check";
const BUILDCHAIN_WORKFLOW = "scripts/auditable-demo-adapter.mjs";
const REQUIRED_AUTHORIZATION_SOURCES = [
  "exact-release-passport",
  "core-policy",
  "work-or-warrant",
  "explicit-capability-grant",
  "runtime-isolation",
];
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
const CLAIMS = [
  "one exact installed Kungfu artifact passed its bundled offline 20-scenario Agent Hub qualification",
  "two independent native PTY captures passed the required Buildchain Gate",
];
const NON_CLAIMS = [
  "Agent Hub Demo KFD certification or authorization",
  "production security or fitness",
  "remote interoperability or external adoption",
  "authorization from identity, compliance, metadata, or generated evidence",
];

function fail(message) {
  throw new Error(`auditable demo passport: ${message}`);
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

export function stableJson(value) {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function required(env, name, pattern) {
  const value = env[name] || "";
  if (!value || (pattern && !pattern.test(value))) fail(`${name} is missing or invalid`);
  return value;
}

function exactIso(value, label) {
  const epoch = Date.parse(value || "");
  if (!Number.isFinite(epoch)) fail(`${label} is not an RFC3339 timestamp`);
  return new Date(epoch).toISOString();
}

function artifactFromEnv(env, prefix, repository, runId, requiredArtifact = true) {
  const values = {
    id: env[`${prefix}_ARTIFACT_ID`] || "",
    name: env[`${prefix}_ARTIFACT_NAME`] || "",
    digest: env[`${prefix}_ARTIFACT_DIGEST`] || "",
    url: env[`${prefix}_ARTIFACT_URL`] || "",
    expiresAt: env[`${prefix}_ARTIFACT_EXPIRES_AT`] || "",
  };
  const present = Object.values(values).filter(Boolean).length;
  if (!requiredArtifact && present === 0) return null;
  if (present !== 5) fail(`${prefix.toLowerCase()} artifact coordinate is partial`);
  if (!ID.test(values.id) || !ARTIFACT_NAME.test(values.name) || !DIGEST.test(values.digest)) {
    fail(`${prefix.toLowerCase()} artifact coordinate is invalid`);
  }
  const expectedUrl = `https://github.com/${repository}/actions/runs/${runId}/artifacts/${values.id}`;
  if (values.url !== expectedUrl) fail(`${prefix.toLowerCase()} artifact URL is not exact`);
  return { ...values, expiresAt: exactIso(values.expiresAt, `${prefix} expiry`) };
}

function verifyArtifact(value, repository, runId, label) {
  if (!value || typeof value !== "object") fail(`${label} artifact is missing`);
  if (!ID.test(value.id || "") || !ARTIFACT_NAME.test(value.name || "") || !DIGEST.test(value.digest || "")) {
    fail(`${label} artifact coordinate is invalid`);
  }
  if (value.url !== `https://github.com/${repository}/actions/runs/${runId}/artifacts/${value.id}`) {
    fail(`${label} artifact URL is not exact`);
  }
  if (exactIso(value.expiresAt, `${label} expiry`) !== value.expiresAt) {
    fail(`${label} artifact expiry is not normalized`);
  }
}

export function buildPassport(env = process.env) {
  const repository = required(env, "GITHUB_REPOSITORY", REPOSITORY);
  const runId = required(env, "GITHUB_RUN_ID", ID);
  const runAttempt = required(env, "GITHUB_RUN_ATTEMPT", ID);
  const sourceSha = required(env, "SOURCE_SHA", SHA);
  const kungfuSourceSha = required(env, "KUNGFU_SOURCE_SHA", SHA);
  const buildchainSha = required(env, "BUILDCHAIN_SHA", SHA);
  const rendererImage = required(env, "RENDERER_IMAGE", RENDERER);
  const captureRoot = required(env, "CAPTURE_ROOT", DIGEST);
  const gateRoot = required(env, "GATE_ROOT", DIGEST);
  const sourceArtifact = artifactFromEnv(env, "SOURCE", repository, runId);
  const captureArtifact = artifactFromEnv(env, "CAPTURE", repository, runId);
  const gateArtifact = artifactFromEnv(env, "GATE", repository, runId);
  const hasMedia = Boolean(env.MEDIA_ROOT || "");
  const mediaArtifact = artifactFromEnv(env, "MEDIA", repository, runId, hasMedia);
  const media = hasMedia
    ? {
        status: "rendered",
        root: required(env, "MEDIA_ROOT", DIGEST),
        profile: required(env, "MEDIA_PROFILE", /^responsive-web-delivery-v1$/u),
        qualificationRoot: required(env, "MEDIA_QUALIFICATION_ROOT", DIGEST),
        artifact: mediaArtifact,
      }
    : {
        status: "not-rendered",
        root: null,
        profile: "responsive-web-delivery-v1",
        qualificationRoot: null,
        artifact: null,
      };
  if (!hasMedia && ["MEDIA_PROFILE", "MEDIA_QUALIFICATION_ROOT"].some((name) => env[name])) {
    fail("media coordinate is partial");
  }
  const body = {
    schema: "agent-hub-demo.auditable-demo.release-passport/v1",
    status: "qualified",
    repository,
    workflow: {
      runId,
      runAttempt,
      url: `https://github.com/${repository}/actions/runs/${runId}`,
    },
    source: { sha: sourceSha, artifact: sourceArtifact },
    capture: {
      command: COMMAND,
      root: captureRoot,
      artifact: captureArtifact,
      kungfuSourceSha,
      renditionPolicy: "independent-native-pty-captures/v1",
    },
    gate: { status: "passed", root: gateRoot, artifact: gateArtifact },
    media,
    toolchain: {
      buildchainSha,
      rendererImage,
      adapterPath: BUILDCHAIN_WORKFLOW,
    },
    authority: {
      grants: [],
      evidenceClass: "exact-installed-kungfu-agent-hub-qualification/v1",
      claims: CLAIMS,
      nonClaims: NON_CLAIMS,
      authorization: {
        status: "not-granted-by-demo",
        requiredSources: REQUIRED_AUTHORIZATION_SOURCES,
        nonAuthorities: NON_AUTHORITIES,
      },
    },
  };
  const passport = { ...body, passportRoot: sha256(stableJson(body)) };
  verifyPassport(passport);
  return passport;
}

export function verifyPassport(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Passport must be an object");
  const { passportRoot, ...body } = value;
  if (passportRoot !== sha256(stableJson(body))) fail("Passport root mismatch");
  if (
    value.schema !== "agent-hub-demo.auditable-demo.release-passport/v1" ||
    value.status !== "qualified" ||
    !REPOSITORY.test(value.repository || "") ||
    !ID.test(value.workflow?.runId || "") ||
    !ID.test(value.workflow?.runAttempt || "") ||
    value.workflow?.url !== `https://github.com/${value.repository}/actions/runs/${value.workflow.runId}` ||
    !SHA.test(value.source?.sha || "") ||
    !SHA.test(value.capture?.kungfuSourceSha || "") ||
    value.capture?.command !== COMMAND ||
    value.capture?.renditionPolicy !== "independent-native-pty-captures/v1" ||
    !DIGEST.test(value.capture?.root || "") ||
    value.gate?.status !== "passed" ||
    !DIGEST.test(value.gate?.root || "") ||
    !SHA.test(value.toolchain?.buildchainSha || "") ||
    !RENDERER.test(value.toolchain?.rendererImage || "") ||
    value.toolchain?.adapterPath !== BUILDCHAIN_WORKFLOW
  ) {
    fail("Passport identity or toolchain fields are invalid");
  }
  for (const [label, artifact] of [
    ["source", value.source.artifact],
    ["capture", value.capture.artifact],
    ["Gate", value.gate.artifact],
  ]) {
    verifyArtifact(artifact, value.repository, value.workflow.runId, label);
  }
  if (value.media?.status === "rendered") {
    if (
      !DIGEST.test(value.media.root || "") ||
      value.media.profile !== "responsive-web-delivery-v1" ||
      !DIGEST.test(value.media.qualificationRoot || "")
    ) {
      fail("rendered media fields are invalid");
    }
    verifyArtifact(value.media.artifact, value.repository, value.workflow.runId, "media");
  } else if (
    value.media?.status !== "not-rendered" ||
    value.media.root !== null ||
    value.media.qualificationRoot !== null ||
    value.media.artifact !== null ||
    value.media.profile !== "responsive-web-delivery-v1"
  ) {
    fail("non-rendered media fields are invalid");
  }
  if (
    JSON.stringify(value.authority?.grants) !== "[]" ||
    value.authority?.evidenceClass !== "exact-installed-kungfu-agent-hub-qualification/v1" ||
    JSON.stringify(value.authority?.claims) !== JSON.stringify(CLAIMS) ||
    JSON.stringify(value.authority?.nonClaims) !== JSON.stringify(NON_CLAIMS) ||
    value.authority?.authorization?.status !== "not-granted-by-demo" ||
    JSON.stringify(value.authority?.authorization?.requiredSources) !== JSON.stringify(REQUIRED_AUTHORIZATION_SOURCES) ||
    JSON.stringify(value.authority?.authorization?.nonAuthorities) !== JSON.stringify(NON_AUTHORITIES)
  ) {
    fail("Passport authority boundary is invalid");
  }
  return value;
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
  if (command === "write" && values.size === 1 && values.has("--output")) {
    const output = path.resolve(values.get("--output"));
    fs.writeFileSync(output, stableJson(buildPassport()), { flag: "wx", mode: 0o644 });
    return;
  }
  if (command === "check" && values.size === 1 && values.has("--input")) {
    verifyPassport(JSON.parse(fs.readFileSync(path.resolve(values.get("--input")), "utf8")));
    return;
  }
  fail("usage: auditable-demo-passport.mjs write --output PATH | check --input PATH");
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] || "")).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
