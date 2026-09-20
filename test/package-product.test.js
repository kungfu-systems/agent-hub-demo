import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { packageProduct } from "../scripts/package-product.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "agent-hub-package-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (file, bytes) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), bytes);
  };
  const binary = "dist/agent-hub-demo-linux-x64";
  const bytes = Buffer.from("exact fixture executable bytes");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  write(binary, bytes);
  write("package.json", JSON.stringify({ private: true, version: "0.2.0-alpha.10" }));
  write(`${binary}.sha256`, `${sha256}  agent-hub-demo-linux-x64\n`);
  write("dist/agent-hub-demo.json", "{}\n");
  write(".buildchain/artifacts/binary-linux-x64.json", JSON.stringify({
    contract: "agent-hub-demo.binary-artifact/v1", platform: "linux-x64",
    file: binary, sha256, size: bytes.length,
    smoke: { version: { product: "agent-hub-demo", version: "0.2.0-alpha.10" } },
    signing: { state: "signed", evidencePath: ".buildchain/artifacts/signing/linux/result.json" },
  }));
  for (const file of [
    ".buildchain/platform-signing-policy.json",
    ...["adoption-lock", "evidence", "report", "verification"].map(name => `.buildchain/artifacts/kfd-agent-hub/${name}.json`),
    ".buildchain/kfd/kfd-2/claims/first-party-clean-room-structural-independence.json",
    ...["kfd-1-witness", "kfd-1-gate-section", "kfd-3-prebuild", "kfd-3-artifact", "qualification-report"].map(name => `.buildchain/release-qualification/${name}.json`),
    ".buildchain/artifacts/signing/linux/result.json",
  ]) write(file, JSON.stringify({ fixture: file }));
  write(".demo/identity.json", "private runtime fixture");
  write(".buildchain/artifacts/unrelated.json", "unrelated fixture");
  write("dist/unrelated.txt", "unrelated fixture");
  return { root, write, binary, bytes };
}

test("archive preserves exact product and evidence bytes without runtime or unrelated files", t => {
  const { root, binary, bytes } = fixture(t);
  const result = packageProduct(root, "linux-x64");
  const entries = execFileSync("tar", ["-tzf", result.output], { encoding: "utf8" }).trim().split("\n");
  assert.deepEqual(entries.sort(), result.files);
  assert.ok(entries.includes(".buildchain/artifacts/signing/linux/result.json"));
  assert.ok(entries.includes(".buildchain/release-qualification/kfd-3-artifact.json"));
  assert.ok(entries.every(file => !file.startsWith(".demo/") && !file.includes("unrelated")));
  for (const file of entries) {
    assert.deepEqual(execFileSync("tar", ["-xOzf", result.output, file]), readFileSync(join(root, file)));
  }
  assert.deepEqual(execFileSync("tar", ["-xOzf", result.output, binary]), bytes);
});

test("archive refuses binary substitution and missing evidence", t => {
  const f = fixture(t);
  f.write(f.binary, "substituted binary");
  assert.throws(() => packageProduct(f.root, "linux-x64"), /differs from its metadata/u);
  f.write(f.binary, f.bytes);
  rmSync(join(f.root, ".buildchain/artifacts/signing/linux/result.json"));
  assert.throws(() => packageProduct(f.root, "linux-x64"), /ENOENT/u);
  assert.throws(() => packageProduct(f.root, "../outside"), /unsupported platform/u);
});

test("archive rejects stale versions and unsigned metadata before publishing bytes", t => {
  const f = fixture(t);
  f.write("package.json", JSON.stringify({ private: true, version: "0.2.0-alpha.11" }));
  assert.throws(() => packageProduct(f.root, "linux-x64"), /governed source version/u);
  f.write("package.json", JSON.stringify({ private: true, version: "0.2.0-alpha.10" }));
  const file = ".buildchain/artifacts/binary-linux-x64.json";
  const metadata = JSON.parse(readFileSync(join(f.root, file), "utf8"));
  delete metadata.signing;
  f.write(file, JSON.stringify(metadata));
  assert.throws(() => packageProduct(f.root, "linux-x64"), /final platform signing metadata/u);
});

test("archive refuses symlink inputs and redirected output", t => {
  const f = fixture(t);
  rmSync(join(f.root, f.binary));
  symlinkSync(join(f.root, ".demo/identity.json"), join(f.root, f.binary));
  assert.throws(() => packageProduct(f.root, "linux-x64"), /regular paths/u);
  rmSync(join(f.root, f.binary));
  f.write(f.binary, f.bytes);
  symlinkSync(join(f.root, ".demo"), join(f.root, "dist/packages"), "dir");
  assert.throws(() => packageProduct(f.root, "linux-x64"), /symbolic link/u);
});
