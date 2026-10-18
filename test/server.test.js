const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { vscode } = require('./helpers/vscode');
const { createServerController } = require('../src/server');

function setup(t, overrides = {}) {
  const state = { ports: new Set(), created: [], disposed: [], warnings: [], contexts: [], http: true };
  const disposable = { dispose() {} };
  const closeListeners = new Set();
  const openListeners = new Set();
  const saved = new Map();
  const workspaceState = { get: key => saved.get(key), update: async (key, value) => saved.set(key, value) };
  const contexts = [];
  vscode.Uri = { parse: value => value };
  vscode.workspace = { isTrusted: true };
  vscode.commands = { executeCommand: (...args) => state.contexts.push(args) };
  vscode.window = {
    terminals: [],
    showInformationMessage(message) { state.information = message; },
    showWarningMessage: async (...args) => { state.warnings.push(args); return state.choice || 'Cancel'; },
    createTreeView: (_id, options) => { state.provider = options.treeDataProvider; return state.view = { ...disposable }; },
    createStatusBarItem: () => ({ ...disposable, show() {}, hide() {} }),
    onDidCloseTerminal: callback => { closeListeners.add(callback); return { dispose: () => closeListeners.delete(callback) }; },
    onDidOpenTerminal: callback => { openListeners.add(callback); return { dispose: () => openListeners.delete(callback) }; },
    createTerminal(options) {
      const port = Number(options.shellArgs[options.shellArgs.indexOf('--port') + 1]);
      const terminal = {
        ...options, show() {},
        dispose() {
          terminal.exitStatus = { code: 0 };
          state.ports.delete(port);
          state.disposed.push(terminal);
          vscode.window.terminals = vscode.window.terminals.filter(value => value !== terminal);
          for (const listener of closeListeners) listener(terminal);
        }
      };
      state.created.push(terminal);
      state.ports.add(port);
      vscode.window.terminals.push(terminal);
      for (const listener of openListeners) listener(terminal);
      return terminal;
    }
  };
  const dependencies = {
    getProjectRoot: () => ({ fsPath: path.resolve('example-site') }),
    isPortOpen: async port => state.ports.has(port),
    isHttpReady: async port => state.http && state.ports.has(port),
    findAvailablePort: async start => {
      while (state.ports.has(start)) start++;
      return start;
    },
    runHugoCommand: async () => 'hugo version',
    readyTimeout: 40, pollInterval: 1, ...overrides
  };
  function controller() {
    const server = createServerController(vscode, dependencies);
    const context = { subscriptions: [], workspaceState };
    server.initialize(context);
    contexts.push(context);
    return server;
  }
  const server = controller();
  t.after(() => { for (const context of contexts) for (const item of context.subscriptions) item.dispose(); });
  return { state, dependencies, server, controller, workspaceState, contexts };
}
const progress = { report() {} };

test('direct Hugo terminals reuse mode, switch modes and stop only the owned execution', async t => {
  const { state, dependencies, server } = setup(t);
  const root = dependencies.getProjectRoot();
  assert.equal(await server.ensureHugoServer(root, progress), true);
  assert.equal(state.view.description, 'Running ●');
  assert.equal(await server.ensureHugoServer(root, progress), true);
  assert.equal(state.created.length, 1);
  assert.equal(await server.ensureHugoServer(root, progress, ['-D']), true);
  assert.equal(state.created[0].shellPath, 'hugo');
  assert.deepEqual(state.created[1].shellArgs, ['server', '-D', '--port', '1313', '--bind', '127.0.0.1', '--environment', 'development', '--renderToMemory']);
  assert.equal(state.disposed.length, 1);
  assert.equal(state.view.description, 'Debug (drafts) ●');
  assert.equal(await server.stopServer(), true);
  assert.equal(state.view.description, 'Stopped');
  assert.equal(state.disposed.length, 2);
});

test('external service is labelled unknown and Stop never acquires or disposes it', async t => {
  const { state, dependencies, server } = setup(t);
  state.ports.add(1313);
  assert.equal(await server.ensureHugoServer(dependencies.getProjectRoot(), progress), false);
  assert.deepEqual(state.warnings[0].slice(1), ['Use Another Port', 'Use Existing', 'Cancel']);
  state.choice = 'Use Existing';
  assert.equal(await server.ensureHugoServer(dependencies.getProjectRoot(), progress), true);
  assert.equal(state.view.description, 'External (mode unknown) ●');
  assert.match(state.provider.getChildren()[0].label, /External.*1313/);
  assert.equal(await server.stopServer(), false);
  assert.equal(state.created.length, 0);
  assert.equal(state.disposed.length, 0);
  assert.equal(state.ports.has(1313), true);
  assert.equal(state.view.description, 'External (mode unknown) ●');
});

test('conflict uses a free port, preserves the other service and reuses the port for mode switches', async t => {
  const { state, dependencies, server } = setup(t);
  state.ports.add(1313);
  state.ports.add(1314);
  state.choice = 'Use Another Port';
  assert.equal(await server.ensureHugoServer(dependencies.getProjectRoot(), progress), true);
  assert.equal(server.getOrigin(), 'http://localhost:1315');
  assert.equal(await server.ensureHugoServer(dependencies.getProjectRoot(), progress, ['-D']), true);
  assert.equal(server.getPort(), 1315);
  assert.equal(state.warnings.length, 1);
  await server.stopServer();
  assert.deepEqual([...state.ports], [1313, 1314]);
});

test('Stop during the version check cancels before terminal creation', async t => {
  let release, entered;
  const startedVersion = new Promise(resolve => entered = resolve);
  const version = new Promise(resolve => release = resolve);
  const { state, dependencies, server } = setup(t, { runHugoCommand: async () => { entered(); await version; } });
  const starting = server.ensureHugoServer(dependencies.getProjectRoot(), progress);
  await startedVersion;
  await server.stopServer();
  release();
  assert.equal(await starting, false);
  assert.equal(state.created.length, 0);
  assert.equal(state.view.description, 'Stopped');
});

test('Stop cancels a pending conflict dialog and HTTP readiness check', async t => {
  let choose;
  const { state, dependencies, server } = setup(t);
  state.ports.add(1313);
  vscode.window.showWarningMessage = () => new Promise(resolve => choose = resolve);
  const starting = server.ensureHugoServer(dependencies.getProjectRoot(), progress);
  await new Promise(resolve => setImmediate(resolve));
  await server.stopServer();
  choose('Use Another Port');
  assert.equal(await starting, false);
  assert.equal(state.created.length, 0);
  assert.equal(state.ports.has(1313), true);

  state.ports.clear();
  state.http = false;
  const waiting = server.ensureHugoServer(dependencies.getProjectRoot(), progress);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.created.length, 1);
  await server.stopServer();
  assert.equal(await waiting, false);
  assert.equal(state.ports.size, 0);
});

test('an open TCP port without HTTP cannot become an external preview', async t => {
  const { state, dependencies, server } = setup(t);
  state.ports.add(1313);
  state.http = false;
  state.choice = 'Use Existing';
  await assert.rejects(server.ensureHugoServer(dependencies.getProjectRoot(), progress), /not responding to HTTP/);
  assert.equal(state.view.description, 'Stopped');
});

test('HTTP startup failure is reported and an exited owned process cannot become available via another service', async t => {
  const { state, dependencies, server } = setup(t);
  state.http = false;
  await assert.rejects(server.ensureHugoServer(dependencies.getProjectRoot(), progress), /did not become ready/);
  assert.equal(state.view.description, 'Stopped');
  state.created[0].dispose();
  state.ports.add(1313);
  state.http = true;
  assert.equal(await server.isAvailable(), false);
  state.choice = 'Cancel';
  assert.equal(await server.ensureHugoServer(dependencies.getProjectRoot(), progress), false);
  assert.equal(state.warnings.length, 1);
});

test('reload restores the saved execution, port and mode without creating a second process', async t => {
  const { state, dependencies, server, controller } = setup(t);
  state.ports.add(1313);
  state.choice = 'Use Another Port';
  await server.ensureHugoServer(dependencies.getProjectRoot(), progress, ['-D']);
  vscode.window.terminals.unshift({ name: 'Hugo Desk someone-else' });
  const restored = controller();
  await restored.reattachHugoTerminal();
  assert.equal(restored.getPort(), 1314);
  assert.equal(state.view.description, 'Debug (drafts) ●');
  assert.equal(await restored.ensureHugoServer(dependencies.getProjectRoot(), progress, ['-D']), true);
  assert.equal(state.created.length, 1);
});

test('reload waits for delayed terminal names', async t => {
  const { state, dependencies, server, controller } = setup(t);
  await server.ensureHugoServer(dependencies.getProjectRoot(), progress, ['-D']);
  const name = state.created[0].name;
  state.created[0].name = '';
  const restored = controller();
  await restored.reattachHugoTerminal();
  assert.equal(state.view.description, 'Stopped');
  state.created[0].name = name;
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.equal(state.view.description, 'Debug (drafts) ●');
});

test('a predictable legacy terminal name without a saved execution is treated as external', async t => {
  const { state, dependencies, server } = setup(t);
  vscode.window.terminals.push({ name: 'Hugo Desk predictable-project (drafts)', dispose() { throw new Error('Legacy shell must not be stopped'); } });
  state.ports.add(1313);
  await server.reattachHugoTerminal();
  assert.equal(await server.isAvailable(), false);
  assert.equal(await server.ensureHugoServer(dependencies.getProjectRoot(), progress), false);
  assert.equal(state.warnings.length, 1);
  assert.equal(state.disposed.length, 0);
});

test('external session survives reload without being claimed as owned', async t => {
  const { state, dependencies, server, controller } = setup(t);
  state.ports.add(1313);
  state.choice = 'Use Existing';
  await server.ensureHugoServer(dependencies.getProjectRoot(), progress);
  const restored = controller();
  await restored.reattachHugoTerminal();
  assert.equal(state.view.description, 'External (mode unknown) ●');
  await restored.stopServer();
  assert.equal(state.ports.has(1313), true);
  assert.equal(state.disposed.length, 0);
});

test('monitor notices an external service disappearing', async t => {
  const { state, dependencies, server } = setup(t, { monitorInterval: 5 });
  state.ports.add(1313);
  state.choice = 'Use Existing';
  await server.ensureHugoServer(dependencies.getProjectRoot(), progress);
  state.ports.clear();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(state.view.description, 'Stopped');
});
