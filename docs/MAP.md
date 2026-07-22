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
- `.buildchain/buildchain.toml` — lifecycle commands.
- `.github/workflows/build.yml` — public Buildchain consumer workflow.
- `CONTRIBUTING.md` — contribution, DCO, and upstream-boundary guidance.

## Evidence boundary

The repository proves a first-party clean-room implementation against the
named public package, adapter, topology, file binding, scenarios, platform, and
content roots. It does not prove certification, security, production fitness,
external adoption, or independent vendor interoperability.
