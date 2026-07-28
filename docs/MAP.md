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
- `.buildchain/buildchain.toml` — semver/auto version state, lifecycle
  commands, and the only three-platform artifact-signing declarations.
- `.github/workflows/build.yml` — PR-stage Buildchain release-candidate build.
- `.github/workflows/verify.yml` — stable protected-branch check surface.
- `.github/workflows/buildchain-ref-promotion.yml` — thin Buildchain-owned
  promotion planner; dry-run-only until Buildchain supports sealed
  GitHub-Release-only admission.
- `scripts/qualify-release.mjs` — offline fail-closed mutation oracle.
- `scripts/qualify-buildchain-release.mjs` — product-specific KFD evidence run
  inside the Buildchain release-candidate lifecycle.
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
