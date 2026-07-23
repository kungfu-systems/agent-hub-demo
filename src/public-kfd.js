import { EMBEDDED_KFD } from "./generated-facts.js";

export function loadPublicKfdProfile() {
  return structuredClone(EMBEDDED_KFD);
}
