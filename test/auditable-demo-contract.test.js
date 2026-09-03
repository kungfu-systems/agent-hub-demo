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
  assert.equal(declaration.compositionMode, "terminal-fill");
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

test("promotion materialization consumes the sole production Buildchain job", () => {
  const workflow = read(".github/workflows/build.yml");
  assert.match(
    workflow,
    /uses: kungfu-systems\/buildchain\/\.github\/workflows\/\.declarative-auditable-demo\.yml@v4/u,
  );
  assert.match(workflow, /binary-artifact-name: \$\{\{ fromJSON\(needs\.build\.outputs\.artifact-coordinates-json\)\.artifacts\[0\]\.name \}\}/u);
  assert.match(workflow, /binary-artifact-digest: \$\{\{ fromJSON\(needs\.build\.outputs\.artifact-coordinates-json\)\.artifacts\[0\]\.digest \}\}/u);
  assert.match(workflow, /scenario-path: \.buildchain\/auditable-demo\.json/u);
  assert.match(workflow, /renderer-image: ghcr\.io\/kungfu-systems\/build-images\/demo-renderer@sha256:3a49708163fedaaabe07b45bba910026a1828151b5d4e9bbdaf0d62e75c927c1/u);
  assert.doesNotMatch(workflow, /build\.yml@v3-alpha|buildchain-ref: v3-alpha/u);
  assert.match(workflow, /auditable-demo-promotion:[\s\S]*needs: build[\s\S]*needs\.build\.outputs\.artifact-coordinates-json/u);
  assert.doesNotMatch(workflow, /capture-auditable-demo|auditable-demo-passport|resolve-auditable-demo-source/u);
  assert.equal((workflow.match(/\/build\.yml@v4\b/gu) || []).length, 1);
});

test("manual auditable demo owns one independent Buildchain invocation", () => {
  const workflow = read(".github/workflows/auditable-demo.yml");
  assert.match(workflow, /materialize:[\s\S]*type: boolean/u);
  assert.match(workflow, /base-ref:[\s\S]*default: dev\/v0\/v0\.2/u);
  assert.match(workflow, /auditable-demo-binary:[\s\S]*build\.yml@v4/u);
  assert.match(workflow, /auditable-demo:[\s\S]*\.declarative-auditable-demo\.yml@v4/u);
  assert.match(workflow, /binary-artifact-name: \$\{\{ fromJSON\(needs\.auditable-demo-binary\.outputs\.artifact-coordinates-json\)\.artifacts\[0\]\.name \}\}/u);
  assert.match(workflow, /binary-artifact-digest: \$\{\{ fromJSON\(needs\.auditable-demo-binary\.outputs\.artifact-coordinates-json\)\.artifacts\[0\]\.digest \}\}/u);
  assert.equal((workflow.match(/\/build\.yml@v4\b/gu) || []).length, 1);
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

test("binary metadata binds the exact executable closure", () => {
  for (const relative of ["scripts/build-binary.mjs", "scripts/verify-signed-binary.mjs"]) {
    assert.match(read(relative), /executableFiles:\s*\[\{ path: [^,]+, sha256: [^}]+ \}\]/u, relative);
  }
});

test("repository persists only reviewed floating Buildchain v4 authorities", () => {
  const repositoryFiles = [
    ".github/workflows/build.yml",
    ".github/workflows/buildchain-ref-promotion.yml",
    ".github/workflows/native-dev-delivery.yml",
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
  const retiredInvocation = /@kungfu-tech\/buildchain@3(?:\.|\b)|@v3(?:-alpha)?\b|Buildchain v3|"ref": "v3(?:-alpha)?"/u;
  for (const relative of repositoryFiles) {
    assert.doesNotMatch(read(relative), retiredInvocation, relative);
  }
  const stableAuthority = "fea8e21dcec2cbf21b9e7fca8fefb537b6b6999c";
  const alphaAuthority = "1805957f942139806f71cc89536895380f71383c";
  const workflowFiles = [
    ".github/workflows/auditable-demo.yml",
    ".github/workflows/build.yml",
    ".github/workflows/buildchain-ref-promotion.yml",
    ".github/workflows/verify.yml",
    ".github/workflows/artifact-signing-dogfood.yml",
    ".github/workflows/v4-stage-capsule-canary.yml",
    ".github/workflows/v4-adopter-delivery-qualification.yml",
  ];
  for (const relative of workflowFiles) {
    const refs = [...read(relative).matchAll(/kungfu-systems\/buildchain\/\.github\/workflows\/[^\s]+@([^\s]+)/gu)];
    assert.ok(refs.length > 0, relative);
    assert.ok(refs.every((match) => ["v4", "v4-alpha"].includes(match[1])), relative);
    assert.doesNotMatch(read(relative), /@[0-9a-f]{40}\b|buildchain-ref:\s*[0-9a-f]{40}\b/u, relative);
  }
  const qualification = read(".github/workflows/v4-adopter-delivery-qualification.yml");
  assert.match(qualification, /v4-adopter-delivery\.yml@v4-alpha/u);
  assert.equal((qualification.match(/v4-adopter-delivery\.yml@v4-alpha\b/gu) || []).length, 1);
  assert.equal((qualification.match(/dev-pr-auto-merge\.yml@v4-alpha\b/gu) || []).length, 1);
  const stableLock = JSON.parse(read(".buildchain/contract-lock.json")).buildchain;
  const alphaLock = JSON.parse(read(".buildchain/alpha-contract-lock.json")).buildchain;
  assert.equal(stableLock.majorLine, "v4");
  assert.equal(stableLock.ref, "v4");
  assert.equal(alphaLock.majorLine, "v4");
  assert.equal(alphaLock.ref, "v4-alpha");
  assert.equal(stableLock.resolvedSha, stableAuthority);
  assert.equal(alphaLock.resolvedSha, alphaAuthority);
  assert.notEqual(alphaLock.resolvedSha, stableAuthority);
  assert.equal(JSON.parse(read(".buildchain/platform-signing-policy.json")).buildchainAuthority.exactSha, stableAuthority);
});

test("protected dev delivery uses the hosted Buildchain Warrant producer", () => {
  const workflow = read(".github/workflows/native-dev-delivery.yml");
  assert.match(workflow, /dev-pr-auto-merge\.yml@v4-alpha/u);
  assert.match(workflow, /delivery-warrant-mode: required/u);
  assert.match(workflow, /ready-label: state\/ready/u);
  assert.match(workflow, /landing-mode: auto/u);
  assert.match(workflow, /github-token: \$\{\{ secrets\.BUILDCHAIN_PROMOTION_TOKEN \}\}/u);

  const bootstrap = read(".github/workflows/v4-adopter-delivery-qualification.yml");
  assert.match(bootstrap, /bootstrap-delivery:[\s\S]*github\.event\.action == 'labeled'/u);
  assert.match(bootstrap, /bootstrap-delivery:[\s\S]*github\.event\.pull_request\.number == 144/u);
  assert.match(bootstrap, /bootstrap-delivery:[\s\S]*github\.event\.pull_request\.head\.ref == 'fix\/v4-alpha-promotion-admission'/u);
  assert.match(bootstrap, /bootstrap-delivery:[\s\S]*dev-pr-auto-merge\.yml@v4-alpha/u);
  assert.match(bootstrap, /bootstrap-delivery:[\s\S]*delivery-warrant-mode: required/u);
  assert.match(bootstrap, /bootstrap-delivery:[\s\S]*buildchain-ref: v4-alpha/u);
  assert.match(bootstrap, /native-command:[\s\S]*hostedtoolcache\/node[\s\S]*node --version[\s\S]*npm run check/u);
  assert.match(bootstrap, /native-heartbeat-seconds: 30/u);
  assert.doesNotMatch(bootstrap, /workflow_dispatch:[\s\S]*inputs:/u);
  assert.match(bootstrap, /bootstrap-delivery:[\s\S]*ready-label: state\/ready/u);
});
