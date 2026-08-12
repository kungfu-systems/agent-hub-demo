import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const argv = process.argv.slice(2);
const valueFor = (flag, fallback) => {
  const index = argv.indexOf(flag);
  return index === -1 ? fallback : argv[index + 1];
};

const cwd = process.cwd();
const passportPath = resolve(cwd, valueFor(
  "--passport",
  ".buildchain/release-passport/buildchain.release.json",
));
const outputPath = resolve(cwd, valueFor(
  "--output",
  ".buildchain/release-qualification/passport-qualification.json",
));
const buildchainAuthority = "a5f9172943d0d15de0713834c897fa9335cc1c7b";
const buildchainCli = resolve(cwd, process.env.BUILDCHAIN_RUNTIME_ROOT || ".buildchain/runtime", "bin/buildchain.mjs");

function verify(path) {
  const result = spawnSync(process.execPath, [
    buildchainCli, "verify", "release-passport", path, "--json",
  ], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, npm_config_registry: "https://registry.npmjs.org/" },
  });
  let document = null;
  try {
    document = JSON.parse(result.stdout);
  } catch {
    // Unparseable verifier output remains a fail-closed result below.
  }
  return { result, document };
}

const positive = verify(passportPath);
if (positive.result.status !== 0 || positive.document?.ok !== true) {
  throw new Error(`positive Release Passport verification failed: ${positive.result.stderr || positive.result.stdout}`);
}

const work = mkdtempSync(join(tmpdir(), "agent-hub-passport-mutation-"));
cpSync(dirname(passportPath), work, { recursive: true });
const mutatedPath = join(work, "buildchain.release.json");
const mutated = JSON.parse(readFileSync(mutatedPath, "utf8"));
mutated.kfdAgentHub.reportDigest = "sha256:deadbeef";
writeFileSync(mutatedPath, `${JSON.stringify(mutated, null, 2)}\n`);

const negative = verify(mutatedPath);
const issue = (negative.document?.issues || []).find((entry) => entry.code === "kfdAgentHub.reportDigest");
const rejected = negative.result.status !== 0 && negative.document?.ok === false && Boolean(issue);
const output = {
  schemaVersion: 1,
  contract: "agent-hub-demo.release-passport-qualification/v1",
  verdict: rejected ? "passed" : "failed",
  positive: {
    status: "verified",
    verifier: `kungfu-systems/buildchain@${buildchainAuthority} verify release-passport`,
  },
  mutation: {
    id: "release-passport-agent-hub-report-root-drift",
    category: "release-passport",
    status: rejected ? "rejected-as-expected" : "unexpected-result",
    error: rejected ? issue.code : "qualification-oracle-mismatch",
    owner: "Buildchain Release Passport and consumer release owner",
    evidence: {
      exitCode: negative.result.status,
      issue,
    },
    nextStep: "Recollect the Release Passport from the exact Agent Hub evidence asset and verify it offline before upload.",
  },
  environment: {
    hubExecution: false,
    privateDependencies: false,
  },
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ verdict: output.verdict, output: outputPath, error: output.mutation.error })}\n`);
if (!rejected) process.exitCode = 1;
