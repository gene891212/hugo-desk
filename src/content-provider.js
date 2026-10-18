const vscode = require('vscode');
const path = require('node:path');
const { parseFrontMatterText, getPublicationStatus } = require('./front-matter');
const { findHugoProjectRoot, pathExists } = require('./workspace');
const { AssetGroupItem, MessageItem, escapeMarkdown, inlineCode } = require('./tree-items');

const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif', '.bmp', '.ico',
  '.tiff', '.tif', '.heic'
]);
const ASSET_GROUP_THRESHOLD = 2;
const RECENTLY_MODIFIED_DAYS = 30;

class BlogContentProvider {
  constructor({ invalidatePreview = () => {}, onFilterChanged = () => {}, outputChannel, now = Date.now } = {}) {
    this.invalidatePreview = invalidatePreview;
    this.onFilterChanged = onFilterChanged;
    this.outputChannel = outputChannel;
    this.now = now;
    this.changeEmitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.changeEmitter.event;
    this.projectRoot = undefined;
    this.contentRoot = undefined;
    this.activeFilter = undefined;
    this.metadataCache = new Map();
  }

  async initialize(context) {
    this.projectRoot = await findHugoProjectRoot();
    if (!this.projectRoot) {
      this.refresh();
      return;
    }

    this.contentRoot = vscode.Uri.joinPath(this.projectRoot, 'content');
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(this.contentRoot.fsPath, '**/*')
    );
    watcher.onDidCreate((uri) => this.invalidate(uri));
    watcher.onDidChange((uri) => this.invalidate(uri));
    watcher.onDidDelete((uri) => this.invalidate(uri));
    context.subscriptions.push(watcher, this.changeEmitter);
    this.refresh();
  }

  invalidate(uri) {
    this.invalidatePreview();
    this.metadataCache.delete(uri.fsPath);
    this.refresh();
  }

  refresh(clearMetadata = false) {
    if (clearMetadata) this.metadataCache.clear();
    this.changeEmitter.fire(undefined);
  }

  async showFilterPicker() {
    if (!this.contentRoot) return;

    const selection = await vscode.window.showQuickPick([
      { label: '$(search) Search articles…', action: 'search', description: 'Title, file name, or path' },
      { label: '$(list-tree) All articles', action: 'all', description: 'Clear the current filter' },
      { label: '$(edit) Drafts', action: 'status', value: 'draft' },
      { label: '$(clock) Scheduled', action: 'status', value: 'scheduled' },
      { label: '$(pass-filled) Published', action: 'status', value: 'published' },
      { label: '$(history) Recently modified', action: 'recent', description: `Last ${RECENTLY_MODIFIED_DAYS} days` },
      { label: '$(folder) By section…', action: 'section' }
    ], {
      placeHolder: 'Search or filter Hugo articles'
    });
    if (!selection) return;

    if (selection.action === 'all') {
      this.clearFilter();
      return;
    }
    if (selection.action === 'search') {
      const query = await vscode.window.showInputBox({
        prompt: 'Search article titles, file names, and paths',
        placeHolder: 'Search articles'
      });
      if (!query?.trim()) return;
      this.setFilter({ kind: 'search', value: query.trim().toLowerCase(), label: `Search: ${query.trim()}` });
      return;
    }
    if (selection.action === 'section') {
      const sections = await this.getSections();
      const section = await vscode.window.showQuickPick(
        sections.map((value) => ({
          label: value === '' ? '$(root-folder) Content root' : `$(folder) ${value}`,
          value
        })),
        { placeHolder: 'Select a content section' }
      );
      if (!section) return;
      this.setFilter({
        kind: 'section',
        value: section.value,
        label: section.value ? `Section: ${section.value}` : 'Section: root'
      });
      return;
    }

    const labels = { draft: 'Drafts', scheduled: 'Scheduled', published: 'Published' };
    this.setFilter(selection.action === 'recent'
      ? { kind: 'recent', label: `Recent ${RECENTLY_MODIFIED_DAYS}d` }
      : { kind: 'status', value: selection.value, label: labels[selection.value] });
  }

  setFilter(filter) {
    this.activeFilter = filter;
    void vscode.commands.executeCommand('setContext', 'blogExplorerFilterActive', true);
    this.onFilterChanged(this.activeFilter);
    this.refresh();
  }

  clearFilter() {
    this.activeFilter = undefined;
    void vscode.commands.executeCommand('setContext', 'blogExplorerFilterActive', false);
    this.onFilterChanged(this.activeFilter);
    this.refresh();
  }

  async getSections() {
    const articles = await this.scanArticles();
    return [...new Set(articles.map((entry) => entry.metadata.section))]
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }

  getTreeItem(element) {
    if (element instanceof MessageItem || element instanceof AssetGroupItem) {
      return element;
    }
    const item = new vscode.TreeItem(
      path.basename(element.uri.fsPath),
      element.type === vscode.FileType.Directory
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    );
    item.id = element.uri.toString();
    // Supplying resourceUri lets VS Code's SCM decorations paint this writing
    // tree green/red. Git state has its own compact view below, so keep Content
    // quiet: neutral icons here, and colour spent only on publication status.
    item.iconPath = new vscode.ThemeIcon(
      element.type === vscode.FileType.Directory ? 'folder' : 'file'
    );
    item.contextValue = element.type === vscode.FileType.Directory
      ? 'blogFolder'
      : 'blogFile';
    if (element.type !== vscode.FileType.Directory) {
      item.command = {
        command: 'vscode.open',
        title: 'Open',
        arguments: [element.uri]
      };
    }

    if (element.metadata) {
      const status = element.metadata.status;
      // Nearly every article is published, so repeating that on every row is
      // noise the eye has to skip -- the coloured icon already says it. And a
      // bundle's index.md needn't repeat the word its own folder row is already
      // showing. Spelling out only the exceptions is what makes a draft stand
      // out; the icon still carries the status on every row.
      const statusLabel = status.key === 'published' || element.isBundleIndex
        ? undefined
        : status.label;
      item.description = element.filtered
        ? [statusLabel, element.metadata.relativePath].filter(Boolean).join(' · ')
        : statusLabel;
      if (element.type !== vscode.FileType.Directory) {
        item.iconPath = new vscode.ThemeIcon(status.icon, new vscode.ThemeColor(status.color));
      }
      item.tooltip = new vscode.MarkdownString([
        `**${escapeMarkdown(element.metadata.title)}**`,
        '',
        `Status: ${status.label}`,
        ...(element.metadata.parseError ? ['', escapeMarkdown(element.metadata.parseError)] : []),
        '',
        `Path: ${inlineCode(element.metadata.relativePath)}`
      ].join('\n'));
      if (element.filtered) item.label = element.metadata.title;
    }
    return item;
  }

  async getChildren(element) {
    if (!this.contentRoot) {
      return [new MessageItem('No Hugo project with a content folder was found.')];
    }

    if (element instanceof AssetGroupItem) {
      return element.children;
    }

    if (!element && this.activeFilter) {
      return this.getFilteredArticles();
    }

    const directory = element ? element.uri : this.contentRoot;
    try {
      const entries = await vscode.workspace.fs.readDirectory(directory);
      const nameCollator = (a, b) =>
        path.basename(a.uri.fsPath).localeCompare(path.basename(b.uri.fsPath), undefined, { numeric: true });

      const directories = [];
      const markdownFiles = [];
      const otherFiles = [];

      for (const [name, type] of entries) {
        if (name.startsWith('.')) continue;
        const entry = { uri: vscode.Uri.joinPath(directory, name), type };
        if (type === vscode.FileType.Directory) {
          directories.push(entry);
        } else if (name.toLowerCase().endsWith('.md')) {
          markdownFiles.push(entry);
        } else {
          otherFiles.push(entry);
        }
      }

      await Promise.all([
        ...markdownFiles.map(async (entry) => {
          entry.metadata = await this.getArticleMetadata(entry.uri);
        }),
        ...directories.map(async (entry) => {
          const bundleIndex = vscode.Uri.joinPath(entry.uri, 'index.md');
          if (await pathExists(bundleIndex)) {
            entry.metadata = await this.getArticleMetadata(bundleIndex);
          }
        })
      ]);

      directories.sort(nameCollator);
      markdownFiles.sort(nameCollator);
      otherFiles.sort(nameCollator);

      // A directory holding `index.md` is a single Hugo leaf bundle: everything
      // else next to it -- loose files or sub-folders alike -- belongs to that
      // one page, so it's safe to group all of it away. A directory holding only
      // `_index.md` (or no markdown) is a section listing instead, where
      // sub-folders are usually other pages, not assets -- those stay visible.
      const isLeafBundle = markdownFiles.some(
        (entry) => path.basename(entry.uri.fsPath).toLowerCase() === 'index.md'
      );

      let children;
      let groupable;
      if (isLeafBundle) {
        // The folder row already spells out this bundle's status so it stays
        // readable while collapsed; mark index.md so it shows the icon alone
        // rather than saying the same word again one line below.
        for (const entry of markdownFiles) {
          entry.isBundleIndex =
            path.basename(entry.uri.fsPath).toLowerCase() === 'index.md';
        }
        children = [...markdownFiles];
        groupable = [...directories, ...otherFiles];
      } else {
        children = [...directories, ...markdownFiles];
        groupable = [...otherFiles];
      }

      if (markdownFiles.length > 0 && groupable.length >= ASSET_GROUP_THRESHOLD) {
        const allImages = groupable.every(
          (entry) => entry.type !== vscode.FileType.Directory
            && IMAGE_EXTENSIONS.has(path.extname(entry.uri.fsPath).toLowerCase())
        );
        children.push(new AssetGroupItem(allImages ? 'Images' : 'Assets', groupable));
      } else {
        children.push(...groupable);
      }

      return children;
    } catch (error) {
      return [new MessageItem(`Cannot read content: ${error.message || error}`)];
    }
  }

  async scanArticles(directory = this.contentRoot) {
    const articles = [];
    let entries;
    try {
      entries = await vscode.workspace.fs.readDirectory(directory);
    } catch {
      return articles;
    }

    for (const [name, type] of entries) {
      if (name.startsWith('.')) continue;
      const uri = vscode.Uri.joinPath(directory, name);
      if (type === vscode.FileType.Directory) {
        articles.push(...await this.scanArticles(uri));
      } else if (name.toLowerCase().endsWith('.md')) {
        articles.push({ uri, type, metadata: await this.getArticleMetadata(uri), filtered: true });
      }
    }
    return articles;
  }

  async getFilteredArticles() {
    const filter = this.activeFilter;
    if (!filter) return [];
    const articles = await this.scanArticles();
    const recentCutoff = this.now() - RECENTLY_MODIFIED_DAYS * 24 * 60 * 60 * 1000;
    const matches = articles.filter((entry) => {
      const metadata = entry.metadata;
      if (filter.kind === 'status') return metadata.status.key === filter.value;
      if (filter.kind === 'recent') return metadata.modifiedTime >= recentCutoff;
      if (filter.kind === 'section') return metadata.section === filter.value;
      if (filter.kind === 'search') {
        return `${metadata.title}\n${metadata.relativePath}`.toLowerCase().includes(filter.value);
      }
      return true;
    });

    matches.sort((a, b) => filter.kind === 'recent'
      ? b.metadata.modifiedTime - a.metadata.modifiedTime
      : a.metadata.title.localeCompare(b.metadata.title, undefined, { numeric: true }));
    if (!matches.length) return [new MessageItem(`No articles match “${filter.label}”.`)];
    return matches;
  }

  async getArticleMetadata(uri) {
    let stat;
    try {
      stat = await vscode.workspace.fs.stat(uri);
    } catch {
      stat = { mtime: 0, size: 0 };
    }
    const cached = this.metadataCache.get(uri.fsPath);
    if (cached && cached.mtime === stat.mtime && cached.size === stat.size) {
      if (cached.fields) cached.metadata.status = getPublicationStatus(cached.fields, this.now());
      return cached.metadata;
    }

    let fields;
    let parseError;
    try {
      fields = await readFrontMatter(uri);
    } catch (error) {
      parseError = error.message;
      fields = {};
      this.outputChannel?.appendLine(`${uri.fsPath}: ${parseError}`);
    }
    const relativePath = path.relative(this.contentRoot.fsPath, uri.fsPath).replace(/\\/g, '/');
    const firstSegment = relativePath.split('/')[0];
    const metadata = {
      title: String(fields.title || articleFallbackTitle(uri)),
      status: parseError
        ? { key: 'unknown', label: 'Invalid front matter', icon: 'warning', color: 'charts.yellow' }
        : getPublicationStatus(fields, this.now()),
      parseError,
      section: relativePath.includes('/') ? firstSegment : '',
      relativePath,
      modifiedTime: stat.mtime || 0
    };
    this.metadataCache.set(uri.fsPath, { mtime: stat.mtime, size: stat.size, metadata, fields: parseError ? undefined : fields });
    return metadata;
  }
}

async function readFrontMatter(fileUri) {
  const bytes = await vscode.workspace.fs.readFile(fileUri);
  return parseFrontMatterText(Buffer.from(bytes).toString('utf8'));
}

function articleFallbackTitle(uri) {
  const filename = path.basename(uri.fsPath, path.extname(uri.fsPath));
  return filename.toLowerCase() === 'index' || filename.toLowerCase() === '_index'
    ? path.basename(path.dirname(uri.fsPath))
    : filename;
}

module.exports = { BlogContentProvider };
