#!/usr/bin/env node
'use strict';
// SessionStart: make sure an AL compiler is available for this repo.
// - Warm path: compiler already resolvable (and at the pinned version) -> one context line, < 1 s.
// - Windows/macOS: detect only (VS Code AL extension or dotnet tool); never installs.
// - Linux (cloud): install dotnet8 with apt and the pinned `al` dotnet tool.
// The ALDC conductor flow is only mentioned when ALDC is installed (optional integration).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const env = require('./lib/al-env');
const msg = require('./lib/messages');
const { t } = msg;

const AL_TOOL_PACKAGE = 'Microsoft.Dynamics.BusinessCentral.Development.Tools';

function out(context, userMessage) {
  const o = { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } };
  if (userMessage) o.systemMessage = userMessage;
  process.stdout.write(JSON.stringify(o));
}

function sh(cmd, timeoutMs) {
  const r = spawnSync('bash', ['-lc', cmd], { encoding: 'utf8', timeout: timeoutMs, env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive', DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1' } });
  return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}`.trim() };
}

function installedToolVersions() {
  const store = path.join(os.homedir(), '.dotnet', 'tools', '.store', AL_TOOL_PACKAGE.toLowerCase());
  try { return fs.readdirSync(store).filter((d) => /^\d/.test(d)); } catch { return []; }
}

function persistPath() {
  const file = process.env.CLAUDE_ENV_FILE;
  if (!file) return;
  const line = 'export PATH="$PATH:$HOME/.dotnet/tools"';
  let current = '';
  try { current = fs.readFileSync(file, 'utf8'); } catch { /* new file */ }
  if (!current.includes(line)) fs.appendFileSync(file, `${line}\nexport DOTNET_CLI_TELEMETRY_OPTOUT=1\n`);
}

function installLinux(version) {
  const steps = [];
  const sudo = process.getuid && process.getuid() === 0 ? '' : 'sudo -n ';
  if (!sh('command -v dotnet', 5000).ok) {
    if (!sh('command -v apt-get', 5000).ok) return { ok: false, steps, error: t('tcNoDotnet') };
    const apt = sh(`${sudo}apt-get update -qq >/dev/null 2>&1; ${sudo}apt-get install -y -qq dotnet8 >/dev/null 2>&1 || ${sudo}apt-get install -y -qq dotnet-sdk-8.0 >/dev/null 2>&1`, 420000);
    steps.push('apt dotnet8');
    if (!apt.ok || !sh('command -v dotnet', 5000).ok) return { ok: false, steps, error: t('tcAptFailed', apt.out.slice(-200)) };
  }
  const have = installedToolVersions();
  if (have.length && !have.includes(version)) {
    sh(`dotnet tool uninstall --global ${AL_TOOL_PACKAGE}`, 60000);
    steps.push(t('tcUninstalled', have.join(',')));
  }
  if (!installedToolVersions().includes(version)) {
    const r = sh(`dotnet tool install --global ${AL_TOOL_PACKAGE} --version ${version}`, 300000);
    steps.push(`dotnet tool al ${version}`);
    if (!r.ok) return { ok: false, steps, error: t('tcToolFailed', r.out.slice(-300)) };
  }
  return { ok: true, steps };
}

// ALDC is optional: present when an aldc@<marketplace> plugin is installed for this user
// (~/.claude/plugins/installed_plugins.json, or under CLAUDE_CONFIG_DIR), or the project has aldc.yaml.
function aldcPresent(root) {
  if (fs.existsSync(path.join(root, 'aldc.yaml'))) return true;
  const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  try {
    const raw = fs.readFileSync(path.join(configDir, 'plugins', 'installed_plugins.json'), 'utf8').replace(/^﻿/, '');
    const data = JSON.parse(raw) || {};
    const plugins = data.plugins && typeof data.plugins === 'object' ? data.plugins : data;
    return Object.keys(plugins).some((k) => /^aldc@/i.test(k));
  } catch { return false; }
}

function main() {
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const projects = env.findProjects(root);
  if (!projects.length) return;
  msg.init(root);
  const cfg = env.loadConfig(root);
  const bcMajor = env.targetBcMajor(cfg, projects);
  const names = projects.map((p) => p.rel).join(', ');
  const tail = t('tcTail', bcMajor, names) + (aldcPresent(root) ? ` ${t('tcAldc')}` : '');

  if (process.platform === 'linux') {
    const version = cfg.compiler.alTool || env.DEFAULT_AL_TOOL;
    const from = cfg.compiler.alTool ? t('tcPinnedFrom') : t('tcDefaultFrom');
    const fresh = env.findCompiler(cfg);
    const warm = !fresh.error && fresh.source === 'dotnet-tool' && installedToolVersions().includes(version);
    const vscodeOk = !fresh.error && fresh.source !== 'dotnet-tool' && !cfg.compiler.alTool;
    if (warm || vscodeOk) { persistPath(); out(`${t('tcReady', `${fresh.source} ${warm ? version : fresh.version}${warm ? `, ${from}` : ''}`)} ${tail}`); return; }
    const started = Date.now();
    const r = installLinux(version);
    const secs = ((Date.now() - started) / 1000).toFixed(0);
    if (!r.ok) { out(t('tcNotRun', r.error), t('tcInstallFailedUser', r.error)); return; }
    persistPath();
    out(`${t('tcInstalled', version, from, secs)} ${tail}`, t('tcInstalledUser', version, secs, r.steps.join(', ')));
    return;
  }

  // Windows / macOS: detect, never install.
  const c = env.findCompiler(cfg);
  if (c.error) {
    out(t('tcNoCompilerContext', c.error), t('tcNoCompilerUser', c.error));
    return;
  }
  out(`${t('tcReady', `alc ${c.version}${c.pinned ? t('tcPinned') : t('tcUnpinned')}`)} ${tail}`);
}

module.exports = { aldcPresent };
if (require.main === module) {
  try { main(); } catch (err) { out(t('tcInternal', err && err.message)); }
  process.exitCode = 0;
}
