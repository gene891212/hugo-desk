const vscode = require('vscode');
const path = require('node:path');
const { runHugo } = require('./hugo');
const { pathExists, isSubPath, getSetting } = require('./workspace');
const { AssetGroupItem } = require('./tree-items');

const DND_MIME_TYPE = 'application/vnd.code.tree.blogExplorer.content';

// Each activation owns its clipboard and tree selection. File mutations use the
// editor filesystem API, preserving overwrite protection and Trash behavior.
function createFileActions({ provider, getSelection, invalidatePreview }) {
  let clipboard;
  function resolveDirectoryFor(item) {
    if (!item) return provider.contentRoot;
    if (item instanceof AssetGroupItem) {
      const child = item.children[0];
      return child ? vscode.Uri.file(path.dirname(child.uri.fsPath)) : provider.contentRoot;
    }
    if (!item.uri) return provider.contentRoot;
    return item.type === vscode.FileType.Directory ? item.uri : vscode.Uri.file(path.dirname(item.uri.fsPath));
  }

  // New File/New Post Folder/Rename/Copy/Cut/Delete/Paste are all reachable
  // two ways: a context-menu click, which hands the clicked element straight
  // to the command, and either a toolbar button or a keybinding, neither of
  // which passes an argument at all -- so those fall back to whatever's
  // selected in the tree.
  function resolveSingleSelection(item) {
    if (item && item.uri) return item;
    return getSelection()[0];
  }

  function resolveTargetDirectory(item) {
    return resolveDirectoryFor(resolveSingleSelection(item));
  }

  async function uniqueDestination(dir, name) {
    let candidate = vscode.Uri.joinPath(dir, name);
    if (!(await pathExists(candidate))) return candidate;

    const ext = path.extname(name);
    const base = ext ? name.slice(0, -ext.length) : name;
    let attempt = 2;
    candidate = vscode.Uri.joinPath(dir, `${base} copy${ext}`);
    while (await pathExists(candidate)) {
      candidate = vscode.Uri.joinPath(dir, `${base} copy ${attempt}${ext}`);
      attempt += 1;
    }
    return candidate;
  }

  class BlogDragAndDropController {
    constructor() {
      this.dragMimeTypes = [DND_MIME_TYPE];
      this.dropMimeTypes = [DND_MIME_TYPE];
    }

    handleDrag(source, dataTransfer) {
      const uris = source.filter((item) => item && item.uri).map((item) => item.uri.toString());
      if (uris.length) dataTransfer.set(DND_MIME_TYPE, new vscode.DataTransferItem(uris));
    }

    async handleDrop(target, dataTransfer) {
      const transferItem = dataTransfer.get(DND_MIME_TYPE);
      if (!transferItem) return;

      const destinationDir = resolveDirectoryFor(target);

      for (const uriString of transferItem.value) {
        const sourceUri = vscode.Uri.parse(uriString);
        const destUri = vscode.Uri.joinPath(destinationDir, path.basename(sourceUri.fsPath));

        if (isSubPath(sourceUri.fsPath, destinationDir.fsPath)) {
          void vscode.window.showWarningMessage(`Can't move "${path.basename(sourceUri.fsPath)}" into itself.`);
          continue;
        }
        if (sourceUri.fsPath === destUri.fsPath) continue;

        try {
          await vscode.workspace.fs.rename(sourceUri, destUri, { overwrite: false });
        } catch (error) {
          void vscode.window.showErrorMessage(`Failed to move "${path.basename(sourceUri.fsPath)}": ${error.message || error}`);
        }
      }
    }
  }

  async function runHugoNew(projectRoot, relativeContentPath) {
    if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace before running Hugo.');
    await runHugo(['new', relativeContentPath], projectRoot.fsPath);
    invalidatePreview();
  }

  async function newFile(item) {
    const projectRoot = provider && provider.projectRoot;
    if (!projectRoot || !provider.contentRoot) {
      void vscode.window.showWarningMessage('No Hugo project was found in this workspace.');
      return;
    }

    const targetDir = resolveTargetDirectory(item);
    const name = await vscode.window.showInputBox({
      prompt: `New file in content/${path.relative(provider.contentRoot.fsPath, targetDir.fsPath).replace(/\\/g, '/') || '.'}/`,
      placeHolder: 'notes.md',
      validateInput: (value) => (value && value.trim() ? undefined : 'Enter a file name.')
    });
    if (!name) return;

    const fileUri = vscode.Uri.joinPath(targetDir, name.trim());
    if (await pathExists(fileUri)) {
      void vscode.window.showErrorMessage(`${name.trim()} already exists.`);
      return;
    }

    // Markdown gets the same archetype scaffolding as New Post Folder --
    // title/date/draft from archetypes/default.md (or a more specific one
    // Hugo picks for this path) instead of a blank file. Non-.md files have
    // no archetype to apply, so they're always created empty.
    const useTemplate = getSetting('newFileTemplate', true) && name.trim().toLowerCase().endsWith('.md');
    if (useTemplate) {
      const relativeDir = path.relative(provider.contentRoot.fsPath, targetDir.fsPath).replace(/\\/g, '/');
      const relativeTarget = path.posix.join(relativeDir, name.trim());
      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Running hugo new ${relativeTarget}`,
            cancellable: false
          },
          () => runHugoNew(projectRoot, relativeTarget)
        );
      } catch (error) {
        void vscode.window.showErrorMessage(`Hugo Desk: ${error.message || error}`);
        return;
      }
    } else {
      await vscode.workspace.fs.writeFile(fileUri, new Uint8Array());
    }

    const doc = await vscode.workspace.openTextDocument(fileUri);
    await vscode.window.showTextDocument(doc);
  }

  async function newFolder(item) {
    const projectRoot = provider && provider.projectRoot;
    const contentRoot = provider && provider.contentRoot;
    if (!projectRoot || !contentRoot) {
      void vscode.window.showWarningMessage('No Hugo project was found in this workspace.');
      return;
    }

    const targetDir = resolveTargetDirectory(item);
    const relativeDir = path.relative(contentRoot.fsPath, targetDir.fsPath).replace(/\\/g, '/');

    const name = await vscode.window.showInputBox({
      prompt: `New post folder in content/${relativeDir || '.'}/ (runs "hugo new <name>/index.md")`,
      placeHolder: 'my-new-post',
      validateInput: (value) => (value && /^[^\\/]+$/.test(value.trim()) ? undefined : 'Enter a folder name (no slashes).')
    });
    if (!name) return;

    const relativeTarget = path.posix.join(relativeDir, name.trim(), 'index.md');

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Running hugo new ${relativeTarget}`,
          cancellable: false
        },
        () => runHugoNew(projectRoot, relativeTarget)
      );
    } catch (error) {
      void vscode.window.showErrorMessage(`Hugo Desk: ${error.message || error}`);
      return;
    }

    const newFileUri = vscode.Uri.joinPath(contentRoot, relativeTarget);
    const doc = await vscode.workspace.openTextDocument(newFileUri);
    await vscode.window.showTextDocument(doc);
  }

  async function renameItem(item) {
    item = resolveSingleSelection(item);
    if (!item || !item.uri) return;

    const oldPath = item.uri.fsPath;
    const oldName = path.basename(oldPath);
    const newName = await vscode.window.showInputBox({
      prompt: `New name for "${oldName}"`,
      value: oldName,
      validateInput: (value) => {
        const trimmed = value.trim();
        if (!trimmed) return 'Enter a name.';
        if (/[\\/]/.test(trimmed)) return 'Name cannot contain slashes.';
        return undefined;
      }
    });
    if (!newName || newName.trim() === oldName) return;

    const newUri = vscode.Uri.file(path.join(path.dirname(oldPath), newName.trim()));
    if (await pathExists(newUri)) {
      void vscode.window.showErrorMessage(`${newName.trim()} already exists.`);
      return;
    }

    try {
      await vscode.workspace.fs.rename(item.uri, newUri, { overwrite: false });
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to rename "${oldName}": ${error.message || error}`);
    }
  }

  async function deleteItem(item) {
    item = resolveSingleSelection(item);
    if (!item || !item.uri) return;

    const isDir = item.type === vscode.FileType.Directory;
    const name = path.basename(item.uri.fsPath);
    const choice = await vscode.window.showWarningMessage(
      `Delete ${isDir ? 'folder' : 'file'} "${name}"?${isDir ? ' This deletes everything inside it.' : ''}`,
      { modal: true },
      'Delete'
    );
    if (choice !== 'Delete') return;

    try {
      await vscode.workspace.fs.delete(item.uri, { recursive: isDir, useTrash: true });
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to delete "${name}": ${error.message || error}`);
      return;
    }
    if (clipboard && clipboard.uri.toString() === item.uri.toString()) {
      clipboard = undefined;
    }
  }

  // Copy/Cut stash a single item's URI; Paste is the only side-effecting step,
  // so a bare Ctrl+C never touches disk. Cut is a real move (rename), same as
  // drag-and-drop already does; Copy duplicates via vscode.workspace.fs.copy,
  // which recurses into directories on its own. Paste is always in the
  // context menu regardless of clipboard state (there's no reliable "disabled
  // but visible" state for a contributed menu item) and just no-ops if
  // there's nothing to paste.
  function copyItem(item) {
    item = resolveSingleSelection(item);
    if (!item || !item.uri) return;
    clipboard = { uri: item.uri, mode: 'copy' };
  }

  function cutItem(item) {
    item = resolveSingleSelection(item);
    if (!item || !item.uri) return;
    clipboard = { uri: item.uri, mode: 'cut' };
  }

  async function pasteItem(item) {
    if (!clipboard) return;

    const sourceUri = clipboard.uri;
    const name = path.basename(sourceUri.fsPath);
    let destinationDir = resolveDirectoryFor(resolveSingleSelection(item));

    // Right-clicking (or just leaving selected) the very folder that's on the
    // clipboard resolves to "inside this folder" -- the same rule New
    // File/drag-and-drop use. For Paste that reads as "duplicate it here,
    // next to itself", matching VS Code's own Explorer, so retarget to the
    // parent instead of treating it as pasting the folder into itself.
    if (destinationDir.fsPath === sourceUri.fsPath) {
      destinationDir = vscode.Uri.file(path.dirname(sourceUri.fsPath));
    }

    if (isSubPath(sourceUri.fsPath, destinationDir.fsPath)) {
      void vscode.window.showWarningMessage(`Can't paste "${name}" into itself.`);
      return;
    }

    try {
      if (clipboard.mode === 'cut') {
        const destUri = vscode.Uri.joinPath(destinationDir, name);
        if (sourceUri.fsPath !== destUri.fsPath) {
          await vscode.workspace.fs.rename(sourceUri, destUri, { overwrite: false });
        }
        clipboard = undefined;
      } else {
        const destUri = await uniqueDestination(destinationDir, name);
        await vscode.workspace.fs.copy(sourceUri, destUri, { overwrite: false });
      }
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to paste "${name}": ${error.message || error}`);
    }
  }

  async function revealInFileExplorer(item) {
    item = resolveSingleSelection(item);
    if (!item || !item.uri) return;
    await vscode.commands.executeCommand('revealFileInOS', item.uri);
  }

  async function copyPath(item) {
    item = resolveSingleSelection(item);
    if (!item || !item.uri) return;
    await vscode.env.clipboard.writeText(item.uri.fsPath);
  }

  async function copyRelativePath(item) {
    item = resolveSingleSelection(item);
    if (!item || !item.uri) return;
    await vscode.env.clipboard.writeText(vscode.workspace.asRelativePath(item.uri, false));
  }

  return {
    dragAndDropController: new BlogDragAndDropController(),
    newFile, newFolder, renameItem, deleteItem, copyItem, cutItem, pasteItem,
    revealInFileExplorer, copyPath, copyRelativePath
  };
}

module.exports = { createFileActions };
