import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { assertRoot, canonicalJson, digest } from "./canonical.js";

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${canonicalJson(value)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}

export class FileCas {
  constructor(root) {
    this.root = root;
    this.objects = join(root, "objects");
    mkdirSync(this.objects, { recursive: true });
  }

  pathFor(root) {
    assertRoot(root);
    return join(this.objects, `${root.slice("sha256:".length)}.json`);
  }

  put(value) {
    const root = digest(value);
    const path = this.pathFor(root);
    try {
      writeFileSync(path, `${canonicalJson(value)}\n`, { flag: "wx", mode: 0o600 });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const existing = this.get(root);
      if (digest(existing) !== root) {
        throw new Error(`content-addressed object drift at ${root}`);
      }
    }
    return root;
  }

  get(root) {
    const value = JSON.parse(readFileSync(this.pathFor(root), "utf8"));
    if (digest(value) !== root) {
      throw new Error(`content-addressed object digest mismatch at ${root}`);
    }
    return value;
  }
}

export class JsonState {
  constructor(path, initial) {
    this.path = path;
    this.initial = initial;
  }

  read() {
    return readJson(this.path, structuredClone(this.initial));
  }

  write(value) {
    writeJsonAtomic(this.path, value);
  }
}
