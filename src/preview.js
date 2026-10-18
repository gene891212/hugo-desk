const path = require('node:path');
const { readFileSync } = require('node:fs');
const { getSetting, isUnderContent } = require('./workspace');
const { HUGO_PORT } = require('./server');

// Panel, navigation and in-flight start state belong to one extension activation.
function createPreviewController(vscode, { getProjectRoot, server, previewResolver, outputChannel }) {
  let followingActiveEditor = false;
  let previewPanel;
  let previewHtmlTemplate;
  let previewNavigationVersion = 0;
  let lastPreviewError;
  let serverOperation;
  let startVersion = 0;
  const serverOrigin = () => server.getOrigin?.() || `http://localhost:${HUGO_PORT}`;

  function previewTitle(uri) {
    return uri ? `Preview ${path.basename(uri.fsPath)}` : 'Hugo Desk Preview';
  }

  // Every preview URL this extension builds ultimately traces back through
  // getArticlePath() to `url`/`slug` front matter -- content from whatever
  // Hugo project happens to be open, not something to trust. Constraining it
  // to exactly the local hugo server's own origin (same restriction the CSP's
  // frame-src already declares) means a crafted front matter value can, at
  // worst, pick which local path loads -- it can never point elsewhere, and
  // `.href` re-serializes it with any HTML/JS-breaking characters percent-
  // encoded. Returns undefined if `url` isn't that origin at all.
  function localHugoUrl(url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:' && parsed.origin === serverOrigin() && !parsed.username && !parsed.password) {
        return parsed.href;
      }
    } catch {
      // Not a parseable URL at all.
    }
    return undefined;
  }

  function escapeHtmlAttribute(value) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function buildPreviewHtml(url, following = true) {
    const origin = serverOrigin();
    const safeUrl = localHugoUrl(url) || `${origin}/`;
    previewHtmlTemplate ??= readFileSync(path.join(__dirname, '..', 'webview', 'preview.html'), 'utf8');
    // Replace in one pass so URL text cannot become another template directive.
    // The script reads iframe.src after HTML decoding, avoiding JS interpolation.
    return previewHtmlTemplate.replace(/{{HUGO_ORIGIN}}|{{PREVIEW_URL}}|{{FOLLOWING}}/g, (token) => {
      if (token === '{{FOLLOWING}}') return following ? 'true' : 'false';
      return token === '{{HUGO_ORIGIN}}' ? origin : escapeHtmlAttribute(safeUrl);
    });
  }

  // Opening the preview is only ever the result of clicking one of the start
  // buttons, so this is the one path allowed to reveal a tab.
  function openPreview(url, title) {
    const safeUrl = localHugoUrl(url) || `${serverOrigin()}/`;

    if (previewPanel) {
      previewPanel.title = title;
      // A port change also changes the iframe CSP. Rebuild the document before
      // sending any URL on that origin, keeping the same editor tab/group.
      if (previewPanelOrigin !== serverOrigin()) {
        previewPanelOrigin = serverOrigin();
        previewPanel.webview.html = buildPreviewHtml(safeUrl, true);
      }
      // Explicit start/mode switches must refresh even if the URL stays the same.
      void previewPanel.webview.postMessage({ type: 'navigate', url: safeUrl, reload: true });
      void previewPanel.webview.postMessage({ type: 'following', value: true });
      previewPanel.reveal(undefined, true);
      return;
    }

    const column = getSetting('previewLocation', 'beside') === 'beside'
      ? vscode.ViewColumn.Beside
      : vscode.ViewColumn.Active;

    previewPanel = vscode.window.createWebviewPanel(
      'blogExplorer.preview',
      title,
      { viewColumn: column, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true, enableFindWidget: true }
    );
    adoptPreviewPanel(previewPanel);
    previewPanel.webview.html = buildPreviewHtml(safeUrl);
  }

  // The follow path, and the reason this owns a panel instead of calling
  // `simpleBrowser.show`: that command always reveals, so in a single editor
  // group it covered the article you just opened. Re-titling the tab and
  // re-pointing its iframe touches nothing on screen -- the preview quietly
  // tracks the active editor in the background, the way VS Code's own Markdown
  // Preview does, and only shows the new article once you click over to it.
  let previewPanelOrigin;
  function adoptPreviewPanel(panel) {
    previewPanel = panel;
    previewPanelOrigin = serverOrigin();
    panel.onDidDispose(() => {
      previewPanel = undefined;
      followingActiveEditor = false;
      ++previewNavigationVersion;
    });
    panel.webview.onDidReceiveMessage((message) => {
      if (message?.type === 'ready') {
        void panel.webview.postMessage({ type: 'following', value: followingActiveEditor });
        void onActiveEditorChanged(vscode.window.activeTextEditor);
        return;
      }
      if (message?.type !== 'openExternal' || !message.url) return;
      // The webview is the one place a crafted front matter value could still
      // reach even after the escaping in buildPreviewHtml -- e.g. by
      // compromising the page and calling postMessage directly. Refusing
      // anything outside the local hugo origin here means that's still not
      // enough to make this extension open an arbitrary external URL.
      const safeUrl = localHugoUrl(message.url);
      if (safeUrl) void vscode.env.openExternal(vscode.Uri.parse(safeUrl));
    });
  }

  // Without a serializer VS Code brings the tab back as a dead placeholder
  // after a window reload, so re-hydrate it from the URL the webview stashed.
  const previewSerializer = {
    async deserializeWebviewPanel(panel, state) {
      panel.webview.options = { enableScripts: true };
      followingActiveEditor = state?.following !== false;
      adoptPreviewPanel(panel);
      panel.webview.html = buildPreviewHtml(state?.url || `${serverOrigin()}/`, followingActiveEditor);
      // onActiveEditorChanged only probes the saved service; it never starts it.
      // The webview ready handshake retries if this first message precedes load.
      void onActiveEditorChanged(vscode.window.activeTextEditor);
    }
  };

  function updatePreview(url, title) {
    if (!previewPanel) return;
    const safeUrl = localHugoUrl(url) || `${serverOrigin()}/`;
    previewPanel.title = title;
    void previewPanel.webview.postMessage({ type: 'navigate', url: safeUrl });
  }

  async function onActiveEditorChanged(editor) {
    const navigationVersion = ++previewNavigationVersion;
    if (!followingActiveEditor) return;

    if (!getSetting('followActiveEditor', true)) return;
    // Nothing on screen to re-point, and following is never a reason to open a
    // preview you didn't ask for.
    if (!previewPanel) return;

    const projectRoot = getProjectRoot();
    if (!projectRoot) return;

    const uri = editor?.document.uri;
    if (!uri || uri.scheme !== 'file' || !uri.fsPath.toLowerCase().endsWith('.md')) return;

    const contentRoot = path.join(projectRoot.fsPath, 'content');
    const relativeToContent = path.relative(contentRoot, uri.fsPath);
    if (!relativeToContent || relativeToContent.startsWith('..') || path.isAbsolute(relativeToContent)) return;

    // Only follow once a server is already up -- switching tabs shouldn't
    // silently spawn a terminal and start `hugo server` on its own.
    try {
      if (!(await server.isAvailable())) {
        server.markUnavailable();
        return;
      }
      if (navigationVersion !== previewNavigationVersion || !previewPanel) return;
      if (previewPanelOrigin !== serverOrigin()) return;
      const articlePath = await getArticlePath(projectRoot, uri);
      if (navigationVersion !== previewNavigationVersion || !previewPanel) return;
      lastPreviewError = undefined;
      updatePreview(`${serverOrigin()}${articlePath}`, previewTitle(uri));
    } catch (error) {
      if (navigationVersion !== previewNavigationVersion) return;
      reportPreviewError(error);
    }
  }

  function reportPreviewError(error) {
    const message = `Hugo Desk: ${error.message || error}`;
    outputChannel?.appendLine(message);
    if (message !== lastPreviewError) void vscode.window.showWarningMessage(message);
    lastPreviewError = message;
  }

  // Mirrors "Open Preview to the Side": if the file you're looking at is
  // something in content/, preview that specific article; otherwise there's
  // nothing specific to show, so fall back to the homepage.
  async function currentPreviewTarget(projectRoot) {
    const activeUri = vscode.window.activeTextEditor?.document.uri;
    const useActiveFile = isUnderContent(projectRoot, activeUri) && activeUri.fsPath.toLowerCase().endsWith('.md');
    const articlePath = await getArticlePath(projectRoot, useActiveFile ? activeUri : undefined);
    return {
      url: `${serverOrigin()}${articlePath}`,
      title: useActiveFile ? previewTitle(activeUri) : 'Hugo Desk Preview'
    };
  }

  function startServer() {
    return startHugoPreview([]);
  }

  function startDebugServer() {
    return startHugoPreview(['-D']);
  }

  function startHugoPreview(args) {
    if (serverOperation) return serverOperation;
    void vscode.commands.executeCommand('setContext', 'blogExplorerServerBusy', true);
    const version = ++startVersion;
    const operation = runStartHugoPreview(args, version).finally(() => {
      if (serverOperation !== operation) return;
      serverOperation = undefined;
      void vscode.commands.executeCommand('setContext', 'blogExplorerServerBusy', false);
    });
    serverOperation = operation;
    return operation;
  }

  async function runStartHugoPreview(args, version) {
    const projectRoot = getProjectRoot();
    if (!projectRoot) {
      void vscode.window.showWarningMessage('No Hugo project was found in this workspace.');
      return;
    }

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: args.length ? 'Starting Hugo server (drafts included)' : 'Starting Hugo server',
          cancellable: false
        },
        async (progress) => {
          try {
            const started = await server.ensureHugoServer(projectRoot, progress, args);
            if (!started || version !== startVersion) return;
            previewResolver.invalidate();
            progress.report({ message: 'Opening site…' });
            const { url, title } = await currentPreviewTarget(projectRoot);
            if (version !== startVersion) return;
            followingActiveEditor = true;
            openPreview(url, title);
            // Editor changes while Hugo was indexing must resolve the latest file.
            void onActiveEditorChanged(vscode.window.activeTextEditor);
          } finally {
            server.finishOperation();
          }
        }
      );
    } catch (error) {
      if (version === startVersion) void vscode.window.showErrorMessage(`Hugo Desk: ${error.message || error}`);
    }
  }

  async function getArticlePath(projectRoot, uri) {
    if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace before running Hugo.');
    return previewResolver.resolve(projectRoot.fsPath, uri?.fsPath);
  }

  async function stopServer() {
    ++startVersion;
    // Stop also cancels URL indexing that began after the server was ready.
    ++previewNavigationVersion;
    const wasFollowing = followingActiveEditor;
    followingActiveEditor = false;
    const cancelledOperation = serverOperation;
    if (await server.stopServer()) {
      void previewPanel?.webview.postMessage({ type: 'following', value: false });
    } else {
      followingActiveEditor = wasFollowing;
    }
    if (serverOperation === cancelledOperation) {
      serverOperation = undefined;
      void vscode.commands.executeCommand('setContext', 'blogExplorerServerBusy', false);
    }
  }

  return {
    startServer, startDebugServer, stopServer, onActiveEditorChanged,
    previewSerializer, buildPreviewHtml,
    initialize(context) {
      if (server.onDidChange) context.subscriptions.push(server.onDidChange(() => {
        void onActiveEditorChanged(vscode.window.activeTextEditor);
      }));
    }
  };
}

module.exports = { createPreviewController };
