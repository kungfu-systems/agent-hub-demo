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

# Contributing

Thank you for improving Agent Hub Demo.

## Development

Use Node.js 24 or newer and the public npm registry:

```bash
npm ci --registry=https://registry.npmjs.org/
npm run check
```

Keep changes focused. Product behavior belongs in `src/`, black-box adapter
translation belongs in `src/adapter.js`, and tests belong in `test/`. Do not
copy KFD suite logic or Buildchain workflow implementation into this repository.
Open an upstream KFD or Buildchain issue when a generic contract or workflow
capability is missing.

## Commits and pull requests

Use English Conventional Commit titles and sign every commit under the
Developer Certificate of Origin:

```bash
git commit -s -m "feat(hub): describe the change"
```

Create work on a Buildchain-classified branch (`feature/*`, `fix/*`, `chore/*`,
`docs/*`, `ci/*`, or `refactor/*`) and open the pull request against the active
`dev/vX/vX.Y` line. The protected `dev`, `alpha`, `release`, and
`publish-gate/*` channels are not ad-hoc work branches. Version changes,
promotion tags, and GitHub Releases are produced only by the exact reviewed
Buildchain v4 authority after a reviewed channel pull request. The consumer
must not add repository-owned tag, release, signing, or publication fallbacks.

Pull requests should explain behavior, tests, contract impact, and residual
risk. Complete the repository governance checklist in the pull request
template. Never include credentials, tokens, private logs, private paths, or
production data.

## Dual-entry migration status

The only workflow callers are `buildchain.yml` and `buildchain-recover.yml`.
The TOML declares product commands and protected routes; the recovery caller
accepts an exact attempt and an optional repaired runtime ref. Do not restore
retired channel, signing, canary or rendering workflows as release fallbacks.

Local `npm run check` does not qualify publication. Native signatures and final
KFD evidence remain mandatory, and the published dual-entry runtime does not
yet supply the required signing evidence. Keep the migration PR in draft until
[the upstream blockers](docs/RELEASE_QUALIFICATION.md) are resolved and all three
hosted platforms have passed. Upstream infrastructure repair is outside this PR.
