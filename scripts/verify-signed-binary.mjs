import { createHash } from "node:crypto";
import { chmodSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
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
  if (!existsSync(directory)) return output;
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
const policyPath = resolve(root, ".buildchain", "platform-signing-policy.json");
const policy = JSON.parse(readFileSync(policyPath, "utf8"));
const platformPolicy = policy.platforms?.[platformId];
if (policy.contract !== "agent-hub-demo.platform-signing-policy/v1" || !platformPolicy) {
  throw new Error(`platform signing policy is absent or invalid for ${platformId}`);
}
if (!("BUILDCHAIN_SIGNING_REQUEST_COUNT" in process.env) || !("BUILDCHAIN_ARTIFACT_SIGNING_STATE" in process.env)) {
  throw new Error("Buildchain finalization signing state environment is required");
}
const requestCount = Number(process.env.BUILDCHAIN_SIGNING_REQUEST_COUNT);
const artifactSigningState = process.env.BUILDCHAIN_ARTIFACT_SIGNING_STATE;
const observedDigest = `sha256:${sha256(binaryPath)}`;
const expected = {
  "linux-x64": ["detached-signature-v1", "detached-cryptographic-signature"],
  "macos-arm64": ["apple-developer-id", "native-platform-signature"],
}[platformId];
let signing;
if (platformPolicy.state === "signed") {
  if (requestCount !== platformPolicy.signingRequestCount || artifactSigningState !== "signed" || resultPaths.length !== 1) {
    throw new Error(`expected one Buildchain signing result for ${platformId}, found ${resultPaths.length}`);
  }
  const resultPath = resultPaths[0];
  const result = JSON.parse(readFileSync(resultPath, "utf8"));
  if (result.contract !== "kungfu-buildchain-artifact-signing-result/v1" || result.verification?.status !== "passed") {
    throw new Error("Buildchain signing result is absent or non-qualifying");
  }
  if (result.artifact?.id !== `agent-hub-demo-${platformId}`) {
    throw new Error(`Buildchain signing result artifact identity mismatch for ${platformId}`);
  }
  if (result.artifact?.digest !== observedDigest || result.artifact?.bytes !== statSync(binaryPath).size) {
    throw new Error("final executable does not match the imported Buildchain signing result");
  }
  if (result.signature?.profile !== expected?.[0] || result.signature?.semantics !== expected?.[1]) {
    throw new Error(`dishonest signing semantics for ${platformId}`);
  }
  signing = {
    state: "signed",
    profile: result.signature.profile,
    semantics: result.signature.semantics,
    provider: result.signature.provider,
    resultDigest: result.digest,
    evidencePath: resultPath.slice(root.length + 1).split("\\").join("/"),
  };
} else if (platformId === "windows-x64" && platformPolicy.state === "unsigned-exception") {
  if (platformPolicy.authenticode !== false || platformPolicy.timestamped !== false
    || platformPolicy.signingRequestCount !== 0 || requestCount !== 0
    || artifactSigningState !== "unsigned" || resultPaths.length !== 0
    || !platformPolicy.reasonCode || !platformPolicy.reviewTrigger) {
    throw new Error("Windows unsigned exception is incomplete or contradicted by signing evidence");
  }
  signing = {
    state: "unsigned-exception",
    profile: "none",
    semantics: "explicitly-unsigned",
    provider: "none",
    resultDigest: null,
    evidencePath: ".buildchain/platform-signing-policy.json",
    reasonCode: platformPolicy.reasonCode,
  };
} else {
  throw new Error(`unsupported signing state for ${platformId}: ${platformPolicy.state}`);
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
  const signedResult = JSON.parse(readFileSync(resultPaths[0], "utf8"));
  const observedChecks = new Set(signedResult.verification?.checks || []);
  if (requiredChecks.some((check) => !observedChecks.has(check))) {
    throw new Error("Buildchain result does not prove standalone Mach-O signing and accepted notarization");
  }
}
if (process.platform === "win32") {
  const securityModule = String.raw`${process.env.WINDIR}\System32\WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1`;
  run("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `Import-Module -Force '${securityModule.replaceAll("'", "''")}'; $s=Get-AuthenticodeSignature -LiteralPath '${binaryPath.replaceAll("'", "''")}'; if($s.Status -ne 'NotSigned' -or $null -ne $s.SignerCertificate -or $null -ne $s.TimeStamperCertificate){exit 1}`,
  ]);
}
if (process.platform !== "win32") chmodSync(binaryPath, 0o755);

const version = JSON.parse(run(binaryPath, ["version", "--json"]).stdout);
const selfVerify = JSON.parse(run(binaryPath, ["self-verify", "--json"]).stdout);
const capabilities = JSON.parse(run(binaryPath, ["capabilities", "--root", resolve(root, ".buildchain", "sea", platformId, "signed-capabilities"), "--json"]).stdout);
if (selfVerify.ok !== true || capabilities.hubs?.length !== 2) throw new Error("final executable smoke verification failed");

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
  signing,
  smoke: { version, selfVerify, hubCount: capabilities.hubs.length },
};
writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
writeFileSync(`${binaryPath}.sha256`, `${metadata.sha256}  ${basename(binaryPath)}\n`);
process.stdout.write(`${JSON.stringify({ status: "verified", platform: platformId, sha256: metadata.sha256, signing: metadata.signing })}\n`);
