const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const { runTests } = require('@vscode/test-electron');

async function main() {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'hugo-desk-test-profile-'));
  // Keep the isolated profile and logs for diagnosing failures. Nothing uses
  // the user's installed extensions, workspace settings or editor profile.
  console.log(`Editor test profile: ${profile}`);
  await runTests({
    version: process.env.VSCODE_TEST_VERSION || '1.90.2',
    vscodeExecutablePath: process.env.VSCODE_EXECUTABLE_PATH || undefined,
    extensionDevelopmentPath: path.resolve(__dirname, '..'),
    extensionTestsPath: path.resolve(__dirname, '../test/editor/run.js'),
    launchArgs: [
      '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes',
      `--user-data-dir=${path.join(profile, 'user')}`, `--extensions-dir=${path.join(profile, 'extensions')}`
    ]
  });
}

main().catch(error => { console.error(error); process.exitCode = 1; });
