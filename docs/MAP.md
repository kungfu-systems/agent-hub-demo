---
status: draft
period: ongoing
theme: agent-hub-demo-release
doc_type: guide
source_level: local-files
confidence: medium
sensitivity: public
evidence_grade: B
review_state: unreviewed
last_reviewed: 2026-09-20
ai_provenance:
  model_family: GPT-6
  product: Codex
  generated_at: 2026-09-20
  visible_context: Consumer source and published Buildchain contract.
  invisible_context_boundary: No signing credentials or unpublished execution results inspected.
---

# Documentation map

## Use the product

- `README.md` — installation, demo flow, adapter example, and claim boundary.
- `src/cli.js` — product demo entry point.
- `src/adapter.js` — JSONL stdio KFD adapter entry point.

## Understand the implementation

- `src/hub.js` — identity, warrants, admission, conflicts, revocation, and
  export/import.
- `src/cas.js` — file-backed content-addressed object storage and atomic state.
- `src/scenarios.js` — public positive and negative product scenarios.
- `test/hub.test.js` — executable behavior evidence.

## Build and review

- `.buildchain/kfd/agent-hub.json` — the single adoption declaration.
- `.buildchain/kfd/kfd-2/registry.json` — product-owned public release claim,
  audit boundary, responsibility, and residual risk.
- `.buildchain/kfd/kfd-3/surfaces.json` — registered public collaboration
  surfaces used by the release witness.
- `.buildchain/buildchain.toml` — schema 2 products, archive targets, governed
  versions, protected routes and review requirements.
- `.buildchain/platform-signing-policy.json` — required Linux/macOS signatures
  and the bounded Windows unsigned exception.
- `.github/workflows/buildchain.yml` — standard Buildchain pipeline caller.
- `.github/workflows/buildchain-recover.yml` — recovery of an exact attempt.
- `scripts/package-product.mjs` — explicit per-platform archive inventory.
- `scripts/qualify-release.mjs` — offline fail-closed mutation oracle.
- `scripts/qualify-buildchain-release.mjs` — product-specific KFD evidence run
  through the public, lockfile-pinned Buildchain CLI.
- `scripts/verify-signed-binary.mjs` — final-byte platform signature and product
  smoke verification before KFD and Passport evidence is sealed.
- `docs/RELEASE_QUALIFICATION.md` — exact release evidence and claim limits.
- `docs/versioning.md` — active Buildchain line and KFD-1 version-impact log.
- `CONTRIBUTING.md` — contribution, DCO, and upstream-boundary guidance.

## Evidence boundary

The repository proves a first-party clean-room implementation against the
named public package, adapter, topology, file binding, scenarios, platform, and
content roots. It does not prove certification, security, production fitness,
external adoption, or independent vendor interoperability.
