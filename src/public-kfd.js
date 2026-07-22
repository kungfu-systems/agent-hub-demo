import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { digest } from "./canonical.js";

const require = createRequire(import.meta.url);

function readExport(specifier) {
  const path = require.resolve(specifier);
  const bytes = readFileSync(path);
  return { path, bytes, json: JSON.parse(bytes.toString("utf8")) };
}

export function loadPublicKfdProfile() {
  const packageJson = readExport("@kungfu-tech/kfd/package.json");
  const manifest = readExport("@kungfu-tech/kfd/protocols/agent-hub/manifest.json");
  return {
    package: packageJson.json.name,
    packageVersion: packageJson.json.version,
    profileId: manifest.json.profile.id,
    profileVersion: manifest.json.profile.version,
    manifest: manifest.json,
    manifestDigest: `sha256:${createHash("sha256").update(manifest.bytes).digest("hex")}`,
    source: "public-npm",
  };
}
