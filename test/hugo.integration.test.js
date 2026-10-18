const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const { HugoPreviewResolver } = require('../src/hugo');

let available = false;
try {
  execFileSync('hugo', ['version'], { stdio: 'ignore', windowsHide: true });
  available = true;
} catch {}

test('real Hugo resolves Chinese bundles, permalinks, languages, drafts and HTML URLs', { skip: !available }, async () => {
  const root = path.join(__dirname, 'fixtures/site');
  const resolver = new HugoPreviewResolver();
  const article = filename => resolver.resolve(root, path.join(root, 'content/posts', filename));
  assert.equal(await resolver.resolve(root), '/blog/');
  assert.equal(await article('中文測試/index.md'), '/blog/articles/2020/%E4%B8%AD%E6%96%87%E6%B8%AC%E8%A9%A6/');
  assert.equal(await article('custom.md'), '/blog/articles/2020/custom-slug/');
  assert.equal(await article('translated.zh.md'), '/blog/zh/articles/2020/%E7%BF%BB%E8%AD%AF%E6%96%87%E7%AB%A0/');
  assert.equal(await article('explicit.md'), '/blog/custom/page.html');
  assert.ok((await article('draft.md')).endsWith('/draft-article/'));
  assert.equal(await article('_index.md'), '/blog/posts/');
});

test('real Hugo also resolves relative base URLs', { skip: !available }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hugo-desk-relative-'));
  try {
    await fs.cp(path.join(__dirname, 'fixtures/site'), root, { recursive: true });
    const configPath = path.join(root, 'hugo.toml');
    const config = await fs.readFile(configPath, 'utf8');
    await fs.writeFile(configPath, config.replace('https://example.org/blog/', '/blog/'));
    const resolver = new HugoPreviewResolver();
    assert.equal(await resolver.resolve(root), '/blog/');
    assert.equal(await resolver.resolve(root, path.join(root, 'content/posts/explicit.md')), '/blog/custom/page.html');
  } finally {
    if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('hugo-desk-relative-')) {
      throw new Error('Unexpected temporary fixture path; refusing recursive cleanup.');
    }
    await fs.rm(root, { recursive: true, force: true });
  }
});
