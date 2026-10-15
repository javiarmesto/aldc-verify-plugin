#!/usr/bin/env node
'use strict';
// UserPromptSubmit: remember the AL fingerprint at the start of the turn, so the Stop gate
// only compiles and blocks when Claude changed AL code during this turn.
// Prints nothing: UserPromptSubmit stdout would be added to Claude's context.

const env = require('./lib/al-env');

try {
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const projects = env.findProjects(root);
  if (projects.length) {
    const cfg = env.loadConfig(root);
    const state = env.readState(root);
    state.turnBaseline = env.fingerprint(root, projects, { bcMajor: env.targetBcMajor(cfg, projects), compiler: cfg.compiler });
    env.writeState(root, state);
  }
} catch { /* never block a prompt */ }
process.exitCode = 0;
