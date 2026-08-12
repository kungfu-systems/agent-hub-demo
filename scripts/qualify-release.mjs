import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const argv = process.argv.slice(2);
const valueFor = (flag, fallback) => {
  const index = argv.indexOf(flag);
  return index === -1 ? fallback : argv[index + 1];
};

const cwd = process.cwd();
const reportPath = resolve(cwd, valueFor("--report", ".buildchain/artifacts/kfd-agent-hub/report.json"));
const declarationPath = resolve(cwd, valueFor("--declaration", ".buildchain/kfd/agent-hub.json"));
const adapterPath = resolve(cwd, valueFor("--adapter", "src/adapter.js"));
const outputPath = resolve(cwd, valueFor("--output", ".buildchain/release-qualification/qualification-report.json"));
const kfdCli = resolve(cwd, "node_modules/@kungfu-tech/kfd/bin/kfd.mjs");
const buildchainAuthority = "98dc8e3d628b558bc8b35a91a821ad6c97334b77";
const buildchainCli = resolve(cwd, process.env.BUILDCHAIN_RUNTIME_ROOT || ".buildchain/runtime", "bin/buildchain.mjs");
const work = mkdtempSync(join(tmpdir(), "agent-hub-release-qualification-"));

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const clone = (value) => JSON.parse(JSON.stringify(value));
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

function run(command, args) {
  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, npm_config_registry: "https://registry.npmjs.org/" },
  });
}

function verifyReport(report, adapter = "") {
  const candidate = join(work, `report-${Math.random().toString(16).slice(2)}.json`);
  writeJson(candidate, report);
  const args = [kfdCli, "verify", "agent-hub-report", candidate, "--json"];
  if (adapter) args.push("--adapter", adapter);
  const result = run(process.execPath, args);
  let document = null;
  try {
    document = JSON.parse(result.stdout);
  } catch {
    // The wrapper records unparsable verifier output as a fail-closed case.
  }
  return { result, document };
}

const baseline = readJson(reportPath);
const positive = verifyReport(baseline);
if (positive.result.status !== 0 || positive.document?.valid !== true) {
  throw new Error(`positive KFD report verification failed: ${positive.result.stderr || positive.result.stdout}`);
}

const cases = [];
function recordCase({ id, category, owner, nextStep, mutate, expectedCheck }) {
  const candidate = clone(baseline);
  mutate(candidate);
  const { result, document } = verifyReport(candidate);
  const failedChecks = (document?.checks || []).filter((entry) => entry.passed === false);
  const matched = result.status !== 0 && document?.valid === false
    && failedChecks.some((entry) => entry.id === expectedCheck);
  cases.push({
    id,
    category,
    status: matched ? "rejected-as-expected" : "unexpected-result",
    error: matched ? failedChecks.find((entry) => entry.id === expectedCheck).code : "qualification-oracle-mismatch",
    owner,
    evidence: {
      verifier: "@kungfu-tech/kfd verify agent-hub-report",
      expectedCheck,
      exitCode: result.status,
      failedChecks,
    },
    nextStep,
  });
}

recordCase({
  id: "report-contract-drift",
  category: "report",
  owner: "KFD report producer",
  expectedCheck: "report-contract",
  mutate: (report) => { report.contract = "kfd.agent-hub-report/v0"; },
  nextStep: "Regenerate the report with the pinned public KFD package.",
});
recordCase({
  id: "source-cut-drift",
  category: "root",
  owner: "KFD package lock owner",
  expectedCheck: "source-cut",
  mutate: (report) => { report.sourceCut.packageManifestDigest = "sha256:deadbeef"; },
  nextStep: "Restore the package manifest and release-anchor roots from the installed KFD package.",
});
recordCase({
  id: "profile-root-drift",
  category: "root",
  owner: "KFD conformance profile owner",
  expectedCheck: "profile-root",
  mutate: (report) => { report.profile.manifestDigest = "sha256:deadbeef"; },
  nextStep: "Use the exact profile manifest root exported by the pinned KFD release.",
});
recordCase({
  id: "protocol-root-drift",
  category: "root",
  owner: "KFD protocol owner",
  expectedCheck: "protocol-root",
  mutate: (report) => { report.protocol.manifestDigest = "sha256:deadbeef"; },
  nextStep: "Use the exact protocol manifest root exported by the pinned KFD release.",
});
recordCase({
  id: "suite-root-drift",
  category: "root",
  owner: "KFD suite owner",
  expectedCheck: "suite-root",
  mutate: (report) => { report.suite.vectorRoot = "sha256:deadbeef"; },
  nextStep: "Regenerate results against the exact pinned 20-vector suite.",
});
recordCase({
  id: "inventory-root-drift",
  category: "root",
  owner: "KFD failure inventory owner",
  expectedCheck: "inventory-root",
  mutate: (report) => { report.suite.inventoryRoot = "sha256:deadbeef"; },
  nextStep: "Restore the failure inventory root exported by the pinned KFD release.",
});
recordCase({
  id: "capability-root-drift",
  category: "declaration",
  owner: "Agent Hub adapter owner",
  expectedCheck: "capability-handshake-roots",
  mutate: (report) => { report.capabilities[0].root = "sha256:deadbeef"; },
  nextStep: "Reconcile declared capabilities with both independent Hub handshakes.",
});
recordCase({
  id: "coverage-policy-drift",
  category: "policy",
  owner: "KFD claim-boundary owner",
  expectedCheck: "coverage",
  mutate: (report) => { report.coverage.total += 1; },
  nextStep: "Require complete coverage of the exact pinned suite before release.",
});
recordCase({
  id: "certification-scope-drift",
  category: "policy",
  owner: "Release claim owner",
  expectedCheck: "scope",
  mutate: (report) => { report.certification = true; },
  nextStep: "Restore the explicit non-certification and non-qualifying claim boundary.",
});
recordCase({
  id: "export-import-result-drift",
  category: "export-import",
  owner: "Agent Hub export/import owner",
  expectedCheck: "actual:hub-020-reject-export-import-drift",
  mutate: (report) => {
    const result = report.results.find((entry) => entry.id === "hub-020-reject-export-import-drift");
    result.actual.code = "accepted";
  },
  nextStep: "Reject mutated export/import bundles and regenerate the affected transcript.",
});

const mutatedAdapter = join(work, "adapter.js");
writeFileSync(mutatedAdapter, `${readFileSync(adapterPath, "utf8")}\n// deliberate qualification mutation\n`);
{
  const { result, document } = verifyReport(baseline, mutatedAdapter);
  const failedChecks = (document?.checks || []).filter((entry) => entry.passed === false);
  const matched = result.status !== 0 && failedChecks.some((entry) => entry.id === "adapter-artifact");
  cases.push({
    id: "adapter-artifact-drift",
    category: "artifact",
    status: matched ? "rejected-as-expected" : "unexpected-result",
    error: matched ? failedChecks.find((entry) => entry.id === "adapter-artifact").code : "qualification-oracle-mismatch",
    owner: "Agent Hub adapter owner",
    evidence: {
      verifier: "@kungfu-tech/kfd verify agent-hub-report --adapter",
      expectedCheck: "adapter-artifact",
      exitCode: result.status,
      failedChecks,
    },
    nextStep: "Rebuild the report after restoring the released adapter bytes.",
  });
}

const mutatedDeclaration = join(work, "agent-hub.json");
const declaration = readJson(declarationPath);
declaration.contract = "kungfu-buildchain-kfd-agent-hub-adoption/v0";
writeJson(mutatedDeclaration, declaration);
{
  const result = run(process.execPath, [
    buildchainCli, "kfd", "hub", "inspect", "--cwd", cwd,
    "--declaration", mutatedDeclaration, "--for", "agent", "--json",
  ]);
  const stderr = result.stderr || "";
  const diagnostic = [stderr, result.stdout || "", result.error?.message || ""].join("\n");
  const matched = result.status !== 0 && diagnostic.includes("kfd-agent-hub-declaration-invalid");
  cases.push({
    id: "declaration-contract-drift",
    category: "declaration",
    status: matched ? "rejected-as-expected" : "unexpected-result",
    error: matched ? "kfd-agent-hub-declaration-invalid" : "qualification-oracle-mismatch",
    owner: "Buildchain adoption declaration owner",
    evidence: {
      verifier: `kungfu-systems/buildchain@${buildchainAuthority} kfd hub inspect`,
      expectedCheck: "kfd-agent-hub-declaration-invalid",
      exitCode: result.status,
      stderr: stderr.trim(),
    },
    nextStep: "Restore the public Buildchain Agent Hub adoption contract.",
  });
}

const passed = cases.filter((entry) => entry.status === "rejected-as-expected").length;
const output = {
  schemaVersion: 1,
  contract: "agent-hub-demo.release-qualification/v1",
  verdict: passed === cases.length && cases.length >= 8 ? "passed" : "failed",
  environment: {
    kfdPackage: "@kungfu-tech/kfd@1.0.0-alpha.42",
    buildchainAuthority: `kungfu-systems/buildchain@${buildchainAuthority}`,
    networkAccessDuringReportMutations: false,
    hubExecutionDuringMutations: false,
    privateDependencies: false,
  },
  positive: {
    status: "verified",
    verifier: "@kungfu-tech/kfd verify agent-hub-report",
    reportContract: baseline.contract,
    reportDigest: positive.document.reportDigest,
  },
  summary: {
    total: cases.length,
    rejectedAsExpected: passed,
    unexpected: cases.length - passed,
    categories: [...new Set(cases.map((entry) => entry.category))].sort(),
  },
  cases,
  claimBoundary: {
    claim: "First-party clean-room structural independence within the exact tested scope.",
    nonClaims: [
      "No KFD certification or qualifying status.",
      "No claim of general third-party Hub interoperability.",
      "No security, performance, hosted-service, or production-readiness certification."
    ],
    residualRisk: [
      "The matrix verifies deliberate JSON, declaration, and adapter byte mutations; it does not enumerate every possible implementation defect.",
      "Cross-platform runtime evidence is supplied by GitHub-hosted runners and does not cover every operating-system or filesystem variant."
    ]
  }
};

mkdirSync(dirname(outputPath), { recursive: true });
writeJson(outputPath, output);
process.stdout.write(`${JSON.stringify({ verdict: output.verdict, output: outputPath, ...output.summary })}\n`);
if (output.verdict !== "passed") process.exitCode = 1;
