import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { createConsumerPublicationDecision } from "../.buildchain/qualification-runtime/packages/core/publication-authority.js";

const requiredEnv = [
  "BUILDCHAIN_PUBLICATION_CAPABILITY_PATH",
  "BUILDCHAIN_PUBLICATION_GATE_AGGREGATE_PATH",
  "BUILDCHAIN_PUBLICATION_QUALIFICATION_RESULT_PATH",
  "BUILDCHAIN_PUBLICATION_PREDICATE_ID",
  "BUILDCHAIN_PUBLICATION_PREDICATE_DIGEST",
];
for (const name of requiredEnv) {
  if (!process.env[name]) throw new Error(`${name} is required`);
}

const readJson = (path) => JSON.parse(readFileSync(resolve(path), "utf8"));
const capability = readJson(process.env.BUILDCHAIN_PUBLICATION_CAPABILITY_PATH);
const gateAggregate = readJson(
  process.env.BUILDCHAIN_PUBLICATION_GATE_AGGREGATE_PATH,
);
const packageJson = readJson("package.json");
const requiredFiles = [
  ".buildchain/kfd/kfd-2/registry.json",
  ".buildchain/kfd/kfd-3/surfaces.json",
  ".buildchain/kfd/agent-hub.json",
  "scripts/build-binary.mjs",
  "scripts/write-publish-evidence.mjs",
];
const missing = requiredFiles.filter((path) => !existsSync(resolve(path)));
const exactTarget =
  capability.target ===
  "github-release:kungfu-systems/agent-hub-demo";
const githubReleaseCapability =
  Array.isArray(capability.capabilityIds) &&
  capability.capabilityIds.includes("github-release");
const allow =
  missing.length === 0 &&
  packageJson.private === true &&
  exactTarget &&
  githubReleaseCapability;
const decision = createConsumerPublicationDecision({
  capability,
  gateAggregate,
  decision: allow ? "allow" : "deny",
  predicateId: process.env.BUILDCHAIN_PUBLICATION_PREDICATE_ID,
  predicateDigest: process.env.BUILDCHAIN_PUBLICATION_PREDICATE_DIGEST,
  evidence: {
    owner: "kungfu-systems/agent-hub-demo maintainers",
    exactTarget,
    githubReleaseCapability,
    declaredPlatforms: ["linux-x64", "macos-arm64", "windows-x64"],
    requiredFiles,
    missing,
    npmPublicationDisabled: packageJson.private === true,
  },
});
const output = resolve(
  process.env.BUILDCHAIN_PUBLICATION_QUALIFICATION_RESULT_PATH,
);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(decision, null, 2)}\n`);
if (!allow) process.exitCode = 1;
