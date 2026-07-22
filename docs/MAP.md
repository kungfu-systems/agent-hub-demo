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
- `.buildchain/buildchain.toml` — lifecycle commands.
- `.github/workflows/build.yml` — public Buildchain consumer workflow.
- `.github/workflows/release-qualification.yml` — clean-clone qualification,
  Release Passport verification, public asset upload, and tagged prerelease.
- `scripts/qualify-release.mjs` — offline fail-closed mutation oracle.
- `docs/RELEASE_QUALIFICATION.md` — exact release evidence and claim limits.
- `CONTRIBUTING.md` — contribution, DCO, and upstream-boundary guidance.

## Evidence boundary

The repository proves a first-party clean-room implementation against the
named public package, adapter, topology, file binding, scenarios, platform, and
content roots. It does not prove certification, security, production fitness,
external adoption, or independent vendor interoperability.
