#!/usr/bin/env node
'use strict';
// On-demand verification: L1 (compile) + L2 (code analyzers), short grouped summary.
// Usage: node al-verify.js [--l1] [--project <name|folder>] [--json] [--root <dir>]
// Exit: 0 no errors, 1 errors, 3 not-run.

const fs = require('fs');
const path = require('path');
const env = require('./lib/al-env');
const msg = require('./lib/messages');
const { t } = msg;

const MAX_ERRORS = 30;
const MAX_WARNINGS = 15;

function parseArgs(argv) {
  const a = { l1: false, project: null, json: false, root: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--l1') a.l1 = true;
    else if (argv[i] === '--json') a.json = true;
    else if (argv[i] === '--project') a.project = argv[++i];
    else if (argv[i] === '--root') a.root = argv[++i];
  }
  return a;
}

function rel(root, file) {
  return path.relative(root, path.resolve(root, file)).split(path.sep).join('/');
}

function countBy(list, key) {
  const m = new Map();
  for (const x of list) m.set(x[key], (m.get(x[key]) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(args.root || process.env.CLAUDE_PROJECT_DIR || process.cwd());
  msg.init(root);
  const result = env.verifyAll(root, { analyzers: !args.l1, only: args.project });
  const level = args.l1 ? 'L1' : 'L1+L2';

  if (result.status === 'no-projects') { console.log(t('verifyNoProjects', level, root)); return 3; }
  if (result.status === 'not-run') { console.log(t('verifyNotRun', level, result.reason)); return 3; }

  const c = result.compiler;
  const report = {
    level, root, bcMajor: result.bcMajor, status: result.status,
    compiler: { version: c.version, source: c.source, pinned: !!c.pinned, path: c.cmd },
    projects: result.results.map((r) => ({
      project: r.project.rel, name: r.project.manifest.name, skipped: r.skipped || null, symbolsFrom: r.symbolsFrom || null,
      seconds: r.seconds, exitCode: r.exitCode,
      analyzers: r.l2 ? { names: r.l2.names, requested: r.l2.requested, missing: r.l2.missing, source: r.l2.source, ruleset: r.l2.ruleset } : null,
      errors: (r.errors || []).map((d) => ({ ...d, file: d.file && rel(root, d.file) })),
      warnings: (r.warnings || []).map((d) => ({ ...d, file: d.file && rel(root, d.file) })),
    })),
  };
  const dir = env.ensureStateDir(root);
  fs.writeFileSync(path.join(dir, 'last-report.json'), JSON.stringify(report, null, 2));

  // A full green compile also satisfies the Stop gate, so it won't recompile the same tree.
  if (result.status === 'green' && !args.project) {
    const cfg = env.loadConfig(root);
    const projects = env.findProjects(root);
    const state = env.readState(root);
    env.writeState(root, { ...state, attempts: 0, releasedFp: null, history: env.appendHistory(state, { status: 'green', via: 'al-verify', afterBlocks: state.attempts || 0 }), lastGreen: env.fingerprint(root, projects, { bcMajor: env.targetBcMajor(cfg, projects), compiler: cfg.compiler }), lastRun: new Date().toISOString() });
  }

  if (args.json) { console.log(JSON.stringify(report, null, 2)); return report.projects.some((p) => p.errors.length) ? 1 : 0; }

  const out = [];
  out.push(t('verifyHeader', level, result.bcMajor, c.version, c.pinned ? '' : t('unpinned')));
  const allErrors = [];
  const allWarnings = [];
  let l2Incomplete = false;
  for (const p of report.projects) {
    if (p.skipped) { out.push(`- ${p.name} (${p.project}): not-run, ${p.skipped}`); continue; }
    const compilerWarn = p.warnings.filter((w) => /^AL/i.test(w.code));
    const analyzerWarn = p.warnings.filter((w) => !/^AL/i.test(w.code));
    const mark = p.errors.length ? '✘' : '✔';
    const l2 = p.analyzers
      ? t('analyzersPart', analyzerWarn.length, p.analyzers.names.join(', '), p.analyzers.source, p.analyzers.ruleset ? rel(root, p.analyzers.ruleset) : null)
      : '';
    out.push(t('projectLine', mark, p.name, p.project, p.errors.length, compilerWarn.length, l2, p.seconds.toFixed(1)));
    if (p.analyzers && p.analyzers.missing) {
      out.push(t('l2Incomplete', p.analyzers.missing, p.analyzers.requested.length, p.analyzers.requested.join(', ')));
      l2Incomplete = true;
    }
    if (p.symbolsFrom && p.symbolsFrom !== '.alpackages') out.push(t('symbolsFrom', p.symbolsFrom));
    if (p.warnings.length) out.push(`    ${countBy(p.warnings, 'code').slice(0, 10).map(([k, n]) => `${k}×${n}`).join(', ')}`);
    if (p.exitCode !== 0 && !p.errors.length) out.push(t('alcNoDiagShort'));
    allErrors.push(...p.errors);
    allWarnings.push(...p.warnings);
  }
  if (allErrors.length) {
    out.push('', t('errorsHeader', allErrors.length));
    for (const e of allErrors.slice(0, MAX_ERRORS)) out.push(`  ${e.file}(${e.line},${e.col}): ${e.code}: ${e.message}`);
    if (allErrors.length > MAX_ERRORS) out.push(`  ${t('andMore', allErrors.length - MAX_ERRORS)}`);
  }
  if (allWarnings.length) {
    const perProject = report.projects.filter((p) => p.warnings && p.warnings.length).map((p) => `${p.project} ${p.warnings.length}`).join(' · ');
    out.push('', t('warningsHeader', Math.min(MAX_WARNINGS, allWarnings.length), allWarnings.length, perProject));
    for (const w of allWarnings.slice(0, MAX_WARNINGS)) out.push(`  ${w.file}(${w.line},${w.col}): ${w.code}: ${w.message.length > 120 ? w.message.slice(0, 117) + '…' : w.message}`);
  }
  if (l2Incomplete) out.push('', t('partialState'));
  out.push('', t('fullDetail', rel(root, path.join(dir, 'last-report.json'))));
  console.log(out.join('\n'));
  return allErrors.length ? 1 : 0;
}

try {
  process.exitCode = main();
} catch (err) {
  console.log(t('verifyInternal', err && err.message));
  process.exitCode = 3;
}
