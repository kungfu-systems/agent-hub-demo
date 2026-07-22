# Contributing

Thank you for improving Agent Hub Demo.

## Development

Use Node.js 22 or newer and the public npm registry:

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
promotion tags, and GitHub Releases are produced only by Buildchain after a
reviewed channel pull request.

Pull requests should explain behavior, tests, contract impact, and residual
risk. Complete the repository governance checklist in the pull request
template. Never include credentials, tokens, private logs, private paths, or
production data.
