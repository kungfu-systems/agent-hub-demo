# Release qualification

The release workflow starts from a fresh GitHub checkout, installs the exact
public npm dependency graph, runs the product tests and 100-delivery soak,
builds the product artifact, and runs the public Buildchain Agent Hub gate. It
then produces KFD-1, KFD-2, KFD-3, Agent Hub, mutation, and Release Passport
evidence before uploading a checksummed asset bundle.

## Reproduce locally

Requirements: Node.js 22 or newer, npm, and Git.

```bash
npm ci --registry=https://registry.npmjs.org/
npm run check
npx --yes --package @kungfu-tech/buildchain@2.14.15 buildchain kfd hub test --for agent
npm run qualify:release
```

The mutation phase does not start either Hub and does not use private packages,
private services, copied evaluators, or copied Buildchain orchestration. It
changes temporary copies only and asks the public KFD verifier or public
Buildchain inspector to reject them.

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

## Release assets

Tagged releases publish a prerelease containing the product artifact, Agent Hub
report/evidence/verification/adoption lock, KFD witnesses and public claim,
mutation report, Release Passport, and `SHA256SUMS`. The workflow independently
verifies the Release Passport before upload. The bundle includes every sibling
evidence document referenced by the Passport so a downloaded directory can be
verified without the source checkout.

## Claim and nonclaims

The release evidence supports one limited claim: first-party clean-room
structural independence within the exact tested scope. It does not establish
KFD certification or qualifying status, general third-party Hub
interoperability, a production security assessment, hosted-service behavior,
performance, or production fitness.

Residual risk remains: deliberate fixture mutations do not enumerate every
possible implementation defect, and the GitHub-hosted runner matrix cannot
cover every operating-system or filesystem variant.
