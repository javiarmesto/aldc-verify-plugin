#!/usr/bin/env node
'use strict';
// Stop / SubagentStop gate: compile the repo's AL projects when they changed in this turn.
// Errors -> exit 2 with the diagnostics on stderr, so Claude keeps fixing.
// After maxAttempts blocked stops in a row it lets Claude stop and tells the user why.

const path = require('path');
const env = require('./lib/al-env');

const MAX_LISTED = 40;
const HISTORY = 20;

function readStdin() {
  try { return JSON.parse(require('fs').readFileSync(0, 'utf8') || '{}'); } catch { return {}; }
}

const debug = (m) => { if (process.env.ALDC_VERIFY_DEBUG) process.stderr.write(`[aldc-verify] ${m}
`); };

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
  if (!projects.length) { debug('sin proyectos'); return 0; }

  const cfg = env.loadConfig(root);
  const state = env.readState(root);
  // Main session and each code-writing subagent keep their own attempt counter.
  const sub = input.hook_event_name === 'SubagentStop' ? String(input.agent_id || input.agent_type || 'subagent') : null;
  const subagents = { ...(state.subagents || {}) };
  const slot = sub ? { ...(subagents[sub] || {}) } : { attempts: state.attempts, releasedFp: state.releasedFp, lastBlockFp: state.lastBlockFp, lastListed: state.lastListed };
  if (sub ? input.stop_hook_active === false : !input.stop_hook_active) slot.attempts = 0;
  const who0 = sub ? `el subagente ${input.agent_type || sub}` : 'Claude';

  const fp = env.fingerprint(root, projects, { bcMajor: env.targetBcMajor(cfg, projects), compiler: cfg.compiler });
  if (state.lastGreen === fp) { debug('huella ya verde'); return 0; }
  // Unchanged since the turn started: whatever state the tree is in, Claude didn't cause it.
  if (state.turnBaseline && state.turnBaseline === fp) { debug('sin cambios AL en el turno'); return 0; }
  const max = Number(cfg.maxAttempts) || 3;
  // Already released (summary shown) on this exact tree: don't pay another compile to say the same thing.
  if ((slot.attempts || 0) >= max && slot.releasedFp === fp) { debug('ya liberado en este árbol'); return 0; }

  // Blocked before and nothing changed since: Claude chose not to (or can't) fix it.
  // Recompiling would only repeat the same errors, so release now with the saved list.
  if ((slot.attempts || 0) > 0 && slot.lastBlockFp === fp) {
    const fresh = env.readState(root);
    const next = { ...fresh, lastRun: new Date().toISOString(), history: env.appendHistory(fresh, { status: 'released', reason: 'sin cambios tras el bloqueo', attempt: slot.attempts, ...(sub ? { agent: input.agent_type || sub } : {}) }, HISTORY) };
    const released = { ...slot, attempts: max, releasedFp: fp };
    if (sub) next.subagents = { ...(fresh.subagents || {}), [sub]: released }; else Object.assign(next, { attempts: max, releasedFp: fp });
    env.writeState(root, next);
    say(`aldc-verify: ${who0} no ha cambiado nada tras el bloqueo; dejo parar. Sigue sin compilar:
${slot.lastListed || '(ver .claude/.aldc-verify/last-report.json)'}`);
    return 0;
  }

  const result = env.verifyAll(root, { analyzers: false });
  debug(`verifyAll: ${result.status}`);
  const who = result.compiler && !result.compiler.error
    ? `alc ${result.compiler.version}${result.compiler.pinned ? '' : ' (sin fijar en .claude/aldc-verify.json)'}`
    : 'alc';
  const now = new Date().toISOString();
  const save = (slotPatch, patch, event) => {
    // Re-read right before writing: another gate may have saved while we compiled.
    const fresh = env.readState(root);
    const next = { ...fresh, ...patch, lastRun: now, history: env.appendHistory(fresh, { ...event, ...(sub ? { agent: input.agent_type || sub } : {}) }, HISTORY) };
    if (sub) {
      Object.assign(subagents, fresh.subagents || {});
      subagents[sub] = { ...slot, ...slotPatch };
      // Keep only the most recent subagent slots.
      next.subagents = Object.fromEntries(Object.entries(subagents).slice(-10));
    } else {
      Object.assign(next, slotPatch);
    }
    env.writeState(root, next);
  };

  if (result.status === 'not-run') {
    save({}, {}, { status: 'not-run', reason: result.reason });
    say(`aldc-verify: not-run. No he compilado: ${result.reason}.`);
    return 0;
  }
  if (result.status === 'green') {
    const afterBlocks = slot.attempts || 0;
    save({ attempts: 0, releasedFp: null, lastBlockFp: null, lastListed: null }, { lastGreen: fp, ...(sub ? {} : { attempts: 0, releasedFp: null }) }, { status: 'green', afterBlocks });
    if (afterBlocks > 0) {
      // Green after this gate blocked: tell the model once, so its final answer reflects the
      // real result. The next stop sees lastGreen === fp and exits immediately.
      process.stdout.write(JSON.stringify({
        decision: 'block',
        reason: `aldc-verify: ahora compila en verde (BC ${result.bcMajor}, ${who}). ${summary(result)}. ` +
          'No hace falta volver a compilar. Termina tu respuesta citando este resultado.',
        systemMessage: `aldc-verify: compila tras ${afterBlocks} ${afterBlocks === 1 ? 'bloqueo' : 'bloqueos'}. ${summary(result)}.`,
      }));
      return 0;
    }
    say(`aldc-verify: compila (BC ${result.bcMajor}, ${who}). ${summary(result)}.`);
    return 0;
  }
  if (result.status === 'partial' || result.status === 'tool-failure') {
    // Not Claude's code to fix (missing symbols, compiler crash): report, don't loop.
    save({ attempts: 0 }, {}, { status: result.status });
    say(`aldc-verify: verificación incompleta (${result.status}).
${formatErrors(root, result.results)}`);
    return 0;
  }

  const attempts = (slot.attempts || 0) + 1;
  const listed = formatErrors(root, result.results);
  const errorCodes = [...new Set(result.results.flatMap((r) => (r.errors || []).map((e) => e.code)))];
  if (attempts > max) {
    save({ attempts: max, releasedFp: fp }, {}, { status: 'released', attempt: attempts, errorCodes });
    say(`aldc-verify: ${who0} sigue sin compilar tras ${max} intentos; dejo parar. Errores pendientes:
${listed}`);
    return 0;
  }
  save({ attempts, lastBlockFp: fp, lastListed: listed.slice(0, 4000) }, {}, { status: 'blocked', attempt: attempts, errorCodes });
  process.stderr.write(
    `aldc-verify: la compilación AL falla (BC ${result.bcMajor}, ${who}; intento ${attempts}/${max}). ` +
    `Corrige estos errores antes de terminar y no des el trabajo por bueno hasta que compile:
${listed}
` +
    `Cuando lo corrijas, termina sin más: este gate vuelve a compilar al parar y te dirá el resultado.
`
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
