import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const readJson = (path) => JSON.parse(readFileSync(resolve(path), "utf8"));
const requiredFiles = [
  ".buildchain/kfd/kfd-2/registry.json",
  ".buildchain/kfd/kfd-3/surfaces.json",
  ".buildchain/kfd/agent-hub.json",
  "scripts/build-binary.mjs",
  "scripts/write-publish-evidence.mjs",
];

export function evaluatePublicationQualification({
  capability,
  packageJson,
  missing,
}) {
  const exactTarget =
    capability.target ===
    "github-release:kungfu-systems/agent-hub-demo";
  const githubReleaseCapability =
    Array.isArray(capability.capabilityIds) &&
    capability.capabilityIds.includes("github-release");
  const versionBound =
    typeof capability.version === "string" &&
    capability.version === packageJson.version;
  return {
    allow:
      missing.length === 0 &&
      packageJson.private === true &&
      exactTarget &&
      githubReleaseCapability &&
      versionBound,
    exactTarget,
    githubReleaseCapability,
    versionBound,
  };
}

export async function main() {
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

  const capability = readJson(process.env.BUILDCHAIN_PUBLICATION_CAPABILITY_PATH);
  const gateAggregate = readJson(
    process.env.BUILDCHAIN_PUBLICATION_GATE_AGGREGATE_PATH,
  );
  const packageJson = readJson("package.json");
  const missing = requiredFiles.filter((path) => !existsSync(resolve(path)));
  const qualification = evaluatePublicationQualification({
    capability,
    packageJson,
    missing,
  });
  const { createConsumerPublicationDecision } = await import(
    "../.buildchain/qualification-runtime/packages/core/publication-authority.js"
  );
  const decision = createConsumerPublicationDecision({
    capability,
    gateAggregate,
    decision: qualification.allow ? "allow" : "deny",
    predicateId: process.env.BUILDCHAIN_PUBLICATION_PREDICATE_ID,
    predicateDigest: process.env.BUILDCHAIN_PUBLICATION_PREDICATE_DIGEST,
    evidence: {
      owner: "kungfu-systems/agent-hub-demo maintainers",
      exactTarget: qualification.exactTarget,
      githubReleaseCapability: qualification.githubReleaseCapability,
      versionBound: qualification.versionBound,
      declaredVersion: packageJson.version,
      publicationVersion: capability.version ?? null,
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
  if (!qualification.allow) process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
