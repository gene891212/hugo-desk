# Demonstration credits

`demo.gif` and `screenshot.png` show Hugo Desk with the
[Even theme and exampleSite](https://github.com/olOwOlo/hugo-theme-even).
The article preview uses exampleSite samples. `assets.gif` uses Hugo Desk's
original fixture site and the original illustrations described below.

- Theme: Even, copyright 2017 olOwOlo,
  [MIT license](https://github.com/olOwOlo/hugo-theme-even/blob/master/LICENSE.md).
- English article: "Creating a New Theme", attributed to Michael Henderson in
  [the example's front matter](https://github.com/olOwOlo/hugo-theme-even/blob/master/exampleSite/content/post/english-preview.md).
  The example links to [hugoBasicExample](https://github.com/gohugoio/hugoBasicExample)
  as its origin.
- Japanese article: "敬語体系", attributed to Wikipedia in
  [the example's front matter](https://github.com/olOwOlo/hugo-theme-even/blob/master/exampleSite/content/post/japanese-preview.md),
  which carries a Creative Commons Attribution-ShareAlike notice.
- [Syntax Highlighting](https://github.com/olOwOlo/hugo-theme-even/blob/master/exampleSite/content/post/syntax-highlighting.md)
  and [Shortcodes](https://github.com/olOwOlo/hugo-theme-even/blob/master/exampleSite/content/post/shortcodes.md)
  are Even exampleSite samples.

Article text and author credits remain as supplied by exampleSite. The temporary
demo configuration disables external CDN loading and adjusts preview settings.
The original theme and exampleSite are not modified or bundled with Hugo Desk.

The server-start sequence includes a visible cursor, click ring, and short label
as recording annotations. They track actual mouse input; the server startup and
preview are captured from the running editor.

## Assets demonstration images

`assets.gif` shows **Forest**, **Coast**, and **Mountains**, three original
geometric illustrations created for Hugo Desk. They contain no downloaded
artwork or photographs and are included under the project's MIT license.
The reproducible source is `scripts/generate-demo-images.py` (requires Pillow).

The recording uses a disposable copy of `test/fixtures/site`. It begins with
`posts` expanded and the `assets-demo` bundle collapsed, expands the bundle and
Assets, opens `forest.png`, `coast.png`, and `mountains.png`, then returns to
the article. `mountains.png` is an unchanged recording-only copy of the fixture's
`gallery/幾何山景.png`. The preview remains visible beside the image editor.

The 1440×900 recording is captured from the actual VS Code interface through
Playwright. Cursor movement and yellow click rings are recording-only annotations
driven by the same pointer events that operate the real controls; no interface
or image-preview content is composited into the screenshots.
