const { randomUUID } = require('node:crypto');
const { runHugo, externalServerChoices } = require('./hugo');
const network = require('./network');

const HUGO_PORT = 1313;
const SESSION_KEY = 'blogExplorer.serverSession';

function createServerController(vscode, {
  getProjectRoot, isPortOpen = network.isPortOpen, isHttpReady = network.isHttpReady,
  findAvailablePort = network.findAvailablePort, runHugoCommand = runHugo,
  readyTimeout = 30000, pollInterval = 300, monitorInterval = 2000
}) {
  let session;
  let hugoTerminal;
  let ready = false;
  let starting = false;
  let transientLabel;
  let serverView;
  let statusBarItem;
  let stateStore;
  let operationVersion = 0;
  let reattachTimer;
  let reattachAttempts = 0;
  let disposed = false;
  let monitoring = false;
  const changeEmitter = new vscode.EventEmitter();

  const currentPort = () => session?.port || HUGO_PORT;
  const origin = () => `http://localhost:${currentPort()}`;
  const terminalAlive = () => Boolean(hugoTerminal && hugoTerminal.exitStatus === undefined);
  const sessionLabel = () => session?.kind === 'external'
    ? 'External (mode unknown)'
    : session?.drafts ? 'Debug (drafts)' : 'Running';

  function persist() { return stateStore?.update(SESSION_KEY, session); }

  function updateServerStatus() {
    const label = transientLabel || (ready ? sessionLabel() : undefined);
    if (serverView) serverView.description = label ? (transientLabel ? label : `${label} ●`) : 'Stopped';
    serverProvider.refresh();
    void vscode.commands.executeCommand('setContext', 'blogExplorerServerRunning', terminalAlive() || starting);
    if (statusBarItem) {
      statusBarItem.text = transientLabel ? `$(sync~spin) Hugo: ${label}` : `$(pulse) Hugo: ${label}`;
      if (label) statusBarItem.show();
      else statusBarItem.hide();
    }
    changeEmitter.fire(undefined);
  }

  class ServerStatusProvider {
    constructor() {
      this.changeEmitter = new vscode.EventEmitter();
      this.onDidChangeTreeData = this.changeEmitter.event;
    }
    refresh() { this.changeEmitter.fire(undefined); }
    getTreeItem(element) { return element; }
    getChildren(element) {
      if (element) return [];
      const item = new vscode.TreeItem(
        transientLabel || (ready ? `${sessionLabel()} — ${origin()}` : 'Start Hugo Server'),
        vscode.TreeItemCollapsibleState.None
      );
      item.iconPath = new vscode.ThemeIcon(transientLabel ? 'sync~spin' : ready ? 'pulse' : 'play');
      if (!transientLabel) {
        if (ready) {
          item.command = { command: 'vscode.open', title: 'Open in Browser', arguments: [vscode.Uri.parse(origin())] };
          if (session.kind === 'external') item.tooltip = 'Using an external HTTP service. Its project and Hugo mode are unknown. Stop only controls Hugo Desk’s own server.';
        } else {
          item.description = 'Stopped';
          item.command = { command: 'blogExplorer.startServer', title: 'Start Hugo Server' };
        }
      }
      return [item];
    }
  }
  const serverProvider = new ServerStatusProvider();

  function validSession(value, projectRoot) {
    return value && value.project === projectRoot.fsPath
      && Number.isInteger(value.port) && value.port >= 1024 && value.port <= 65535
      && (value.kind === 'external' || (value.kind === 'owned' && typeof value.name === 'string'
        && /^Hugo Desk [0-9a-f-]{36} \(\d+\)( drafts)?$/.test(value.name)));
  }

  async function reattachHugoTerminal() {
    if (disposed || starting) return;
    const projectRoot = getProjectRoot();
    if (!projectRoot) return;
    const version = operationVersion;
    const saved = stateStore?.get(SESSION_KEY);
    if (!session && validSession(saved, projectRoot)) session = { ...saved };
    if (!session) { updateServerStatus(); return; }
    const selected = session;
    if (selected.kind === 'owned' && !terminalAlive()) {
      // Match the saved random execution name. Legacy shell terminals remain
      // external because their names do not prove which process is running.
      hugoTerminal = vscode.window.terminals.find(terminal => terminal.name === selected.name
        && terminal.exitStatus === undefined);
      if (!hugoTerminal) {
        ready = false;
        if (reattachAttempts++ < 20) {
          clearTimeout(reattachTimer);
          reattachTimer = setTimeout(() => void reattachHugoTerminal(), 250);
        }
        updateServerStatus();
        return;
      }
    }
    const available = await isHttpReady(selected.port);
    if (disposed || version !== operationVersion || session !== selected) return;
    ready = available && (selected.kind === 'external' || terminalAlive());
    if (ready) { clearTimeout(reattachTimer); reattachAttempts = 0; }
    updateServerStatus();
  }

  async function isAvailable() {
    const selected = session;
    if (!selected || (selected.kind === 'owned' && !terminalAlive())) return false;
    const available = await isHttpReady(selected.port);
    return session === selected && available && (selected.kind === 'external' || terminalAlive());
  }

  async function waitUntil(check, timeout, active) {
    const deadline = Date.now() + timeout;
    while (active() && Date.now() < deadline) {
      if (await check()) return active();
      if (!active()) return false;
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
    return false;
  }

  function detachTerminal() {
    const terminal = hugoTerminal;
    hugoTerminal = undefined;
    ready = false;
    // The terminal's process is Hugo itself, not a reusable command shell.
    // Dispose targets only that execution on Windows, macOS and Linux.
    terminal?.dispose();
  }

  async function ensureHugoServer(projectRoot, progress, args = []) {
    if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace before starting Hugo.');
    const version = ++operationVersion;
    const active = () => !disposed && operationVersion === version;
    starting = true;
    transientLabel = 'Starting…';
    updateServerStatus();
    try {
      let port = currentPort();
      if (session?.kind === 'owned' && terminalAlive()) {
        const available = await isAvailable();
        if (!active()) return false;
        if (available && session.drafts === args.includes('-D')) { ready = true; return true; }
        transientLabel = 'Restarting…';
        updateServerStatus();
        detachTerminal();
        await waitUntil(async () => !(await isPortOpen(port)), 5000, active);
        if (!active()) return false;
      }

      let occupied = await isPortOpen(port);
      if (!active()) return false;
      if (occupied) {
        const choice = await vscode.window.showWarningMessage(
          `Port ${port} is already in use. Use another port for this project, or use the existing service (project and mode unknown).`,
          ...externalServerChoices()
        );
        if (!active()) return false;
        if (choice === 'Use Existing') {
          if (!(await isHttpReady(port))) {
            if (!active()) return false;
            throw new Error(`The service on port ${port} is not responding to HTTP. Choose Use Another Port to start Hugo.`);
          }
          if (!active()) return false;
          session = { kind: 'external', project: projectRoot.fsPath, port };
          ready = true;
          await persist();
          return active();
        }
        if (choice !== 'Use Another Port') return false;
        // Binding the same interface finds a candidate. Explicit --port makes
        // a later bind race fail visibly instead of silently changing endpoints.
        let attempts = 0;
        do {
          if (++attempts > 5) throw new Error('Local ports kept changing while starting Hugo. Try starting again.');
          port = await findAvailablePort(port < 65535 ? port + 1 : 1314);
          if (!active()) return false;
          occupied = await isPortOpen(port);
          if (!active()) return false;
        } while (occupied);
      }

      await runHugoCommand(['version'], projectRoot.fsPath);
      if (!active()) return false;
      transientLabel = 'Starting…';
      session = {
        kind: 'owned', project: projectRoot.fsPath, port, drafts: args.includes('-D'),
        name: `Hugo Desk ${randomUUID()} (${port})${args.includes('-D') ? ' drafts' : ''}`
      };
      ready = false;
      await persist();
      if (!active()) return false;
      progress.report({ message: `Starting Hugo on port ${port}…` });
      // Direct executable + argument array avoids OS/shell quoting differences.
      const terminal = vscode.window.createTerminal({
        name: session.name, cwd: projectRoot.fsPath, shellPath: 'hugo',
        shellArgs: ['server', ...args, '--port', String(port), '--bind', '127.0.0.1', '--environment', 'development', '--renderToMemory']
      });
      hugoTerminal = terminal;
      updateServerStatus();
      terminal.show(true);
      const ownsExecution = () => active() && hugoTerminal === terminal && terminalAlive();
      const available = await waitUntil(() => isHttpReady(port), readyTimeout, ownsExecution);
      if (!active()) return false;
      if (!available) {
        ready = false;
        throw new Error(`Hugo did not become ready on port ${port}. Check the Hugo terminal for build or port-conflict errors, then start again.`);
      }
      ready = true;
      return true;
    } catch (error) {
      if (!active()) return false;
      throw error;
    } finally {
      if (active()) { starting = false; transientLabel = undefined; updateServerStatus(); }
    }
  }

  async function stopServer() {
    const wasStarting = starting;
    ++operationVersion; // Cancels continuations even before a terminal exists.
    starting = false;
    transientLabel = undefined;
    clearTimeout(reattachTimer);
    reattachAttempts = 0;
    if (session?.kind === 'external' && !wasStarting) {
      void vscode.window.showInformationMessage('This is an external service. Stop it in the terminal or application that started it.');
      updateServerStatus();
      return false;
    }
    detachTerminal();
    session = undefined;
    await persist();
    updateServerStatus();
    return true;
  }

  async function monitor() {
    if (disposed || monitoring || starting || !session) return;
    monitoring = true;
    const selected = session;
    const version = operationVersion;
    try {
      const available = await isAvailable();
      if (disposed || starting || version !== operationVersion || session !== selected) return;
      if (available !== ready) { ready = available; updateServerStatus(); }
    } finally { monitoring = false; }
  }

  function initialize(context) {
    stateStore = context.workspaceState;
    serverView = vscode.window.createTreeView('blogExplorer.server', { treeDataProvider: serverProvider });
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.command = 'blogExplorer.startServer';
    const monitorTimer = setInterval(() => void monitor(), monitorInterval);
    monitorTimer.unref?.();
    context.subscriptions.push(
      serverView, statusBarItem, serverProvider.changeEmitter, changeEmitter,
      { dispose() { disposed = true; ++operationVersion; clearTimeout(reattachTimer); clearInterval(monitorTimer); } },
      vscode.window.onDidCloseTerminal((terminal) => {
        if (terminal !== hugoTerminal) return;
        hugoTerminal = undefined;
        ready = false;
        updateServerStatus();
      }),
      vscode.window.onDidOpenTerminal(() => {
        if (!hugoTerminal && !starting && getProjectRoot()) void reattachHugoTerminal();
      })
    );
  }

  function markUnavailable() {
    if (!ready) return;
    ready = false;
    updateServerStatus();
  }

  return {
    initialize, reattachHugoTerminal, ensureHugoServer, stopServer, isAvailable, markUnavailable,
    getPort: currentPort, getOrigin: origin, onDidChange: changeEmitter.event,
    finishOperation() { updateServerStatus(); }
  };
}

module.exports = { createServerController, HUGO_PORT };
