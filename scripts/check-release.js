const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const missing = [];
if (!manifest.publisher || manifest.publisher === 'local') missing.push('A registered publisher ID');
if (!manifest.repository?.url) missing.push('Public repository URL');
if (!manifest.bugs?.url) missing.push('Issue tracker URL (bugs.url)');
if (!manifest.homepage) missing.push('Homepage URL');
if (!manifest.author || (typeof manifest.author === 'object' && !manifest.author.name)) missing.push('Author name');
const license = fs.readFileSync(path.join(root, 'LICENSE.txt'), 'utf8');
if (/Copyright \(c\) \d{4}[ \t]*\r?$/m.test(license)) missing.push('Copyright holder in LICENSE.txt');
for (const filename of [manifest.icon, 'media/demo.gif', 'media/assets.gif', 'media/screenshot.png', 'CHANGELOG.md', 'README.md']) {
  if (!filename || !fs.existsSync(path.join(root, filename))) missing.push(`Release asset: ${filename || 'icon'}`);
}
if (missing.length) {
  console.error('Release preparation is incomplete:\n' + missing.map(item => `- ${item}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log('Release metadata and assets are present. Nothing was published.');
}
