# Agent Hub Demo

Agent Hub Demo is a clean-room demonstration of building a KFD-compatible
Agent Hub with Buildchain. It implements two independent Node.js Hubs backed by
separate file-based content-addressed stores and consumes KFD only through its
public npm package and adapter contract.

The repository is deliberately small, but the implementation is real. Each Hub
owns a distinct Ed25519 identity, capability document, content-addressed store,
admission state, revocation set, and export bundle. The file binding records
transport receipts while the Hub keeps delivery, admission, and completion as
independent facts.

## Quick start

Requirements: Node.js 22 or newer and npm.

```bash
git clone https://github.com/kungfu-systems/agent-hub-demo.git
cd agent-hub-demo
npm ci --registry=https://registry.npmjs.org/
npm test
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
npx --yes --package @kungfu-tech/buildchain@2.14.14 buildchain kfd hub test --for agent
```

The gate reads [`.buildchain/kfd/agent-hub.json`](.buildchain/kfd/agent-hub.json),
runs the fixed public KFD Hub suite against the real adapter, and writes its
lock and verified report under `.buildchain/artifacts/kfd-agent-hub/`.

## Agent adapter

The adapter uses the public KFD Agent Hub JSONL stdio envelopes:

```bash
node src/adapter.js inspect
node src/adapter.js jsonl --root .demo/adapter
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

It is not KFD certification, a production security assessment, independent
vendor adoption, plural-vendor interoperability, or proof of production
fitness. The file binding is the tested transport in this release; HTTP and
hosted operation are outside the current claim.

## Project map

- [`docs/MAP.md`](docs/MAP.md) routes product users and reviewers.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) covers local development and DCO.
- [`.buildchain/kfd/agent-hub.json`](.buildchain/kfd/agent-hub.json) is the one
  builder-owned adoption declaration.
- [`src/hub.js`](src/hub.js) is the product implementation.
- [`src/adapter.js`](src/adapter.js) is the black-box KFD adapter.

## License

Apache-2.0. See [`LICENSE`](LICENSE). Project names and marks are addressed in
[`TRADEMARK.md`](TRADEMARK.md).
