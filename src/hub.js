import {
  generateKeyPairSync,
  sign as signBytes,
  verify as verifyBytes,
} from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { canonicalJson, digest } from "./canonical.js";
import { FileCas, JsonState } from "./cas.js";
import { loadPublicKfdProfile } from "./public-kfd.js";

export const FAILURE_CODES = [
  "profile-version-unsupported",
  "profile-root-mismatch",
  "required-feature-unsupported",
  "identity-unresolved",
  "authority-unresolved",
  "authority-expired",
  "authority-revoked",
  "authority-amplification",
  "fact-cut-unavailable",
  "causal-gap",
  "payload-digest-mismatch",
  "idempotency-conflict",
  "conflict-visible",
  "disclosure-insufficient",
  "required-field-withheld",
  "completion-unproved",
  "local-policy-rejected",
];

const OPERATIONS = [
  "capability-advertisement",
  "responsibility-proposal",
  "fact-admission",
  "supersession",
  "completion-assessment",
  "warrant-revocation",
];

const FEATURES = [
  "explicit-receiver-verdict",
  "warrant-attenuation",
  "visible-conflict",
];

function nowIso(clock) {
  return new Date(clock()).toISOString();
}

function sign(body, identity, privateKey) {
  const root = digest(body);
  const signature = signBytes(null, Buffer.from(canonicalJson(body)), privateKey).toString("base64");
  return { body, root, signature, signer: identity };
}

function verifySigned(signed) {
  if (!signed?.body || digest(signed.body) !== signed.root) return false;
  return verifyBytes(
    null,
    Buffer.from(canonicalJson(signed.body)),
    signed.signer?.publicKey ?? "",
    Buffer.from(signed.signature ?? "", "base64"),
  );
}

function identityPaths(root) {
  return {
    metadata: join(root, "identity.json"),
    privateKey: join(root, "identity-private.pem"),
  };
}

function loadOrCreateIdentity(root, hubId, clock) {
  mkdirSync(root, { recursive: true });
  const paths = identityPaths(root);
  try {
    return {
      identity: JSON.parse(readFileSync(paths.metadata, "utf8")),
      privateKey: readFileSync(paths.privateKey, "utf8"),
    };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const pair = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const identity = {
    hubId,
    nodeId: `${hubId}/node`,
    actorId: `${hubId}/agent`,
    publicKey: pair.publicKey,
    issuedAt: nowIso(clock),
  };
  identity.root = digest(identity);
  writeFileSync(paths.metadata, `${canonicalJson(identity)}\n`, { mode: 0o600 });
  writeFileSync(paths.privateKey, pair.privateKey, { mode: 0o600 });
  return { identity, privateKey: pair.privateKey };
}

function verdict(status, reasonCodes, extra = {}, clock = Date.now) {
  return {
    contract: "agent-hub-demo.receiver-verdict/v1",
    status,
    reasonCodes,
    decidedAt: nowIso(clock),
    acceptedRoots: [],
    conflictRoots: [],
    completion: "unassessed",
    ...extra,
  };
}

export class AgentHub {
  constructor(root, hubId, { clock = Date.now } = {}) {
    this.root = root;
    this.clock = clock;
    this.cas = new FileCas(join(root, "cas"));
    const keys = loadOrCreateIdentity(root, hubId, clock);
    this.identity = keys.identity;
    this.privateKey = keys.privateKey;
    this.state = new JsonState(join(root, "hub-state.json"), {
      deliveryKeys: {},
      semanticRoots: {},
      revokedWarrants: [],
      verdictRoots: [],
      acceptedObjectRoots: [],
    });
    this.kfd = loadPublicKfdProfile();
  }

  capabilities() {
    return {
      $schema: "https://kfd.libkungfu.dev/schemas/kfd-agent-hub/capabilities.schema.json",
      schemaVersion: 1,
      contract: "kfd-agent-hub-capabilities",
      identity: {
        hubId: this.identity.hubId,
        nodeId: this.identity.nodeId,
        actorId: this.identity.actorId,
      },
      profileVersions: [this.kfd.profileVersion],
      requiredFeatures: FEATURES,
      optionalFeatures: ["inline-payload"],
      operations: OPERATIONS,
      topologies: ["local-peer", "offline-device"],
      disclosureModes: ["full", "partial", "redacted", "reference-only", "intentionally-withheld"],
      failureCodes: FAILURE_CODES,
      bindings: [
        {
          id: "local-file-bundle",
          mediaTypes: ["application/json"],
          authentication: "ed25519 signature with content-addressed warrants",
          transportReceipts: true,
          duplicateDelivery: "at-least-once",
        },
      ],
      limits: { maxInlineBytes: 65536, maxEnvelopeBytes: 1048576 },
      authorityRoots: [this.identity.root],
      issuedAt: this.identity.issuedAt,
    };
  }

  capabilityRoot() {
    return digest(this.capabilities());
  }

  store(value) {
    return this.cas.put(value);
  }

  issueWarrant({
    holderId = this.identity.actorId,
    targetHubId,
    subjectRoot,
    allowedActions,
    forbiddenActions = ["declare-remote-completion"],
    validFrom = nowIso(this.clock),
    expiresAt,
    parent = null,
  }) {
    const body = {
      contract: "agent-hub-demo.warrant/v1",
      issuerId: this.identity.actorId,
      holderId,
      targetHubId,
      subjectRoot,
      allowedActions: [...allowedActions].sort(),
      forbiddenActions: [...forbiddenActions].sort(),
      validFrom,
      expiresAt,
      delegationDepth: parent ? parent.body.delegationDepth + 1 : 0,
      ...(parent ? { parentRoot: parent.root } : {}),
    };
    return sign(body, this.identity, this.privateKey);
  }

  makeDelivery({
    deliveryId,
    operation,
    target,
    object,
    warrantChain,
    requiredFeatures = FEATURES,
    disclosure = { mode: "full", availability: "available", omittedPaths: [] },
  }) {
    const objectRoot = this.store(object);
    const body = {
      contract: "agent-hub-demo.delivery/v1",
      deliveryId,
      idempotencyKey: `${this.identity.hubId}/${deliveryId}`,
      operation,
      source: this.identity,
      targetHubId: target.identity.hubId,
      object,
      objectRoot,
      requiredFeatures: [...requiredFeatures].sort(),
      disclosure,
      warrantChain,
      createdAt: nowIso(this.clock),
    };
    return sign(body, this.identity, this.privateKey);
  }

  revokeWarrant(root) {
    const state = this.state.read();
    if (!state.revokedWarrants.includes(root)) state.revokedWarrants.push(root);
    state.revokedWarrants.sort();
    this.state.write(state);
    return this.store({ contract: "agent-hub-demo.revocation/v1", warrantRoot: root, revokedAt: nowIso(this.clock) });
  }

  #checkWarrantChain(chain, delivery) {
    if (!Array.isArray(chain) || chain.length === 0) return "authority-unresolved";
    for (let index = 0; index < chain.length; index += 1) {
      const current = chain[index];
      if (!verifySigned(current)) return "authority-unresolved";
      if (current.body.targetHubId !== this.identity.hubId) return "authority-unresolved";
      if (current.body.subjectRoot !== delivery.objectRoot) return "authority-unresolved";
      if (new Date(current.body.validFrom).getTime() > this.clock()) return "authority-unresolved";
      if (new Date(current.body.expiresAt).getTime() <= this.clock()) return "authority-expired";
      if (this.state.read().revokedWarrants.includes(current.root)) return "authority-revoked";
      if (!current.body.allowedActions.includes(delivery.operation)) return "authority-unresolved";
      if (current.body.forbiddenActions.includes(delivery.operation)) return "authority-amplification";
      if (index > 0) {
        const parent = chain[index - 1];
        const actionsAreSubset = current.body.allowedActions.every((action) => parent.body.allowedActions.includes(action));
        const forbiddenPreserved = parent.body.forbiddenActions.every((action) => current.body.forbiddenActions.includes(action));
        const expiryNarrowed = new Date(current.body.expiresAt) <= new Date(parent.body.expiresAt);
        const lineageMatches = current.body.parentRoot === parent.root
          && current.body.issuerId === parent.body.holderId
          && current.body.delegationDepth === parent.body.delegationDepth + 1;
        if (!actionsAreSubset || !forbiddenPreserved || !expiryNarrowed || !lineageMatches) {
          return "authority-amplification";
        }
      }
    }
    return null;
  }

  #reject(reasonCode, extra = {}) {
    const result = verdict("rejected", [reasonCode], extra, this.clock);
    const root = this.store(result);
    const state = this.state.read();
    state.verdictRoots.push(root);
    this.state.write(state);
    return { ...result, root };
  }

  admit(signedDelivery) {
    if (!verifySigned(signedDelivery)) return this.#reject("identity-unresolved");
    const delivery = signedDelivery.body;
    if (delivery.targetHubId !== this.identity.hubId) return this.#reject("local-policy-rejected");
    if (digest(delivery.object) !== delivery.objectRoot) return this.#reject("payload-digest-mismatch");

    const supportedFeatures = new Set([...FEATURES, "inline-payload"]);
    if (delivery.requiredFeatures.some((feature) => !supportedFeatures.has(feature))) {
      return this.#reject("required-feature-unsupported");
    }

    const disclosure = delivery.disclosure ?? {};
    const conflated = (disclosure.availability === "unavailable" && disclosure.mode === "intentionally-withheld")
      || (disclosure.availability === "intentionally-withheld" && disclosure.mode !== "intentionally-withheld");
    if (conflated) return this.#reject("disclosure-insufficient");

    const warrantFailure = this.#checkWarrantChain(delivery.warrantChain, delivery);
    if (warrantFailure) return this.#reject(warrantFailure);

    const state = this.state.read();
    const prior = state.deliveryKeys[delivery.idempotencyKey];
    if (prior) {
      if (prior.deliveryRoot !== signedDelivery.root) return this.#reject("idempotency-conflict");
      return { ...this.cas.get(prior.verdictRoot), root: prior.verdictRoot, duplicate: true };
    }

    const semanticKey = delivery.object.semanticKey ?? delivery.objectRoot;
    const priorRoots = state.semanticRoots[semanticKey] ?? [];
    if (priorRoots.length > 0 && !priorRoots.includes(delivery.objectRoot)) {
      const result = verdict("conflicted", ["conflict-visible"], {
        conflictRoots: [...priorRoots, delivery.objectRoot].sort(),
      }, this.clock);
      const verdictRoot = this.store(result);
      state.semanticRoots[semanticKey] = result.conflictRoots;
      state.deliveryKeys[delivery.idempotencyKey] = { deliveryRoot: signedDelivery.root, verdictRoot };
      state.verdictRoots.push(verdictRoot);
      this.state.write(state);
      return { ...result, root: verdictRoot };
    }

    this.store(delivery.object);
    const result = verdict("admitted", ["admission-accepted"], {
      acceptedRoots: [delivery.objectRoot],
      receiptRoot: digest({ deliveryRoot: signedDelivery.root, receiver: this.identity.root }),
    }, this.clock);
    const verdictRoot = this.store(result);
    state.semanticRoots[semanticKey] = [delivery.objectRoot];
    state.deliveryKeys[delivery.idempotencyKey] = { deliveryRoot: signedDelivery.root, verdictRoot };
    state.acceptedObjectRoots.push(delivery.objectRoot);
    state.verdictRoots.push(verdictRoot);
    this.state.write(state);
    return { ...result, root: verdictRoot };
  }

  exportBundle() {
    const state = this.state.read();
    const roots = [...new Set([
      ...state.acceptedObjectRoots,
      ...state.verdictRoots,
      ...Object.values(state.deliveryKeys).map((entry) => entry.verdictRoot),
    ])].sort();
    const body = {
      contract: "agent-hub-demo.export/v1",
      hubIdentity: this.identity,
      capabilityRoot: this.capabilityRoot(),
      objects: roots.map((root) => ({ root, value: this.cas.get(root) })),
      state,
    };
    return { ...body, bundleRoot: digest(body) };
  }

  importBundle(bundle) {
    const { bundleRoot, ...body } = bundle;
    if (digest(body) !== bundleRoot) throw new Error("export/import drift: bundle root mismatch");
    for (const entry of body.objects) {
      if (digest(entry.value) !== entry.root) throw new Error(`export/import drift: object ${entry.root}`);
      this.store(entry.value);
    }
    this.state.write(body.state);
    return { bundleRoot, importedObjects: body.objects.length };
  }
}

export function inspectSigned(value) {
  return { rootValid: digest(value.body) === value.root, signatureValid: verifySigned(value) };
}
