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

# Release qualification

## Consumer migration and blocked publication

The consumer has two generated callers at `@v4`: normal
`public-ops-pipeline.yml` and attempt-based `public-ops-recover.yml`.
`.buildchain/buildchain.toml` uses schema 2 and declares three binary products,
GitHub Release archive targets, the two governed version files, protected
channel routes, independent review and merge queue requirements.

Each platform runs dependency installation, `npm run check`, signature
verification, KFD qualification, then archive assembly, in that order. No
repository script owns provider publication or channel promotion. Old payload
collection, publication capability callbacks, contract locks and specialized
workflows have been retired from the active consumer tree.

**Publication remains blocked.** The published Buildchain 4.1.3 contract has
no product signing/finalization fields and its credentialless build phase does
not deliver `BUILDCHAIN_SIGNING_REQUEST_COUNT`,
`BUILDCHAIN_ARTIFACT_SIGNING_STATE` or native signing results. The retained
verifier fails with `Buildchain finalization signing state environment is required`.
The TOML intentionally uses only published fields; it does not declare an
unmerged signing API or manufacture successful evidence.

Linux requires one detached cryptographic signature. macOS requires one
Developer ID signature, hardened runtime, accepted notarization and a standalone
online ticket. Windows requires zero signing requests, `NotSigned` native
status and the existing bounded unsigned exception. These requirements are in
`.buildchain/platform-signing-policy.json` and `scripts/verify-signed-binary.mjs`.
OIDC build attestations do not replace native executable signatures.

[Buildchain PR #3870](https://github.com/kungfu-systems/buildchain/pull/3870)
is owned by another work thread. Its proposed Apple archive signing support
alone does not supply the Linux detached-signature requirement or prove this
consumer's final-byte protocol. Upstream repair, release and ownership are
outside this consumer-only change. Existing consumer
[PR #165](https://github.com/kungfu-systems/agent-hub-demo/pull/165) is also
separate work and is not superseded by a successful release here.

Before enabling this migration, the upstream public contract must expose and
publish the required signature/final-byte evidence, the consumer must adopt
that published declaration, and all three hosted platforms must pass KFD and
signature verification. Archive publication and downstream Passport binding
must then be verified against an actual release. Keep this PR in draft while
these conditions remain unproved.

## Preserved and deferred functionality

The two Hub implementation, CLI, embedded protocol facts, KFD-1/2/3 gates and
twelve-case negative matrix remain product responsibilities. Public Buildchain
CLI verification is pinned to npm version 4.1.3, independently of the hosted
`@v4` orchestration selection. It uses no internal workflow checkout path.

Each proposed `.tar.gz` preserves the executable under `dist/`, its checksum
and manifest, product artifact, Agent Hub adoption/report/evidence/verification,
KFD-1 and KFD-3 witnesses, KFD-2 claim, mutation report and declared signing
result. Archive tests prove byte preservation and reject substitution, missing
evidence and symlinks; they do not certify fixture signatures or KFD semantics.

The pinned public CLI currently brings five npm audit findings (two moderate,
three high), including upstream TOML parser denial of service and HTTP-client
advisories. These are development/verification dependencies, not embedded SEA
runtime dependencies. No automatic dependency override or upstream repair is
included in this migration; hosted qualification must account for that risk.

The old independent signing dogfood, canary, bootstrap and animation workflows
are removed so only the two standard callers remain. The animation declaration
and already-published media remain available, but automatic media regeneration
is deferred pending a supported public entry capability. No new animation or
Release Passport is claimed by the local migration tests.

## Reproduce locally

Use Node.js 24 or newer, npm and Git:

```bash
npm ci --registry=https://registry.npmjs.org/
npm run check
npm run qualify:buildchain-release
npm run verify:signed-binary
```

The final command must fail without genuine Buildchain finalization evidence.
The KFD-only command exercises product gates on local build bytes and is not
signature qualification. Hosted product ordering requires signatures first.
Do not set signing-success variables to bypass the blocked release path.

## Frozen negative matrix

The machine-readable report contains twelve deliberate cases:

1. report contract drift;
2. KFD package source-cut drift;
3. profile manifest-root drift;
4. protocol manifest-root drift;
5. vector-suite root drift;
6. failure-inventory root drift;
7. dual-Hub capability/handshake root drift;
8. suite coverage policy drift;
9. certification/claim-scope widening;
10. export/import result drift;
11. adapter artifact byte drift;
12. Buildchain adoption declaration contract drift.

Every case records its stable machine error, responsible owner, verifier
evidence, and next action. The workflow fails unless all twelve are rejected.

## Claim and nonclaims

The release evidence supports one limited claim: first-party clean-room
structural independence within the exact tested scope. It does not establish
KFD certification or qualifying status, general third-party Hub
interoperability, a production security assessment, hosted-service behavior,
performance, or production fitness.

Residual risk remains: deliberate fixture mutations do not enumerate every
possible implementation defect, and the GitHub-hosted runner matrix cannot
cover every operating-system or filesystem variant.
