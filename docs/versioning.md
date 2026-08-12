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
last_reviewed: 2026-08-12
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

The exact reviewed Buildchain v4 release-candidate authority seals both exact npm targets
and exact caller-bound GitHub Release targets. Agent Hub Demo uses only
`github-release:kungfu-systems/agent-hub-demo`, an empty npm package identity,
and a credentialless product predicate. Manual promotion remains dry-run-only;
successful Verify runs on reviewed alpha/release channel commits may publish.

## Version transaction boundary

`package.json`, its lockfile, and the Agent Hub declaration's
`adapter.version` are the product version state. Buildchain updates both
configured JSON keys in one version-state commit. Source-mode commands and
standalone binaries read the package state through `src/product.js`; the SEA
build bundles the exact transaction version. Generated protocol facts therefore
bind the public KFD profile and stable adapter implementation sources, but
deliberately exclude both the product version and `package.json`.

Each reviewed release candidate predeclares the exact next transaction version
in both configured version-state files before its cross-platform binaries are
built. Buildchain independently recomputes that next version and owns the tag,
release-state ref, and publication transaction. The consumer publication
predicate rejects any capability whose version differs from the candidate
source version, so an older binary cannot be published under a newer tag.

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
| 2026-07-23 | Separate transaction version from embedded protocol facts | `v0.2` | patch | Package version state now enters source commands and SEA binaries directly, while generated KFD and adapter facts remain stable during Buildchain version verification. |
| 2026-07-23 | Version the Agent Hub declaration atomically | `v0.2` | patch | The KFD conformance declaration now advances with `package.json`, so promotion-time verification binds the exact public adapter version instead of a stale prerelease. |
| 2026-07-23 | Bind candidate binaries to the governed release version | `v0.2` | patch | Reviewed candidates predeclare the exact next version, while Buildchain independently verifies that version and owns the tag and publication transaction; the product predicate denies mismatches. |
| 2026-08-02 | Add declarative binary animation publication | `v0.2` | minor | The then-current Buildchain authority consumes the exact same-run standalone Linux binary, verifies its product metadata and embedded facts, captures independent native 1080p and 720p terminal sessions, and binds rendered media to a Release Passport. Source launchers and other products are outside this demo contract. |
| 2026-08-12 | Adopt Buildchain v4 as sole production authority | `v0.2` | patch | Every production workflow pins one independently reviewed v4 commit. Linux and macOS remain signed; Windows is published only under a machine-readable zero-request unsigned exception and cannot be represented as Authenticode-signed. |
