'use strict';
// Shared AL environment discovery: projects, per-repo config, compiler, filtered symbol cache, compile.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const STATE_DIR = path.join('.claude', '.aldc-verify');
const CONFIG_FILE = path.join('.claude', 'aldc-verify.json');
const SKIP_DIRS = new Set(['node_modules', '.alpackages', '.git', '.claude', '.snapshots', '.altestrunner', '.output']);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
}

function loadConfig(root) {
  const file = path.join(root, CONFIG_FILE);
  const defaults = { bcMajor: null, compiler: {}, analyzers: [], ruleset: null, maxAttempts: 3 };
  if (!fs.existsSync(file)) return defaults;
  const cfg = readJson(file);
  return { ...defaults, ...cfg, compiler: { ...(cfg.compiler || {}) } };
}

// Every folder with an app.json, skipping symbol caches and tool folders.
function findProjects(root) {
  const found = [];
  (function walk(dir, depth) {
    if (depth > 4) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    if (entries.some((e) => e.isFile() && e.name.toLowerCase() === 'app.json')) {
      try {
        const manifest = readJson(path.join(dir, 'app.json'));
        if (manifest.id && manifest.name) found.push({ dir, manifest, rel: path.relative(root, dir) || '.' });
      } catch { /* not an AL manifest */ }
    }
    for (const e of entries) {
      if (e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) walk(path.join(dir, e.name), depth + 1);
    }
  })(root, 0);
  return orderByDependencies(found);
}

// In-repo dependencies first (App before Test). Cycles fall back to discovery order.
function orderByDependencies(projects) {
  const ids = new Map(projects.map((p) => [p.manifest.id.toLowerCase(), p]));
  const done = new Set();
  const ordered = [];
  let progress = true;
  while (ordered.length < projects.length && progress) {
    progress = false;
    for (const p of projects) {
      if (done.has(p)) continue;
      const deps = (p.manifest.dependencies || [])
        .map((d) => ids.get(String(d.id || d.appId || '').toLowerCase()))
        .filter(Boolean);
      p.inRepoDeps = deps;
      if (deps.every((d) => done.has(d))) { done.add(p); ordered.push(p); progress = true; }
    }
  }
  for (const p of projects) if (!done.has(p)) ordered.push(p);
  return ordered;
}

function majorOf(version) {
  const m = /^(\d+)/.exec(String(version || ''));
  return m ? Number(m[1]) : null;
}

function targetBcMajor(cfg, projects) {
  if (cfg.bcMajor) return Number(cfg.bcMajor);
  const majors = projects.map((p) => majorOf(p.manifest.application)).filter((m) => m);
  return majors.length ? Math.min(...majors) : null;
}

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

// Compiler resolution. Per-repo pin wins; an unmatched pin is an error, never a silent fallback.
function findCompiler(cfg) {
  const c = cfg.compiler || {};
  const explicit = c.path || process.env.ALDC_VERIFY_ALC;
  if (explicit) {
    return fs.existsSync(explicit)
      ? { cmd: explicit, args: [], version: 'path', source: explicit, binDir: path.dirname(explicit) }
      : { error: `compiler.path no existe: ${explicit}` };
  }

  const home = os.homedir();
  const extRoots = ['.vscode', '.vscode-insiders', '.vscode-server', '.vscode-server-insiders']
    .map((d) => path.join(home, d, 'extensions'));
  const candidates = [];
  for (const extRoot of extRoots) {
    let dirs = [];
    try { dirs = fs.readdirSync(extRoot); } catch { continue; }
    for (const d of dirs) {
      const m = /^ms-dynamics-smb\.al-(\d+(?:\.\d+)*)$/.exec(d);
      if (!m) continue;
      const bin = path.join(extRoot, d, 'bin');
      const exe = process.platform === 'win32'
        ? [path.join(bin, 'alc.exe'), path.join(bin, 'win32', 'alc.exe')]
        : [path.join(bin, 'linux', 'alc'), path.join(bin, 'darwin', 'alc')];
      const hit = exe.find((f) => fs.existsSync(f));
      if (hit) candidates.push({ cmd: hit, args: [], version: m[1], source: 'vscode', binDir: path.dirname(hit) });
    }
  }
  if (c.alExtension) {
    const pinned = candidates
      .filter((x) => x.version === c.alExtension || x.version.startsWith(c.alExtension + '.'))
      .sort((a, b) => compareVersions(b.version, a.version))[0];
    if (pinned) return { ...pinned, pinned: true };
    if (!c.alTool) return { error: `no encuentro la extensión AL fijada (alExtension ${c.alExtension}); instaladas: ${candidates.map((x) => x.version).join(', ') || 'ninguna'}` };
  }

  // dotnet tool `al` (Linux/cloud, or Windows with the tool installed).
  const toolName = process.platform === 'win32' ? 'al.exe' : 'al';
  const toolPath = path.join(home, '.dotnet', 'tools', toolName);
  if (fs.existsSync(toolPath)) {
    return { cmd: toolPath, args: ['compile'], version: c.alTool || 'dotnet-tool', source: 'dotnet-tool', pinned: !!c.alTool, binDir: null };
  }
  if (c.alTool) return { error: `no encuentro la herramienta dotnet 'al' fijada (alTool ${c.alTool})` };

  const latest = candidates.sort((a, b) => compareVersions(b.version, a.version))[0];
  return latest ? { ...latest, pinned: false } : { error: 'no encuentro alc.exe (extensión AL de VS Code) ni la herramienta dotnet `al`' };
}

// Microsoft symbols: keep the BC-major build when one exists, otherwise what is there.
// Stale symbols of apps built from this repo are dropped; the fresh build replaces them.
function prepareCache(project, bcMajor, cacheDir, freshApps, inRepoPrefixes) {
  fs.rmSync(cacheDir, { recursive: true, force: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  const src = path.join(project.dir, '.alpackages');
  let files = [];
  try { files = fs.readdirSync(src).filter((f) => f.toLowerCase().endsWith('.app')); } catch { /* no symbols */ }

  const groups = new Map();
  for (const f of files) {
    const m = /^(.*)_(\d+(?:\.\d+){1,3})\.app$/i.exec(f);
    const key = m ? m[1] : f;
    if (inRepoPrefixes.has(key.toLowerCase())) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ file: f, version: m ? m[2] : '' });
  }
  const picked = [];
  for (const [key, list] of groups) {
    const isMicrosoft = /^microsoft_/i.test(key);
    const sameMajor = list.filter((x) => majorOf(x.version) === bcMajor);
    picked.push(...(isMicrosoft && bcMajor && sameMajor.length ? sameMajor : list));
  }
  for (const x of picked) linkOrCopy(path.join(src, x.file), path.join(cacheDir, x.file));
  for (const app of freshApps) linkOrCopy(app, path.join(cacheDir, path.basename(app)));
  return { symbolCount: picked.length, hadSymbols: files.length > 0 };
}

function linkOrCopy(from, to) {
  try { fs.linkSync(from, to); } catch { fs.copyFileSync(from, to); }
}

const DIAG = /^(.*?)\((\d+),(\d+)\):\s*(error|warning|info)\s+(AL\w+|[A-Z]{2,}\d+):\s*(.*)$/i;

function compileProject(compiler, project, opts) {
  const outDir = opts.outDir;
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const args = [...compiler.args, `/project:${project.dir}`, `/packagecachepath:${opts.cacheDir}`, `/outfolder:${outDir}`];
  for (const a of opts.analyzers || []) args.push(`/analyzer:${a}`);
  if (opts.ruleset) args.push(`/ruleset:${opts.ruleset}`);

  const started = Date.now();
  const r = spawnSync(compiler.cmd, args, { cwd: opts.cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: opts.timeoutMs || 240000, windowsHide: true });
  const output = `${r.stdout || ''}\n${r.stderr || ''}`;
  const diagnostics = [];
  for (const line of output.split(/\r?\n/)) {
    const m = DIAG.exec(line.trim());
    if (m) diagnostics.push({ file: m[1], line: +m[2], col: +m[3], severity: m[4].toLowerCase(), code: m[5], message: m[6] });
    else if (/^error\s+AL\w+:/i.test(line.trim())) {
      const g = /^error\s+(AL\w+):\s*(.*)$/i.exec(line.trim());
      diagnostics.push({ file: '', line: 0, col: 0, severity: 'error', code: g[1], message: g[2] });
    }
  }
  let apps = [];
  try { apps = fs.readdirSync(outDir).filter((f) => f.endsWith('.app')).map((f) => path.join(outDir, f)); } catch { /* none */ }
  return {
    exitCode: r.status,
    spawnError: r.error ? String(r.error.message || r.error) : null,
    seconds: (Date.now() - started) / 1000,
    errors: diagnostics.filter((d) => d.severity === 'error'),
    warnings: diagnostics.filter((d) => d.severity === 'warning'),
    apps,
    tail: output.trim().split(/\r?\n/).slice(-15).join('\n'),
  };
}

// Content fingerprint of everything that affects compilation.
function fingerprint(root, projects, extra) {
  const h = crypto.createHash('sha1');
  h.update(JSON.stringify(extra || {}));
  for (const p of projects) {
    const files = [];
    (function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) walk(full); }
        else if (/\.(al|xlf|json|rdlc|docx|xlsx)$/i.test(e.name) || e.name === 'app.json') files.push(full);
      }
    })(p.dir);
    const pkg = path.join(p.dir, '.alpackages');
    try { for (const f of fs.readdirSync(pkg)) files.push(`symbol:${f}`); } catch { /* none */ }
    files.sort();
    for (const f of files) {
      if (f.startsWith('symbol:')) { h.update(`${p.rel}|${f}`); continue; }
      h.update(path.relative(root, f));
      h.update(fs.readFileSync(f));
    }
  }
  return h.digest('hex');
}

function readState(root) {
  try { return readJson(path.join(root, STATE_DIR, 'state.json')); } catch { return {}; }
}

function writeState(root, state) {
  const dir = path.join(root, STATE_DIR);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(state, null, 2));
}

function resolveAnalyzers(names, compiler) {
  const map = { codecop: 'CodeCop', uicop: 'UICop', pertenantextensioncop: 'PerTenantExtensionCop', appsourcecop: 'AppSourceCop' };
  return (names || []).map((n) => {
    if (fs.existsSync(n)) return n;
    const short = map[String(n).replace(/^\$\{|\}$/g, '').toLowerCase()] || n;
    const dll = compiler.binDir && path.join(compiler.binDir, `Microsoft.Dynamics.Nav.${short}.dll`);
    return dll && fs.existsSync(dll) ? dll : null;
  }).filter(Boolean);
}

const DEFAULT_ANALYZERS = ['CodeCop', 'UICop', 'PerTenantExtensionCop'];

function readVsCodeSettings(projectDir) {
  try {
    const raw = fs.readFileSync(path.join(projectDir, '.vscode', 'settings.json'), 'utf8').replace(/^﻿/, '');
    return JSON.parse(raw.replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1'));
  } catch { return {}; }
}

// L2 settings per project: repo config, then the project's VS Code AL settings, then the PTE default.
function analyzerSettings(root, project, cfg, compiler) {
  const vs = readVsCodeSettings(project.dir);
  let names = cfg.analyzers && cfg.analyzers.length ? cfg.analyzers : null;
  let source = names ? '.claude/aldc-verify.json' : null;
  if (!names && Array.isArray(vs['al.codeAnalyzers'])) { names = vs['al.codeAnalyzers']; source = '.vscode/settings.json'; }
  if (!names) { names = DEFAULT_ANALYZERS; source = 'default'; }
  let ruleset = null;
  if (cfg.ruleset) ruleset = path.resolve(root, cfg.ruleset);
  else if (vs['al.ruleSetPath']) ruleset = path.resolve(project.dir, vs['al.ruleSetPath']);
  if (ruleset && !fs.existsSync(ruleset)) ruleset = null;
  const dlls = resolveAnalyzers(names, compiler);
  return { dlls, names: dlls.map((d) => path.basename(d).replace(/^Microsoft\.Dynamics\.Nav\.|\.dll$/g, '')), source, ruleset, missing: names.length - dlls.length };
}

// Compile every project in dependency order. Downstream projects are skipped when an upstream one fails.
// opts.analyzers: false (L1 only) or true (L1+L2 with per-project analyzer settings).
function verifyAll(root, opts = {}) {
  const cfg = loadConfig(root);
  let projects = findProjects(root);
  if (!projects.length) return { status: 'no-projects', projects: [] };
  const compiler = findCompiler(cfg);
  const bcMajor = targetBcMajor(cfg, projects);
  if (compiler.error) return { status: 'not-run', reason: compiler.error, projects, bcMajor };
  if (opts.only) {
    // Keep the requested project plus the in-repo projects it needs.
    const want = projects.find((p) => p.rel.toLowerCase() === opts.only.toLowerCase() || p.manifest.name.toLowerCase() === opts.only.toLowerCase());
    if (!want) return { status: 'not-run', reason: `no encuentro el proyecto ${opts.only}`, projects, bcMajor };
    const keep = new Set();
    (function add(p) { if (keep.has(p)) return; keep.add(p); (p.inRepoDeps || []).forEach(add); })(want);
    projects = projects.filter((p) => keep.has(p));
  }

  const inRepoPrefixes = new Set(projects.map((p) => `${p.manifest.publisher}_${p.manifest.name}`.toLowerCase()));
  const built = new Map();
  const results = [];
  for (const p of projects) {
    const failedDep = (p.inRepoDeps || []).find((d) => !built.has(d));
    if (failedDep) { results.push({ project: p, skipped: `depende de ${failedDep.rel}, que no compila` }); continue; }
    const slug = p.rel.replace(/[\\/:. ]+/g, '_') || 'root';
    const cacheDir = path.join(root, STATE_DIR, 'cache', slug);
    const fresh = (p.inRepoDeps || []).flatMap((d) => built.get(d));
    const cache = prepareCache(p, bcMajor, cacheDir, fresh, inRepoPrefixes);
    if (!cache.hadSymbols) { results.push({ project: p, skipped: `no hay símbolos en ${path.join(p.rel, '.alpackages')}` }); continue; }
    const l2 = opts.analyzers ? analyzerSettings(root, p, cfg, compiler) : null;
    const r = compileProject(compiler, p, {
      cacheDir, outDir: path.join(root, STATE_DIR, 'out', slug), cwd: root,
      analyzers: l2 ? l2.dlls : [], ruleset: l2 ? l2.ruleset : null,
    });
    results.push({ project: p, l2, ...r });
    if (!r.errors.length && r.exitCode === 0 && r.apps.length) built.set(p, r.apps);
  }
  const errors = results.reduce((n, r) => n + (r.errors ? r.errors.length : 0), 0);
  const toolFailure = results.some((r) => r.exitCode !== undefined && r.exitCode !== 0 && !r.errors.length);
  const skipped = results.filter((r) => r.skipped);
  const status = errors ? 'red' : toolFailure ? 'tool-failure' : skipped.length ? 'partial' : 'green';
  return { status, results, compiler, bcMajor, cfg, projects };
}

module.exports = { STATE_DIR, loadConfig, findProjects, findCompiler, targetBcMajor, fingerprint, readState, writeState, verifyAll };
