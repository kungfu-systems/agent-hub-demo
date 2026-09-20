import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { parse } from "smol-toml";

const root = new URL("../", import.meta.url);
const read = file => readFileSync(new URL(file, root), "utf8");

test("all product lanes require final signature verification before KFD evidence and packaging", () => {
  const config = parse(read(".buildchain/buildchain.toml"));
  const policy = JSON.parse(read(".buildchain/platform-signing-policy.json"));
  assert.deepEqual(config.products.flatMap(product => product.platforms), ["linux-x64", "macos-arm64", "windows-x64"]);
  for (const product of config.products) {
    assert.deepEqual(product.verify, ["npm run verify:signed-binary", "npm run qualify:buildchain-release", "npm run package:product"]);
  }
  assert.equal(policy.platforms["linux-x64"].profile, "detached-signature-v1");
  assert.equal(policy.platforms["macos-arm64"].profile, "apple-developer-id");
  for (const platform of ["linux-x64", "macos-arm64"]) {
    assert.equal(policy.platforms[platform].state, "signed");
    assert.equal(policy.platforms[platform].signingRequestCount, 1);
  }
  assert.equal(policy.platforms["windows-x64"].state, "unsigned-exception");
  assert.equal(policy.platforms["windows-x64"].authenticode, false);
  assert.equal(policy.platforms["windows-x64"].signingRequestCount, 0);
});

test("published dual-entry runtime cannot silently bypass missing finalization evidence", () => {
  const env = { ...process.env };
  delete env.BUILDCHAIN_SIGNING_REQUEST_COUNT;
  delete env.BUILDCHAIN_ARTIFACT_SIGNING_STATE;
  const result = spawnSync(process.execPath, ["scripts/verify-signed-binary.mjs"], { cwd: root, env, encoding: "utf8" });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Buildchain finalization signing state environment is required/u);
});
