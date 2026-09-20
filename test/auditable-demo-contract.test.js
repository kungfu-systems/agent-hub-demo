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
