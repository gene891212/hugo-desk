const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const { vscode, loadEditorModule } = require('./helpers/vscode');
const { BlogContentProvider } = loadEditorModule('../../src/content-provider');
const { createPreviewController } = loadEditorModule('../../src/preview');
const { createServerController } = require('../src/server');
const root = path.resolve(__dirname, 'example-project');
const uri = name => ({ fsPath: path.join(root, 'content', name), scheme: 'file', toString() { return this.fsPath; } });

function loadExtension() {
  const state = { text: '---\ntitle: Article\n---\n', mtime: 1, now: Date.parse('2020-01-01') };
  vscode.workspace = {
    isTrusted: true,
    getConfiguration: () => ({ get: (_key, fallback) => fallback }),
    fs: { stat: async () => ({ mtime: state.mtime, size: state.text.length }), readFile: async () => Buffer.from(state.text) }
  };
  vscode.commands = { executeCommand() {} };
  vscode.window = {
    showWarningMessage() {}, showErrorMessage(message) { throw new Error(message); },
    withProgress: (_options, task) => task({ report() {} })
  };
  const resolver = { resolve: async () => '/', invalidate() {} };
  const server = {
    isAvailable: async () => true, ensureHugoServer: async () => true, finishOperation() {},
    stopServer: async () => true, markUnavailable() {},
    getOrigin: () => `http://localhost:${state.port || 1313}`
  };
  const api = createPreviewController(vscode, {
    getProjectRoot: () => ({ fsPath: root }), server, previewResolver: resolver
  });
  api.createProvider = () => new BlogContentProvider({ now: () => state.now });
  api.server = server;
  api.resolver = resolver;
  api.ensureHugoServer = createServerController(vscode, { getProjectRoot: () => ({ fsPath: root }) }).ensureHugoServer;
  api.setupFollow = async (resolve, messages) => {
    vscode.window.createWebviewPanel = () => ({
      webview: { postMessage: message => messages.push(message), onDidReceiveMessage() {} },
      onDidDispose() {}
    });
    await api.startServer();
    messages.length = 0;
    resolver.resolve = resolve;
  };
  return { state, vscode, api };
}

test('invalid article metadata stays out of Published and recovers after a save', async () => {
  const { state, api } = loadExtension();
  const provider = api.createProvider();
  provider.contentRoot = { fsPath: path.join(root, 'content') };
  state.text = '---\ntitle: [\n---\n';
  const invalid = await provider.getArticleMetadata(uri('example.md'));
  assert.equal(invalid.status.key, 'unknown');
  assert.ok(invalid.parseError);
  state.text = '+++\ntitle = "Article"\ndraft = false\n[params]\ndraft = true\n+++\n';
  state.mtime += 1;
  const repaired = await provider.getArticleMetadata(uri('example.md'));
  assert.equal(repaired.status.key, 'published');
  assert.equal(repaired.parseError, undefined);
});

test('cached scheduled metadata is recalculated as time passes', async () => {
  const { state, api } = loadExtension();
  const provider = api.createProvider();
  provider.contentRoot = { fsPath: path.join(root, 'content') };
  state.text = '---\npublishDate: 2020-01-02T00:00:00Z\n---\n';
  assert.equal((await provider.getArticleMetadata(uri('scheduled.md'))).status.key, 'scheduled');
  state.now = Date.parse('2020-01-03');
  assert.equal((await provider.getArticleMetadata(uri('scheduled.md'))).status.key, 'published');
});

test('tree items keep stable identity across refreshes', () => {
  const { api } = loadExtension();
  const provider = api.createProvider();
  const fileUri = uri('example.md');
  assert.equal(provider.getTreeItem({ uri: fileUri, type: 1 }).id, fileUri.toString());
  assert.equal(provider.getTreeItem({ uri: { ...fileUri }, type: 1 }).id, fileUri.toString());
});

test('real bundle assets stay grouped and nested image files open in the editor', async () => {
  const fs = require('node:fs/promises');
  const { api } = loadExtension();
  const fixture = path.join(__dirname, 'fixtures/site/content/posts');
  const makeUri = fsPath => ({ fsPath, scheme: 'file', toString() { return this.fsPath; } });
  vscode.Uri = { joinPath: (base, ...segments) => makeUri(path.join(base.fsPath, ...segments)) };
  vscode.workspace.fs = {
    stat: fs.stat,
    readFile: value => fs.readFile(value.fsPath),
    readDirectory: async value => (await fs.readdir(value.fsPath, { withFileTypes: true }))
      .map(entry => [entry.name, entry.isDirectory() ? vscode.FileType.Directory : vscode.FileType.File])
  };
  vscode.workspace.fs.stat = value => fs.stat(value.fsPath);
  const provider = api.createProvider();
  provider.contentRoot = makeUri(fixture);
  const posts = await provider.getChildren();
  const bundle = posts.find(entry => path.basename(entry.uri?.fsPath || '') === 'assets-demo');
  assert.equal(bundle.metadata.title, 'Page bundle assets');
  const children = await provider.getChildren(bundle);
  assert.equal(path.basename(children[0].uri.fsPath), 'index.md');
  assert.equal(children[1].label, 'Assets (4)');
  const assets = await provider.getChildren(children[1]);
  assert.deepEqual(assets.map(entry => path.basename(entry.uri.fsPath)), ['gallery', 'coast.png', 'credits.txt', 'forest.png']);
  const gallery = await provider.getChildren(assets[0]);
  assert.equal(path.basename(gallery[0].uri.fsPath), '幾何山景.png');
  const imageItem = provider.getTreeItem(gallery[0]);
  assert.equal(imageItem.command.command, 'vscode.open');
  assert.equal(imageItem.command.arguments[0], gallery[0].uri);
});

test('slow earlier navigation cannot replace the most recently selected article', async () => {
  const { api } = loadExtension();
  const messages = [];
  const pending = new Map();
  await api.setupFollow((_root, filename) => new Promise(resolve => pending.set(filename, resolve)), messages);
  const oldUri = uri('old.md');
  const newUri = uri('new.md');
  const oldNavigation = api.onActiveEditorChanged({ document: { uri: oldUri } });
  await new Promise(resolve => setImmediate(resolve));
  const newNavigation = api.onActiveEditorChanged({ document: { uri: newUri } });
  await new Promise(resolve => setImmediate(resolve));
  pending.get(newUri.fsPath)('/new/');
  await newNavigation;
  pending.get(oldUri.fsPath)('/old/');
  await oldNavigation;
  assert.equal(messages.length, 1);
  assert.equal(messages[0].url, 'http://localhost:1313/new/');
});

test('untrusted workspaces cannot reach server or external-process operations', async () => {
  const { vscode, api } = loadExtension();
  vscode.workspace.isTrusted = false;
  await assert.rejects(api.ensureHugoServer({ fsPath: root }, { report() {} }), /Trust this workspace/);
});

function runPreviewDocument(api, url) {
  const html = api.buildPreviewHtml(url);
  const initialSrc = html.match(/<iframe id="frame" src="([^"]*)"/)[1]
    .replace(/&(amp|quot|lt|gt);/g, (_match, entity) => ({ amp: '&', quot: '"', lt: '<', gt: '>' })[entity]);
  const assignments = [];
  const states = [];
  const messages = [];
  const listeners = new Map();
  const animationFrames = [];
  let src = initialSrc;
  const frame = { get src() { return src; }, set src(value) { src = value; assignments.push(value); } };
  const urlbar = { textContent: '' };
  const button = id => ({ addEventListener: (event, callback) => listeners.set(`${id}:${event}`, callback) });
  const elements = { frame, urlbar, reload: button('reload'), 'open-external': button('external') };
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], {
    document: { getElementById: id => elements[id] },
    acquireVsCodeApi: () => ({ setState: state => states.push(state), postMessage: message => messages.push(message) }),
    window: { addEventListener: (event, callback) => listeners.set(`window:${event}`, callback) },
    requestAnimationFrame: callback => animationFrames.push(callback), URL
  });
  return { html, frame, urlbar, assignments, states, messages, listeners, animationFrames };
}

test('preview HTML loads the standalone template and safely embeds only local URLs', () => {
  const { api } = loadExtension();
  const ordinary = runPreviewDocument(api, 'http://localhost:1313/post/example/?one=1&two=2');
  assert.ok(ordinary.html.includes("frame-src http://localhost:1313;"));
  assert.ok(ordinary.html.includes('<style>'));
  assert.ok(!ordinary.html.includes('{{HUGO_ORIGIN}}'));
  assert.ok(!ordinary.html.includes('{{PREVIEW_URL}}'));
  const crafted = 'http://localhost:1313/post/$&{{HUGO_ORIGIN}}/?q="</script>&x=1';
  const rendered = runPreviewDocument(api, crafted);
  assert.equal(rendered.frame.src, new URL(crafted).href);
  assert.ok(decodeURIComponent(rendered.frame.src).includes('{{HUGO_ORIGIN}}'));
  assert.ok(!rendered.html.match(/<script>([\s\S]*?)<\/script>/)[1].includes('localhost:1313'));
  for (const invalid of ['https://example.org/', 'http://localhost:9999/', 'javascript:alert(1)',
    'blob:http://localhost:1313/id', 'http://user:secret@localhost:1313/']) {
    assert.equal(runPreviewDocument(api, invalid).frame.src, 'http://localhost:1313/');
  }
});

test('preview keeps initial scroll, follows articles, reloads and sends external-open messages', () => {
  const { api } = loadExtension();
  const initial = 'http://localhost:1313/post/first/';
  const second = 'http://localhost:1313/post/second/';
  const document = runPreviewDocument(api, initial);
  assert.equal(document.urlbar.textContent, initial);
  assert.equal(document.states[0].url, initial);
  assert.equal(document.assignments.length, 0, 'initial iframe must not reload');
  const navigate = document.listeners.get('window:message');
  navigate({ data: { type: 'navigate', url: initial } });
  assert.equal(document.assignments.length, 0, 'same article must keep its scroll position');
  navigate({ data: { type: 'navigate', url: second } });
  assert.equal(document.frame.src, second);
  assert.equal(document.urlbar.textContent, second);
  assert.equal(document.states.at(-1).url, second);
  document.listeners.get('reload:click')();
  assert.equal(document.frame.src, 'about:blank');
  document.animationFrames.shift()();
  assert.equal(document.frame.src, second);
  document.listeners.get('external:click')();
  assert.equal(document.messages[0].type, 'ready');
  assert.equal(document.messages[1].type, 'openExternal');
  assert.equal(document.messages[1].url, second);
});

test('explicit server starts refresh the same URL while ordinary following preserves scroll', async () => {
  const { api, vscode } = loadExtension();
  const messages = [];
  const initial = 'http://localhost:1313/';
  const document = runPreviewDocument(api, initial);
  const panel = {
    webview: {
      postMessage: message => messages.push(message),
      onDidReceiveMessage() {}
    },
    onDidDispose() {}, reveal() {}
  };
  await api.previewSerializer.deserializeWebviewPanel(panel, { url: initial });
  await api.startDebugServer();
  assert.equal(messages[0].reload, true);
  const navigate = document.listeners.get('window:message');
  navigate({ data: messages[0] });
  assert.equal(document.frame.src, 'about:blank');
  document.animationFrames.shift()();
  assert.equal(document.frame.src, initial);
  const assignmentCount = document.assignments.length;
  navigate({ data: { type: 'navigate', url: initial } });
  assert.equal(document.assignments.length, assignmentCount);
});

test('restored previews use the template and retain the host-side external URL guard', async () => {
  const { api, vscode } = loadExtension();
  const opened = [];
  let receiveMessage;
  vscode.Uri = { parse: value => value };
  vscode.env = { openExternal: url => opened.push(url) };
  const panel = {
    webview: { onDidReceiveMessage: callback => { receiveMessage = callback; } },
    onDidDispose() {}
  };
  await api.previewSerializer.deserializeWebviewPanel(panel, { url: 'http://localhost:1313/restored/' });
  assert.ok(panel.webview.html.includes('src="http://localhost:1313/restored/"'));
  assert.equal(panel.webview.options.enableScripts, true);
  receiveMessage({ type: 'openExternal', url: 'https://example.org/' });
  receiveMessage({ type: 'openExternal', url: 'http://localhost:1313/restored/' });
  assert.deepEqual(opened, ['http://localhost:1313/restored/']);
  await api.previewSerializer.deserializeWebviewPanel(panel, { url: 'https://example.org/' });
  assert.ok(panel.webview.html.includes('src="http://localhost:1313/"'));
});

test('restored preview follows the active article and retries navigation after the ready handshake', async () => {
  const { api, vscode } = loadExtension();
  const messages = [];
  let receive;
  vscode.window.activeTextEditor = { document: { uri: uri('current.md') } };
  const panel = {
    webview: { onDidReceiveMessage: callback => receive = callback, postMessage: message => messages.push(message) },
    onDidDispose() {}
  };
  await api.previewSerializer.deserializeWebviewPanel(panel, { url: 'http://localhost:1313/old/', following: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(messages.at(-1).url, 'http://localhost:1313/');
  messages.length = 0;
  receive({ type: 'ready' });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(messages.some(message => message.type === 'navigate'));
});

test('restoration honors Stop and the follow setting, and never starts a missing server', async () => {
  const { api, vscode } = loadExtension();
  const messages = [];
  let probes = 0;
  api.server.isAvailable = async () => { probes++; return false; };
  api.server.ensureHugoServer = () => { throw new Error('Restoration must never start Hugo'); };
  const panel = {
    webview: { onDidReceiveMessage() {}, postMessage: message => messages.push(message) }, onDidDispose() {}
  };
  await api.previewSerializer.deserializeWebviewPanel(panel, { url: 'http://localhost:1313/old/', following: false });
  await api.onActiveEditorChanged({ document: { uri: uri('next.md') } });
  assert.equal(probes, 0);
  await api.previewSerializer.deserializeWebviewPanel(panel, { following: true });
  vscode.workspace.getConfiguration = () => ({ get: () => false });
  await api.onActiveEditorChanged({ document: { uri: uri('next.md') } });
  assert.equal(probes, 0);
  vscode.workspace.getConfiguration = () => ({ get: (_key, fallback) => fallback });
  await api.onActiveEditorChanged({ document: { uri: uri('next.md') } });
  assert.equal(probes, 1);
  assert.equal(messages.length, 0);
});

test('Stop during URL indexing prevents the preview opening after the server was started', async () => {
  const { api, vscode } = loadExtension();
  let release;
  let created = 0;
  vscode.window.createWebviewPanel = () => { created++; throw new Error('Preview should stay closed'); };
  api.server.ensureHugoServer = async () => true;
  api.resolver.resolve = () => new Promise(resolve => release = resolve);
  const starting = api.startServer();
  await new Promise(resolve => setImmediate(resolve));
  await api.stopServer();
  release('/delayed/');
  await starting;
  assert.equal(created, 0);
});

test('selected port updates the URL allowlist, iframe CSP and restored preview', async () => {
  const { api, state } = loadExtension();
  state.port = 1414;
  const page = runPreviewDocument(api, 'http://localhost:1414/article/');
  assert.ok(page.html.includes('frame-src http://localhost:1414;'));
  assert.equal(page.frame.src, 'http://localhost:1414/article/');
  const stale = runPreviewDocument(api, 'http://localhost:1313/old/');
  assert.equal(stale.frame.src, 'http://localhost:1414/');
  page.listeners.get('window:message')({ data: { type: 'navigate', url: 'http://localhost:1313/other/' } });
  assert.equal(page.frame.src, 'http://localhost:1414/article/');
  page.listeners.get('window:message')({ data: { type: 'following', value: false } });
  assert.equal(page.states.at(-1).following, false);
});

test('changing ports rebuilds the CSP in the same preview tab', async () => {
  const { api, state, vscode } = loadExtension();
  let panels = 0;
  let html;
  const messages = [];
  vscode.window.createWebviewPanel = () => {
    panels++;
    return {
      webview: { set html(value) { html = value; }, postMessage: message => messages.push(message), onDidReceiveMessage() {} },
      onDidDispose() {}, reveal() {}
    };
  };
  await api.startServer();
  state.port = 1414;
  await api.startDebugServer();
  assert.equal(panels, 1);
  assert.ok(html.includes('frame-src http://localhost:1414;'));
  assert.ok(messages.some(message => message.url === 'http://localhost:1414/'));
});

test('a cancelled start does not block the next start or clear its busy state when it finishes late', async () => {
  const { api, vscode } = loadExtension();
  const starts = [];
  const contexts = [];
  vscode.commands.executeCommand = (...args) => contexts.push(args);
  vscode.window.createWebviewPanel = () => ({
    webview: { onDidReceiveMessage() {}, postMessage() {} }, onDidDispose() {}
  });
  api.server.ensureHugoServer = () => new Promise(resolve => starts.push(resolve));
  const first = api.startServer();
  await api.stopServer();
  const second = api.startDebugServer();
  assert.equal(starts.length, 2);
  starts[0](true);
  await first;
  assert.deepEqual(contexts.at(-1), ['setContext', 'blogExplorerServerBusy', true]);
  assert.equal(api.startServer(), second);
  starts[1](true);
  await second;
  assert.deepEqual(contexts.at(-1), ['setContext', 'blogExplorerServerBusy', false]);
});
