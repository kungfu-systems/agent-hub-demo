import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const platforms = ["linux-x64", "macos-arm64", "windows-x64"];
const evidence = [
  ".buildchain/platform-signing-policy.json",
  ".buildchain/artifacts/kfd-agent-hub/adoption-lock.json",
  ".buildchain/artifacts/kfd-agent-hub/evidence.json",
  ".buildchain/artifacts/kfd-agent-hub/report.json",
  ".buildchain/artifacts/kfd-agent-hub/verification.json",
  ".buildchain/kfd/kfd-2/claims/first-party-clean-room-structural-independence.json",
  ".buildchain/release-qualification/kfd-1-witness.json",
  ".buildchain/release-qualification/kfd-1-gate-section.json",
  ".buildchain/release-qualification/kfd-3-prebuild.json",
  ".buildchain/release-qualification/kfd-3-artifact.json",
  ".buildchain/release-qualification/qualification-report.json",
];

// Archive assembly owns no signing, qualification or publication authority.
// Preserve relative evidence paths, and never recursively package the workspace.
function regularFile(root, file) {
  let current = root;
  const parts = file.split("/");
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() ||
        (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())) {
      throw new Error(`product archive requires regular paths: ${file}`);
    }
  }
  return current;
}

export function packageProduct(root, platform) {
  root = resolve(root);
  if (!platforms.includes(platform)) throw new Error(`unsupported platform: ${platform}`);
  const binary = `agent-hub-demo-${platform}${platform === "windows-x64" ? ".exe" : ""}`;
  const binaryFile = `dist/${binary}`;
  const metadataFile = `.buildchain/artifacts/binary-${platform}.json`;
  const files = [
    binaryFile, `${binaryFile}.sha256`, "dist/agent-hub-demo.json",
    metadataFile, ...evidence,
  ];
  for (const file of files) regularFile(root, file);
  const bytes = readFileSync(join(root, binaryFile));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const metadata = JSON.parse(readFileSync(join(root, metadataFile), "utf8"));
  const product = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  if (product.private !== true || metadata.smoke?.version?.product !== "agent-hub-demo" ||
      metadata.smoke.version.version !== product.version) {
    throw new Error("product archive version differs from the governed source version");
  }
  const expectedState = platform === "windows-x64" ? "unsigned-exception" : "signed";
  if (metadata.signing?.state !== expectedState) {
    throw new Error("product archive requires final platform signing metadata");
  }
  if (metadata.contract !== "agent-hub-demo.binary-artifact/v1" ||
      metadata.platform !== platform || metadata.file !== binaryFile ||
      metadata.sha256 !== sha256 || metadata.size !== bytes.length) {
    throw new Error("product archive binary differs from its metadata");
  }
  if (readFileSync(join(root, `${binaryFile}.sha256`), "utf8") !== `${sha256}  ${binary}\n`) {
    throw new Error("product archive binary differs from its checksum");
  }
  const signingResult = metadata.signing?.evidencePath;
  if (metadata.signing?.state === "signed") {
    if (!/^\.buildchain\/artifacts\/signing\/(?:[A-Za-z0-9_-]+\/)*result\.json$/u.test(signingResult ?? "")) {
      throw new Error("product archive requires the declared public signing result");
    }
    regularFile(root, signingResult);
    files.push(signingResult);
  }
  // dist has already been checked as a real directory through binaryFile.
  const outputDirectory = join(root, "dist", "packages");
  mkdirSync(outputDirectory, { recursive: true });
  if (lstatSync(outputDirectory).isSymbolicLink()) throw new Error("archive output cannot be a symbolic link");
  const output = join(outputDirectory, `agent-hub-demo-${platform}.tar.gz`);
  try {
    if (!lstatSync(output).isFile() || lstatSync(output).isSymbolicLink()) {
      throw new Error("archive output must be a regular file");
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  execFileSync("tar", ["-czf", output, "-C", root, "--", ...files.sort()], {
    stdio: "pipe", env: { ...process.env, COPYFILE_DISABLE: "1" },
  });
  return { platform, output, files: files.sort(), binarySha256: sha256 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const platform = `${process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : process.platform}-${process.arch}`;
  console.log(JSON.stringify(packageProduct(process.cwd(), platform)));
}
