import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const repositoryRoot = resolve(import.meta.dirname, "..");
const publishScript = resolve(repositoryRoot, "scripts/write-publish-evidence.mjs");
const platforms = [
  { artifact: "linux-x64", target: "linux-x64", extension: "" },
  { artifact: "macos", target: "macos-arm64", extension: "" },
  { artifact: "windows-x64", target: "windows-x64", extension: ".exe" },
];

function write(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}

function writeJson(path, value) {
  write(path, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

test("publish evidence pairs platform KFD witnesses with exact public assets", () => {
  const cwd = mkdtempSync(join(tmpdir(), "agent-hub-publish-evidence-"));
  const payloadRoot = resolve(cwd, ".buildchain/release-candidate/payloads");
  const manifest = '{"version":"0.2.0-alpha.1"}\n';

  for (const { artifact, target, extension } of platforms) {
    const payload = resolve(payloadRoot, `agent-hub-demo-${artifact}-fixture`);
    const binaryName = `agent-hub-demo-${target}${extension}`;
    const binary = Buffer.from(`binary:${target}`);
    const binarySha256 = sha256(binary);
    write(resolve(payload, "dist/agent-hub-demo.json"), manifest);
    write(resolve(payload, `dist/${binaryName}`), binary);
    write(resolve(payload, `dist/${binaryName}.sha256`), `${binarySha256}  ${binaryName}\n`);
    writeJson(resolve(payload, ".buildchain/platform-signing-policy.json"), {
      schemaVersion: 1,
      contract: "agent-hub-demo.platform-signing-policy/v1",
      platforms: { "windows-x64": { state: "unsigned-exception" } },
    });
    writeJson(resolve(payload, `.buildchain/artifacts/binary-${target}.json`), {
      target,
      sha256: binarySha256,
    });
    writeJson(resolve(payload, ".buildchain/release-qualification/kfd-1-witness.json"), {
      id: "agent-hub-demo-product-artifact",
      standard: "kfd-1",
      contractWorld: { id: "agent-hub-demo-product-artifact" },
      surfaces: [
        {
          name: "agent-hub-demo.json",
          artifactPath: "agent-hub-demo.json",
          expectedSha256: sha256(manifest),
        },
        {
          name: binaryName,
          artifactPath: binaryName,
          expectedSha256: binarySha256,
        },
      ],
    });
    const collaborationInterfaceDigest = `sha256:${sha256(`interface:${target}`)}`;
    const kfd3 = {
      id: "kfd-3-surface-registry",
      standard: "kfd-3",
      collaborationInterfaceDigest,
      surfaces: [{ id: "cli:agent-hub-demo", state: "shipped" }],
    };
    writeJson(resolve(payload, ".buildchain/release-qualification/kfd-3-prebuild.json"), kfd3);
    writeJson(resolve(payload, ".buildchain/release-qualification/kfd-3-artifact.json"), {
      ...kfd3,
      exposedSurfaces: [{ id: "cli:agent-hub-demo", state: "shipped" }],
      artifact: { name: binaryName, path: `dist/${binaryName}`, sha256: binarySha256 },
    });
  }

  const linuxPayload = resolve(payloadRoot, "agent-hub-demo-linux-x64-fixture");
  writeJson(resolve(linuxPayload, ".buildchain/kfd/kfd-2/claims/first-party-clean-room-structural-independence.json"), {
    id: "claim",
  });
  for (const path of [
    ".buildchain/artifacts/kfd-agent-hub/adoption-lock.json",
    ".buildchain/artifacts/kfd-agent-hub/evidence.json",
    ".buildchain/artifacts/kfd-agent-hub/report.json",
    ".buildchain/artifacts/kfd-agent-hub/verification.json",
    ".buildchain/release-qualification/kfd-1-gate-section.json",
    ".buildchain/release-qualification/qualification-report.json",
  ]) {
    writeJson(resolve(linuxPayload, path), { path });
  }

  const result = spawnSync(process.execPath, [publishScript], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      BUILDCHAIN_VERSION: "0.2.0-alpha.2",
      BUILDCHAIN_CHANNEL: "alpha",
      BUILDCHAIN_SOURCE_SHA: "a".repeat(40),
      BUILDCHAIN_TARGET_REF: "alpha/v0/v0.2",
      BUILDCHAIN_RELEASE_SHA: "b".repeat(40),
      BUILDCHAIN_RELEASE_MATERIAL_SHA: "c".repeat(40),
      BUILDCHAIN_PUBLISH_TOOLING_SHA: "d".repeat(40),
      BUILDCHAIN_PUBLISH_EVIDENCE: ".buildchain/release-evidence/v0.2.0-alpha.2/evidence.json",
    },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  for (const { target, extension } of platforms) {
    const binaryName = `agent-hub-demo-${target}${extension}`;
    const kfd1 = JSON.parse(readFileSync(
      resolve(cwd, `.buildchain/release-inputs/kfd-1-witness-${target}.json`),
      "utf8",
    ));
    const prebuild = JSON.parse(readFileSync(
      resolve(cwd, `.buildchain/release-inputs/kfd-3-prebuild-${target}.json`),
      "utf8",
    ));
    const artifact = JSON.parse(readFileSync(
      resolve(cwd, `.buildchain/release-inputs/kfd-3-artifact-${target}.json`),
      "utf8",
    ));
    assert.equal(kfd1.id, `agent-hub-demo-product-artifact-${target}`);
    assert.deepEqual(
      kfd1.surfaces.map((surface) => surface.artifactPath),
      target === "linux-x64"
        ? [
            ".buildchain/release-passport/agent-hub-demo.json",
            `.buildchain/release-passport/${binaryName}`,
          ]
        : [`.buildchain/release-passport/${binaryName}`],
    );
    assert.ok(kfd1.surfaces.every((surface) => surface.sourcePath === ""));
    assert.ok(kfd1.surfaces.every((surface) => surface.sourceSha256 === ""));
    assert.equal(prebuild.id, `kfd-3-surface-registry-${target}`);
    assert.equal(artifact.id, prebuild.id);
    assert.equal(artifact.collaborationInterfaceDigest, prebuild.collaborationInterfaceDigest);
    assert.equal(
      artifact.artifact.path,
      `.buildchain/release-passport/${binaryName}`,
    );
  }
  assert.equal(
    JSON.parse(readFileSync(
      resolve(cwd, ".buildchain/release-passport/platform-signing-policy.json"),
      "utf8",
    )).platforms["windows-x64"].state,
    "unsigned-exception",
  );
});
