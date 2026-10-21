#!/usr/bin/env node
'use strict';
// Apply the aldc-verify layer to an AL repo without overwriting anything.
// Usage: node init.js [--dry-run] [--root <dir>] [--bc <major>] [--al-extension <ver>] [--al-tool <ver>] [--no-ci] [--no-claude-md]
// Prints one line per file: created | merged | appended | skipped (reason) | would-*.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const env = require('./lib/al-env');
const msg = require('./lib/messages');
const { t } = msg;

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const PLUGIN_REF = 'v' + require(path.join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json')).version;
const GITIGNORE_LINE = '.claude/.aldc-verify/';

function parseArgs(argv) {
  const a = { dryRun: false, root: null, bc: null, alExtension: null, alTool: null, ci: true, claudeMd: true };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--dry-run') a.dryRun = true;
    else if (k === '--root') a.root = argv[++i];
    else if (k === '--bc') a.bc = Number(argv[++i]);
    else if (k === '--al-extension') a.alExtension = argv[++i];
    else if (k === '--al-tool') a.alTool = argv[++i];
    else if (k === '--no-ci') a.ci = false;
    else if (k === '--no-claude-md') a.claudeMd = false;
  }
  return a;
}

function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : '';
}

function fill(text, vars) {
  return text.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));
}

// Add missing keys only; never change a value the repo already has.
function mergeMissing(target, source) {
  const added = [];
  for (const [k, v] of Object.entries(source)) {
    if (!(k in target)) { target[k] = v; added.push(k); continue; }
    if (Array.isArray(v) && Array.isArray(target[k])) {
      for (const item of v) if (!target[k].includes(item)) { target[k].push(item); added.push(`${k}[${item}]`); }
    } else if (v && typeof v === 'object' && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) {
      added.push(...mergeMissing(target[k], v).map((x) => `${k}.${x}`));
    }
  }
  return added;
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  const root = path.resolve(a.root || process.env.CLAUDE_PROJECT_DIR || process.cwd());
  const lang = msg.init(root);
  const projects = env.findProjects(root);
  if (!projects.length) { console.log(t('initNoProjects', root)); return 3; }

  const cfg = env.loadConfig(root);
  const bcMajor = a.bc || env.targetBcMajor(cfg, projects);
  const compiler = env.findCompiler({ compiler: {} });
  const alExtension = a.alExtension || (compiler.source === 'vscode' ? compiler.version.split('.').slice(0, 2).join('.') : null);
  const alTool = a.alTool || env.DEFAULT_AL_TOOL;
  // What the repo will actually use: an existing pin wins over what is detected on this machine.
  const effective = {
    bcMajor: cfg.bcMajor || bcMajor,
    alExtension: (cfg.compiler && cfg.compiler.alExtension) || alExtension,
    alTool: (cfg.compiler && cfg.compiler.alTool) || alTool,
    source: fs.existsSync(path.join(root, '.claude', 'aldc-verify.json')) ? t('initPinnedSource') : t('initDetectedSource'),
  };
  // Repo name from the origin remote (a worktree folder name is not the repo name).
  const remote = git(root, ['remote', 'get-url', 'origin']);
  const repoName = (remote && remote.replace(/\.git$/, '').split(/[\/:]/).pop()) || path.basename(root);
  // Ask the remote (a local origin/HEAD can be stale); fall back to the local ref, then main.
  const lsRemote = spawnSync('git', ['ls-remote', '--symref', 'origin', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 8000 });
  const remoteHead = lsRemote.status === 0 && /ref: refs\/heads\/(\S+)\s+HEAD/.exec(lsRemote.stdout || '');
  const defaultBranch = remoteHead ? remoteHead[1] : (git(root, ['rev-parse', '--abbrev-ref', 'origin/HEAD']) || 'origin/main').replace(/^origin\//, '');
  const planDirs = ['.github/plans', '.claude/plans', 'docs/plans'].filter((p) => fs.existsSync(path.join(root, p)));
  const plansRoot = planDirs.length ? planDirs.join('` y `') : '.github/plans';
  const hasSymbols = projects.some((p) => { try { return fs.readdirSync(path.join(p.dir, '.alpackages')).some((f) => f.endsWith('.app')); } catch { return false; } });
  const vars = {
    REPO_NAME: repoName, BC_MAJOR: String(effective.bcMajor), PROJECTS: projects.map((p) => `\`${p.rel}\` (${p.manifest.name})`).join(', '),
    PLANS_ROOT: plansRoot, DEFAULT_BRANCH: defaultBranch, AL_TOOL: effective.alTool, PLUGIN_REF,
  };

  const out = [];
  const write = (rel, content, verb) => {
    const file = path.join(root, rel);
    if (!a.dryRun) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); }
    const shown = rel.split(path.sep).join('/');
    out.push(`${a.dryRun ? 'would-' + verb.replace(/d$/, '') : verb}: ${shown}`);
  };

  // 1. Per-repo pin.
  const pinRel = '.claude/aldc-verify.json';
  if (fs.existsSync(path.join(root, pinRel))) out.push(`skipped: ${pinRel} (${t('initExists')})`);
  else {
    const pin = { bcMajor, compiler: { ...(alExtension ? { alExtension } : {}), alTool }, maxAttempts: 3 };
    write(pinRel, JSON.stringify(pin, null, 2) + '\n', 'created');
  }

  // 2. settings.json: create, or add only what is missing.
  const setRel = '.claude/settings.json';
  const template = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'templates', 'settings.json'), 'utf8'));
  const setFile = path.join(root, setRel);
  if (!fs.existsSync(setFile)) write(setRel, JSON.stringify(template, null, 2) + '\n', 'created');
  else {
    let current;
    try { current = JSON.parse(fs.readFileSync(setFile, 'utf8').replace(/^﻿/, '')); } catch { current = null; }
    if (!current) out.push(`skipped: ${setRel} (${t('initInvalidJson')})`);
    else {
      const added = mergeMissing(current, template);
      if (added.length) { write(setRel, JSON.stringify(current, null, 2) + '\n', 'merged'); out[out.length - 1] += ` (+ ${added.join(', ')})`; }
      else out.push(`skipped: ${setRel} (${t('initHasAll')})`);
    }
  }

  // 3. CLAUDE.md only if missing, in the message language (templates/CLAUDE.md or CLAUDE.es.md).
  const claudeTemplate = path.join(PLUGIN_ROOT, 'templates', lang === 'es' ? 'CLAUDE.es.md' : 'CLAUDE.md');
  if (!a.claudeMd) out.push('skipped: CLAUDE.md (--no-claude-md)');
  else if (fs.existsSync(path.join(root, 'CLAUDE.md'))) out.push(`skipped: CLAUDE.md (${t('initClaudeMdExists')})`);
  else write('CLAUDE.md', fill(fs.readFileSync(claudeTemplate, 'utf8'), vars), 'created');

  // 4. .gitignore entry.
  const giFile = path.join(root, '.gitignore');
  const gi = fs.existsSync(giFile) ? fs.readFileSync(giFile, 'utf8') : '';
  if (gi.split(/\r?\n/).some((l) => l.trim() === GITIGNORE_LINE || l.trim() === '/' + GITIGNORE_LINE)) out.push(`skipped: .gitignore (${t('initGitignoreHas')})`);
  else {
    const add = `${gi && !gi.endsWith('\n') ? '\n' : ''}\n# aldc-verify (Claude Code plugin): local compile state, symbol cache and build output\n${GITIGNORE_LINE}\n`;
    if (!a.dryRun) fs.appendFileSync(giFile, add);
    out.push(`${a.dryRun ? 'would-append' : 'appended'}: .gitignore`);
  }

  // 5. CI workflow, only when symbols are versioned (CI can't download them yet).
  const ciRel = '.github/workflows/al-compile.yml';
  if (!a.ci) out.push(`skipped: ${ciRel} (--no-ci)`);
  else if (fs.existsSync(path.join(root, ciRel))) out.push(`skipped: ${ciRel} (${t('initExists')})`);
  else if (!hasSymbols) out.push(`skipped: ${ciRel} (${t('initNoSymbolsCi')})`);
  else write(ciRel, fill(fs.readFileSync(path.join(PLUGIN_ROOT, 'templates', 'github', 'al-compile.yml'), 'utf8'), vars), 'created');

  console.log(t('initHeader', a.dryRun, root));
  console.log(t('initSummary', repoName, effective.bcMajor, projects.map((p) => p.rel).join(', '), effective.alExtension || '-', effective.alTool, effective.source, plansRoot, defaultBranch));
  for (const l of out) console.log(`- ${l}`);
  return 0;
}

try { process.exitCode = main(); } catch (err) { console.log(t('initInternal', err && err.message)); process.exitCode = 3; }
