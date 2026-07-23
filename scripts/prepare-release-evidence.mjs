import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

const argv = process.argv.slice(2);
const valueFor = (flag, fallback = "") => {
  const index = argv.indexOf(flag);
  return index === -1 ? fallback : argv[index + 1];
};

const cwd = process.cwd();
const productPath = resolve(cwd, valueFor("--artifact", "dist/agent-hub-demo.json"));
const binaryNames = readdirSync(resolve(cwd, "dist")).filter((name) =>
  /^agent-hub-demo-(linux-x64|macos-arm64|windows-x64)(?:\.exe)?$/.test(name),
);
if (binaryNames.length !== 1) {
  throw new Error(`expected one platform binary under dist, found ${binaryNames.length}`);
}
const binaryPath = resolve(cwd, "dist", binaryNames[0]);
const prebuildPath = resolve(cwd, valueFor(
  "--kfd-3-prebuild",
  ".buildchain/release-qualification/kfd-3-prebuild.json",
));
const kfd1Path = resolve(cwd, valueFor(
  "--kfd-1-output",
  ".buildchain/release-qualification/kfd-1-witness.json",
));
const kfd3ArtifactPath = resolve(cwd, valueFor(
  "--kfd-3-artifact-output",
  ".buildchain/release-qualification/kfd-3-artifact.json",
));
const sourceSha = valueFor("--source-sha", process.env.GITHUB_SHA || "unknown");

const productSha256 = createHash("sha256").update(readFileSync(productPath)).digest("hex");
const binarySha256 = createHash("sha256").update(readFileSync(binaryPath)).digest("hex");
const relativeProduct = "dist/agent-hub-demo.json";
const relativeBinary = `dist/${basename(binaryPath)}`;
const writeJson = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

const kfd1Witness = {
  schemaVersion: 1,
  id: "agent-hub-demo-product-artifact",
  standard: "kfd-1",
  source: {
    repo: "kungfu-systems/agent-hub-demo",
    ref: sourceSha,
    package: "@kungfu-tech/agent-hub-demo",
  },
  contractWorld: {
    id: "agent-hub-demo-product-artifact",
    schemaId: "agent-hub-demo.product-artifact/v1",
    digest: `sha256:${productSha256}`,
    owner: "kungfu-systems/agent-hub-demo maintainers",
    selfHosted: false,
  },
  surfaces: [
    {
      name: "agent-hub-demo.json",
      sourcePath: relativeProduct,
      sourceSha256: productSha256,
      artifactPath: "agent-hub-demo.json",
      expectedSha256: productSha256,
      byteForByte: true,
    },
    {
      name: basename(binaryPath),
      sourcePath: relativeBinary,
      sourceSha256: binarySha256,
      artifactPath: basename(binaryPath),
      expectedSha256: binarySha256,
      byteForByte: true,
    },
  ],
  responsibility: {
    sourceContractOwner: "kungfu-systems/agent-hub-demo maintainers",
    artifactVerificationOwner: "Buildchain KFD-1 release gate",
    releasePassportProofOwner: "Buildchain",
  },
};
writeJson(kfd1Path, kfd1Witness);

const prebuild = JSON.parse(readFileSync(prebuildPath, "utf8"));
const kfd3Artifact = {
  ...prebuild,
  witnessKind: "artifact",
  artifact: {
    name: basename(binaryPath),
    path: relativeBinary,
    sha256: binarySha256,
  },
};
writeJson(kfd3ArtifactPath, kfd3Artifact);

process.stdout.write(`${JSON.stringify({
  status: "prepared",
  product: relativeProduct,
  binary: relativeBinary,
  sha256: binarySha256,
  kfd1Witness: kfd1Path,
  kfd3ArtifactWitness: kfd3ArtifactPath,
})}\n`);
