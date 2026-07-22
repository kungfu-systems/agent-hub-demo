import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { adapterArtifact } from "../src/artifact.js";
import { canonicalJson, digest } from "../src/canonical.js";
import { handshake } from "../src/adapter.js";

// Runtime identity material stays outside the publishable Buildchain artifacts.
const root = ".demo/build-inspect";
const artifact = adapterArtifact();
const inspection = handshake(root);
const product = {
  contract: "agent-hub-demo.product-artifact/v1",
  adapter: artifact,
  hubs: inspection.hubs,
  claimBoundary: "Clean-room structural-independence witness only.",
};
product.root = digest(product);
mkdirSync("dist", { recursive: true });
mkdirSync(".buildchain/artifacts", { recursive: true });
writeFileSync(join("dist", "agent-hub-demo.json"), `${canonicalJson(product)}\n`);
writeFileSync(join(".buildchain/artifacts", "product.json"), `${canonicalJson(product)}\n`);
process.stdout.write(`${JSON.stringify({ status: "built", root: product.root, adapterRoot: artifact.root })}\n`);
