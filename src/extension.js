const vscode = require('vscode');
const { BlogContentProvider } = require('./content-provider');
const { SimpleGitProvider } = require('./git-provider');
const { createServerController } = require('./server');
const { createFileActions } = require('./file-actions');
const { createPreviewController } = require('./preview');
const { HugoPreviewResolver } = require('./hugo');

async function activate(context) {
  const outputChannel = vscode.window.createOutputChannel('Hugo Desk');
  const previewResolver = new HugoPreviewResolver();
  const invalidatePreview = () => previewResolver.invalidate();
  let treeView;
  const provider = new BlogContentProvider({
    invalidatePreview,
    outputChannel,
    onFilterChanged: filter => { treeView.description = filter?.label; }
  });
  const fileActions = createFileActions({
    provider, getSelection: () => treeView.selection, invalidatePreview
  });
  treeView = vscode.window.createTreeView('blogExplorer.content', {
    treeDataProvider: provider,
    dragAndDropController: fileActions.dragAndDropController,
    showCollapseAll: true
  });
  const getProjectRoot = () => provider.projectRoot;
  const gitProvider = new SimpleGitProvider(getProjectRoot);
  const gitView = vscode.window.createTreeView('blogExplorer.git', {
    treeDataProvider: gitProvider, showCollapseAll: true
  });
  const server = createServerController(vscode, { getProjectRoot });
  server.initialize(context);
  const preview = createPreviewController(vscode, { getProjectRoot, server, previewResolver, outputChannel });
  preview.initialize(context);

  const commands = {
    refresh: () => { invalidatePreview(); provider.refresh(true); },
    filter: () => provider.showFilterPicker(),
    clearFilter: () => provider.clearFilter(),
    refreshGit: () => gitProvider.refresh(),
    startServer: preview.startServer,
    startDebugServer: preview.startDebugServer,
    stopServer: preview.stopServer,
    newFile: fileActions.newFile,
    newFolder: fileActions.newFolder,
    rename: fileActions.renameItem,
    delete: fileActions.deleteItem,
    copy: fileActions.copyItem,
    cut: fileActions.cutItem,
    paste: fileActions.pasteItem,
    revealInFileExplorer: fileActions.revealInFileExplorer,
    copyPath: fileActions.copyPath,
    copyRelativePath: fileActions.copyRelativePath
  };
  void vscode.commands.executeCommand('setContext', 'blogExplorerFilterActive', false);
  context.subscriptions.push(
    outputChannel, treeView, gitView,
    ...Object.entries(commands).map(([name, handler]) =>
      vscode.commands.registerCommand(`blogExplorer.${name}`, handler)),
    vscode.window.onDidChangeActiveTextEditor(preview.onActiveEditorChanged)
  );

  await provider.initialize(context);
  await server.reattachHugoTerminal();
  context.subscriptions.push(vscode.window.registerWebviewPanelSerializer('blogExplorer.preview', preview.previewSerializer));
  gitProvider.initialize(context);
  const configWatcher = vscode.workspace.createFileSystemWatcher('**/*.{toml,yaml,yml,json,md}');
  configWatcher.onDidCreate(invalidatePreview);
  configWatcher.onDidChange(invalidatePreview);
  configWatcher.onDidDelete(invalidatePreview);
  context.subscriptions.push(configWatcher, vscode.workspace.onDidSaveTextDocument((document) => {
    invalidatePreview();
    if (document === vscode.window.activeTextEditor?.document) {
      void preview.onActiveEditorChanged(vscode.window.activeTextEditor);
    }
  }));
}

function deactivate() {
  // Keep the Hugo terminal alive across extension host reloads.
}

module.exports = { activate, deactivate };
