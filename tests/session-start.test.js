'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeAlRepo, hookEnv, runScript, tempDir } = require('./helpers');

// A fake home: optionally with an ALDC plugin registered in installed_plugins.json.
function fakeHome(plugins) {
  const home = tempDir('aldc-verify-home-');
  if (plugins) {
    const dir = path.join(home, '.claude', 'plugins');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'installed_plugins.json'), JSON.stringify({ version: 2, plugins }, null, 2));
  }
  return home;
}

// The compiler is any existing file: SessionStart only checks it is there, it never runs it.
function sessionStart(repo, home, extra = {}) {
  const r = runScript('ensure-al-toolchain.js', {
    env: hookEnv({ CLAUDE_PROJECT_DIR: repo, HOME: home, USERPROFILE: home, ALDC_VERIFY_ALC: process.execPath, ...extra }),
  });
  assert.equal(r.code, 0, r.stderr);
  return JSON.parse(r.stdout);
}

const ALDC = /With ALDC \(al-conductor\)/;

test('SessionStart does not mention ALDC when it is not installed', () => {
  const out = sessionStart(makeAlRepo(), fakeHome());
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(ctx, /^aldc-verify: AL compiler ready/);
  assert.match(ctx, /Compile with \/aldc-verify:al-verify/);
  assert.doesNotMatch(ctx, ALDC);
  assert.doesNotMatch(ctx, /ALDC/);
});

test('SessionStart ignores other plugins with similar names', () => {
  const home = fakeHome({ 'aldc-verify@aldc-verify-dev': [{}], 'bcquality@bcquality': [{}], 'myaldc@x': [{}] });
  assert.doesNotMatch(sessionStart(makeAlRepo(), home).hookSpecificOutput.additionalContext, ALDC);
});

test('SessionStart mentions the ALDC flow when an aldc@ plugin is installed', () => {
  const home = fakeHome({ 'aldc@aldc-marketplace': [{ version: '5.1.1' }] });
  assert.match(sessionStart(makeAlRepo(), home).hookSpecificOutput.additionalContext, ALDC);
});

test('SessionStart honours CLAUDE_CONFIG_DIR for the plugin registry', () => {
  const config = path.join(fakeHome({ 'aldc@aldc-marketplace': [{}] }), '.claude');
  assert.match(sessionStart(makeAlRepo(), fakeHome(), { CLAUDE_CONFIG_DIR: config }).hookSpecificOutput.additionalContext, ALDC);
});

test('SessionStart mentions the ALDC flow when the project has aldc.yaml', () => {
  const repo = makeAlRepo();
  fs.writeFileSync(path.join(repo, 'aldc.yaml'), 'version: 1\n');
  assert.match(sessionStart(repo, fakeHome()).hookSpecificOutput.additionalContext, ALDC);
});

test('SessionStart speaks Spanish with "language": "es"', () => {
  const home = fakeHome({ 'aldc@aldc-marketplace': [{}] });
  const ctx = sessionStart(makeAlRepo({ config: { language: 'es' } }), home).hookSpecificOutput.additionalContext;
  assert.match(ctx, /^aldc-verify: compilador AL listo/);
  assert.match(ctx, /Con ALDC \(al-conductor\)/);
});

// On Linux a missing compiler triggers the dotnet install, which a unit test must not do.
test('SessionStart reports not-run without a compiler (Windows/macOS)', { skip: process.platform === 'linux' && 'Linux installs the compiler instead' }, () => {
  const repo = makeAlRepo({ config: { compiler: { path: path.join(tempDir(), 'no-alc') } } });
  const r = runScript('ensure-al-toolchain.js', { env: hookEnv({ CLAUDE_PROJECT_DIR: repo, HOME: fakeHome(), USERPROFILE: fakeHome() }) });
  assert.equal(r.code, 0);
  const out = JSON.parse(r.stdout);
  assert.match(out.hookSpecificOutput.additionalContext, /^aldc-verify: not-run, compiler\.path does not exist/);
  assert.match(out.systemMessage, /no AL compiler/);
});

test('SessionStart stays silent outside AL repos', () => {
  const plain = runScript('ensure-al-toolchain.js', { env: hookEnv({ CLAUDE_PROJECT_DIR: tempDir() }) });
  assert.equal(plain.code, 0);
  assert.equal(plain.stdout, '');
});
