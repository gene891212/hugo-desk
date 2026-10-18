const vscode = require('vscode');
const path = require('node:path');

function escapeMarkdown(value) {
  return String(value).replace(/[\\`*_{}\[\]<>]/g, '\\$&');
}

function inlineCode(value) {
  const text = String(value);
  const longestRun = Math.max(0, ...(text.match(/`+/g) || []).map((run) => run.length));
  const fence = '`'.repeat(longestRun + 1);
  return `${fence}${text}${fence}`;
}

class AssetGroupItem extends vscode.TreeItem {
  constructor(label, children) {
    super(`${label} (${children.length})`, vscode.TreeItemCollapsibleState.Collapsed);
    this.children = children;
    this.id = `assets:${path.dirname(children[0].uri.fsPath)}`;
    this.contextValue = 'blogAssetGroup';
    this.iconPath = new vscode.ThemeIcon(label === 'Images' ? 'file-media' : 'files');
  }
}

class MessageItem extends vscode.TreeItem {
  constructor(label) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('info');
    this.contextValue = 'blogMessage';
  }
}

module.exports = { AssetGroupItem, MessageItem, escapeMarkdown, inlineCode };
