import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { parse } from "smol-toml";

const root = new URL("../", import.meta.url);
const read = file => readFileSync(new URL(file, root), "utf8");

test("consumer exposes exactly the pipeline and attempt recovery callers", () => {
  assert.deepEqual(readdirSync(new URL(".github/workflows/", root)).sort(), ["buildchain-recover.yml", "buildchain.yml"]);
  for (const [file, entry] of [["buildchain.yml", "public-ops-pipeline"], ["buildchain-recover.yml", "public-ops-recover"]]) {
    const source = read(`.github/workflows/${file}`);
    const calls = [...source.matchAll(/^\s+uses: (\S+)/gmu)].map(match => match[1]);
    assert.deepEqual(calls, [`kungfu-systems/buildchain/.github/workflows/${entry}.yml@v4`]);
    assert.doesNotMatch(source, /\b(?:steps|runs-on|run):/u);
    assert.match(source, /secrets: inherit/u);
  }
  const recover = read(".github/workflows/buildchain-recover.yml");
  assert.match(recover, /attempt: \$\{\{ inputs\.attempt \}\}/u);
  assert.match(recover, /runtime-ref: \$\{\{ inputs\.runtime-ref \}\}/u);
});

test("schema 2 declares archive products, governed version files and protected routes", () => {
  const config = parse(read(".buildchain/buildchain.toml"));
  assert.equal(config.schema, 2);
  assert.deepEqual(Object.keys(config).sort(), ["channels", "products", "review", "schema", "version"]);
  assert.deepEqual(config.review, { minimum_approvals: 1, code_owners: true, merge_queue: true });
  assert.deepEqual(config.version.files.map(file => [file.path, file.key]), [["package.json", "version"], [".buildchain/kfd/agent-hub.json", "adapter.version"]]);
  assert.deepEqual(config.channels.slice(-3).map(route => route.operation), ["alpha", "stable", "major"]);
  assert.equal(config.channels.filter(route => route.to === "dev/v0/v0.2").length, 6);
  for (const product of config.products) {
    assert.equal(product.type, "binary");
    assert.deepEqual(product.build, ["npm run check"]);
    assert.equal(product.artifacts[0].kind, "archive");
    assert.equal(product.artifacts[0].path, `dist/packages/${product.id}.tar.gz`);
    assert.equal(product.artifacts[0].filename, `${product.id}.tar.gz`);
    assert.deepEqual(product.targets, [{ provider: "github-release", artifacts: [product.artifacts[0].id] }]);
  }
  assert.equal(JSON.parse(read("package.json")).private, true);
});
