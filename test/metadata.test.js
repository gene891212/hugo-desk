const assert = require('node:assert/strict');
const { loadEditorModule } = require('./helpers/vscode');
const { parseFrontMatterText, getPublicationStatus } = require('../src/front-matter');
const { parseGitStatus, parseGitLog, groupGitChangesByPage } = loadEditorModule('../../src/git-provider');
const { escapeMarkdown, inlineCode } = require('../src/tree-items');

const yaml = parseFrontMatterText(`---
title: "A YAML post"
draft: true
date: 2026-08-30T12:00:00+08:00
---
Body
`);
assert.equal(yaml.title, 'A YAML post');
assert.equal(yaml.draft, true);
assert.equal(getPublicationStatus(yaml).key, 'draft');

const toml = parseFrontMatterText(`+++
title = "A TOML post"
draft = false
publishDate = "2999-01-01T00:00:00Z"
+++
Body
`);
assert.equal(toml.title, 'A TOML post');
assert.equal(toml.draft, false);
assert.equal(getPublicationStatus(toml).key, 'scheduled');

const published = parseFrontMatterText(`---
title: Published
draft: false # an inline comment
date: 2020-01-01
---
`);
assert.equal(getPublicationStatus(published).key, 'published');

const changes = parseGitStatus([
  ' M readme.md',
  '?? content/post/new file/index.md',
  'R  content/post/new-name/index.md',
  'content/post/old-name/index.md',
  ''
].join('\0'));
assert.equal(changes.length, 3);
assert.equal(changes[0].status.key, 'modified');
assert.equal(changes[1].status.key, 'untracked');
assert.equal(changes[2].status.key, 'renamed');
assert.equal(changes[2].originalPath, 'content/post/old-name/index.md');

const commits = parseGitLog(
  '0123456789\x1f0123456\x1fGene\x1f2 hours ago\x1fAdd a simple Git view\x1e'
);
assert.equal(commits.length, 1);
assert.equal(commits[0].shortHash, '0123456');
assert.equal(commits[0].subject, 'Add a simple Git view');
assert.equal(escapeMarkdown('post/my-page/index.md'), 'post/my-page/index.md');
assert.equal(inlineCode('post/my-page/index.md'), '`post/my-page/index.md`');

(async () => {
  const pageGroups = await groupGitChangesByPage({ fsPath: 'C:\\blog' }, [
    { path: 'content/post/example/index.md', status: { key: 'modified', label: 'Modified' } },
    { path: 'content/post/example/cover.png', status: { key: 'untracked', label: 'Untracked' } },
    { path: 'hugo.toml', status: { key: 'modified', label: 'Modified' } }
  ]);
  assert.equal(pageGroups.length, 2);
  assert.equal(pageGroups[0].label, 'example');
  assert.equal(pageGroups[0].changes.length, 2);
  assert.equal(pageGroups[1].label, 'Site files');
  console.log('metadata and Git parser tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
