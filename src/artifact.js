import { EMBEDDED_ADAPTER_ARTIFACT } from "./generated-facts.js";

export function adapterArtifact() {
  return structuredClone(EMBEDDED_ADAPTER_ARTIFACT);
}
