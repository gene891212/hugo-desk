const path = require('node:path');
const { execFile } = require('node:child_process');
const { parse } = require('csv-parse/sync');

function runHugo(args, projectRoot) {
  return new Promise((resolve, reject) => {
    execFile('hugo', args, {
      cwd: projectRoot, windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024
    }, (error, stdout, stderr) => {
      if (!error) return resolve(stdout);
      const reason = error.code === 'ENOENT'
        ? 'Hugo was not found. Install Hugo, add it to PATH, then restart your editor.'
        : error.killed
          ? 'Hugo took longer than 30 seconds. Check the project configuration and dependencies.'
          : stderr?.trim() || error.message;
      reject(new Error(reason));
    });
  });
}

function fileKey(filename) {
  const normalized = path.resolve(filename);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function localPath(permalink) {
  // Hugo also supports relative baseURL values such as '/' or '/blog/'.
  const url = new URL(permalink, 'http://localhost:1313/');
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Hugo returned an unsupported permalink.');
  // Preserve Hugo's encoding, subdirectory, language prefix and HTML suffix.
  // Only the origin is replaced by the local server when opening the preview.
  return url.pathname + url.search + url.hash;
}

function parsePageList(output, projectRoot) {
  const records = parse(output, { columns: true, bom: true, skip_empty_lines: true });
  const pages = new Map();
  for (const record of records) {
    if (!record.path || !record.permalink) continue;
    pages.set(fileKey(path.resolve(projectRoot, record.path)), localPath(record.permalink));
  }
  return pages;
}

class HugoPreviewResolver {
  constructor(run = runHugo) {
    this.run = run;
    this.snapshots = new Map();
  }

  invalidate() {
    this.snapshots.clear();
  }

  async snapshot(projectRoot) {
    const key = fileKey(projectRoot);
    if (!this.snapshots.has(key)) {
      const pending = Promise.all([
        this.run(['list', 'all', '--environment', 'development', '--renderToMemory', '--noBuildLock'], projectRoot),
        this.run(['config', '--environment', 'development', '--format', 'json'], projectRoot)
      ]).then(([csv, configText]) => {
        const config = JSON.parse(configText);
        return {
          pages: parsePageList(csv, projectRoot),
          home: localPath(config.baseurl || config.baseURL || 'http://localhost:1313/')
        };
      });
      this.snapshots.set(key, pending);
      pending.catch(() => {
        if (this.snapshots.get(key) === pending) this.snapshots.delete(key);
      });
    }
    return this.snapshots.get(key);
  }

  async resolve(projectRoot, filename) {
    const snapshot = await this.snapshot(projectRoot);
    if (!filename) return snapshot.home;
    const articlePath = snapshot.pages.get(fileKey(filename));
    if (!articlePath) {
      throw new Error(`Hugo did not report a page URL for "${path.basename(filename)}". Save the file and check its build settings, then refresh Content.`);
    }
    return articlePath;
  }
}

function externalServerChoices() {
  // Identical on Windows, macOS and Linux; never terminate an unrelated PID.
  return ['Use Another Port', 'Use Existing', 'Cancel'];
}

module.exports = { runHugo, parsePageList, localPath, HugoPreviewResolver, externalServerChoices };
