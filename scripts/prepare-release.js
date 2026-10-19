const fs = require('node:fs');
const path = require('node:path');

function releaseMetadata(manifest, changelog, tag) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(manifest.version)) {
    throw new Error('The package version must have the form major.minor.patch.');
  }
  if (tag !== `v${manifest.version}`) {
    throw new Error(`Release tag ${tag || '(missing)'} must match v${manifest.version}.`);
  }
  if (!manifest.name || !/^[a-z0-9][a-z0-9-]*$/.test(manifest.name)) {
    throw new Error('The package name must be a lowercase extension name.');
  }
  if (!manifest.publisher || manifest.publisher === 'local') {
    throw new Error('The release needs a registered publisher.');
  }
  if (typeof manifest.displayName !== 'string' || !manifest.displayName.trim() || /[\r\n]/.test(manifest.displayName)) {
    throw new Error('The display name must be a nonempty single line.');
  }
  const lines = changelog.split(/\r?\n/);
  const prefix = `## ${manifest.version} — `;
  const start = lines.findIndex(line => line.startsWith(prefix));
  const date = start < 0 ? '' : lines[start].slice(prefix.length);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
    throw new Error(`CHANGELOG.md needs a dated section: ${prefix}YYYY-MM-DD.`);
  }
  let end = start + 1;
  while (end < lines.length && !lines[end].startsWith('## ')) end++;
  const notes = lines.slice(start + 1, end).join('\n').trim();
  if (!notes) throw new Error(`CHANGELOG.md has no release notes for ${manifest.version}.`);
  return {
    tag,
    title: `${manifest.displayName} ${tag}${manifest.preview ? ' (Preview)' : ''}`,
    prerelease: manifest.preview === true,
    assetName: `${manifest.name}-${manifest.version}.vsix`,
    notes: `${notes}\n`,
  };
}

function main() {
  const root = path.resolve(__dirname, '..');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  const tag = process.env.RELEASE_TAG || (process.env.RELEASE_DRY_RUN === 'true' ? `v${manifest.version}` : '');
  const metadata = releaseMetadata(manifest, changelog, tag);
  if (process.argv.includes('--check')) {
    console.log(`Release tag and changelog are valid: ${metadata.tag}`);
    return;
  }
  const packageIndex = process.argv.indexOf('--package-dir');
  const packageDir = packageIndex < 0 ? root : process.argv[packageIndex + 1];
  if (!packageDir) throw new Error('--package-dir requires a directory.');
  const asset = path.resolve(packageDir, metadata.assetName);
  if (!fs.statSync(asset).isFile()) throw new Error(`Missing VSIX: ${asset}`);
  const outputDir = path.join(root, 'output', 'release');
  fs.mkdirSync(outputDir, { recursive: true });
  const notes = path.join(outputDir, 'notes.md');
  fs.writeFileSync(notes, metadata.notes);
  if (process.env.GITHUB_OUTPUT) {
    const outputs = { tag: metadata.tag, title: metadata.title, prerelease: metadata.prerelease, asset, notes };
    fs.appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(outputs).map(([key, value]) => `${key}=${value}\n`).join(''));
  }
  console.log(`Prepared ${metadata.title}: ${asset}`);
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { releaseMetadata };
