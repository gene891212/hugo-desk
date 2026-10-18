const vscode = require('vscode');
const path = require('node:path');

const HUGO_CONFIG_FILES = [
  'hugo.toml',
  'hugo.yaml',
  'hugo.yml',
  'hugo.json',
  'config.toml',
  'config.yaml',
  'config.yml',
  'config.json'
];

async function pathExists(uri) {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

function isSubPath(basePath, maybePath) {
  const relative = path.relative(basePath, maybePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function findHugoProjectRoot() {
  const folders = vscode.workspace.workspaceFolders || [];
  for (const folder of folders) {
    for (const configName of HUGO_CONFIG_FILES) {
      const configUri = vscode.Uri.joinPath(folder.uri, configName);
      try {
        await vscode.workspace.fs.stat(configUri);
        const contentUri = vscode.Uri.joinPath(folder.uri, 'content');
        const contentStat = await vscode.workspace.fs.stat(contentUri);
        if (contentStat.type === vscode.FileType.Directory) return folder.uri;
      } catch {
        // Try the next supported Hugo configuration name.
      }
    }
  }
  return undefined;
}

function getSetting(key, fallback) {
  return vscode.workspace.getConfiguration('blogExplorer').get(key, fallback);
}

function isUnderContent(projectRoot, uri) {
  if (!uri || uri.scheme !== 'file') return false;
  const contentRoot = path.join(projectRoot.fsPath, 'content');
  const relative = path.relative(contentRoot, uri.fsPath);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

module.exports = { pathExists, isSubPath, findHugoProjectRoot, getSetting, isUnderContent };
