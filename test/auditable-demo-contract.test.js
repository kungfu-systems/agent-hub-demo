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
  assert.match(workflow, /auditable-demo-materialize:[\s\S]*type: boolean/u);
  assert.match(workflow, /auditable-demo-base-ref:[\s\S]*default: dev\/v0\/v0\.2/u);
  assert.match(
    workflow,
    /uses: kungfu-systems\/buildchain\/\.github\/workflows\/\.declarative-auditable-demo\.yml@f4f2471269521e56a6f1c2a743f8244dc2a9a557/u,
  );
  assert.match(workflow, /binary-artifact-name: \$\{\{ fromJSON\(needs\.auditable-demo-binary\.outputs\.artifact-coordinates-json\)\.artifacts\[0\]\.name \}\}/u);
  assert.match(workflow, /binary-artifact-digest: \$\{\{ fromJSON\(needs\.auditable-demo-binary\.outputs\.artifact-coordinates-json\)\.artifacts\[0\]\.digest \}\}/u);
  assert.match(workflow, /scenario-path: \.buildchain\/auditable-demo\.json/u);
  assert.match(workflow, /renderer-image: ghcr\.io\/kungfu-systems\/build-images\/demo-renderer@sha256:3a49708163fedaaabe07b45bba910026a1828151b5d4e9bbdaf0d62e75c927c1/u);
  assert.doesNotMatch(workflow, /build\.yml@v3-alpha|buildchain-ref: v3-alpha/u);
  assert.match(workflow, /auditable-demo-binary:[\s\S]*if: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.auditable-demo-mode != 'off' \}\}/u);
  assert.match(workflow, /auditable-demo-promotion:[\s\S]*needs: build[\s\S]*needs\.build\.outputs\.artifact-coordinates-json/u);
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

test("repository invokes only the exact reviewed Buildchain v4 authority", () => {
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
  const retiredInvocation = /@kungfu-tech\/buildchain@3(?:\.|\b)|@v3(?:-alpha)?\b|Buildchain v3|"ref": "v3(?:-alpha)?"/u;
  for (const relative of repositoryFiles) {
    assert.doesNotMatch(read(relative), retiredInvocation, relative);
  }
  const authority = "f4f2471269521e56a6f1c2a743f8244dc2a9a557";
  for (const relative of [
    ".github/workflows/build.yml",
    ".github/workflows/buildchain-ref-promotion.yml",
    ".github/workflows/verify.yml",
    ".github/workflows/artifact-signing-dogfood.yml",
    ".github/workflows/v4-stage-capsule-canary.yml",
  ]) {
    const refs = [...read(relative).matchAll(/kungfu-systems\/buildchain\/\.github\/workflows\/[^\s]+@([0-9a-f]{40})/gu)];
    assert.ok(refs.length > 0, relative);
    assert.ok(refs.every((match) => match[1] === authority), relative);
  }
  const stableLock = JSON.parse(read(".buildchain/contract-lock.json")).buildchain;
  const alphaLock = JSON.parse(read(".buildchain/alpha-contract-lock.json")).buildchain;
  assert.equal(stableLock.majorLine, "v4");
  assert.equal(stableLock.ref, "v4");
  assert.equal(alphaLock.majorLine, "v4");
  assert.equal(alphaLock.ref, "v4-alpha");
  assert.equal(stableLock.resolvedSha, authority);
  assert.equal(alphaLock.resolvedSha, authority);
  assert.equal(JSON.parse(read(".buildchain/platform-signing-policy.json")).buildchainAuthority.exactSha, authority);
});
