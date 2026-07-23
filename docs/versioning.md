---
status: active
period: ongoing
theme: agent-hub-demo-versioning
doc_type: process-rule
source_level: local-files
confidence: high
sensitivity: public
evidence_grade: B
review_state: self-reviewed
last_reviewed: 2026-07-23
---

# Versioning

Agent Hub Demo uses Buildchain `semver` with automatic next-version selection.
The active line is `v0.2`:

```text
dev/v0/v0.2 -> alpha/v0/v0.2 -> release/v0/v0.2
```

Normal changes start on a classified work branch and enter
`dev/v0/v0.2` through review. Channel branches and `publish-gate/*` are
Buildchain-managed merge targets, not development branches. Exact tags such as
`v0.1.0-alpha.0` are immutable evidence; floating tags are moved only by
Buildchain promotion.

The Buildchain v2 alpha release-candidate authority seals both exact npm targets
and exact caller-bound GitHub Release targets. Agent Hub Demo uses only
`github-release:kungfu-systems/agent-hub-demo`, an empty npm package identity,
and a credentialless product predicate. Manual promotion remains dry-run-only;
successful Verify runs on reviewed alpha/release channel commits may publish.

## Version transaction boundary

`package.json` and its lockfile are the product version state. Source-mode
commands and standalone binaries read that state through `src/product.js`;
the SEA build bundles the exact transaction version. Generated protocol facts
therefore bind the public KFD profile and stable adapter implementation sources,
but deliberately exclude both the product version and `package.json`.

This separation is a release invariant. After Buildchain selects a version,
`npm run check` may rebuild ignored artifacts, but it must not rewrite tracked
protocol facts. A promotion diagnosis such as `Version verification changed
files outside version state` means the generator crossed this boundary. Fix
the source/generator ownership and repeat the protected dev-to-alpha flow; do
not commit transaction output or bypass the promotion gate.

## Decision log

| Date | Decision | Line | Impact | Rationale |
| --- | --- | --- | --- | --- |
| 2026-07-22 | Adopt canonical Buildchain semver/auto governance | `v0.1` | patch | Release governance and CI ownership change without widening the public Agent Hub runtime contract. The existing `v0.1.0-alpha.0` tag remains immutable; promotion stays dry-run-only while the GitHub-Release admission lane is unavailable. |
| 2026-07-23 | Publish standalone binary reference release | `v0.2` | minor | The new public CLI and binary distribution demonstrate Linux, macOS, and Windows executables plus KFD-1/2/3 and Release Passport evidence while keeping the existing Hub protocol and explicit non-certification boundary. |
