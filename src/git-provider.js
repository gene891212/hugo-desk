const vscode = require('vscode');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { pathExists } = require('./workspace');
const { MessageItem, escapeMarkdown, inlineCode } = require('./tree-items');

function runGit(projectRoot, args) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: projectRoot.fsPath, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.trim() || error.message));
      } else {
        resolve(stdout || '');
      }
    });
  });
}

function gitStatusDetails(code) {
  const indexStatus = code[0] || ' ';
  const workTreeStatus = code[1] || ' ';
  if (code === '??') return { key: 'untracked', label: 'Untracked', icon: 'new-file' };

  const statusCode = workTreeStatus !== ' ' ? workTreeStatus : indexStatus;
  const states = {
    A: { key: 'added', label: 'Added', icon: 'diff-added' },
    C: { key: 'copied', label: 'Copied', icon: 'files' },
    D: { key: 'deleted', label: 'Deleted', icon: 'diff-removed' },
    M: { key: 'modified', label: 'Modified', icon: 'diff-modified' },
    R: { key: 'renamed', label: 'Renamed', icon: 'replace' },
    T: { key: 'changed', label: 'Type changed', icon: 'diff' },
    U: { key: 'conflict', label: 'Conflict', icon: 'warning' }
  };
  const details = states[statusCode] || { key: 'changed', label: 'Changed', icon: 'diff' };
  const hasIndexChange = indexStatus !== ' ' && indexStatus !== '?';
  const hasWorkTreeChange = workTreeStatus !== ' ' && workTreeStatus !== '?';
  if (hasIndexChange && hasWorkTreeChange) return { ...details, label: `${details.label}, partially staged` };
  if (hasIndexChange) return { ...details, label: `${details.label}, staged` };
  return details;
}

function parseGitStatus(output) {
  const records = output.split('\0');
  const changes = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record || record.length < 4) continue;
    const code = record.slice(0, 2);
    const filePath = record.slice(3);
    let originalPath;
    if (/[RC]/.test(code) && records[index + 1]) {
      originalPath = records[index + 1];
      index += 1;
    }
    changes.push({ code, path: filePath, originalPath, status: gitStatusDetails(code) });
  }
  return changes;
}

function parseGitLog(output) {
  return output.split('\x1e').map((record) => record.trim()).filter(Boolean).map((record) => {
    const [hash, shortHash, author, relativeDate, ...subjectParts] = record.split('\x1f');
    return { hash, shortHash, author, relativeDate, subject: subjectParts.join('\x1f') };
  });
}

async function groupGitChangesByPage(projectRoot, changes) {
  const knownBundleDirs = new Set();
  for (const change of changes) {
    const normalized = change.path.replace(/\\/g, '/');
    if (!normalized.startsWith('content/')) continue;
    const relative = normalized.slice('content/'.length);
    if (['index.md', '_index.md'].includes(path.posix.basename(relative).toLowerCase())) {
      knownBundleDirs.add(path.posix.dirname(relative));
    }
  }

  const bundleCache = new Map();
  const groups = new Map();
  for (const change of changes) {
    const identity = await gitPageIdentity(projectRoot, change.path, knownBundleDirs, bundleCache);
    let group = groups.get(identity.key);
    if (!group) {
      group = { ...identity, changes: [] };
      groups.set(identity.key, group);
    }
    group.changes.push(change);
  }
  return [...groups.values()].sort((a, b) => {
    if (a.kind === 'site') return 1;
    if (b.kind === 'site') return -1;
    return a.pagePath.localeCompare(b.pagePath, undefined, { numeric: true });
  });
}

async function gitPageIdentity(projectRoot, gitPath, knownBundleDirs, bundleCache) {
  const normalized = gitPath.replace(/\\/g, '/');
  if (!normalized.startsWith('content/')) {
    return { key: 'site', kind: 'site', label: 'Site files', pagePath: '' };
  }

  const relative = normalized.slice('content/'.length);
  const filename = path.posix.basename(relative);
  const lowerFilename = filename.toLowerCase();
  if (lowerFilename === 'index.md' || lowerFilename === '_index.md') {
    const bundleDir = path.posix.dirname(relative);
    return bundlePageIdentity(bundleDir, lowerFilename);
  }
  if (lowerFilename.endsWith('.md')) {
    const pagePath = relative.slice(0, -path.posix.extname(relative).length);
    return {
      key: `page:${pagePath}`,
      kind: 'page',
      label: path.posix.basename(pagePath),
      pagePath,
      openPath: normalized
    };
  }

  let candidate = path.posix.dirname(relative);
  while (candidate && candidate !== '.') {
    let isBundle = knownBundleDirs.has(candidate);
    if (!isBundle && bundleCache.has(candidate)) {
      isBundle = bundleCache.get(candidate);
    } else if (!isBundle) {
      const indexUri = vscode.Uri.joinPath(projectRoot, 'content', ...candidate.split('/'), 'index.md');
      isBundle = await pathExists(indexUri);
      bundleCache.set(candidate, isBundle);
    }
    if (isBundle) return bundlePageIdentity(candidate, 'index.md');
    const parent = path.posix.dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }

  const parent = path.posix.dirname(relative);
  const pagePath = parent === '.' ? relative : parent;
  return {
    key: `content:${pagePath}`,
    kind: 'page',
    label: path.posix.basename(pagePath),
    pagePath
  };
}

function bundlePageIdentity(bundleDir, indexName) {
  const isRoot = bundleDir === '.';
  return {
    key: `bundle:${bundleDir}`,
    kind: 'page',
    label: isRoot ? 'Content home' : path.posix.basename(bundleDir),
    pagePath: isRoot ? '' : bundleDir,
    openPath: isRoot ? `content/${indexName}` : `content/${bundleDir}/${indexName}`
  };
}

class SimpleGitProvider {
  constructor(getProjectRoot) {
    this.getProjectRoot = getProjectRoot;
    this.changeEmitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.changeEmitter.event;
    this.snapshotPromise = undefined;
    this.refreshTimer = undefined;
  }

  initialize(context) {
    const projectRoot = this.getProjectRoot();
    if (!projectRoot) {
      this.refresh();
      return;
    }
    const workspaceWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(projectRoot.fsPath, '**/*')
    );
    const repositoryWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(projectRoot.fsPath, '.git/{HEAD,index,refs/**}')
    );
    const schedule = () => this.scheduleRefresh();
    for (const watcher of [workspaceWatcher, repositoryWatcher]) {
      watcher.onDidCreate(schedule);
      watcher.onDidChange(schedule);
      watcher.onDidDelete(schedule);
    }
    context.subscriptions.push(
      workspaceWatcher,
      repositoryWatcher,
      this.changeEmitter,
      { dispose: () => clearTimeout(this.refreshTimer) }
    );
    // getChildren() can already have rendered "No Hugo project" once, before
    // provider.projectRoot (found asynchronously) was ready -- fire once
    // more now that it's known, instead of leaving that stale until a
    // watcher event or manual Refresh happens to come along.
    this.refresh();
  }

  scheduleRefresh() {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => this.refresh(), 250);
  }

  refresh() {
    this.snapshotPromise = undefined;
    this.changeEmitter.fire(undefined);
  }

  getTreeItem(element) {
    return element;
  }

  async getChildren(element) {
    if (element instanceof GitGroupItem) return element.children;
    if (element) return [];

    const projectRoot = this.getProjectRoot();
    if (!projectRoot) return [new MessageItem('No Hugo project was found.')];
    try {
      const snapshot = await this.getSnapshot(projectRoot);
      return [
        new GitGroupItem('Changes', snapshot.changes, vscode.TreeItemCollapsibleState.Expanded),
        new GitGroupItem('Recent Commits', snapshot.commits, vscode.TreeItemCollapsibleState.Collapsed)
      ];
    } catch (error) {
      return [new MessageItem(`Git information unavailable: ${error.message || error}`)];
    }
  }

  getSnapshot(projectRoot) {
    if (!this.snapshotPromise) this.snapshotPromise = this.loadSnapshot(projectRoot);
    return this.snapshotPromise;
  }

  async loadSnapshot(projectRoot) {
    const statusOutput = await runGit(projectRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
    let logOutput = '';
    try {
      logOutput = await runGit(projectRoot, [
        'log', '-n', '5', '--date=relative',
        '--pretty=format:%H%x1f%h%x1f%an%x1f%ar%x1f%s%x1e'
      ]);
    } catch {
      // A newly initialized repository can have changes but no commits yet.
    }
    const rawChanges = parseGitStatus(statusOutput);
    const changes = (await groupGitChangesByPage(projectRoot, rawChanges))
      .map((group) => new GitPageChangeItem(projectRoot, group));
    const commits = parseGitLog(logOutput).map((commit) => new GitCommitItem(commit));
    if (!changes.length) changes.push(new MessageItem('Working tree clean.'));
    if (!commits.length) commits.push(new MessageItem('No commits yet.'));
    return { changes, commits };
  }
}

class GitGroupItem extends vscode.TreeItem {
  constructor(label, children, collapsibleState) {
    const count = children.length === 1 && children[0] instanceof MessageItem ? 0 : children.length;
    super(`${label} (${count})`, collapsibleState);
    this.children = children;
    this.contextValue = 'blogGitGroup';
    this.iconPath = new vscode.ThemeIcon(label === 'Changes' ? 'git-compare' : 'history');
  }
}

class GitPageChangeItem extends vscode.TreeItem {
  constructor(projectRoot, group) {
    super(group.label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'blogGitPageChange';
    const statuses = [...new Set(group.changes.map((change) => change.status.label))];
    const summary = statuses.length === 1 ? statuses[0] : 'Mixed changes';
    const fileCount = `${group.changes.length} ${group.changes.length === 1 ? 'file' : 'files'}`;
    const parentPath = group.pagePath ? path.posix.dirname(group.pagePath) : undefined;
    this.description = [summary, fileCount, parentPath && parentPath !== '.' ? parentPath : undefined]
      .filter(Boolean).join(' · ');
    this.iconPath = new vscode.ThemeIcon(group.kind === 'site' ? 'settings-gear' : 'folder');
    this.tooltip = new vscode.MarkdownString([
      `**${escapeMarkdown(group.label)}**`,
      '',
      ...group.changes.map((change) => `- ${escapeMarkdown(change.status.label)}: ${inlineCode(change.path)}`)
    ].join('\n'));
    if (group.openPath) {
      const uri = vscode.Uri.joinPath(projectRoot, ...group.openPath.split('/'));
      const opensDeletedPage = group.changes.some(
        (change) => change.path === group.openPath && change.status.key === 'deleted'
      );
      if (!opensDeletedPage) {
        this.command = { command: 'vscode.open', title: 'Open Page', arguments: [uri] };
      }
    }
  }
}

class GitCommitItem extends vscode.TreeItem {
  constructor(commit) {
    super(commit.subject || commit.shortHash, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'blogGitCommit';
    this.description = `${commit.shortHash} · ${commit.relativeDate}`;
    this.iconPath = new vscode.ThemeIcon('git-commit');
    this.tooltip = new vscode.MarkdownString([
      `**${escapeMarkdown(commit.subject || commit.shortHash)}**`,
      '',
      `Commit: ${inlineCode(commit.hash)}`,
      '',
      `Author: ${escapeMarkdown(commit.author)}`,
      '',
      commit.relativeDate
    ].join('\n'));
  }
}

module.exports = { SimpleGitProvider, parseGitStatus, parseGitLog, groupGitChangesByPage };
