# Release preparation

0.1.0 is an unreleased preview. This repository has no publish script or
publishing workflow. Publishing requires a separate, explicit owner action.

## Owner information still needed

- Register the publisher/namespace for each target registry. Replace the local
  testing publisher `local` after confirming ownership.
- Confirm `hugo-desk` and its display name are available in the target registries.
  Marketplace and Open VSX require separate setup.

Source repository: https://github.com/gene891212/hugo-desk. The package author
and MIT copyright holder are `gene891212`. Repository, issues, and homepage
metadata are set in `package.json`.

## Validation

1. Complete the owner metadata, then run `npm run release:check`. It reports
   missing information and never publishes.
2. Run `npm ci`, `npm run check`, `npm test`, `npm run test:editor`, and
   `npm audit` with Hugo installed. Require all three platform jobs in the
   [Check workflow](https://github.com/gene891212/hugo-desk/actions/workflows/ci.yml)
   to pass before publishing. On headless Linux, use Xvfb for editor tests.
3. Inspect `npm run package:check`. Include production dependencies (`yaml`,
   `@iarna/toml`, `csv-parse`). Do not restore `--no-dependencies` or exclude all
   `node_modules` without bundling runtime code first.
4. Use `npm run package` for local testing. It permits missing repository metadata
   and preserves local README links. For a release artifact, use
   `npm run package:release`: it requires metadata and lets vsce rewrite README
   links against the public repository. Neither command publishes.
5. Install the VSIX in a clean editor profile and complete the manual QA checklist.
   Verify Windows/macOS/Linux and any claimed Antigravity version. Check the actual
   installed VSIX and its production dependencies.
6. Check README images/links against the chosen public repository, set the final
   version/date, and review the packaged contents.

No command above creates a GitHub repository, registry listing, or public release.
