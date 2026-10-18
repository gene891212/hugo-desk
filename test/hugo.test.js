const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { parsePageList, localPath, HugoPreviewResolver, externalServerChoices, runHugo } = require('../src/hugo');

const root = path.resolve('example-site');
const csv = 'path,title,permalink\r\n' +
  'content/posts/中文/index.md,"Title, with a comma",https://example.org/blog/zh/%E4%B8%AD%E6%96%87/\r\n' +
  'content/posts/file.md,"A ""quoted""\nmultiline title",https://example.org/blog/custom/page.html\r\n';

test('CSV keeps commas, escaped quotes, newlines and actual Unicode permalinks', () => {
  const pages = parsePageList(csv, root);
  const key = filename => {
    const absolute = path.join(root, filename);
    return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
  };
  assert.equal(pages.get(key('content/posts/中文/index.md')), '/blog/zh/%E4%B8%AD%E6%96%87/');
  assert.equal(pages.get(key('content/posts/file.md')), '/blog/custom/page.html');
  assert.equal(localPath('https://production.example/subdir/page.html?view=1#section'), '/subdir/page.html?view=1#section');
  assert.equal(localPath('/blog/中文/'), '/blog/%E4%B8%AD%E6%96%87/');
  assert.throws(() => localPath('javascript:alert(1)'), /unsupported/);
});

test('resolver shares its index, refreshes after invalidation and never guesses missing URLs', async () => {
  let calls = 0;
  const resolver = new HugoPreviewResolver(async args => {
    calls += 1;
    assert.ok(args.includes('development'));
    return args[0] === 'list' ? csv : '{"baseurl":"https://example.org/blog/"}';
  });
  const filename = path.join(root, 'content/posts/file.md');
  const results = await Promise.all([resolver.resolve(root, filename), resolver.resolve(root)]);
  assert.deepEqual(results, ['/blog/custom/page.html', '/blog/']);
  assert.equal(calls, 2);
  await assert.rejects(resolver.resolve(root, path.join(root, 'content/missing.md')), /did not report a page URL/);
  resolver.invalidate();
  await resolver.resolve(root, filename);
  assert.equal(calls, 4);
});

test('failed indexes can recover without reloading the extension', async () => {
  let failing = true;
  const resolver = new HugoPreviewResolver(async args => {
    if (failing) throw new Error('broken config');
    return args[0] === 'list' ? csv : '{}';
  });
  await assert.rejects(resolver.resolve(root), /broken config/);
  failing = false;
  assert.equal(await resolver.resolve(root), '/');
});

test('all platforms prioritize another port and never offer external process termination', () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    assert.deepEqual(externalServerChoices('Normal', platform), ['Use Another Port', 'Use Existing', 'Cancel']);
  }
});

test('missing Hugo fails immediately with installation guidance', async () => {
  const previousPath = process.env.PATH;
  process.env.PATH = '';
  try {
    await assert.rejects(runHugo(['version'], __dirname), /Install Hugo, add it to PATH/);
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
  }
});
