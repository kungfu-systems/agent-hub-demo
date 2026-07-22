import { createHash } from "node:crypto";

export function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function digest(value) {
  return `sha256:${createHash("sha256").update(`${canonicalJson(value)}\n`).digest("hex")}`;
}

export function assertRoot(root) {
  if (!/^sha256:[a-f0-9]{64}$/.test(root)) {
    throw new Error(`invalid content root: ${root}`);
  }
}
