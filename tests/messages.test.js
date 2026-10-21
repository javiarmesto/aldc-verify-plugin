'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const msg = require('../scripts/lib/messages');
const { makeAlRepo, hookEnv, runScript, tempDir } = require('./helpers');

test('resolveLanguage: English by default', () => {
  assert.equal(msg.resolveLanguage({}), 'en');
  assert.equal(msg.resolveLanguage({ locale: 'en-US' }), 'en');
  assert.equal(msg.resolveLanguage({ locale: 'de-DE' }), 'en');
  assert.equal(msg.resolveLanguage({ locale: '' }), 'en');
});

test('resolveLanguage: Spanish from config, env or locale', () => {
  assert.equal(msg.resolveLanguage({ config: 'es' }), 'es');
  assert.equal(msg.resolveLanguage({ env: 'es' }), 'es');
  assert.equal(msg.resolveLanguage({ env: 'es-ES' }), 'es');
  assert.equal(msg.resolveLanguage({ locale: 'es-ES' }), 'es');
  assert.equal(msg.resolveLanguage({ locale: 'es' }), 'es');
  assert.equal(msg.resolveLanguage({ locale: 'es-419' }), 'es');
});

test('resolveLanguage: config wins over env, env wins over locale', () => {
  assert.equal(msg.resolveLanguage({ config: 'en', env: 'es', locale: 'es-ES' }), 'en');
  assert.equal(msg.resolveLanguage({ config: 'es', env: 'en', locale: 'en-US' }), 'es');
  assert.equal(msg.resolveLanguage({ env: 'en', locale: 'es-ES' }), 'en');
  assert.equal(msg.resolveLanguage({ env: '', locale: 'es-ES' }), 'es');
});

test('resolveLanguage: a locale that merely contains "es" is not Spanish', () => {
  assert.equal(msg.resolveLanguage({ locale: 'est-EE' }), 'en');
});

test('every key exists in both languages with the same kind', () => {
  const en = msg.MESSAGES.en;
  const es = msg.MESSAGES.es;
  assert.deepEqual(Object.keys(es).sort(), Object.keys(en).sort());
  for (const k of Object.keys(en)) {
    const kind = (v) => (Array.isArray(v) ? 'array' : typeof v);
    assert.equal(kind(es[k]), kind(en[k]), k);
    if (typeof en[k] === 'function') assert.equal(es[k].length, en[k].length, `${k} arity`);
    if (Array.isArray(en[k])) assert.equal(es[k].length, en[k].length, `${k} lines`);
  }
});

test('init(root) reads "language" from .claude/aldc-verify.json', () => {
  const saved = process.env.ALDC_VERIFY_LANG;
  try {
    process.env.ALDC_VERIFY_LANG = 'en';
    assert.equal(msg.init(makeAlRepo({ config: { language: 'es' } })), 'es');
    assert.equal(msg.t('guardMassAdd'), 'git add masivo. Añade los ficheros uno a uno por su ruta.');
    assert.equal(msg.init(makeAlRepo()), 'en');
    assert.equal(msg.t('guardMassAdd'), 'mass git add. Add the files one by one by path.');
    process.env.ALDC_VERIFY_LANG = 'es';
    assert.equal(msg.init(tempDir()), 'es');
  } finally {
    if (saved === undefined) delete process.env.ALDC_VERIFY_LANG; else process.env.ALDC_VERIFY_LANG = saved;
    msg.init(null);
  }
});

test('a script speaks English by default and Spanish via env or config', () => {
  const empty = tempDir();
  const en = runScript('al-verify.js', { env: hookEnv({ CLAUDE_PROJECT_DIR: empty }) });
  assert.equal(en.code, 3);
  assert.match(en.stdout, /not-run, there is no app\.json in/);

  const es = runScript('al-verify.js', { env: hookEnv({ CLAUDE_PROJECT_DIR: empty, ALDC_VERIFY_LANG: 'es' }) });
  assert.equal(es.code, 3);
  assert.match(es.stdout, /not-run, no hay ningún app\.json en/);

  // Config wins over the environment.
  const repo = makeAlRepo({ config: { language: 'es', compiler: { path: path.join(empty, 'missing-alc') } } });
  const cfg = runScript('al-verify.js', { env: hookEnv({ CLAUDE_PROJECT_DIR: repo, ALDC_VERIFY_LANG: 'en' }) });
  assert.equal(cfg.code, 3);
  assert.match(cfg.stdout, /compiler\.path no existe/);
  assert.ok(fs.existsSync(repo));
});
