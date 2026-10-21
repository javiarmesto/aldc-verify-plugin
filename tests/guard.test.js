'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const msg = require('../scripts/lib/messages');
const { check } = require('../scripts/guard');
const { makeAlRepo, hookEnv, runScript, tempDir, gitAvailable } = require('./helpers');

process.env.ALDC_VERIFY_LANG = 'en';
msg.init(null);

// A git repo on branch `main`, and one on a claude/ branch, for pushes without a target.
function gitRepo(branch) {
  const dir = tempDir();
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['checkout', '-q', '-b', branch], { cwd: dir });
  return dir;
}

const cfg = { guard: { protectedPaths: ['data/real', 'Exports\\'] } };

test('guard denies what cannot be undone', { skip: !gitAvailable() && 'git not available' }, () => {
  const onMain = gitRepo('main');
  const denied = [
    ['gh pr merge 12 --squash', /merging a PR/],
    ['gh.exe pr merge 12', /merging a PR/],
    ['git push -f origin claude/x', /forced push/],
    ['git push --force origin claude/x', /forced push/],
    ['git push --force-with-lease origin claude/x', /forced push/],
    ['git push --force-with-lease=claude/x origin claude/x', /forced push/],
    ['git push --force-if-includes origin claude/x', /forced push/],
    ['git push --mirror origin', /forced push/],
    ['git push --delete origin claude/x', /forced push/],
    ['git push origin -d claude/x', /forced push/],
    ['git push origin +claude/x', /forced push/],
    ['git -C some/dir push --force', /forced push/],
    ['git push origin main', /default branch \(main\)/],
    ['git push origin HEAD:master', /default branch/],
    ['git push origin claude/x:refs/heads/develop', /default branch/],
    ['git push -u origin dev', /default branch/],
    ['git push', /you are on main/],
    ['git push -u origin', /you are on main/],
    ['git add -A', /mass git add/],
    ['git add --all', /mass git add/],
    ['git add .', /mass git add/],
    ['git add :/', /mass git add/],
    ['git add *', /mass git add/],
    ['git add -Av', /mass git add/],
    ['git status && git add -A && git commit -m x', /mass git add/],
    ['git commit -a -m "x"', /git commit -a/],
    ['git commit --all -m x', /git commit -a/],
    ['git commit -am "x"', /git commit -a/],
    ['git add data/real/export.xlsx', /protected folder \(data\/real\/\)/],
    ['git add data/real', /protected folder/],
    ['git add ./Exports/a.csv', /protected folder \(exports\/\)/],
    ['git add src\\a.al data\\real\\x.csv', /protected folder/],
  ];
  for (const [cmd, why] of denied) {
    const reason = check(cmd, onMain, cfg);
    assert.ok(reason, `should deny: ${cmd}`);
    assert.match(reason, why, cmd);
  }
});

test('guard allows normal work', { skip: !gitAvailable() && 'git not available' }, () => {
  const onMain = gitRepo('main');
  const onBranch = gitRepo('claude/topic');
  const allowed = [
    ['git status --short', onMain],
    ['git diff', onMain],
    ['git add src/Hello.al', onMain],
    ['git add App/src/a.al App/app.json', onMain],
    ['git add data/realistic.al', onMain],
    ['git commit -m "feat: x"', onMain],
    ['git commit --amend -m "x"', onMain],
    ['git push -u origin claude/topic', onMain],
    ['git push origin claude/main-fix', onMain],
    ['git push', onBranch],
    ['git push -u origin', onBranch],
    ['git switch -c claude/topic', onMain],
    ['gh pr create --draft --base main', onMain],
    ['gh pr view 12', onMain],
    ['git log --oneline -15', onMain],
    ['echo "git add -A is denied"', onMain],
  ];
  for (const [cmd, cwd] of allowed) assert.equal(check(cmd, cwd, cfg), null, `should allow: ${cmd}`);
});

test('guard messages follow the language', () => {
  try {
    process.env.ALDC_VERIFY_LANG = 'es';
    msg.init(null);
    assert.match(check('git add -A', tempDir(), {}), /git add masivo/);
  } finally {
    process.env.ALDC_VERIFY_LANG = 'en';
    msg.init(null);
  }
});

test('guard hook: denies through PreToolUse output in an AL repo', () => {
  const repo = makeAlRepo();
  const r = runScript('guard.js', { input: { tool_input: { command: 'git add -A' }, cwd: repo }, env: hookEnv({ CLAUDE_PROJECT_DIR: repo }) });
  assert.equal(r.code, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /^aldc-verify guard: mass git add/);
});

test('guard hook: silent outside AL repos and with "guard": false', () => {
  const plain = tempDir();
  const r1 = runScript('guard.js', { input: { tool_input: { command: 'git add -A' }, cwd: plain }, env: hookEnv({ CLAUDE_PROJECT_DIR: plain }) });
  assert.equal(r1.code, 0);
  assert.equal(r1.stdout, '');

  const off = makeAlRepo({ config: { guard: false } });
  const r2 = runScript('guard.js', { input: { tool_input: { command: 'git push --force' }, cwd: off }, env: hookEnv({ CLAUDE_PROJECT_DIR: off }) });
  assert.equal(r2.code, 0);
  assert.equal(r2.stdout, '');
});

test('guard hook: never fails on bad input', () => {
  const r = runScript('guard.js', { input: 'not json' });
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '');
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'scripts', 'guard.js')));
});
