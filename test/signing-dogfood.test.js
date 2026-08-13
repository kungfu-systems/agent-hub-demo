import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

test("consumer signs Linux and macOS and declares Windows unsigned without credentials", () => {
  const config = fs.readFileSync(path.join(root, ".buildchain/buildchain.toml"), "utf8");
  const policy = JSON.parse(fs.readFileSync(path.join(root, ".buildchain/platform-signing-policy.json"), "utf8"));
  assert.equal((config.match(/\[\[signing\.artifacts\]\]/g) || []).length, 2);
  assert.match(config, /kind = "binary"[\s\S]*platforms = \["linux-x64"\]/);
  assert.match(config, /kind = "mach-o"[\s\S]*platforms = \["macos"\]/);
  assert.doesNotMatch(config, /kind = "pe"|platforms = \["windows-x64"\]/);
  assert.deepEqual(policy.platforms["windows-x64"], {
    state: "unsigned-exception",
    authenticode: false,
    timestamped: false,
    signingRequestCount: 0,
    reasonCode: "windows-authenticode-credential-not-configured",
    scope: "agent-hub-demo-windows-x64",
    releaseChannels: ["alpha", "stable"],
    reviewTrigger: "authenticode-credential-onboarding",
  });
  assert.doesNotMatch(config, /certificate|password|private.?key|team.?id|notary|timestamp.?url|environment/iu);
});

test("release verification consumes final platform bytes before KFD evidence", () => {
  const workflow = fs.readFileSync(path.join(root, ".github/workflows/artifact-signing-dogfood.yml"), "utf8");
  const verifier = fs.readFileSync(path.join(root, "scripts/verify-signed-binary.mjs"), "utf8");
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.match(workflow, /actions: read/);
  assert.equal((workflow.match(/fea8e21dcec2cbf21b9e7fca8fefb537b6b6999c/g) || []).length, 2);
  assert.match(workflow, /BUILDCHAIN_PROMOTION_TOKEN: \$\{\{ secrets\.BUILDCHAIN_PROMOTION_TOKEN \}\}/);
  assert.doesNotMatch(workflow, /CERTIFICATE|PASSWORD|PRIVATE_KEY|TEAM_ID|NOTARY|TIMESTAMP_URL/);
  assert.match(workflow, /artifact-finalization-command: npm run verify:final-artifact/);
  assert.match(workflow, /artifact-finalization-on-platform: true/);
  assert.match(packageJson.scripts["verify:final-artifact"], /verify:signed-binary.*prepare:release-evidence/);
  assert.match(verifier, /detached-signature-v1/);
  assert.match(verifier, /apple-developer-id/);
  assert.match(verifier, /unsigned-exception/);
  assert.match(verifier, /explicitly-unsigned/);
  assert.match(verifier, /codesign/);
  assert.match(verifier, /notarytool-accepted/);
  assert.match(verifier, /standalone-notary-ticket-online/);
  assert.doesNotMatch(verifier, /spctl/);
  assert.match(verifier, /Get-AuthenticodeSignature/);
  assert.match(verifier, /NotSigned/);
  assert.match(verifier, /process\.env\.BUILDCHAIN_SIGNING_REQUEST_COUNT/);
  assert.match(verifier, /process\.env\.BUILDCHAIN_ARTIFACT_SIGNING_STATE/);
});
