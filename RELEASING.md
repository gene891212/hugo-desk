# Release preparation

0.1.0 is a preview prepared for publication. This repository has no publish
script or publishing workflow. Building a VSIX does not upload it to a registry.

## Release identity

- Marketplace publisher and Open VSX namespace: `gene891212` (owner confirmed).
- Extension ID: `gene891212.hugo-desk`; display name: **Hugo Desk**.
- Version: `0.1.0`, marked as a preview. Registration and upload are separate
  for each registry; configured metadata does not establish a published listing.

Source repository: https://github.com/gene891212/hugo-desk. The package author
and MIT copyright holder are `gene891212`. Repository, issues, and homepage
metadata are set in `package.json`.

## Validation

1. Run `npm run release:check`. It reports
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
   CI also uses `package:release` for its downloadable VSIX artifacts.
5. Install the VSIX in a clean editor profile and complete the manual QA checklist.
   Verify Windows/macOS/Linux and any claimed Antigravity version. Check the actual
   installed VSIX and its production dependencies.
6. Check README images/links against the chosen public repository, set the final
   version/date, and review the packaged contents.

No command above creates a GitHub repository, registry listing, or public release.

## Upload the validated artifact

Before packaging, confirm the version and changelog date match the intended
publication. Use the same `hugo-desk-0.1.0.vsix` on both registries.

- Marketplace: open [Manage Publishers](https://marketplace.visualstudio.com/manage/publishers/),
  select `gene891212`, and upload the VSIX as a new Visual Studio Code extension.
  See the [official publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).
- Open VSX: complete the account and Publisher Agreement setup in the
  [official guide](https://github.com/eclipse-openvsx/openvsx/wiki/Publishing-Extensions),
  then publish the existing VSIX. The namespace must already exist.
  In PowerShell 7, enter the access token locally without putting it in a command:

  ```powershell
  $env:OVSX_PAT = Read-Host 'Open VSX access token' -MaskInput
  try {
      npx --yes ovsx publish ./hugo-desk-0.1.0.vsix
      if ($LASTEXITCODE -ne 0) { throw 'Open VSX publish failed' }
  } finally {
      Remove-Item Env:OVSX_PAT -ErrorAction SilentlyContinue
  }
  ```

After successful uploads, verify both public listings and install their version
in a clean profile. Tag the validated source and attach the same VSIX to the
GitHub release. Public listing URLs:

- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=gene891212.hugo-desk)
- [Open VSX](https://open-vsx.org/extension/gene891212/hugo-desk)
