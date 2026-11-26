'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const msg = require('../scripts/lib/messages');
const { contextFor } = require('../scripts/aldc-overlay');
const { makeAlRepo, hookEnv, runScript, tempDir } = require('./helpers');

function withLang(lang, fn) {
  const saved = process.env.ALDC_VERIFY_LANG;
  process.env.ALDC_VERIFY_LANG = lang;
  msg.init(null);
  try { return fn(); } finally {
    if (saved === undefined) delete process.env.ALDC_VERIFY_LANG; else process.env.ALDC_VERIFY_LANG = saved;
    msg.init(null);
  }
}

test('contextFor gives each ALDC role its own instructions', () => withLang('en', () => {
  const common = /^aldc-verify is active in this repo/;
  const writers = ['aldc:al-implement-subagent', 'aldc:al-developer', 'aldc:al-agent-builder'];
  const reviewers = ['aldc:al-review-subagent', 'aldc:al-developer-reviewer', 'aldc:dredd', 'aldc:al-triage'];
  const planners = ['aldc:al-planning-subagent', 'aldc:al-architect', 'aldc:al-spec-agent', 'aldc:al-presales'];

  for (const a of writers) {
    const c = contextFor(a);
    assert.match(c, common, a);
    assert.match(c, /\/aldc-verify:al-verify --l1/, a);
    assert.match(c, /TDD RED/, a);
  }
  for (const a of reviewers) {
    const c = contextFor(a);
    assert.match(c, common, a);
    assert.match(c, /last-report\.json/, a);
    assert.match(c, /read-only/, a);
    assert.doesNotMatch(c, /TDD RED/, a);
  }
  const conductor = contextFor('aldc:al-conductor');
  assert.match(conductor, /al-build-validator/);
  assert.match(conductor, /\/aldc-verify:al-go/);
  for (const a of planners) assert.match(contextFor(a), /In plans, the "compiles" criterion/, a);

  assert.equal(contextFor('aldc:something-else'), null);
}));

test('contextFor speaks Spanish when asked', () => withLang('es', () => {
  assert.match(contextFor('aldc:al-developer'), /^aldc-verify está activo en este repo/);
  assert.match(contextFor('aldc:al-review-subagent'), /solo lectura/);
}));

test('overlay hook: injects SubagentStart context for aldc:* in an AL repo', () => {
  const repo = makeAlRepo();
  const r = runScript('aldc-overlay.js', { input: { agent_type: 'aldc:al-developer', cwd: repo }, env: hookEnv({ CLAUDE_PROJECT_DIR: repo }) });
  assert.equal(r.code, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'SubagentStart');
  assert.match(out.hookSpecificOutput.additionalContext, /aldc-verify is active/);
});

test('overlay hook: silent outside AL repos, for other agents and on bad input', () => {
  const plain = tempDir();
  const r1 = runScript('aldc-overlay.js', { input: { agent_type: 'aldc:al-developer', cwd: plain }, env: hookEnv({ CLAUDE_PROJECT_DIR: plain }) });
  assert.equal(r1.code, 0);
  assert.equal(r1.stdout, '');

  const repo = makeAlRepo();
  const r2 = runScript('aldc-overlay.js', { input: { agent_type: 'general-purpose', cwd: repo }, env: hookEnv({ CLAUDE_PROJECT_DIR: repo }) });
  assert.equal(r2.stdout, '');
  const r3 = runScript('aldc-overlay.js', { input: { agent_type: 'other:al-developer', cwd: repo }, env: hookEnv({ CLAUDE_PROJECT_DIR: repo }) });
  assert.equal(r3.stdout, '');

  const r4 = runScript('aldc-overlay.js', { input: '{oops', env: hookEnv({ CLAUDE_PROJECT_DIR: repo }) });
  assert.equal(r4.code, 0);
  assert.equal(r4.stdout, '');
});
