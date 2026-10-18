const Module = require('node:module');

// Only replace the editor's host API. Application modules are imported normally;
// no source rewriting or access to private variables is needed.
const vscode = {
  TreeItem: class { constructor(label, collapsibleState) { Object.assign(this, { label, collapsibleState }); } },
  ThemeIcon: class {}, ThemeColor: class {},
  MarkdownString: class { constructor(value) { this.value = value; } },
  EventEmitter: class {
    constructor() { this.listeners = new Set(); }
    event = callback => { this.listeners.add(callback); return { dispose: () => this.listeners.delete(callback) }; };
    fire(value) { for (const callback of this.listeners) callback(value); }
    dispose() { this.listeners.clear(); }
  },
  RelativePattern: class {},
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  FileType: { File: 1, Directory: 2 },
  ViewColumn: { Active: 1, Beside: 2 },
  ProgressLocation: { Notification: 15 }, StatusBarAlignment: { Left: 1 }
};

function loadEditorModule(name) {
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    return request === 'vscode' ? vscode : originalLoad.call(this, request, parent, isMain);
  };
  try { return require(name); } finally { Module._load = originalLoad; }
}

module.exports = { vscode, loadEditorModule };
