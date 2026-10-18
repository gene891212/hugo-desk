# Changelog

## 0.1.0 — Unreleased

Initial release of Hugo Desk.

### Added

- Focused content tree, bundle assets, article search/status filters, file
  operations, and article-grouped Git changes.
- Normal/draft server controls and an editor-following local preview.
- Original Forest, Coast, and Mountains illustrations for the bundle-asset
  fixtures and recorded demo, with reproducible source and MIT licensing.
- Resolve preview URLs through Hugo, preserving Unicode, permalinks, languages,
  subdirectory base URLs, and HTML endings.
- Parse YAML/TOML front matter with nested scopes and show malformed metadata clearly.
- Automated editor terminal/Webview lifecycle checks for the Windows, macOS,
  and Linux CI jobs. macOS/Linux results remain pending.

### Changed

- Port conflicts offer **Use Another Port** first, followed by **Use Existing**
  and **Cancel**, on all three platforms. The preview and mode switches use the
  selected port.
- Remove the Windows-only force-restart action. External services are never
  terminated by port, and servers from older versions are treated as external.
- Run Hugo directly in its own terminal and check HTTP readiness before opening
  the preview. Report missing Hugo and startup/build errors.

### Fixed

- Restore article following for an open preview after reload, respecting the
  follow setting and Stop state, without automatically starting Hugo.
- Reconnect to the saved server execution, port, and mode when its terminal
  survives a reload, including delayed terminal-name restoration.
- Cancel pending startup and preview indexing when Stop is requested. A late
  completion cannot open the preview or block a subsequent start.
- Show **External (mode unknown)** when using an existing HTTP service instead
  of incorrectly showing Stopped. Stop leaves that service running.
- Keep the iframe URL guard and content security policy aligned with the selected port.
- Prevent Debug draft pages lingering after a switch back to Normal by rendering
  preview output in memory; refresh the same preview URL after mode switches.
- Keep the latest article in view when switching editors quickly and preserve
  Content tree expansion when saving or refreshing files.
