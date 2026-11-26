'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const env = require('../scripts/lib/al-env');
const { makeAlRepo, hookEnv, runScript, tempDir } = require('./helpers');

function fp(root) {
  const cfg = env.loadConfig(root);
  const projects = env.findProjects(root);
  return env.fingerprint(root, projects, { bcMajor: env.targetBcMajor(cfg, projects), compiler: cfg.compiler });
}

// A compiler path that does not exist: if the gate tried to compile, it would print not-run.
const noCompiler = (root) => hookEnv({ CLAUDE_PROJECT_DIR: root, ALDC_VERIFY_ALC: path.join(root, 'no-such-alc.exe') });
const stopInput = { hook_event_name: 'Stop', stop_hook_active: false };

test('gate: exits 0 silently when the repo has no app.json', () => {
  const plain = tempDir();
  const r = runScript('al-verify-gate.js', { input: stopInput, env: noCompiler(plain) });
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
});

test('gate: exits 0 quickly, without compiling, when the fingerprint is already green', () => {
  const repo = makeAlRepo();
  env.writeState(repo, { lastGreen: fp(repo) });
  const r = runScript('al-verify-gate.js', { input: stopInput, env: noCompiler(repo) });
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '', 'no compile attempt, so no not-run message');
  assert.equal(r.stderr, '');
  assert.ok(r.ms < 10000, `took ${r.ms} ms`);
  assert.equal(env.readState(repo).history, undefined, 'nothing recorded');
});

test('gate: exits 0 without compiling when AL did not change during the turn', () => {
  const repo = makeAlRepo();
  const base = runScript('al-verify-baseline.js', { env: noCompiler(repo) });
  assert.equal(base.code, 0);
  assert.equal(base.stdout, '', 'UserPromptSubmit must print nothing');
  assert.equal(env.readState(repo).turnBaseline, fp(repo));
  const r = runScript('al-verify-gate.js', { input: stopInput, env: noCompiler(repo) });
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '');
});

test('gate: a change with no compiler reports not-run and never blocks', () => {
  const repo = makeAlRepo();
  runScript('al-verify-baseline.js', { env: noCompiler(repo) });
  fs.appendFileSync(path.join(repo, 'App', 'src', 'Hello.Codeunit.al'), '// changed\n');
  const r = runScript('al-verify-gate.js', { input: stopInput, env: noCompiler(repo) });
  assert.equal(r.code, 0);
  assert.match(JSON.parse(r.stdout).systemMessage, /^aldc-verify: not-run\. I did not compile: compiler\.path does not exist/);
  const history = env.readState(repo).history;
  assert.equal(history.at(-1).status, 'not-run');
  // The state folder ignores itself.
  assert.equal(fs.readFileSync(path.join(repo, '.claude', '.aldc-verify', '.gitignore'), 'utf8'), '*\n');
});

test('gate: missing symbols is an incomplete verification, not a block', () => {
  const repo = makeAlRepo();
  // Any existing file passes as compiler: with no symbols the project is skipped before alc runs.
  const r = runScript('al-verify-gate.js', { input: stopInput, env: hookEnv({ CLAUDE_PROJECT_DIR: repo, ALDC_VERIFY_ALC: process.execPath }) });
  assert.equal(r.code, 0);
  const m = JSON.parse(r.stdout).systemMessage;
  assert.match(m, /incomplete verification \(partial\)/);
  assert.match(m, /no symbols in App[\\/]\.alpackages/);
});

test('gate: Spanish messages with "language": "es"', () => {
  const repo = makeAlRepo({ config: { language: 'es' } });
  const r = runScript('al-verify-gate.js', { input: stopInput, env: noCompiler(repo) });
  assert.equal(r.code, 0);
  assert.match(JSON.parse(r.stdout).systemMessage, /^aldc-verify: not-run\. No he compilado: compiler\.path no existe/);
});

test('gate: a broken stdin never traps the session', () => {
  const repo = makeAlRepo();
  env.writeState(repo, { lastGreen: fp(repo) });
  const r = runScript('al-verify-gate.js', { input: '{not json', env: noCompiler(repo) });
  assert.equal(r.code, 0);
});

// 0.4.1: a subagent launched with isolation: worktree stops in a linked worktree of the project.
const { spawnSync } = require('child_process');
const { gitAvailable } = require('./helpers');
function repoWithWorktree() {
  const repo = makeAlRepo({ config: { maxAttempts: 3 } });
  const git = (...a) => spawnSync('git', a, { cwd: repo, encoding: 'utf8' });
  git('init', '-q'); git('add', 'App/app.json'); git('add', 'App/src/Hello.Codeunit.al');
  git('-c', 'user.name=t', '-c', 'user.email=t@localhost', 'commit', '-qm', 'base');
  const wt = path.join(repo, '.claude', 'worktrees', 'agent-1');
  git('worktree', 'add', '-q', wt, '-b', 'worktree-agent-1');
  return { repo, wt: fs.realpathSync.native(wt) };
}
const subStop = (cwd) => ({ hook_event_name: 'SubagentStop', cwd, agent_type: 'aldc:al-implementer', agent_id: 'a1', stop_hook_active: false });

test('gate: SubagentStop in a worktree compiles that worktree, not the project', { skip: !gitAvailable() }, () => {
  const { repo, wt } = repoWithWorktree();
  fs.appendFileSync(path.join(wt, 'App', 'src', 'Hello.Codeunit.al'), '// changed in the worktree\n');
  const r = runScript('al-verify-gate.js', { input: subStop(path.join(wt, 'App')), env: noCompiler(repo) });
  assert.equal(r.code, 0);
  assert.match(JSON.parse(r.stdout).systemMessage, /not-run/);
  assert.equal(env.readState(wt).history.at(-1).status, 'not-run', 'the worktree keeps its own state');
  const audit = env.readState(repo).history.at(-1);
  assert.equal(audit.worktree, '.claude/worktrees/agent-1');
  assert.equal(audit.agent, 'aldc:al-implementer');
});

test('gate: a worktree the subagent already compiled green leaves a cached line in the project', { skip: !gitAvailable() }, () => {
  const { repo, wt } = repoWithWorktree();
  env.writeState(wt, { lastGreen: fp(wt) });
  const r = runScript('al-verify-gate.js', { input: subStop(wt), env: noCompiler(repo) });
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '');
  const audit = env.readState(repo).history.at(-1);
  assert.deepEqual([audit.status, audit.cached, audit.worktree], ['green', true, '.claude/worktrees/agent-1']);
});

test('gate: a worktree without its own config uses the main checkout config', { skip: !gitAvailable() }, () => {
  const { wt } = repoWithWorktree();
  assert.equal(env.loadConfig(wt).maxAttempts, 3);
  fs.rmSync(path.join(wt, '.claude', 'aldc-verify.json'), { force: true });
  assert.ok(env.mainCheckout(wt));
});
