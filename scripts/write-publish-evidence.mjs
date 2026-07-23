import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { matchesPayload, releasePlatforms } from "./release-platforms.mjs";

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

const payloadFiles = filesUnder(payloadRoot);
function payloadFile(artifact, suffix) {
  const matches = payloadFiles.filter(
    (path) => matchesPayload(path, artifact, suffix),
  );
  if (matches.length !== 1) {
    throw new Error(
      `expected one ${artifact} release-candidate file ending ${suffix}, found ${matches.length}`,
    );
  }
  return matches[0];
}

function copyTo(source, directory, name = basename(source)) {
  const target = resolve(directory, name);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target);
  return target;
}

function copyJsonTo(source, directory, name, transform) {
  const target = resolve(directory, name);
  const value = JSON.parse(readFileSync(source, "utf8"));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(transform(value), null, 2)}\n`);
  return target;
}

mkdirSync(inputRoot, { recursive: true });
mkdirSync(passportRoot, { recursive: true });
copyTo(
  payloadFile("linux-x64", "/dist/agent-hub-demo.json"),
  passportRoot,
  "agent-hub-demo.json",
);
copyTo(
  payloadFile(
    "linux-x64",
    "/.buildchain/kfd/kfd-2/claims/first-party-clean-room-structural-independence.json",
  ),
  inputRoot,
  "kfd-2-claim.json",
);
for (const { artifact, target } of releasePlatforms) {
  const extension = target === "windows-x64" ? ".exe" : "";
  const binaryName = `agent-hub-demo-${target}${extension}`;
  copyTo(payloadFile(artifact, `/dist/${binaryName}`), passportRoot, binaryName);
  copyTo(
    payloadFile(artifact, `/dist/${binaryName}.sha256`),
    passportRoot,
    `${binaryName}.sha256`,
  );
  copyTo(
    payloadFile(
      artifact,
      `/.buildchain/artifacts/binary-${target}.json`,
    ),
    passportRoot,
    `binary-${target}.json`,
  );
  copyJsonTo(
    payloadFile(
      artifact,
      "/.buildchain/release-qualification/kfd-1-witness.json",
    ),
    inputRoot,
    `kfd-1-witness-${target}.json`,
    (witness) => ({
      ...witness,
      id: `${witness.id}-${target}`,
      contractWorld: witness.contractWorld
        ? { ...witness.contractWorld, id: `${witness.contractWorld.id}-${target}` }
        : witness.contractWorld,
      surfaces: (witness.surfaces || [])
        .filter(
          (surface) =>
            target === "linux-x64" ||
            basename(surface.artifactPath) !== "agent-hub-demo.json",
        )
        .map((surface) => ({
          ...surface,
          artifactPath: `.buildchain/release-passport/${basename(surface.artifactPath)}`,
        })),
    }),
  );
  copyJsonTo(
    payloadFile(
      artifact,
      "/.buildchain/release-qualification/kfd-3-prebuild.json",
    ),
    inputRoot,
    `kfd-3-prebuild-${target}.json`,
    (witness) => ({
      ...witness,
      id: `${witness.id}-${target}`,
    }),
  );
  copyJsonTo(
    payloadFile(
      artifact,
      "/.buildchain/release-qualification/kfd-3-artifact.json",
    ),
    inputRoot,
    `kfd-3-artifact-${target}.json`,
    (witness) => ({
      ...witness,
      id: `${witness.id}-${target}`,
      artifact: {
        ...witness.artifact,
        path: `.buildchain/release-passport/${basename(witness.artifact?.path || binaryName)}`,
      },
    }),
  );
}

const publicAssets = [
  [
    "/.buildchain/artifacts/kfd-agent-hub/adoption-lock.json",
    "kfd-agent-hub-adoption-lock.json",
  ],
  [
    "/.buildchain/artifacts/kfd-agent-hub/evidence.json",
    "kfd-agent-hub-evidence.json",
  ],
  [
    "/.buildchain/artifacts/kfd-agent-hub/report.json",
    "kfd-agent-hub-report.json",
  ],
  [
    "/.buildchain/artifacts/kfd-agent-hub/verification.json",
    "kfd-agent-hub-verification.json",
  ],
  [
    "/.buildchain/release-qualification/kfd-1-gate-section.json",
    "kfd-1-gate-linux-x64.json",
  ],
  [
    "/.buildchain/release-qualification/qualification-report.json",
    "qualification-report.json",
  ],
];
for (const [suffix, name] of publicAssets) {
  copyTo(payloadFile("linux-x64", suffix), passportRoot, name);
}
copyTo(resolve(inputRoot, "kfd-2-claim.json"), passportRoot);
for (const { target } of releasePlatforms) {
  copyTo(
    resolve(inputRoot, `kfd-1-witness-${target}.json`),
    passportRoot,
  );
  copyTo(
    resolve(inputRoot, `kfd-3-prebuild-${target}.json`),
    passportRoot,
  );
  copyTo(
    resolve(inputRoot, `kfd-3-artifact-${target}.json`),
    passportRoot,
  );
}

const binaryAssets = readdirSync(passportRoot)
  .filter((name) => /^agent-hub-demo-(?:linux-x64|macos-arm64|windows-x64)(?:\.exe)?$/.test(name))
  .sort();
const checksums = binaryAssets
  .map((name) => {
    const digest = createHash("sha256")
      .update(readFileSync(resolve(passportRoot, name)))
      .digest("hex");
    return `${digest}  ${name}`;
  })
  .join("\n");
writeFileSync(resolve(passportRoot, "SHA256SUMS"), `${checksums}\n`);

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

const bundleDigest = createHash("sha256")
  .update(readFileSync(resolve(passportRoot, "SHA256SUMS")))
  .digest("hex");
const evidence = {
  schema: 1,
  version: process.env.BUILDCHAIN_VERSION,
  channel: process.env.BUILDCHAIN_CHANNEL,
  source_sha: process.env.BUILDCHAIN_SOURCE_SHA,
  release_sha: process.env.BUILDCHAIN_RELEASE_SHA,
  target_ref: process.env.BUILDCHAIN_TARGET_REF,
  release_material_sha: process.env.BUILDCHAIN_RELEASE_MATERIAL_SHA,
  publish_tooling_sha: process.env.BUILDCHAIN_PUBLISH_TOOLING_SHA,
  artifacts: [
    {
      group: "release",
      kind: "github-release",
      name: "agent-hub-demo",
      ref: `v${process.env.BUILDCHAIN_VERSION}`,
      digest: `sha256:${bundleDigest}`,
    },
  ],
};
const evidencePath = resolve(root, process.env.BUILDCHAIN_PUBLISH_EVIDENCE);
mkdirSync(dirname(evidencePath), { recursive: true });
writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);

const assets = readdirSync(passportRoot)
  .map((name) => resolve(passportRoot, name))
  .filter((path) => statSync(path).isFile())
  .map((path) => relative(root, path));
process.stdout.write(
  `${JSON.stringify({
    status: "published",
    evidence: relative(root, evidencePath),
    binaries: binaryAssets,
    assets,
  })}\n`,
);
