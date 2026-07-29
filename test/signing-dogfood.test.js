import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

test("consumer declares three honest signing intents without credentials", () => {
  const config = fs.readFileSync(path.join(root, ".buildchain/buildchain.toml"), "utf8");
  assert.equal((config.match(/\[\[signing\.artifacts\]\]/g) || []).length, 3);
  assert.match(config, /kind = "binary"[\s\S]*platforms = \["linux-x64"\]/);
  assert.match(config, /kind = "mach-o"[\s\S]*platforms = \["macos"\]/);
  assert.match(config, /kind = "pe"[\s\S]*platforms = \["windows-x64"\]/);
  assert.doesNotMatch(config, /certificate|password|private.?key|team.?id|notary|timestamp.?url|environment/iu);
});

test("release verification consumes final signed bytes before KFD evidence", () => {
  const workflow = fs.readFileSync(path.join(root, ".github/workflows/artifact-signing-dogfood.yml"), "utf8");
  const verifier = fs.readFileSync(path.join(root, "scripts/verify-signed-binary.mjs"), "utf8");
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.match(workflow, /actions: read/);
  assert.equal((workflow.match(/authority\/v3\/v3\.0\/artifact-signing/g) || []).length, 2);
  assert.doesNotMatch(workflow, /train\/v3\/v3\.0\/artifact-signing-authority/);
  assert.match(workflow, /BUILDCHAIN_PROMOTION_TOKEN: \$\{\{ secrets\.BUILDCHAIN_PROMOTION_TOKEN \}\}/);
  assert.doesNotMatch(workflow, /CERTIFICATE|PASSWORD|PRIVATE_KEY|TEAM_ID|NOTARY|TIMESTAMP_URL/);
  assert.match(workflow, /verify-command: npm run verify:signed-release/);
  assert.match(packageJson.scripts["verify:signed-release"], /verify:signed-binary.*qualify:buildchain-release/);
  assert.match(verifier, /detached-signature-v1/);
  assert.match(verifier, /apple-developer-id/);
  assert.match(verifier, /windows-authenticode/);
  assert.match(verifier, /codesign/);
  assert.match(verifier, /notarytool-accepted/);
  assert.match(verifier, /standalone-notary-ticket-online/);
  assert.doesNotMatch(verifier, /spctl/);
  assert.match(verifier, /Get-AuthenticodeSignature/);
});
