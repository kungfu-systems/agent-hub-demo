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
last_reviewed: 2026-07-22
---

# Versioning

Agent Hub Demo uses Buildchain `semver` with automatic next-version selection.
The active line is `v0.1`:

```text
dev/v0/v0.1 -> alpha/v0/v0.1 -> release/v0/v0.1
```

Normal changes start on a classified work branch and enter
`dev/v0/v0.1` through review. Channel branches and `publish-gate/*` are
Buildchain-managed merge targets, not development branches. Exact tags such as
`v0.1.0-alpha.0` are immutable evidence; floating tags are moved only by
Buildchain promotion.

Buildchain v3 is the only admitted Buildchain major line. Agent Hub Demo
publishes only through GitHub Releases, so the canonical promotion workflow
runs in dry-run mode and creates no tag, release, or `publish-gate/*` ref until
an exact matching provider admission is sealed. This fail-closed boundary must
not be bypassed with a consumer-owned publisher or a false npm identity.

## Decision log

| Date | Decision | Line | Impact | Rationale |
| --- | --- | --- | --- | --- |
| 2026-07-22 | Adopt canonical Buildchain semver/auto governance | `v0.1` | patch | Release governance and CI ownership change without widening the public Agent Hub runtime contract. The existing `v0.1.0-alpha.0` tag remains immutable; promotion stays dry-run-only while the GitHub-Release admission lane is unavailable. |
