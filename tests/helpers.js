'use strict';
// Shared test helpers: temp AL projects and running hook scripts like Claude Code does.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const SCRIPTS = path.join(PLUGIN_ROOT, 'scripts');

function tempDir(prefix = 'aldc-verify-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// A minimal AL repo: one app project with one codeunit. No symbols, no compiler needed.
function makeAlRepo(opts = {}) {
  const root = tempDir();
  const app = path.join(root, 'App');
  fs.mkdirSync(path.join(app, 'src'), { recursive: true });
  fs.writeFileSync(path.join(app, 'app.json'), JSON.stringify({
    id: '11111111-2222-3333-4444-555555555555',
    name: 'Fixture App',
    publisher: 'Fixture',
    version: '1.0.0.0',
    application: `${opts.bcMajor || 27}.0.0.0`,
    dependencies: [],
  }, null, 2));
  fs.writeFileSync(path.join(app, 'src', 'Hello.Codeunit.al'), 'codeunit 50100 "Hello"\n{\n    procedure Hi(): Text\n    begin\n        exit(\'hi\');\n    end;\n}\n');
  if (opts.config) {
    fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'aldc-verify.json'), JSON.stringify(opts.config, null, 2));
  }
  return root;
}

// Environment for a spawned hook: isolated HOME, fixed language, no inherited Claude settings.
function hookEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of ['CLAUDE_PROJECT_DIR', 'CLAUDE_CONFIG_DIR', 'CLAUDE_ENV_FILE', 'ALDC_VERIFY_ALC', 'ALDC_VERIFY_DEBUG', 'ALDC_VERIFY_LANG']) delete env[k];
  env.ALDC_VERIFY_LANG = 'en';
  return { ...env, ...extra };
}

function runScript(name, { input, env, cwd } = {}) {
  const started = Date.now();
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, name)], {
    input: input === undefined ? '' : typeof input === 'string' ? input : JSON.stringify(input),
    env: env || hookEnv(),
    cwd: cwd || PLUGIN_ROOT,
    encoding: 'utf8',
    timeout: 60000,
  });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '', ms: Date.now() - started };
}

function gitAvailable() {
  return spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0;
}

module.exports = { PLUGIN_ROOT, SCRIPTS, tempDir, makeAlRepo, hookEnv, runScript, gitAvailable };
