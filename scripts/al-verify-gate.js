#!/usr/bin/env node
'use strict';
// Stop gate: compile the repo's AL projects when they changed since the last green build.
// Errors -> exit 2 with the diagnostics on stderr, so Claude keeps fixing.
// After maxAttempts blocked stops in a row it lets Claude stop and tells the user why.

const path = require('path');
const env = require('./lib/al-env');

const MAX_LISTED = 40;
const HISTORY = 20;

function readStdin() {
  try { return JSON.parse(require('fs').readFileSync(0, 'utf8') || '{}'); } catch { return {}; }
}

function say(message) {
  process.stdout.write(JSON.stringify({ systemMessage: message }));
}

function formatErrors(root, results) {
  const lines = [];
  for (const r of results) {
    if (r.skipped) { lines.push(`- ${r.project.rel}: not-run (${r.skipped})`); continue; }
    for (const e of r.errors || []) {
      // alc prints paths relative to its cwd (the repo root) or absolute.
      const file = (e.file ? path.relative(root, path.resolve(root, e.file)) : r.project.rel).split(path.sep).join('/');
      lines.push(`${file}(${e.line},${e.col}): error ${e.code}: ${e.message}`);
    }
    if (r.exitCode !== 0 && !(r.errors || []).length) lines.push(`- ${r.project.rel}: alc terminó con código ${r.exitCode} sin diagnósticos. Salida:\n${r.tail}`);
  }
  const total = lines.length;
  return total > MAX_LISTED ? [...lines.slice(0, MAX_LISTED), `… y ${total - MAX_LISTED} más`].join('\n') : lines.join('\n');
}

function summary(result) {
  return result.results
    .filter((r) => !r.skipped)
    .map((r) => `${r.project.manifest.name}: ${r.errors.length} errores, ${r.warnings.length} warnings (${r.seconds.toFixed(1)} s)`)
    .join('; ');
}

function main() {
  const input = readStdin();
  const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const projects = env.findProjects(root);
  if (!projects.length) return 0;

  const cfg = env.loadConfig(root);
  const state = env.readState(root);
  if (!input.stop_hook_active) state.attempts = 0;

  const fp = env.fingerprint(root, projects, { bcMajor: env.targetBcMajor(cfg, projects), compiler: cfg.compiler });
  if (state.lastGreen === fp) return 0;
  // Unchanged since the turn started: whatever state the tree is in, Claude didn't cause it.
  if (state.turnBaseline && state.turnBaseline === fp) return 0;
  const max = Number(cfg.maxAttempts) || 3;
  // Already released (summary shown) on this exact tree: don't pay another compile to say the same thing.
  if ((state.attempts || 0) >= max && state.releasedFp === fp) return 0;

  const result = env.verifyAll(root, { analyzers: false });
  const who = result.compiler && !result.compiler.error
    ? `alc ${result.compiler.version}${result.compiler.pinned ? '' : ' (sin fijar en .claude/aldc-verify.json)'}`
    : 'alc';
  const now = new Date().toISOString();
  const save = (patch, event) => env.writeState(root, {
    ...state, ...patch, lastRun: now,
    history: [...(state.history || []), { at: now, ...event }].slice(-HISTORY),
  });

  if (result.status === 'not-run') {
    save({}, { status: 'not-run', reason: result.reason });
    say(`aldc-verify: not-run. No he compilado: ${result.reason}.`);
    return 0;
  }
  if (result.status === 'green') {
    save({ lastGreen: fp, attempts: 0, releasedFp: null }, { status: 'green', afterBlocks: state.attempts || 0 });
    say(`aldc-verify: compila (BC ${result.bcMajor}, ${who}). ${summary(result)}.`);
    return 0;
  }
  if (result.status === 'partial' || result.status === 'tool-failure') {
    // Not Claude's code to fix (missing symbols, compiler crash): report, don't loop.
    save({ attempts: 0 }, { status: result.status });
    say(`aldc-verify: verificación incompleta (${result.status}).\n${formatErrors(root, result.results)}`);
    return 0;
  }

  const attempts = (state.attempts || 0) + 1;
  const listed = formatErrors(root, result.results);
  const errorCodes = [...new Set(result.results.flatMap((r) => (r.errors || []).map((e) => e.code)))];
  if (attempts > max) {
    save({ attempts: max, releasedFp: fp }, { status: 'released', attempt: attempts, errorCodes });
    say(`aldc-verify: sigue sin compilar tras ${max} intentos; dejo parar. Errores pendientes:\n${listed}`);
    return 0;
  }
  save({ attempts }, { status: 'blocked', attempt: attempts, errorCodes });
  process.stderr.write(
    `aldc-verify: la compilación AL falla (BC ${result.bcMajor}, ${who}; intento ${attempts}/${max}). ` +
    `Corrige estos errores antes de terminar y no des el trabajo por bueno hasta que compile:\n${listed}\n` +
    `Cuando creas que está corregido, ejecuta /aldc-verify:al-verify --l1 y cita su resultado en tu respuesta final: ` +
    `si compila en verde, este gate no te volverá a parar.\n`
  );
  return 2;
}

try {
  process.exitCode = main();
} catch (err) {
  // A broken gate must never trap the session.
  say(`aldc-verify: error interno del gate, no he verificado nada (${err && err.message}).`);
  process.exitCode = 0;
}
