const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseFrontMatterText } = require('../src/front-matter');

test('TOML tables, dotted keys, comments and dates keep their own scope', () => {
  const fields = parseFrontMatterText(`+++
title = "A # title" # comment
draft = false
publishDate = 2020-01-02T03:04:05+08:00
params.slug = "nested-slug"
[params]
draft = true
title = "Nested title"
+++
Body`);
  assert.equal(fields.title, 'A # title');
  assert.equal(fields.draft, false);
  assert.equal(fields.slug, undefined);
  assert.equal(fields.params.draft, true);
  assert.equal(fields.publishdate.toISOString(), '2020-01-01T19:04:05.000Z');
});

test('YAML handles multiline and quoted values without flattening params', () => {
  const fields = parseFrontMatterText(`\uFEFF---\r
title: >-\r
  A multiline\r
  article title\r
draft: "true" # comment\r
params:\r
  draft: false\r
  title: Nested title\r
---\r
Body`);
  assert.equal(fields.title, 'A multiline article title');
  assert.equal(fields.draft, 'true');
  assert.equal(fields.params.title, 'Nested title');
});

test('malformed front matter raises a useful error instead of fabricated metadata', () => {
  assert.throws(() => parseFrontMatterText('---\ntitle: [\n---\n'));
  assert.throws(() => parseFrontMatterText('+++\ntitle = "unterminated\n+++\n'));
  assert.throws(() => parseFrontMatterText('---\ntitle: Missing end\n'), /closing delimiter/);
  assert.throws(() => parseFrontMatterText('---\n- not\n- a mapping\n---\n'), /mapping/);
  assert.deepEqual(parseFrontMatterText('--- not a delimiter\nText'), {});
  assert.deepEqual(parseFrontMatterText('Normal Markdown\n'), {});
});
