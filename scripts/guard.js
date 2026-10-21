#!/usr/bin/env node
'use strict';
// PreToolUse (Bash and PowerShell) guard: lets agents work without a human watching by refusing only what
// can't be undone or breaks the repo rules. Active in AL repos; `"guard": false` in
// .claude/aldc-verify.json turns it off, `guard.protectedPaths` adds folders git must never add.
// Denies: gh pr merge, force pushes, pushes to the default branch, git add -A / . / --all,
// git commit -a, git add of protected paths (data that must never be committed).

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const env = require('./lib/al-env');
const msg = require('./lib/messages');
const { t } = msg;

const DEFAULT_BRANCHES = new Set(['main', 'master', 'dev', 'develop']);

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `aldc-verify guard: ${reason}`,
    },
  }));
  return 0;
}

function currentBranch(cwd) {
  const r = spawnSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf8', timeout: 5000 });
  return r.status === 0 ? r.stdout.trim() : '';
}

// Split a shell line into simple commands (good enough for agent-written commands).
function segments(command) {
  return command.split(/&&|\|\||;|\||\r?\n/).map((s) => s.trim()).filter(Boolean);
}

function tokens(seg) {
  return (seg.match(/"[^"]*"|'[^']*'|\S+/g) || []).map((t) => t.replace(/^["']|["']$/g, ''));
}

// Drop `git -C dir` / `git -c k=v` style options before the subcommand.
function gitArgs(tok) {
  const i = tok.findIndex((t) => /(^|[\\/])git(\.exe)?$/i.test(t));
  if (i < 0) return null;
  const rest = tok.slice(i + 1);
  while (rest.length && /^-/.test(rest[0])) {
    const opt = rest.shift();
    if ((opt === '-C' || opt === '-c') && rest.length) rest.shift();
  }
  return rest;
}

function check(command, cwd, cfg) {
  const guardCfg = typeof cfg.guard === 'object' && cfg.guard ? cfg.guard : {};
  const protectedPaths = (guardCfg.protectedPaths || []).map((p) => p.replace(/\\/g, '/').replace(/\/?$/, '/').toLowerCase());

  for (const seg of segments(command)) {
    const tok = tokens(seg);
    if (/(^|[\\/])gh(\.exe)?$/i.test(tok[0] || '') && tok[1] === 'pr' && tok[2] === 'merge') {
      return t('guardMerge');
    }
    const g = gitArgs(tok);
    if (!g || !g.length) continue;
    const [sub, ...args] = g;

    if (sub === 'push') {
      if (args.some((a) => /^(-f|--force|--force-with-lease(=.*)?|--force-if-includes|--mirror|--delete|-d)$/.test(a) || /^\+/.test(a))) {
        return t('guardForce');
      }
      const refs = args.filter((a) => !a.startsWith('-'));
      const targets = refs.slice(1).map((r) => r.split(':').pop().replace(/^refs\/heads\//, '').toLowerCase());
      if (targets.some((t) => DEFAULT_BRANCHES.has(t))) {
        return t('guardPushDefault', targets.join(', '));
      }
      if (!targets.length) {
        const branch = currentBranch(cwd).toLowerCase();
        if (DEFAULT_BRANCHES.has(branch)) return t('guardOnDefault', branch);
      }
    }

    if (sub === 'add') {
      if (args.some((a) => a === '-A' || a === '--all' || a === '.' || a === ':/' || a === '*' || /^-[a-zA-Z]*A/.test(a))) {
        return t('guardMassAdd');
      }
      for (const a of args.filter((x) => !x.startsWith('-'))) {
        const rel = a.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
        const hit = protectedPaths.find((p) => rel === p.slice(0, -1) || rel.startsWith(p));
        if (hit) return t('guardProtected', a, hit);
      }
    }

    if (sub === 'commit' && args.some((a) => a === '-a' || a === '--all' || /^-[a-zA-Z]*a[a-zA-Z]*$/.test(a) && !a.startsWith('--'))) {
      return t('guardCommitA');
    }
  }
  return null;
}

function main() {
  let input = {};
  try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { return 0; }
  const command = input.tool_input && input.tool_input.command;
  if (!command || !/\b(git|gh)\b/.test(command)) return 0;
  const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  if (!env.findProjects(root).length) return 0;
  msg.init(root);
  const cfg = env.loadConfig(root);
  if (cfg.guard === false) return 0;
  const reason = check(command, input.cwd || root, cfg);
  return reason ? deny(reason) : 0;
}

module.exports = { check };
if (require.main === module) {
  try { process.exitCode = main(); } catch { process.exitCode = 0; }
}
