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

# Agent Hub Demo

Agent Hub Demo is a small reference project for shipping a KFD-compatible
Agent Hub as Buildchain-managed standalone binaries.

This branch migrates to exactly two workflow callers:
[buildchain.yml](.github/workflows/buildchain.yml) for normal delivery and
[buildchain-recover.yml](.github/workflows/buildchain-recover.yml) for recovery
of an exact attempt. Product commands, archive outputs and protected channel
routes are declared in [buildchain.toml](.buildchain/buildchain.toml).

**Signed publication is blocked upstream.** The published Buildchain 4.1.3
dual-entry contract does not yet deliver native signing/finalization evidence.
Linux x64 still requires a detached signature, macOS arm64 still requires
Developer ID signing and notarization, and Windows x64 retains its explicit
unsigned exception. The verifier rejects absent evidence before packaging;
this migration is not proof of a new release. See
[release qualification and migration blockers](docs/RELEASE_QUALIFICATION.md).

The implementation uses two independent Hubs backed by separate file-based
content-addressed stores. KFD enters through the public npm package at build
time; its exact public profile facts are embedded into the executables, so
released binaries do not require Node.js, npm, a source checkout, or private
packages.

The repository is deliberately small, but the implementation is real. Each Hub
owns a distinct Ed25519 identity, capability document, content-addressed store,
admission state, revocation set, and export bundle. The file binding records
transport receipts while the Hub keeps delivery, admission, and completion as
independent facts.

<!-- agent-hub-demo:auditable-demo:start -->
## Agent Hub Demo standalone binary

[![Agent Hub Demo standalone binary](docs/evidence/auditable-demo/ebadc9805b8045711e021c62210019914ae2b5b09ae26a334e4ae6a72a8c49a6/agent-hub-demo/demo.gif)](docs/evidence/auditable-demo/ebadc9805b8045711e021c62210019914ae2b5b09ae26a334e4ae6a72a8c49a6/agent-hub-demo/public-evidence.json)

Animation scenario:

```text
$ agent-hub-demo demo --root ./agent-hub-demo-run --output ./agent-hub-demo-run/report.json --presentation
```

Native renditions: [1080p MP4](docs/evidence/auditable-demo/ebadc9805b8045711e021c62210019914ae2b5b09ae26a334e4ae6a72a8c49a6/agent-hub-demo/demo.mp4) · [1080p WebM](docs/evidence/auditable-demo/ebadc9805b8045711e021c62210019914ae2b5b09ae26a334e4ae6a72a8c49a6/agent-hub-demo/demo.webm) · [720p MP4](docs/evidence/auditable-demo/ebadc9805b8045711e021c62210019914ae2b5b09ae26a334e4ae6a72a8c49a6/agent-hub-demo/demo-720p.mp4) · [720p WebM](docs/evidence/auditable-demo/ebadc9805b8045711e021c62210019914ae2b5b09ae26a334e4ae6a72a8c49a6/agent-hub-demo/demo-720p.webm)

[Static poster / reduced-motion fallback](docs/evidence/auditable-demo/ebadc9805b8045711e021c62210019914ae2b5b09ae26a334e4ae6a72a8c49a6/agent-hub-demo/poster.png)

<details>
<summary>Evidence and claim boundary</summary>

This animation records one exact same-run standalone binary completing its deterministic local demonstration; it does not certify production security or grant authority from identity, compliance, metadata, scans, registry history, or generation.

[Release Passport](docs/evidence/auditable-demo/ebadc9805b8045711e021c62210019914ae2b5b09ae26a334e4ae6a72a8c49a6/agent-hub-demo/release-passport.json) · [auditable evidence](docs/evidence/auditable-demo/ebadc9805b8045711e021c62210019914ae2b5b09ae26a334e4ae6a72a8c49a6/agent-hub-demo/public-evidence.json)

</details>
<!-- agent-hub-demo:auditable-demo:end -->

## Quick start

Existing GitHub Releases provide the executable for your platform. Download and
run:

```bash
./agent-hub-demo-linux-x64 self-describe --json
./agent-hub-demo-linux-x64 self-verify --json
./agent-hub-demo-linux-x64 demo --root .demo/release
```

On Windows, use `agent-hub-demo-windows-x64.exe`; on macOS, use
`agent-hub-demo-macos-arm64`.

Building from source requires Node.js 24 or newer and npm:

```bash
git clone https://github.com/kungfu-systems/agent-hub-demo.git
cd agent-hub-demo
npm ci --registry=https://registry.npmjs.org/
npm run check
npm run demo
```

`npm run demo` creates a new ignored `.demo/` run. The printed report shows:

- Hub A and Hub B capability documents and roots;
- admitted Fact and Episode objects;
- an idempotent duplicate and a visible semantic conflict;
- rejected authority amplification, expiry, revocation, unknown required
  features, and disclosure-state conflation;
- a verified export/import recovery and a rejected drifted bundle;
- distinct delivery, object, verdict, and completion state.

Run the product-local 100-delivery soak separately:

```bash
npm run runtime100
```

This soak does not replace or qualify the separate KFD Runtime 100 profile.

Run the public Buildchain first-class Agent Hub gate separately:

```bash
node node_modules/@kungfu-tech/buildchain/bin/buildchain.mjs kfd hub test --for agent
```

The gate reads [`.buildchain/kfd/agent-hub.json`](.buildchain/kfd/agent-hub.json),
runs the fixed public KFD Hub suite against the real adapter, and writes its
lock and verified report under `.buildchain/artifacts/kfd-agent-hub/`. The
local verifier is the public npm CLI pinned in package-lock.json. Hosted
orchestration remains owned by the standard Buildchain v4 entrypoints.

Run the release qualification after that positive gate:

```bash
npm run qualify:release
```

The qualification oracle performs twelve deliberate offline mutations across
the declaration, adapter artifact, report and roots, policy scope, and
export/import result. Every case must fail closed with a stable machine error
and an explicit owner, evidence pointer, and next action. See
[`docs/RELEASE_QUALIFICATION.md`](docs/RELEASE_QUALIFICATION.md).

## Agent adapter

The source CLI and released binary expose the same public KFD Agent Hub JSONL
stdio envelopes:

```bash
node src/adapter.js inspect
node src/adapter.js jsonl --root .demo/adapter
./agent-hub-demo-linux-x64 adapter inspect
./agent-hub-demo-linux-x64 adapter jsonl --root .demo/adapter-binary
```

Example handshake request:

```json
{"schemaVersion":1,"contract":"kfd.agent-hub-adapter-request/v1","requestId":"hello","operation":"handshake","input":{}}
```

Each response is one `kfd.agent-hub-adapter-response/v1` JSON object on stdout.
Adapter inspection and the Hub capability documents are computed from the same
live implementation, so their roots can be checked rather than copied.

## What this proves

This repository is a first-party clean-room consumer and a structural-
independence witness. It demonstrates that a builder-owned product can use the
public KFD package, a public black-box adapter boundary, and Buildchain without
depending on Kungfu Core, private packages, local paths, Git submodules, a
copied KFD evaluator, or private Buildchain scripts.

The reference release demonstrates three bounded adoption layers:

- KFD-1 binds every platform executable and product contract artifact
  byte-for-byte to its release-candidate evidence;
- KFD-2 publishes the explicit structural-independence claim, responsibility,
  exclusions, and residual risk;
- KFD-3 declares the participant-facing CLI plus its three-platform
  distribution tasks and artifacts.

The new product packaging command preserves executable and KFD evidence bytes
in one platform archive. The executable remains under `dist/` after extraction.
Existing published releases retain their original assets and Release Passports;
this branch has not qualified a new hosted release or Passport. Signature and
KFD verification must pass before `npm run package:product` is reached.

It is not KFD certification, a production security assessment, independent
vendor adoption, plural-vendor interoperability, or proof of production
fitness. The file binding is the tested transport in this release; HTTP and
hosted operation are outside the current claim.

## Project map

- [`docs/MAP.md`](docs/MAP.md) routes product users and reviewers.
- [`docs/versioning.md`](docs/versioning.md) records the Buildchain release line
  and version-impact decisions.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) covers local development and DCO.
- [`.buildchain/kfd/agent-hub.json`](.buildchain/kfd/agent-hub.json) is the one
  builder-owned adoption declaration.
- [`.buildchain/kfd/kfd-2/registry.json`](.buildchain/kfd/kfd-2/registry.json)
  declares the limited public release claim and residual risk.
- [`.buildchain/kfd/kfd-3/surfaces.json`](.buildchain/kfd/kfd-3/surfaces.json)
  declares the CLI and cross-platform distribution surface.
- [`.buildchain/auditable-demo.json`](.buildchain/auditable-demo.json) declares
  the retained standalone-binary animation scenario. Existing media above is
  historical evidence; automatic regeneration is not wired into the two callers.
- [`scripts/build-binary.mjs`](scripts/build-binary.mjs) owns the per-platform
  Node SEA build and binary smoke checks.
- [`scripts/package-product.mjs`](scripts/package-product.mjs)
  assembles each product archive with an explicit evidence inventory.
- [`src/hub.js`](src/hub.js) is the product implementation.
- [`src/adapter.js`](src/adapter.js) is the black-box KFD adapter.

## License

Apache-2.0. See [`LICENSE`](LICENSE). Project names and marks are addressed in
[`TRADEMARK.md`](TRADEMARK.md).
