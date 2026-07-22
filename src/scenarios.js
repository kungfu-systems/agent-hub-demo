import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { digest } from "./canonical.js";
import { AgentHub } from "./hub.js";

const FIXED_TIME = Date.parse("2026-07-22T00:00:00.000Z");
const FUTURE = "2026-07-23T00:00:00.000Z";
const NARROW_FUTURE = "2026-07-22T12:00:00.000Z";

function clock() {
  return FIXED_TIME;
}

export function createEnvironment(root) {
  mkdirSync(root, { recursive: true });
  return {
    hubA: new AgentHub(join(root, "hub-a"), "demo.local/hub-a", { clock }),
    hubB: new AgentHub(join(root, "hub-b"), "demo.local/hub-b", { clock }),
  };
}

function warrantsFor(hubA, hubB, objectRoot, operation, overrides = {}) {
  const parent = hubA.issueWarrant({
    targetHubId: hubB.identity.hubId,
    subjectRoot: objectRoot,
    allowedActions: [operation, "delegate-warrant"],
    expiresAt: overrides.parentExpiresAt ?? FUTURE,
  });
  const child = hubA.issueWarrant({
    targetHubId: hubB.identity.hubId,
    subjectRoot: objectRoot,
    allowedActions: overrides.childActions ?? [operation],
    forbiddenActions: overrides.forbiddenActions ?? ["declare-remote-completion"],
    expiresAt: overrides.childExpiresAt ?? NARROW_FUTURE,
    parent,
  });
  return [parent, child];
}

function deliver(hubA, hubB, object, deliveryId, operation = "fact-admission", options = {}) {
  const objectRoot = hubA.store(object);
  const warrantChain = options.warrantChain ?? warrantsFor(hubA, hubB, objectRoot, operation, options);
  const signed = hubA.makeDelivery({
    deliveryId,
    operation,
    target: hubB,
    object,
    warrantChain,
    requiredFeatures: options.requiredFeatures,
    disclosure: options.disclosure,
  });
  return { signed, verdict: hubB.admit(signed), objectRoot, warrantChain };
}

export function runCoreDemo(root) {
  const { hubA, hubB } = createEnvironment(root);
  const pursuit = { contract: "agent-hub-demo.pursuit/v1", semanticKey: "pursuit/demo", objective: "preserve a public fact across Hubs" };
  const pursuitRoot = hubA.store(pursuit);
  const atlas = { contract: "agent-hub-demo.atlas/v1", semanticKey: "atlas/demo", pursuitRoot, knownFacts: [] };
  const atlasRoot = hubA.store(atlas);
  const actionBindingRoot = hubA.store({ contract: "agent-hub-demo.action-binding/v1", action: "submit-fact-candidate", pursuitRoot });
  const fact = {
    contract: "agent-hub-demo.fact/v1",
    kind: "fact",
    semanticKey: "fact/demo-temperature",
    value: { unit: "celsius", amount: 21 },
    observedAt: "2026-07-22T00:00:00.000Z",
    pursuitRoot,
    atlasRoot,
    actionBindingRoot,
  };
  const factResult = deliver(hubA, hubB, fact, "fact-1");
  const duplicateVerdict = hubB.admit(factResult.signed);

  const idempotencyConflictFact = { ...fact, semanticKey: "fact/idempotency-conflict", value: "different payload" };
  const idempotencyConflict = deliver(hubA, hubB, idempotencyConflictFact, "fact-1");

  const episode = {
    contract: "agent-hub-demo.episode/v1",
    kind: "episode",
    semanticKey: "episode/demo-capture",
    pursuitRoot,
    inputFactRoots: [],
    resultFactRoots: [factResult.objectRoot],
    actions: ["capture", "submit-fact-candidate"],
    occurredAt: "2026-07-22T00:00:00.000Z",
  };
  const episodeResult = deliver(hubA, hubB, episode, "episode-1");

  const conflictingFact = { ...fact, value: { unit: "celsius", amount: 99 } };
  const conflictResult = deliver(hubA, hubB, conflictingFact, "fact-conflict");

  const amplificationFact = { ...fact, semanticKey: "fact/amplification", value: "candidate" };
  const amplificationRoot = hubA.store(amplificationFact);
  const amplifiedChain = warrantsFor(hubA, hubB, amplificationRoot, "fact-admission", {
    childActions: ["fact-admission", "declare-remote-completion"],
    forbiddenActions: [],
  });
  const amplificationResult = deliver(hubA, hubB, amplificationFact, "fact-amplification", "fact-admission", { warrantChain: amplifiedChain });

  const revokedFact = { ...fact, semanticKey: "fact/revoked", value: "candidate" };
  const revokedRoot = hubA.store(revokedFact);
  const revokedChain = warrantsFor(hubA, hubB, revokedRoot, "fact-admission");
  const revocationRoot = hubB.revokeWarrant(revokedChain.at(-1).root);
  const revokedResult = deliver(hubA, hubB, revokedFact, "fact-revoked", "fact-admission", { warrantChain: revokedChain });

  const expiredFact = { ...fact, semanticKey: "fact/expired", value: "candidate" };
  const expiredRoot = hubA.store(expiredFact);
  const expiredChain = warrantsFor(hubA, hubB, expiredRoot, "fact-admission", {
    parentExpiresAt: "2026-07-21T00:00:00.000Z",
    childExpiresAt: "2026-07-21T00:00:00.000Z",
  });
  const expiredResult = deliver(hubA, hubB, expiredFact, "fact-expired", "fact-admission", { warrantChain: expiredChain });

  const featureFact = { ...fact, semanticKey: "fact/unknown-feature", value: "candidate" };
  const unknownFeatureResult = deliver(hubA, hubB, featureFact, "fact-unknown-feature", "fact-admission", {
    requiredFeatures: ["future-required-feature"],
  });

  const disclosureFact = { ...fact, semanticKey: "fact/disclosure", value: "candidate" };
  const disclosureResult = deliver(hubA, hubB, disclosureFact, "fact-disclosure", "fact-admission", {
    disclosure: { mode: "intentionally-withheld", availability: "unavailable", omittedPaths: ["/value"] },
  });

  const exportBundle = hubB.exportBundle();
  const recovered = new AgentHub(join(root, "recovered"), "demo.local/hub-b-recovered", { clock });
  const recovery = recovered.importBundle(exportBundle);
  const driftedBundle = structuredClone(exportBundle);
  driftedBundle.objects[0].value = { drifted: true };
  let driftError = "";
  try {
    recovered.importBundle(driftedBundle);
  } catch (error) {
    driftError = error.message;
  }

  return {
    contract: "agent-hub-demo.report/v1",
    claimBoundary: "First-party clean-room structural-independence witness; not certification, production security, vendor interoperability, or external adoption.",
    profile: {
      package: hubA.kfd.package,
      packageVersion: hubA.kfd.packageVersion,
      id: hubA.kfd.profileId,
      version: hubA.kfd.profileVersion,
      manifestDigest: hubA.kfd.manifestDigest,
    },
    hubs: [hubA, hubB].map((hub) => ({
      hubId: hub.identity.hubId,
      identityRoot: hub.identity.root,
      capabilityRoot: hub.capabilityRoot(),
      capabilities: hub.capabilities(),
    })),
    results: {
      fact: factResult.verdict,
      duplicate: duplicateVerdict,
      idempotencyConflict: idempotencyConflict.verdict,
      episode: episodeResult.verdict,
      conflict: conflictResult.verdict,
      amplification: amplificationResult.verdict,
      revoked: revokedResult.verdict,
      expired: expiredResult.verdict,
      unknownFeature: unknownFeatureResult.verdict,
      disclosureConflation: disclosureResult.verdict,
      recovery,
      revocationRoot,
      driftRejected: driftError.includes("drift"),
    },
    objectSeparation: {
      deliveryRoot: factResult.signed.root,
      admittedObjectRoot: factResult.objectRoot,
      verdictRoot: factResult.verdict.root,
      completion: factResult.verdict.completion,
      independent: new Set([factResult.signed.root, factResult.objectRoot, factResult.verdict.root]).size === 3,
    },
  };
}

export function runRuntime100(root) {
  const { hubA, hubB } = createEnvironment(root);
  const verdicts = [];
  for (let index = 0; index < 100; index += 1) {
    const object = {
      contract: "agent-hub-demo.fact/v1",
      kind: "fact",
      semanticKey: `runtime-100/fact-${index}`,
      value: { index, parity: index % 2 },
      observedAt: "2026-07-22T00:00:00.000Z",
    };
    verdicts.push(deliver(hubA, hubB, object, `runtime-100-${index}`).verdict);
  }
  return {
    contract: "agent-hub-demo.runtime-100-soak/v1",
    boundary: "Product-local 100-delivery soak. It does not replace or qualify the separate KFD Runtime 100 profile.",
    total: verdicts.length,
    admitted: verdicts.filter((item) => item.status === "admitted").length,
    verdictRoot: digest(verdicts.map((item) => item.root)),
  };
}
