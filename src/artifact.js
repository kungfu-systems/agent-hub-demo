import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { digest } from "./canonical.js";

const repositoryRoot = join(fileURLToPath(new URL("..", import.meta.url)));

function filesBelow(path) {
  return readdirSync(path, { withFileTypes: true })
    .flatMap((entry) => {
      const child = join(path, entry.name);
      return entry.isDirectory() ? filesBelow(child) : [child];
    });
}

export function adapterArtifact() {
  const paths = [
    ...filesBelow(join(repositoryRoot, "src")),
    join(repositoryRoot, "package.json"),
  ].filter((path) => statSync(path).isFile());
  const files = paths
    .map((path) => ({
      path: relative(repositoryRoot, path).replaceAll("\\", "/"),
      sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const body = {
    contract: "agent-hub-demo.adapter-artifact/v1",
    entry: "src/adapter.js",
    files,
  };
  return { ...body, root: digest(body) };
}
