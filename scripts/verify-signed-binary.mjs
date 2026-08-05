import { createHash } from "node:crypto";
import { chmodSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw result.error || new Error(`${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result;
}

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function platform() {
  if (process.platform === "darwin" && process.arch === "arm64") return "macos-arm64";
  if (process.platform === "linux" && process.arch === "x64") return "linux-x64";
  if (process.platform === "win32" && process.arch === "x64") return "windows-x64";
  throw new Error(`unsupported signed release platform: ${process.platform}-${process.arch}`);
}

function walk(directory, name, output = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const child = resolve(directory, entry.name);
    if (entry.isDirectory()) walk(child, name, output);
    else if (entry.isFile() && entry.name === name) output.push(child);
  }
  return output;
}

const platformId = platform();
const extension = process.platform === "win32" ? ".exe" : "";
const binaryPath = resolve(root, "dist", `agent-hub-demo-${platformId}${extension}`);
const evidenceRoot = resolve(root, ".buildchain", "artifacts", "signing");
const resultPaths = walk(evidenceRoot, "result.json");
if (resultPaths.length !== 1) throw new Error(`expected one Buildchain signing result for ${platformId}, found ${resultPaths.length}`);
const resultPath = resultPaths[0];
const result = JSON.parse(readFileSync(resultPath, "utf8"));
const observedDigest = `sha256:${sha256(binaryPath)}`;
if (result.contract !== "kungfu-buildchain-artifact-signing-result/v1" || result.verification?.status !== "passed") {
  throw new Error("Buildchain signing result is absent or non-qualifying");
}
if (result.artifact?.id !== `agent-hub-demo-${platformId}`) {
  throw new Error(`Buildchain signing result artifact identity mismatch for ${platformId}`);
}
if (result.artifact?.digest !== observedDigest || result.artifact?.bytes !== statSync(binaryPath).size) {
  throw new Error("final executable does not match the imported Buildchain signing result");
}
const expected = {
  "linux-x64": ["detached-signature-v1", "detached-cryptographic-signature"],
  "macos-arm64": ["apple-developer-id", "native-platform-signature"],
  "windows-x64": ["windows-authenticode", "native-platform-signature"],
}[platformId];
if (result.signature?.profile !== expected[0] || result.signature?.semantics !== expected[1]) {
  throw new Error(`dishonest signing semantics for ${platformId}`);
}
if (process.platform === "darwin") {
  run("codesign", ["--verify", "--strict", "--verbose=4", binaryPath]);
  const requiredChecks = [
    "codesign-strict",
    "developer-id-team",
    "hardened-runtime",
    "notarytool-accepted",
    "standalone-notary-ticket-online",
  ];
  const observedChecks = new Set(result.verification?.checks || []);
  if (requiredChecks.some((check) => !observedChecks.has(check))) {
    throw new Error("Buildchain result does not prove standalone Mach-O signing and accepted notarization");
  }
}
if (process.platform === "win32") {
  const check = run("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `$s=Get-AuthenticodeSignature -LiteralPath '${binaryPath.replaceAll("'", "''")}'; if($s.Status -ne 'Valid' -or $null -eq $s.TimeStamperCertificate){exit 1}`,
  ]);
  if (check.status !== 0) throw new Error("final PE lacks valid timestamped Authenticode");
}
if (process.platform !== "win32") chmodSync(binaryPath, 0o755);

const version = JSON.parse(run(binaryPath, ["version", "--json"]).stdout);
const selfVerify = JSON.parse(run(binaryPath, ["self-verify", "--json"]).stdout);
const capabilities = JSON.parse(run(binaryPath, ["capabilities", "--root", resolve(root, ".buildchain", "sea", platformId, "signed-capabilities"), "--json"]).stdout);
if (selfVerify.ok !== true || capabilities.hubs?.length !== 2) throw new Error("final signed executable smoke verification failed");

const metadataPath = resolve(root, ".buildchain", "artifacts", `binary-${platformId}.json`);
const metadata = {
  schemaVersion: 1,
  contract: "agent-hub-demo.binary-artifact/v1",
  platform: platformId,
  file: `dist/${basename(binaryPath)}`,
  sha256: observedDigest.slice("sha256:".length),
  size: statSync(binaryPath).size,
  node: process.version,
  runtimeDependencies: [],
  executableFiles: [{ path: `dist/${basename(binaryPath)}`, sha256: observedDigest.slice("sha256:".length) }],
  signing: {
    profile: result.signature.profile,
    semantics: result.signature.semantics,
    provider: result.signature.provider,
    resultDigest: result.digest,
    evidencePath: resultPath.slice(root.length + 1).split("\\").join("/"),
  },
  smoke: { version, selfVerify, hubCount: capabilities.hubs.length },
};
writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
writeFileSync(`${binaryPath}.sha256`, `${metadata.sha256}  ${basename(binaryPath)}\n`);
process.stdout.write(`${JSON.stringify({ status: "verified", platform: platformId, sha256: metadata.sha256, signing: metadata.signing })}\n`);
