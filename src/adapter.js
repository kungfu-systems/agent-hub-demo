#!/usr/bin/env node
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

import { adapterArtifact } from "./artifact.js";
import { digest } from "./canonical.js";
import { createEnvironment, runCoreDemo, runRuntime100 } from "./scenarios.js";

const ADAPTER = {
  id: "agent-hub-demo",
  version: "0.1.0-alpha.0",
  topology: "two-independent-file-cas-hubs",
};

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

export function handshake(root) {
  const { hubA, hubB } = createEnvironment(root);
  return {
    adapter: ADAPTER,
    artifact: adapterArtifact(),
    binding: "jsonl-stdio/v1",
    hubs: [hubA, hubB].map((hub) => ({
      hubId: hub.identity.hubId,
      capabilities: hub.capabilities(),
      capabilityRoot: hub.capabilityRoot(),
    })),
  };
}

export function evaluate(input, root) {
  const scenario = input.scenario ?? input.vector?.scenario ?? input.vector?.id ?? "core-demo";
  const scenarioInput = input.input ?? input.vector?.input ?? input;
  if (scenario === "handshake") return { status: "accepted", code: "adapter-ready", verdict: "not-applicable", observations: handshake(root) };
  if (scenario === "runtime-100") {
    const result = runRuntime100(join(root, "runtime-100"));
    return { status: result.admitted === 100 ? "accepted" : "rejected", code: result.admitted === 100 ? "delivery-recorded" : "local-policy-rejected", verdict: result.admitted === 100 ? "admitted" : "rejected", observations: result };
  }
  const safeScenario = scenario.replaceAll(/[^a-zA-Z0-9._-]/g, "-");
  const scenarioRoot = join(root, safeScenario);

  if (scenario === "negotiate-exact-profile" || scenario === "reject-unknown-required-feature" || scenario === "reject-profile-root-drift") {
    const inspection = handshake(join(scenarioRoot, "negotiation"));
    const leftRoot = scenarioInput.localProfileRoot ?? scenarioInput.profileRoot;
    const rightRoot = scenarioInput.remoteProfileRoot ?? scenarioInput.profileRoot;
    const supported = new Set([
      ...inspection.hubs[0].capabilities.requiredFeatures,
      ...inspection.hubs[0].capabilities.optionalFeatures,
      "transport-receipts",
    ]);
    const unsupported = (scenarioInput.requiredFeatures ?? []).filter((feature) => !supported.has(feature));
    if (unsupported.length > 0) {
      return { status: "rejected", code: "required-feature-unsupported", verdict: "rejected", observations: { unsupported, capabilityRoots: inspection.hubs.map((hub) => hub.capabilityRoot) } };
    }
    if (leftRoot !== rightRoot) {
      return { status: "rejected", code: "profile-root-mismatch", verdict: "rejected", observations: { localProfileRoot: leftRoot, remoteProfileRoot: rightRoot } };
    }
    const supportedVersion = inspection.hubs[0].capabilities.profileVersions.includes(scenarioInput.profile);
    return supportedVersion
      ? { status: "accepted", code: "capability-negotiated", verdict: "admitted", observations: { profile: scenarioInput.profile, profileRoot: leftRoot, capabilityRoots: inspection.hubs.map((hub) => hub.capabilityRoot) } }
      : { status: "rejected", code: "profile-version-unsupported", verdict: "rejected", observations: { profile: scenarioInput.profile } };
  }

  if (scenario === "record-delivery-without-admission" || scenario === "retain-delayed-delivery") {
    const { hubB } = createEnvironment(join(scenarioRoot, "transport"));
    const transport = {
      contract: "agent-hub-demo.transport-record/v1",
      state: scenarioInput.delayed ? "delayed" : "delivered",
      receiptRoot: scenarioInput.receiptRoot ?? null,
      admitted: false,
    };
    const transportRoot = hubB.store(transport);
    const semanticAdmissions = Object.keys(hubB.state.read().deliveryKeys).length;
    return { status: "accepted", code: "delivery-recorded", verdict: "not-applicable", observations: { transportRoot, transport, semanticAdmissions } };
  }

  const report = runCoreDemo(join(scenarioRoot, "product"));
  const reportObservations = { reportRoot: digest(report), report };
  const fromVerdict = (selected, code = selected.reasonCodes[0]) => ({
    status: selected.status === "conflicted" ? "conflicted" : selected.status === "rejected" ? "rejected" : "accepted",
    code,
    verdict: selected.status,
    observations: reportObservations,
  });

  if (scenario === "preserve-identical-duplicate") {
    return {
      status: report.results.duplicate.duplicate ? "accepted" : "error",
      code: report.results.duplicate.duplicate ? "duplicate-preserved" : "local-policy-rejected",
      verdict: "not-applicable",
      observations: reportObservations,
    };
  }
  if (scenario === "reject-idempotency-conflict") return fromVerdict(report.results.idempotencyConflict);
  if (scenario === "admit-under-local-authority") return fromVerdict(report.results.fact);
  if (scenario === "reject-revoked-warrant") return fromVerdict(report.results.revoked);
  if (scenario === "surface-concurrent-conflict" || scenario === "surface-offline-reconnect-conflict") return fromVerdict(report.results.conflict);
  if (scenario === "reject-hidden-last-write-wins") {
    const unresolved = report.results.conflict.status === "conflicted" && (scenarioInput.conflictRoots?.length ?? 0) >= 2;
    return unresolved
      ? { status: "rejected", code: "conflict-visible", verdict: "rejected", observations: { ...reportObservations, rejectedPolicy: scenarioInput.policy } }
      : { status: "error", code: "local-policy-rejected", verdict: "not-applicable", observations: reportObservations };
  }

  if (scenario === "attenuate-delegated-authority" || scenario === "reject-authority-amplification") {
    const { hubA, hubB } = createEnvironment(join(scenarioRoot, "authority"));
    const operation = scenarioInput.childActions[0];
    const object = { contract: "agent-hub-demo.authority-probe/v1", semanticKey: scenario, operation };
    const objectRoot = hubA.store(object);
    const epoch = Date.parse("2026-07-22T00:00:00.000Z");
    const parent = hubA.issueWarrant({
      targetHubId: hubB.identity.hubId,
      subjectRoot: objectRoot,
      allowedActions: scenarioInput.parentActions,
      forbiddenActions: [],
      expiresAt: new Date(epoch + scenarioInput.parentExpiresAt * 1000).toISOString(),
    });
    const child = hubA.issueWarrant({
      targetHubId: hubB.identity.hubId,
      subjectRoot: objectRoot,
      allowedActions: scenarioInput.childActions,
      forbiddenActions: [],
      expiresAt: new Date(epoch + scenarioInput.childExpiresAt * 1000).toISOString(),
      parent,
    });
    const delivery = hubA.makeDelivery({ deliveryId: scenario, operation, target: hubB, object, warrantChain: [parent, child] });
    const result = hubB.admit(delivery);
    return result.status === "admitted"
      ? { status: "accepted", code: "authority-attenuated", verdict: "admitted", observations: { parentRoot: parent.root, childRoot: child.root, verdictRoot: result.root } }
      : fromVerdict(result);
  }

  if (scenario === "retain-partial-knowledge" || scenario === "retain-intentionally-withheld" || scenario === "retain-unavailable") {
    const { hubB } = createEnvironment(join(scenarioRoot, "knowledge"));
    const knowledge = {
      contract: "agent-hub-demo.knowledge-state/v1",
      disclosure: scenarioInput.disclosure,
      knownFields: scenarioInput.knownFields ?? [],
      omittedFields: scenarioInput.omittedFields ?? [],
      reason: scenarioInput.reason ?? null,
    };
    const knowledgeRoot = hubB.store(knowledge);
    const knowledgeVerdict = scenarioInput.disclosure === "intentionally-withheld"
      ? "intentionally-withheld"
      : scenarioInput.disclosure === "unavailable" ? "unavailable" : "not-applicable";
    return { status: "accepted", code: "partial-knowledge-retained", verdict: knowledgeVerdict, observations: { knowledgeRoot, knowledge } };
  }

  if (scenario === "reject-call-success-as-completion") {
    const separated = report.objectSeparation.completion === "unassessed" && scenarioInput.callSucceeded === true;
    return separated
      ? { status: "rejected", code: "completion-unproved", verdict: "rejected", observations: reportObservations }
      : { status: "error", code: "local-policy-rejected", verdict: "not-applicable", observations: reportObservations };
  }

  if (scenario === "preserve-export-import-roots") {
    const requestedRootsPreserved = scenarioInput.exportedProfileRoot === scenarioInput.importedProfileRoot
      && scenarioInput.exportedPayloadRoot === scenarioInput.importedPayloadRoot;
    const recovered = report.results.recovery.importedObjects > 0 && report.results.driftRejected;
    return requestedRootsPreserved && recovered
      ? { status: "accepted", code: "export-import-preserved", verdict: "admitted", observations: reportObservations }
      : { status: "rejected", code: "profile-root-mismatch", verdict: "rejected", observations: reportObservations };
  }

  if (scenario === "reject-export-import-drift") {
    const drift = scenarioInput.exportedProfileRoot !== scenarioInput.importedProfileRoot && report.results.driftRejected;
    return drift
      ? { status: "rejected", code: "profile-root-mismatch", verdict: "rejected", observations: reportObservations }
      : { status: "error", code: "local-policy-rejected", verdict: "not-applicable", observations: reportObservations };
  }

  return { status: "error", code: "adapter-invalid-input", verdict: "not-applicable", observations: { scenario } };
}

export function respond(request, root) {
  if (request?.schemaVersion !== 1 || request?.contract !== "kfd.agent-hub-adapter-request/v1") {
    throw new Error("adapter request contract invalid");
  }
  const result = request.operation === "handshake"
    ? { status: "accepted", code: "adapter-ready", verdict: "not-applicable", observations: handshake(join(root, "handshake")) }
    : evaluate(request.input, join(root, request.requestId.replaceAll(/[^a-zA-Z0-9._-]/g, "-")));
  const hubs = result.observations.hubs ?? result.observations.report?.hubs;
  return {
    schemaVersion: 1,
    contract: "kfd.agent-hub-adapter-response/v1",
    requestId: request.requestId,
    adapter: ADAPTER,
    status: result.status,
    code: result.code,
    verdict: result.verdict,
    ...(hubs ? { hubs } : {}),
    observations: result.observations,
  };
}

async function jsonl(root) {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let response;
    try {
      response = respond(JSON.parse(line), root);
    } catch (error) {
      let requestId = "invalid-request";
      try { requestId = JSON.parse(line).requestId ?? requestId; } catch {}
      response = {
        schemaVersion: 1,
        contract: "kfd.agent-hub-adapter-response/v1",
        requestId,
        adapter: ADAPTER,
        status: "error",
        code: "adapter-invalid-input",
        verdict: "not-applicable",
        observations: { message: error.message },
      };
    }
    process.stdout.write(`${JSON.stringify(response)}\n`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2] ?? "jsonl";
  const root = resolve(arg("--root", `.demo/adapter-${process.pid}`));
  mkdirSync(root, { recursive: true });
  if (command === "inspect") {
    process.stdout.write(`${JSON.stringify(handshake(join(root, "inspect")), null, 2)}\n`);
  } else if (command === "run") {
    const scenario = arg("--scenario", "core-demo");
    const result = scenario === "runtime-100" ? runRuntime100(join(root, scenario)) : runCoreDemo(join(root, scenario));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (command === "jsonl") {
    await jsonl(root);
  } else {
    throw new Error(`unknown adapter command: ${command}`);
  }
}
