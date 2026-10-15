#!/usr/bin/env node
'use strict';
// SubagentStart overlay for ALDC agents: injects how to verify with aldc-verify into each
// ALDC subagent, without touching the aldc plugin. Silent outside AL repos and for other agents.

const fs = require('fs');
const env = require('./lib/al-env');

const WRITERS = /implement|developer|agent-builder/i;
const REVIEWERS = /review|dredd|triage/i;
const PLANNERS = /planning|architect|spec|presales/i;
const CONDUCTOR = /conductor/i;

function contextFor(agentType) {
  const common = 'aldc-verify está activo en este repo: el compilador AL real está disponible y el Stop/SubagentStop hook compila lo que cambies.';
  if (REVIEWERS.test(agentType)) {
    return [
      common,
      '- Evidencia de build: si existe .claude/.aldc-verify/last-report.json, léelo y cita errores y warnings reales (código, fichero y línea) junto a BCQuality. Si no existe o es anterior a los cambios, di "build: not-run" y pide que se ejecute aldc-verify:al-build-validator.',
      '- No ejecutes nada: tu revisión sigue siendo de solo lectura.',
    ].join('\n');
  }
  if (WRITERS.test(agentType)) {
    return [
      common,
      '- "Verify Build Compiles" / "0 compilation errors": ejecútalo con /aldc-verify:al-verify --l1 (o delega en el agente aldc-verify:al-build-validator) y cita su línea de resultado. Nunca lo declares sin ese resultado.',
      '- TDD RED: "el test compila y describe el comportamiento" (compílalo con /aldc-verify:al-verify --l1). Ejecutar tests necesita BC v28+: si no hay sandbox, dilo como not-run.',
      '- Si las herramientas mcp__al__al_compile / al_build no están disponibles, usa aldc-verify en su lugar.',
      '- Analizadores (L2): /aldc-verify:al-verify sin --l1. Arregla solo los warnings de líneas que hayas cambiado.',
    ].join('\n');
  }
  if (CONDUCTOR.test(agentType)) {
    return `${common}
- Tras cada fase de implementación, lanza el agente aldc-verify:al-build-validator y pega su resultado en el phase-complete. Pásale .claude/.aldc-verify/last-report.json al revisor.
- Para entregar, usa /aldc-verify:al-go: verifica, revisa, hace commit, push y abre la PR en borrador sin esperar a nadie.`;
  }
  if (PLANNERS.test(agentType)) {
    return `${common}\n- En los planes, el criterio de "compila" se comprueba con /aldc-verify:al-verify; inclúyelo como paso de verificación de cada fase.`;
  }
  return null;
}

function main() {
  let input = {};
  try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { return 0; }
  const agentType = String(input.agent_type || '');
  if (!/^aldc:/i.test(agentType)) return 0;
  const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  if (!env.findProjects(root).length) return 0;
  const ctx = contextFor(agentType);
  if (!ctx) return 0;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: ctx } }));
  return 0;
}

module.exports = { contextFor };
if (require.main === module) {
  try { process.exitCode = main(); } catch { process.exitCode = 0; }
}
