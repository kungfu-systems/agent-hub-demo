import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

test("declaration binds the exact standalone binary without implicit authority", () => {
  const declaration = JSON.parse(read(".buildchain/auditable-demo.json"));
  assert.equal(declaration.schema, "buildchain.declarative-binary-demo/v1");
  assert.deepEqual(declaration.product, {
    id: "agent-hub-demo",
    displayName: "Agent Hub Demo",
    binaryName: "agent-hub-demo",
  });
  assert.deepEqual(declaration.artifact, {
    platformId: "linux-x64",
    binaryPath: "dist/agent-hub-demo-linux-x64",
    metadataPath: ".buildchain/artifacts/binary-linux-x64.json",
    metadataContract: "agent-hub-demo.binary-artifact/v1",
    runtimeDependencies: [],
  });
  assert.deepEqual(declaration.execution, {
    deterministic: true,
    network: "none",
    secrets: "none",
    totalTimeoutSeconds: 60,
    environment: {},
  });
  assert.deepEqual(
    declaration.renditions.map(({ columns, rows, width, height }) => [columns, rows, width, height]),
    [[150, 36, 1920, 1080], [100, 28, 1280, 720]],
  );
  assert.deepEqual(declaration.demos[0].steps[0].argv, [
    "demo", "--root", "./agent-hub-demo-run", "--output",
    "./agent-hub-demo-run/report.json", "--presentation",
  ]);
  assert.deepEqual(declaration.authority.grants, []);
  assert.deepEqual(declaration.authority.nonAuthorities, [
    "first-party-identity", "system-identity", "kfd-compliance",
    "product-system-metadata", "package-metadata", "registry-history",
    "scan-output", "standalone-generation",
  ]);
});

test("one reusable Buildchain job serves manual validation and promotion materialization", () => {
  const workflow = read(".github/workflows/build.yml");
  assert.match(workflow, /auditable-demo-materialize:[\s\S]*type: boolean/u);
  assert.match(workflow, /auditable-demo-base-ref:[\s\S]*default: dev\/v0\/v0\.2/u);
  assert.match(
    workflow,
    /uses: kungfu-systems\/buildchain\/\.github\/workflows\/\.declarative-auditable-demo\.yml@train\/v3\/v3\.0\/declarative-binary-demo-platform/u,
  );
  assert.match(workflow, /binary-artifact-name: \$\{\{ fromJSON\(needs\.auditable-demo-binary\.outputs\.artifact-coordinates-json\)\.artifacts\[0\]\.name \}\}/u);
  assert.match(workflow, /binary-artifact-digest: \$\{\{ fromJSON\(needs\.auditable-demo-binary\.outputs\.artifact-coordinates-json\)\.artifacts\[0\]\.digest \}\}/u);
  assert.match(workflow, /scenario-path: \.buildchain\/auditable-demo\.json/u);
  assert.match(workflow, /github\.event_name == 'workflow_dispatch'[\s\S]*startsWith\(github\.base_ref, 'alpha\/'\)[\s\S]*startsWith\(github\.base_ref, 'release\/'\)/u);
  assert.doesNotMatch(workflow, /capture-auditable-demo|auditable-demo-passport|resolve-auditable-demo-source/u);
});

test("consumer carries no product-specific capture or publication implementation", () => {
  for (const relative of [
    "scripts/capture-agent-hub-demo.py",
    "scripts/auditable-demo-adapter.mjs",
    "scripts/auditable-demo-passport.mjs",
    "scripts/materialize-auditable-demo.mjs",
  ]) assert.equal(fs.existsSync(path.join(ROOT, relative)), false, relative);
  const packageJson = JSON.parse(read("package.json"));
  assert.equal(packageJson.scripts["auditable-demo:check"], undefined);
  assert.equal(packageJson.scripts["auditable-demo:materialize"], undefined);
});

test("repository invokes Buildchain v3 only", () => {
  const repositoryFiles = [
    ".github/workflows/build.yml",
    ".github/workflows/buildchain-ref-promotion.yml",
    ".github/workflows/verify.yml",
    ".buildchain/alpha-contract-lock.json",
    ".buildchain/contract-lock.json",
    ".buildchain/kfd/kfd-2/registry.json",
    "CONTRIBUTING.md",
    "README.md",
    "docs/RELEASE_QUALIFICATION.md",
    "docs/versioning.md",
    "scripts/qualify-passport.mjs",
    "scripts/qualify-release.mjs",
  ];
  const retiredMajor = String(1 + 1);
  const retiredInvocation = new RegExp([
    `@kungfu-tech/buildchain@${retiredMajor}(?:\\.|\\b)`,
    `@v${retiredMajor}\\b`,
    `Buildchain v${retiredMajor}`,
    `"ref": "v${retiredMajor}(?:-alpha)?"`,
  ].join("|"), "u");
  for (const relative of repositoryFiles) {
    assert.doesNotMatch(read(relative), retiredInvocation, relative);
  }
  assert.equal(JSON.parse(read(".buildchain/contract-lock.json")).buildchain.majorLine, "v3");
  assert.equal(JSON.parse(read(".buildchain/alpha-contract-lock.json")).buildchain.majorLine, "v3");
});
