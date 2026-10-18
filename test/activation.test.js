const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { vscode, loadEditorModule } = require('./helpers/vscode');
const { activate, deactivate } = loadEditorModule('../../src/extension');
const manifest = require('../package.json');

test('activation wires every contributed command and preserves the settings contract', async () => {
  const root = path.resolve('test/fixtures/site');
  const uri = fsPath => ({ fsPath, toString: () => fsPath });
  const disposable = { dispose() {} };
  const watcher = { ...disposable, onDidCreate() {}, onDidChange() {}, onDidDelete() {} };
  const commands = new Map();
  const views = new Map();
  let serializer;
  vscode.Uri = { joinPath: (base, ...parts) => uri(path.join(base.fsPath, ...parts)) };
  vscode.workspace = {
    workspaceFolders: [{ uri: uri(root) }],
    fs: { stat: async value => ({ type: value.fsPath.endsWith('content') ? 2 : 1 }) },
    createFileSystemWatcher: () => watcher,
    onDidSaveTextDocument: () => disposable
  };
  vscode.window = {
    terminals: [],
    createOutputChannel: () => disposable,
    createTreeView(id, options) {
      const view = { ...disposable, selection: [], ...options };
      views.set(id, view);
      return view;
    },
    createStatusBarItem: () => ({ ...disposable, show() {}, hide() {} }),
    registerWebviewPanelSerializer: (id, value) => { serializer = { id, value }; return disposable; },
    onDidChangeActiveTextEditor: () => disposable,
    onDidCloseTerminal: () => disposable,
    onDidOpenTerminal: () => disposable
  };
  vscode.commands = {
    executeCommand() {},
    registerCommand: (id, handler) => { commands.set(id, handler); return disposable; }
  };
  const context = { subscriptions: [] };
  await activate(context);
  assert.deepEqual([...commands.keys()].sort(), manifest.contributes.commands.map(command => command.command).sort());
  assert.ok([...commands.values()].every(handler => typeof handler === 'function'));
  assert.deepEqual([...views.keys()].sort(), ['blogExplorer.content', 'blogExplorer.git', 'blogExplorer.server']);
  assert.equal(serializer.id, 'blogExplorer.preview');
  assert.equal(typeof serializer.value.deserializeWebviewPanel, 'function');
  const content = views.get('blogExplorer.content').treeDataProvider;
  content.setFilter({ kind: 'status', value: 'draft', label: 'Drafts' });
  assert.equal(views.get('blogExplorer.content').description, 'Drafts');
  content.clearFilter();
  assert.equal(views.get('blogExplorer.content').description, undefined);
  assert.equal(views.get('blogExplorer.server').description, 'Stopped');
  assert.deepEqual(Object.fromEntries(Object.entries(manifest.contributes.configuration.properties)
    .map(([key, value]) => [key, value.default])), {
    'blogExplorer.previewLocation': 'beside',
    'blogExplorer.newFileTemplate': true,
    'blogExplorer.followActiveEditor': true
  });
  deactivate();
  for (const subscription of context.subscriptions) subscription.dispose();
});
