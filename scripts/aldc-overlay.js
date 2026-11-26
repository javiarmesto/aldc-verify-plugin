#!/usr/bin/env node
'use strict';
// SubagentStart overlay for ALDC agents (optional integration): injects how to verify with
// aldc-verify into each ALDC subagent, without touching the aldc plugin. Silent outside AL repos
// and for other agents; without ALDC installed it never fires.

const fs = require('fs');
const env = require('./lib/al-env');
const msg = require('./lib/messages');
const { t } = msg;

const WRITERS = /implement|developer|agent-builder/i;
const REVIEWERS = /review|dredd|triage/i;
const PLANNERS = /planning|architect|spec|presales/i;
const CONDUCTOR = /conductor/i;

function contextFor(agentType) {
  const common = t('overlayCommon');
  const role = REVIEWERS.test(agentType) ? 'overlayReviewer'
    : WRITERS.test(agentType) ? 'overlayWriter'
      : CONDUCTOR.test(agentType) ? 'overlayConductor'
        : PLANNERS.test(agentType) ? 'overlayPlanner' : null;
  return role ? [common, ...t(role)].join('\n') : null;
}

function main() {
  let input = {};
  try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { return 0; }
  const agentType = String(input.agent_type || '');
  if (!/^aldc:/i.test(agentType)) return 0;
  const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  if (!env.findProjects(root).length) return 0;
  msg.init(root);
  const ctx = contextFor(agentType);
  if (!ctx) return 0;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: ctx } }));
  return 0;
}

module.exports = { contextFor };
if (require.main === module) {
  try { process.exitCode = main(); } catch { process.exitCode = 0; }
}
