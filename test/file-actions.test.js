const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { vscode, loadEditorModule } = require('./helpers/vscode');
const { createFileActions } = loadEditorModule('../../src/file-actions');

function setup() {
  const root = path.resolve('example-site/content');
  const uri = fsPath => ({ fsPath, toString: () => fsPath });
  const file = name => ({ uri: uri(path.join(root, name)), type: 1 });
  const folder = name => ({ uri: uri(path.join(root, name)), type: 2 });
  const calls = [];
  const existing = new Set();
  let selection = [];
  vscode.Uri = {
    file: uri, parse: uri,
    joinPath: (base, ...parts) => uri(path.join(base.fsPath, ...parts))
  };
  vscode.window = {
    showWarningMessage: async () => 'Delete',
    showErrorMessage: message => { throw new Error(message); }
  };
  vscode.workspace = { fs: {
    stat: async value => { if (!existing.has(value.fsPath)) throw new Error('Not found'); return {}; },
    copy: async (source, destination, options) => calls.push(['copy', source.fsPath, destination.fsPath, options]),
    rename: async (source, destination, options) => calls.push(['rename', source.fsPath, destination.fsPath, options]),
    delete: async (source, options) => calls.push(['delete', source.fsPath, options])
  } };
  const actions = createFileActions({
    provider: { contentRoot: uri(root) }, getSelection: () => selection, invalidatePreview() {}
  });
  return { actions, calls, existing, file, folder, select: item => { selection = [item]; } };
}

test('copy finds a free name, cut moves once, and deletion uses Trash', async () => {
  const { actions, calls, existing, file, folder, select } = setup();
  const article = file('post.md');
  existing.add(article.uri.fsPath);
  existing.add(file('post copy.md').uri.fsPath);
  select(article);
  actions.copyItem();
  assert.equal(calls.length, 0);
  await actions.pasteItem();
  assert.deepEqual(calls.pop(), ['copy', article.uri.fsPath, file('post copy 2.md').uri.fsPath, { overwrite: false }]);
  actions.cutItem(article);
  await actions.pasteItem(folder('archive'));
  assert.deepEqual(calls.pop(), ['rename', article.uri.fsPath, file('archive/post.md').uri.fsPath, { overwrite: false }]);
  await actions.pasteItem(folder('elsewhere'));
  assert.equal(calls.length, 0, 'cut clipboard is consumed only once');
  await actions.deleteItem(article);
  assert.deepEqual(calls.pop(), ['delete', article.uri.fsPath, { recursive: false, useTrash: true }]);
});

test('dragging refuses descendants and moves with overwrite protection', async () => {
  const { actions, calls, folder, file } = setup();
  const controller = actions.dragAndDropController;
  const source = folder('bundle');
  const transfer = { get: () => ({ value: [source.uri.toString()] }) };
  await controller.handleDrop(folder('bundle/images'), transfer);
  assert.equal(calls.length, 0);
  await controller.handleDrop(folder('archive'), transfer);
  assert.deepEqual(calls[0], ['rename', source.uri.fsPath, file('archive/bundle').uri.fsPath, { overwrite: false }]);
});
