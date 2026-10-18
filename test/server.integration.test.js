const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { vscode } = require('./helpers/vscode');
const { createServerController } = require('../src/server');
const { isPortOpen } = require('../src/network');
const { HugoPreviewResolver } = require('../src/hugo');

let available = false;
try { execFileSync('hugo', ['version'], { stdio: 'ignore', windowsHide: true }); available = true; } catch {}

test('real Hugo conflict, alternate port, mode switch, reattachment and owned-only stop', { skip: !available }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hugo-desk-lifecycle-'));
  const processes = new Set();
  const contexts = [];
  const close = new Set();
  const saved = new Map();
  let view;
  const terminalList = [];
  const disposable = { dispose() {} };
  const external = http.createServer((_request, response) => response.end('external-service'));
  let ownsExternal = false;
  t.after(async () => {
    for (const context of contexts) for (const item of context.subscriptions) item.dispose();
    for (const child of processes) {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit');
        child.kill();
        await exited;
      }
    }
    if (ownsExternal) await new Promise(resolve => external.close(resolve));
    if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('hugo-desk-lifecycle-')) {
      throw new Error('Unexpected temporary fixture path; refusing recursive cleanup.');
    }
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.cp(path.join(__dirname, 'fixtures/site'), root, { recursive: true });
  // Occupy the default port ourselves when possible. If another application
  // already holds it, only select another port; never stop or modify that app.
  try {
    external.listen(1313, '127.0.0.1');
    await once(external, 'listening');
    ownsExternal = true;
  } catch (error) { if (error.code !== 'EADDRINUSE') throw error; }

  const host = {
    ...vscode,
    workspace: { isTrusted: true }, Uri: { parse: value => value },
    commands: { executeCommand() {} },
    window: {
      terminals: terminalList,
      createTreeView: () => view = { ...disposable },
      createStatusBarItem: () => ({ ...disposable, show() {}, hide() {} }),
      onDidCloseTerminal: callback => { close.add(callback); return { dispose: () => close.delete(callback) }; },
      onDidOpenTerminal: () => disposable,
      showInformationMessage() {},
      showWarningMessage: async (_message, first) => { assert.equal(first, 'Use Another Port'); return first; },
      createTerminal(options) {
        const child = spawn(options.shellPath, options.shellArgs, { cwd: options.cwd, windowsHide: true });
        processes.add(child);
        const terminal = { ...options, show() {}, dispose() { child.kill(); } };
        terminal.output = '';
        child.stdout.on('data', chunk => terminal.output += chunk);
        child.stderr.on('data', chunk => terminal.output += chunk);
        child.once('exit', code => {
          terminal.exitStatus = { code };
          terminalList.splice(terminalList.indexOf(terminal), 1);
          for (const callback of close) callback(terminal);
        });
        terminalList.push(terminal);
        return terminal;
      }
    }
  };
  const getProjectRoot = () => ({ fsPath: root });
  const workspaceState = { get: key => saved.get(key), update: async (key, value) => saved.set(key, value) };
  const makeController = () => {
    const server = createServerController(host, { getProjectRoot, pollInterval: 50 });
    const context = { subscriptions: [], workspaceState };
    server.initialize(context);
    contexts.push(context);
    return server;
  };
  const server = makeController();
  assert.equal(await server.ensureHugoServer(getProjectRoot(), { report() {} }, ['-D']), true);
  const port = server.getPort();
  assert.notEqual(port, 1313);
  const draftPath = await new HugoPreviewResolver().resolve(root, path.join(root, 'content/posts/draft.md'));
  const url = `http://127.0.0.1:${port}${draftPath}`;
  assert.equal((await fetch(url)).status, 200);
  assert.equal(processes.size, 1);
  assert.equal(await server.ensureHugoServer(getProjectRoot(), { report() {} }, ['-D']), true);
  assert.equal(processes.size, 1);
  assert.equal(await server.ensureHugoServer(getProjectRoot(), { report() {} }), true);
  assert.equal(server.getPort(), port);
  assert.equal((await fetch(url)).status, 404);
  assert.equal(processes.size, 2);
  for (const item of contexts[0].subscriptions) item.dispose();
  const restored = makeController();
  await restored.reattachHugoTerminal();
  assert.equal(view.description, 'Running ●');
  assert.equal(restored.getPort(), port);
  assert.equal(await restored.isAvailable(), true);
  assert.equal(await restored.ensureHugoServer(getProjectRoot(), { report() {} }), true);
  assert.equal(processes.size, 2);
  await restored.stopServer();
  for (let attempt = 0; attempt < 100 && await isPortOpen(port); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(await isPortOpen(port), false);
  assert.equal(await isPortOpen(1313), true);
  if (ownsExternal) {
    const response = await fetch('http://127.0.0.1:1313');
    assert.equal(await response.text(), 'external-service');
    host.window.showWarningMessage = async () => 'Use Existing';
    assert.equal(await restored.ensureHugoServer(getProjectRoot(), { report() {} }), true);
    assert.equal(view.description, 'External (mode unknown) ●');
    await restored.stopServer();
    assert.equal(await isPortOpen(1313), true);
  }
});
