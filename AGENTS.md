# Agent entry point

Agent Hub Demo is a clean-room, two-Hub implementation of the public KFD Agent
Hub contract. Product use and claim boundaries are mapped in `docs/MAP.md`.

To build or change the repository, follow `CONTRIBUTING.md`. The primary checks
are `npm test`, `npm run runtime100`, and `npm run build`.

The implementation must remain independent of Kungfu Core, private packages,
local paths, submodules, copied KFD evaluators, and copied Buildchain
orchestration. KFD semantics belong upstream; this repository owns only its
Hub implementation and adapter.
