const test = require('node:test');
const assert = require('node:assert/strict');
const { releaseMetadata } = require('../scripts/prepare-release');

const manifest = { name: 'hugo-desk', displayName: 'Hugo Desk', publisher: 'gene891212', version: '0.1.0', preview: true };
const changelog = '# Changelog\n\n## 0.2.0 — Unreleased\n\nFuture notes.\n\n## 0.1.0 — 2026-10-18\n\nInitial preview.\n\n### Fixed\n\n- A server fix.\n\n## 0.0.1 — 2026-09-01\n\nOld notes.\n';

test('release notes select only the tagged version and preserve its subsections', () => {
  const metadata = releaseMetadata(manifest, changelog.replaceAll('\n', '\r\n'), 'v0.1.0');
  assert.equal(metadata.notes, 'Initial preview.\n\n### Fixed\n\n- A server fix.\n');
  assert.equal(metadata.assetName, 'hugo-desk-0.1.0.vsix');
  assert.equal(metadata.prerelease, true);
  assert.equal(metadata.title, 'Hugo Desk v0.1.0 (Preview)');
});

test('release refuses a missing or mismatched tag and an undated changelog', () => {
  for (const tag of ['', 'main', 'v0.2.0', 'v0.1.0-extra']) {
    assert.throws(() => releaseMetadata(manifest, changelog, tag), /must match/);
  }
  for (const date of ['Unreleased', '2026-02-30', '2026-13-01']) {
    assert.throws(() => releaseMetadata(manifest, changelog.replace('2026-10-18', date), 'v0.1.0'), /dated section/);
  }
  assert.throws(() => releaseMetadata(manifest, '## 0.1.0 — 2026-10-18\n\n', 'v0.1.0'), /no release notes/);
});

test('release maps a stable manifest to a normal GitHub release and rejects local identity', () => {
  const stable = releaseMetadata({ ...manifest, preview: false }, changelog, 'v0.1.0');
  assert.equal(stable.prerelease, false);
  assert.equal(stable.title, 'Hugo Desk v0.1.0');
  assert.throws(() => releaseMetadata({ ...manifest, publisher: 'local' }, changelog, 'v0.1.0'), /registered publisher/);
  assert.throws(() => releaseMetadata({ ...manifest, version: '01.1.0' }, changelog, 'v01.1.0'), /package version/);
});
