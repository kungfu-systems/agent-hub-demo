import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

const root = process.cwd();
const payloadRoot = resolve(root, ".buildchain/release-candidate/payloads");
const inputRoot = resolve(root, ".buildchain/release-inputs");
const passportRoot = resolve(root, ".buildchain/release-passport");

function filesUnder(directory) {
  const files = [];
  const visit = (path) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile()) files.push(child);
    }
  };
  visit(directory);
  return files;
}

function linuxPayloadFile(suffix) {
  const matches = filesUnder(payloadRoot).filter((path) =>
    path.includes("agent-hub-demo-linux-x64-") && path.endsWith(suffix),
  );
  if (matches.length !== 1) {
    throw new Error(`expected one Linux release-candidate file ending ${suffix}, found ${matches.length}`);
  }
  return matches[0];
}

function copyInput(sourceSuffix, targetName) {
  const source = linuxPayloadFile(sourceSuffix);
  const target = resolve(inputRoot, targetName);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target);
  return target;
}

const product = copyInput("/dist/agent-hub-demo.json", "agent-hub-demo.json");
copyInput("/.buildchain/release-qualification/kfd-1-witness.json", "kfd-1-witness.json");
copyInput("/.buildchain/kfd/kfd-2/claims/first-party-clean-room-structural-independence.json", "kfd-2-claim.json");
copyInput("/.buildchain/release-qualification/kfd-3-prebuild.json", "kfd-3-prebuild.json");
copyInput("/.buildchain/release-qualification/kfd-3-artifact.json", "kfd-3-artifact.json");

mkdirSync(passportRoot, { recursive: true });
const publicAssets = [
  ["/dist/agent-hub-demo.json", "agent-hub-demo.json"],
  ["/.buildchain/artifacts/kfd-agent-hub/adoption-lock.json", "kfd-agent-hub-adoption-lock.json"],
  ["/.buildchain/artifacts/kfd-agent-hub/evidence.json", "kfd-agent-hub-evidence.json"],
  ["/.buildchain/artifacts/kfd-agent-hub/report.json", "kfd-agent-hub-report.json"],
  ["/.buildchain/artifacts/kfd-agent-hub/verification.json", "kfd-agent-hub-verification.json"],
  ["/.buildchain/release-qualification/kfd-1-witness.json", "kfd-1-witness.json"],
  ["/.buildchain/release-qualification/kfd-1-gate-section.json", "kfd-1-gate.json"],
  ["/.buildchain/release-qualification/kfd-3-prebuild.json", "kfd-3-prebuild.json"],
  ["/.buildchain/release-qualification/kfd-3-artifact.json", "kfd-3-artifact.json"],
  ["/.buildchain/release-qualification/qualification-report.json", "qualification-report.json"],
];
for (const [suffix, name] of publicAssets) {
  cpSync(linuxPayloadFile(suffix), resolve(passportRoot, name));
}

const digest = createHash("sha256").update(readFileSync(product)).digest("hex");
const required = [
  "BUILDCHAIN_VERSION",
  "BUILDCHAIN_CHANNEL",
  "BUILDCHAIN_SOURCE_SHA",
  "BUILDCHAIN_TARGET_REF",
  "BUILDCHAIN_RELEASE_SHA",
  "BUILDCHAIN_RELEASE_MATERIAL_SHA",
  "BUILDCHAIN_PUBLISH_TOOLING_SHA",
  "BUILDCHAIN_PUBLISH_EVIDENCE",
];
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is required`);
}

const evidence = {
  schema: 1,
  version: process.env.BUILDCHAIN_VERSION,
  channel: process.env.BUILDCHAIN_CHANNEL,
  source_sha: process.env.BUILDCHAIN_SOURCE_SHA,
  release_sha: process.env.BUILDCHAIN_RELEASE_SHA,
  target_ref: process.env.BUILDCHAIN_TARGET_REF,
  release_material_sha: process.env.BUILDCHAIN_RELEASE_MATERIAL_SHA,
  publish_tooling_sha: process.env.BUILDCHAIN_PUBLISH_TOOLING_SHA,
  artifacts: [{
    group: "release",
    kind: "github-release",
    name: "agent-hub-demo",
    ref: `v${process.env.BUILDCHAIN_VERSION}`,
    digest: `sha256:${digest}`,
  }],
};
const evidencePath = resolve(root, process.env.BUILDCHAIN_PUBLISH_EVIDENCE);
mkdirSync(dirname(evidencePath), { recursive: true });
writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);

const assets = readdirSync(passportRoot)
  .map((name) => resolve(passportRoot, name))
  .filter((path) => statSync(path).isFile())
  .map((path) => relative(root, path));
process.stdout.write(`${JSON.stringify({ status: "published", evidence: relative(root, evidencePath), assets })}\n`);
