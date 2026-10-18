// Run with VS Code --extensionTestsPath=<absolute path to this directory>.
// Uses real terminal/webview APIs in a separate editor profile and disposable site.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { once } = require('node:events');
const vscode = require('vscode');
const { createServerController } = require('../../src/server');
const { createPreviewController } = require('../../src/preview');
const { HugoPreviewResolver } = require('../../src/hugo');
const { isPortOpen } = require('../../src/network');

exports.run = async function run() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hugo-desk-editor-'));
  const contexts = [];
  const terminals = [];
  const saved = new Map();
  const workspaceState = { get: key => saved.get(key), update: async (key, value) => saved.set(key, value) };
  const external = http.createServer((_request, response) => response.end('external-service'));
  const disposable = { dispose() {} };
  let ownsExternal = false;
  let view;
  let panel;
  let preview;
  let server;
  let resolveReady;
  const webviewReady = new Promise(resolve => resolveReady = resolve);
  const host = {
    EventEmitter: vscode.EventEmitter, TreeItem: vscode.TreeItem,
    ThemeIcon: vscode.ThemeIcon, TreeItemCollapsibleState: vscode.TreeItemCollapsibleState,
    StatusBarAlignment: vscode.StatusBarAlignment, Uri: vscode.Uri,
    ViewColumn: vscode.ViewColumn, ProgressLocation: vscode.ProgressLocation,
    workspace: vscode.workspace, commands: vscode.commands, env: vscode.env,
    window: {
      get terminals() { return vscode.window.terminals; },
      get activeTextEditor() { return vscode.window.activeTextEditor; },
      onDidCloseTerminal: vscode.window.onDidCloseTerminal,
      onDidOpenTerminal: vscode.window.onDidOpenTerminal,
      showInformationMessage: vscode.window.showInformationMessage,
      createTreeView: () => view = { ...disposable },
      createStatusBarItem: () => ({ ...disposable, show() {}, hide() {} }),
      showWarningMessage: async (_message, first) => first,
      showErrorMessage: message => { throw new Error(message); },
      withProgress: (_options, task) => task({ report() {} }),
      createTerminal(options) {
        const terminal = vscode.window.createTerminal(options);
        terminals.push(terminal);
        return terminal;
      },
      createWebviewPanel(...args) {
        panel = vscode.window.createWebviewPanel(...args);
        panel.webview.onDidReceiveMessage(message => { if (message.type === 'ready') resolveReady(); });
        return panel;
      }
    }
  };
  const makeContext = () => {
    const context = { subscriptions: [], workspaceState };
    contexts.push(context);
    return context;
  };
  const getProjectRoot = () => vscode.Uri.file(root);
  try {
    await fs.cp(path.join(__dirname, '../fixtures/site'), root, { recursive: true });
    try {
      external.listen(1313, '127.0.0.1');
      await once(external, 'listening');
      ownsExternal = true;
    } catch (error) { if (error.code !== 'EADDRINUSE') throw error; }

    server = createServerController(host, { getProjectRoot });
    server.initialize(makeContext());
    assert.equal(await server.ensureHugoServer(getProjectRoot(), { report() {} }, ['-D']), true);
    const port = server.getPort();
    assert.notEqual(port, 1313);
    assert.equal(terminals[0].creationOptions.shellPath, 'hugo');
    const resolver = new HugoPreviewResolver();
    const draft = path.join(root, 'content/posts/draft.md');
    const draftPath = await resolver.resolve(root, draft);
    const url = `http://127.0.0.1:${port}${draftPath}`;
    assert.equal((await fetch(url)).status, 200);

    const document = await vscode.workspace.openTextDocument(draft);
    await vscode.window.showTextDocument(document);
    preview = createPreviewController(host, { getProjectRoot, server, previewResolver: resolver });
    preview.initialize(makeContext());
    await preview.startDebugServer();
    await Promise.race([webviewReady, new Promise((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Webview script did not initialize')), 15000);
      timer.unref?.();
    })]);
    assert.ok(panel.webview.html.includes(`frame-src http://localhost:${port};`));
    assert.equal(terminals.length, 1);
    await preview.startServer();
    assert.equal(server.getPort(), port);
    assert.equal((await fetch(url)).status, 404);
    assert.equal(terminals.length, 2);

    // Simulate controller reactivation while keeping the editor's real terminal.
    for (const context of contexts) for (const item of context.subscriptions) item.dispose();
    const restored = createServerController(host, { getProjectRoot });
    restored.initialize(makeContext());
    server = restored;
    await restored.reattachHugoTerminal();
    assert.equal(view.description, 'Running ●');
    assert.equal(restored.getPort(), port);
    assert.equal(await restored.ensureHugoServer(getProjectRoot(), { report() {} }), true);
    assert.equal(terminals.length, 2);
    await restored.stopServer();
    for (let attempt = 0; attempt < 100 && await isPortOpen(port); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(await isPortOpen(port), false);
    assert.equal(await isPortOpen(1313), true);
    console.log(`EDITOR_SMOKE_OK ${process.platform}: real Hugo terminal, alternate port ${port}, draft/normal, webview script/CSP, reattachment, owned-only stop`);
  } finally {
    panel?.dispose();
    await server?.stopServer();
    for (const terminal of terminals) terminal.dispose();
    for (const context of contexts) for (const item of context.subscriptions) item.dispose();
    if (ownsExternal) await new Promise(resolve => external.close(resolve));
    if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('hugo-desk-editor-')) {
      throw new Error('Unexpected temporary fixture path; refusing recursive cleanup.');
    }
    await fs.rm(root, { recursive: true, force: true });
  }
};
