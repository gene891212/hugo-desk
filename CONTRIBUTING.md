# Contributing to Hugo Desk

Use Node.js 22 or later, npm, VS Code 1.90 or later, and Hugo on PATH. The real
Hugo integration test has been verified locally with Hugo 0.164.0.

```sh
npm ci
npm run check
npm test
```

The real Hugo test is skipped when Hugo is unavailable. Install Hugo before
claiming it passed. Tests do not stop existing servers or arbitrary processes.

Create a local `.vscode/launch.json` (this directory is ignored):

```json
{
  "version": "0.2.0",
  "configurations": [{
    "name": "Run Hugo Desk",
    "type": "extensionHost",
    "request": "launch",
    "args": ["--extensionDevelopmentPath=${workspaceFolder}"]
  }]
}
```

Press F5 using **Run Hugo Desk**. In the Extension Development Host, open a Hugo
project such as `test/fixtures/site`. Copy the
fixture to a disposable directory before testing file operations. Reload that
development window after editing JavaScript or `webview/preview.html`; relaunch
after manifest changes. The preview's markup, styles, and browser script live
together in that HTML file, which the extension loads and caches for the session.

Use a separate editor profile for packaged-build tests. Existing `blogExplorer.*`
IDs require a migration plan before renaming.

- `npm test`: parsers, CSV, cache/recovery, platform choices, Git, and real Hugo
  URLs (Unicode, language prefixes, subdirectories, permalinks, drafts, HTML URLs,
  and section indexes), plus real HTTP readiness, alternate ports, mode switches,
  terminal reattachment, and owned-only stop. Lifecycle tests use a disposable site.
- `npm run test:editor`: downloads VS Code 1.90.2 (the supported minimum release
  series) and runs real terminal/Webview lifecycle checks in an isolated profile.
  Hugo must be on PATH. On headless Linux, use `xvfb-run -a npm run test:editor`.
  Set `VSCODE_TEST_VERSION=stable` to test the current release, or
  `VSCODE_EXECUTABLE_PATH` to use an existing editor executable. Profiles/logs stay
  in the OS temporary directory for debugging; downloads stay in `.vscode-test/`.
- [test/manual-qa.md](test/manual-qa.md): editor behavior, focus, server lifecycle,
  filters, failure states, and screenshots.
- `npm run package:check`: list the files destined for the VSIX.
- `npm run package`: runs syntax checks/tests via `vscode:prepublish`, then creates
  `hugo-desk-0.1.0.vsix` with production dependencies included.

CI runs module, real Hugo lifecycle, and editor smoke tests on Windows/macOS/Linux.
Version tags run the same checks before the Release workflow publishes a GitHub
release with its validated VSIX. Manual Release workflow runs are dry runs.
Marketplace and Open VSX uploads remain separate. See
[RELEASING.md](RELEASING.md) before preparing a public release.

## Source layout

The original bundle illustrations can be rebuilt with
`python scripts/generate-demo-images.py` after installing Pillow in your
development environment. Pillow is only needed to regenerate these assets;
it is not a runtime or test dependency for the extension.

| Path | Responsibility |
| --- | --- |
| `src/extension.js` | Activation, command registration, watchers, and module wiring. |
| `src/content-provider.js` | Content tree, metadata cache, search, and filters. |
| `src/git-provider.js` | Git status, article grouping, and recent commits. |
| `src/server.js` | Hugo terminal ownership, readiness, mode switching, and status view. |
| `src/file-actions.js` | File commands, clipboard, and drag and drop. |
| `src/preview.js` | Webview lifecycle, navigation, restoration, and preview start flow. |
| `src/hugo.js` | Hugo CLI calls and the cached URL index. |
| `src/front-matter.js` | YAML/TOML parsing and publication status. |
| `src/workspace.js`, `src/tree-items.js`, `src/network.js` | Shared editor, presentation, and port helpers. |
| `webview/preview.html` | One preview document containing markup, CSS, and browser JavaScript. |
| `media/` | Extension icons, screenshot, GIF, and sample attribution. |
| `test/` | Module tests, host API stubs, Hugo fixtures, and manual QA. |

Each activation owns its controllers and providers. Server, preview, and file
clipboard state live in their respective controllers; modules do not reach into
another module's private state. Content changes invalidate the shared Hugo URL
index through a callback. Command, view, and configuration IDs remain
`blogExplorer.*` for existing installations.

Tests import production modules directly and substitute the editor API in
`test/helpers/vscode.js`. The browser script is executed separately with a small
DOM bridge. Real Hugo integration tests continue to use an isolated fixture site.
