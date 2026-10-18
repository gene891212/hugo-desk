# Hugo Desk manual QA

Use a disposable copy of `test/fixtures/site`, with Hugo on PATH. Launch the
extension in a separate VS Code profile; never use a personal blog for destructive
or off-path checks. The automated tests cover the parsers and Hugo URL mapping.

| Claim or control | Functional check | Visual evidence |
| --- | --- | --- |
| Hugo Desk branding | Open the activity bar container and command palette | Container title, command category |
| Normal server | Start from Content, then stop | Starting, Running, Stopped states |
| Draft server | Start Debug, switch back to Normal, then stop | Debug state and draft preview |
| Preview follows | Open custom.md, Chinese bundle, explicit.md in turn | Correct title and local URL; editor keeps focus |
| Preview stays closed | Close preview, then switch Markdown files | No tab reopens |
| Search/filter | Filter Drafts, clear filter | Flat results, then normal tree |
| Invalid front matter | Save malformed YAML in disposable article, then repair | Warning status, then normal status |
| Rapid switching | Switch articles while URL index is loading | Last selected article wins |
| Same URL after mode switch | Open a fresh draft in Normal, then start Debug | 404 changes to draft content without manual Reload |
| Window reload | Reload while the owned Debug terminal runs on an alternate port, then switch articles | Same port, restored following and Debug status, no duplicate terminal |
| Reload after Stop | Stop, reload, switch articles | No server starts; following stays off until Start |
| Stop during startup | Start then immediately Stop, including while indexing | No delayed terminal creation, reopening or navigation |
| Non-content editor | Start while editing a site file | Site homepage |
| Missing Hugo | Launch with Hugo absent from PATH | Installation guidance, no 30-second port wait |
| External server | Use Another Port, Use Existing, or Cancel on each OS | Another port first, external mode unknown, external process untouched |
| Alternate port | Occupy 1313, start Debug on another port, switch Normal, Stop | Same alternate port for mode switch, drafts return 404, 1313 service survives |

Inspect the default window and a smaller window for clipped controls, truncated
essential labels, broken preview rendering, and unexpected focus changes. Inspect
the full sidebar and preview separately. Explore reopen, reload, and rapid mode
switching after the normal flows. Capture `media/screenshot.png` and `media/demo.gif`
from verified states, with no personal paths or credentials visible. For theme
demos, copy a theme to a disposable site and use its exampleSite or fictional
article content; do not record a personal blog. Keep the source site and theme
unmodified, and retain source attribution for the example articles.

## README exampleSite demonstration

- Use a fresh editor profile so the default Content → Server → Changes ordering
  is visible, with the full sidebar and article preview fitting the viewport.
- Record article preview separately: open the English article with Server stopped,
  show Start Hugo Server, then start it and show the preview appearing beside the
  editor. Switch to Japanese, syntax highlighting, and shortcode samples. Omit the
  Chinese preview and search/filter sequence. Verify each preview title/URL.
- Make the startup action visible: record the cursor moving to Start, show the
  mouse press and click ring centered on the real control, then verify Running
  and the rendered preview after mouse release. Cursor, ring, and label are
  recording-only annotations; remove them after the preview opens.
- Record Assets separately: begin with only post expanded and the demo article
  folder collapsed. Keep post open throughout; do not select it again in the
  recording. Open the bundle and expand Assets directly, without clicking index.md;
  view three images at the same level, and return to the article. Omit nested folders.
  Wait for each image to load, and keep the Hugo preview visible beside it.
- Check rapid article changes and preview reopening as exploratory cases. Record
  actual editor states, inspect representative frames, and keep the GIF readable.

## Validation record — 2026-10-18

- Windows VS Code: normal server, Debug mode, article-following preview, Chinese
  paths, explicit HTML URLs, draft filtering/clear, close-and-reopen behavior,
  invalid front matter and repair, and owned-server stop were exercised.
- Updated README media using a disposable copy of Even's exampleSite. The main
  GIF opens an article, starts the server, and shows four article types without
  the Chinese preview or search/filter
  sequence. A separate Assets GIF begins with only post expanded, then opens the
  bundle and Assets, shows three images at the same level, and returns to the
  article. The sidebar shows Content →
  Server → Changes. Sample attribution is in `media/ATTRIBUTION.md`.
- Inspected the encoded GIFs' article, asset-list, and opened-image frames at
  1440×810. Editor groups stay readable, the full sidebar fits, and preview
  titles match the samples. The main clip is about 10 seconds, including a
  two-second startup introduction; article pauses are 1.8-2 seconds. Assets is
  about 10.5 seconds, with each image visible for 1.8 seconds. The initial Markdown
  click and pause have been removed. No terminal output or local filesystem paths appear.
- Re-recorded startup with cursor movement and a yellow click ring. Checked its
  alignment against the real Start control and verified the server stayed stopped
  until mouse release, then opened the English article preview. The main GIF uses
  15 fps so the cursor movement remains visible and takes about 10 seconds total.
  Rapid switching and closing/reopening the preview also passed during this run.
- Installed the generated VSIX in an isolated extensions directory. Its packaged
  parsers, real Hugo URL resolver, README/media assets, and exclusion of `.vscode`
  passed smoke checks.
- Automated suite after the source refactor: 28 tests passed, including real Hugo 0.164.0 integration and
  standalone preview-template rendering, toolbar behavior, navigation, restoration,
  and host-side URL validation.
  `npm audit` reported no known vulnerabilities.
- Installed the refactored VSIX in an isolated Windows VS Code profile and used
  a disposable fixture site. Checked normal/debug server switching, Unicode and
  HTML preview URLs, draft filtering, Git grouping, nested bundle assets, preview
  reload, close/reopen, restored Webview state, and terminal reattachment.
- Fixed and rechecked two discovered cases: the same draft URL showing a stale
  Normal-mode 404 after starting Debug, and restored terminals initially having
  an empty name. Both have automated regression coverage. Reviewed the sidebar,
  toolbar, and article preview at 1600x900; the earlier 1440x900 startup layout
  also fit the editor viewport.
- macOS/Linux editor UI, Antigravity, remote extension hosts, external-process
  force termination, and every unchanged file-operation control were not manually
  validated in this run. CI configuration has not run on GitHub yet.

## Server lifecycle follow-up — 2026-10-18

- Replaced port-based force termination with the same choices on all hosts:
  Use Another Port first, Use Existing (project/mode unknown), and Cancel.
  Dedicated terminals now execute Hugo directly with an argument array; stopping
  them uses the editor API rather than Windows process lookup/kill commands.
- 44 automated tests passed with no skips. Added cancellation during version
  checks, conflict dialogs, HTTP startup, and URL indexing; restart after
  cancellation; restored following/settings; dynamic-port CSP/URL guards;
  unknown external-service status; and process-exit/HTTP-readiness coverage.
- Real Hugo lifecycle integration occupied 1313, started on another port,
  reused that port for Debug/Normal, reattached the saved execution, and stopped
  only the owned process. The original HTTP service stayed reachable.
  Draft requests returned 200 in Debug and 404 in Normal using memory rendering.
- Real Windows VS Code terminal/Webview smoke tests passed on 1.90.2 and 1.142.0.
  Checked direct Hugo launch, alternate port, draft/normal HTTP responses, Webview
  script initialization and selected-port CSP, controller reattachment to the
  real terminal, and owned-only stop. This smoke test simulates controller
  reactivation; a full editor restart with the new implementation has not been
  visually verified.
- Added `npm run test:editor` and three-platform CI editor tests (Xvfb on Linux).
  macOS/Linux execution and visual results remain pending; the CI workflow has
  not been run on GitHub from this local, uncommitted repository.
- Syntax checks and VSIX packaging passed; `npm audit` reported zero known
  vulnerabilities. Test helpers, editor downloads and development dependencies
  are excluded from the VSIX.

## Publication preparation follow-up — 2026-10-18

- Removed the third-party merchandise photographs from the bundle fixtures and
  replaced them with original Forest, Coast, and Mountains illustrations. The
  generator is `scripts/generate-demo-images.py`; images use the project's MIT
  license. Nested assets and a Unicode filename remain covered by the fixture.
- Re-recorded `media/assets.gif` in an isolated Windows VS Code 1.142.0 profile
  using the original fixture site. The 1440×900, 12.16-second GIF expands the
  bundle and Assets, opens all three original images, and returns to the article
  with its preview still visible. Mountains is copied to the bundle root for
  the recording; the real nested fixture is kept intact.
- Recorded cursor motion and yellow click rings from the actual pointer events
  used to operate the editor. These are recording annotations, not extension UI.
  Inspected the encoded GIF's click, Coast, and Mountains frames as well as the
  live Forest/preview and article states.
- Full **Developer: Reload Window** check on Windows VS Code 1.142.0: the same
  running server/port and preview returned, and opening `custom.md` changed the
  preview to its Hugo permalink. After Stop and another full window reload,
  switching back to `index.md` left the server Stopped and port 1313 closed;
  preview following also stayed off.
- Windows Computer Use was used for initial editor inspection, then Playwright
  connected directly to the isolated editor renderer for recording and reload
  checks, so foreground interaction was not required during capture.

## First GitHub CI validation — 2026-10-18

- Pushed source commit `e3e307338a15d0e6017466a9a3c257cccf3c61e2` to
  `https://github.com/gene891212/hugo-desk` through SSH.
- [Check run 39131273625](https://github.com/gene891212/hugo-desk/actions/runs/39131273625)
  passed on `windows-latest`, `macos-latest`, and `ubuntu-latest`. All three
  completed dependency installation, syntax checks, module/real Hugo tests,
  actual VS Code 1.90.2 terminal/Webview lifecycle checks, dependency audit,
  packaging, and VSIX artifact upload. Linux editor tests used Xvfb.
- This establishes automated macOS/Linux coverage. Manual visual checks on
  those hosts and Antigravity compatibility still remain unverified.
- Author and MIT copyright holder are `gene891212`; repository, homepage, and
  issues metadata are set. Store publishing still requires the registered
  publisher ID and the corresponding Open VSX namespace. CI artifacts use the
  local testing publisher until that setup is complete.

## Registered publisher package — 2026-10-18

- Owner confirmed `gene891212` for both the Marketplace publisher and Open VSX
  namespace. The manifest now identifies the extension as
  `gene891212.hugo-desk`; version remains `0.1.0` with the preview flag.
- `npm run package:release` passed metadata validation, syntax checks, and all
  44 tests with no skips. Inspected the resulting VSIX: both manifests contain
  the registered publisher, README links/images use HTTPS GitHub URLs, all
  three production dependencies are present, and tests, scripts, recordings,
  editor downloads, and development dependencies are excluded.
- Installed the VSIX into a separate Windows VS Code 1.142.0 profile and
  extension directory. CLI listing reports `gene891212.hugo-desk@0.1.0`.
- CI now packages with `package:release` so its downloadable artifacts receive
  the same release metadata checks and README link rewriting.
- Registry upload and public listing verification remain separate steps.
