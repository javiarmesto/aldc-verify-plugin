'use strict';
// Runtime messages in English (default) and Spanish.
// Language: "language" in .claude/aldc-verify.json, else env ALDC_VERIFY_LANG, else the system
// locale (Spanish when it starts with "es"). Anything other than "es" means English.

const fs = require('fs');
const path = require('path');

const M = {
  en: {
    // al-env
    compilerPathMissing: (p) => `compiler.path does not exist: ${p}`,
    pinnedExtMissing: (ver, list) => `cannot find the pinned AL extension (alExtension ${ver}); installed: ${list || 'none'}`,
    pinnedToolMissing: (ver) => `cannot find the pinned dotnet tool 'al' (alTool ${ver})`,
    noCompiler: 'cannot find alc.exe (VS Code AL extension) or the dotnet tool `al`',
    projectNotFound: (name) => `cannot find the project ${name}`,
    dependsOnFailed: (rel) => `depends on ${rel}, which does not compile`,
    noSymbols: (dir) => `no symbols in ${dir}`,
    mainCheckout: 'main checkout',
    lockTimeout: 'another compilation of this repo is still running after waiting 5 min',

    // shared
    andMore: (n) => `… and ${n} more`,
    unpinned: ' (not pinned in .claude/aldc-verify.json)',
    alcNoDiag: (rel, code, tail) => `- ${rel}: alc exited with code ${code} and no diagnostics. Output:\n${tail}`,

    // gate
    projectSummary: (name, e, w, s) => `${name}: ${e} errors, ${w} warnings (${s} s)`,
    whoClaude: 'Claude',
    whoSubagent: (t) => `the subagent ${t}`,
    seeReport: '(see .claude/.aldc-verify/last-report.json)',
    noChangeAfterBlock: 'no changes after the block',
    releasedNoChange: (who, listed) => `aldc-verify: ${who} changed nothing after the block; letting it stop. Still does not compile:\n${listed}`,
    gateNotRun: (reason) => `aldc-verify: not-run. I did not compile: ${reason}.`,
    greenAfterBlockReason: (bc, who, sum) => `aldc-verify: it now compiles green (BC ${bc}, ${who}). ${sum}. ` +
      'No need to compile again. Finish your answer citing this result.',
    greenAfterBlockSystem: (n, sum) => `aldc-verify: compiles after ${n} ${n === 1 ? 'block' : 'blocks'}. ${sum}.`,
    green: (bc, who, sum) => `aldc-verify: compiles (BC ${bc}, ${who}). ${sum}.`,
    incomplete: (status, listed) => `aldc-verify: incomplete verification (${status}).\n${listed}`,
    releasedMax: (who, max, listed) => `aldc-verify: ${who} still does not compile after ${max} attempts; letting it stop. Pending errors:\n${listed}`,
    blocked: (bc, who, attempt, max, listed) =>
      `aldc-verify: the AL compilation fails (BC ${bc}, ${who}; attempt ${attempt}/${max}). ` +
      `Fix these errors before finishing and do not consider the work done until it compiles:\n${listed}\n` +
      'When you have fixed them, just finish: this gate compiles again when you stop and will tell you the result.\n',
    gateInternal: (m) => `aldc-verify: internal gate error, nothing was verified (${m}).`,

    // al-verify
    verifyNoProjects: (level, root) => `aldc-verify ${level}: not-run, there is no app.json in ${root}.`,
    verifyNotRun: (level, reason) => `aldc-verify ${level}: not-run, ${reason}.`,
    verifyHeader: (level, bc, ver, unpinned) => `aldc-verify ${level}: BC ${bc}, alc ${ver}${unpinned}`,
    analyzersPart: (n, names, source, ruleset) => ` · ${n} from analyzers [${names}; ${source}${ruleset ? `; ruleset ${ruleset}` : ''}]`,
    projectLine: (mark, name, project, e, cw, l2, s) => `${mark} ${name} (${project}): ${e} errors · ${cw} compiler warnings${l2} · ${s} s`,
    l2Incomplete: (missing, total, list) => `    ⚠ L2 incomplete: cannot find ${missing} of ${total} analyzers (${list}) next to alc`,
    symbolsFrom: (src) => `    symbols taken from: ${src}`,
    alcNoDiagShort: '    alc failed without diagnostics (see last-report.json)',
    errorsHeader: (n) => `Errors (${n}):`,
    warningsHeader: (shown, total, per) => `Warnings (first ${shown} of ${total}: ${per}):`,
    partialState: 'Status: partial. L1 is valid, but L2 did not run completely: do not say the analyzers pass.',
    fullDetail: (p) => `Full detail: ${p}`,
    verifyInternal: (m) => `aldc-verify: internal error, nothing was verified (${m}).`,

    // overlay
    overlayCommon: 'aldc-verify is active in this repo: the real AL compiler is available and the Stop/SubagentStop hook compiles what you change.',
    overlayReviewer: [
      '- Build evidence: if .claude/.aldc-verify/last-report.json exists, read it and cite real errors and warnings (code, file and line) next to BCQuality. If it does not exist or predates the changes, say "build: not-run" and ask for aldc-verify:al-build-validator to be run.',
      '- Do not run anything: your review is still read-only.',
    ],
    overlayWriter: [
      '- "Verify Build Compiles" / "0 compilation errors": run it with /aldc-verify:al-verify --l1 (or delegate to the aldc-verify:al-build-validator agent) and cite its result line. Never claim it without that result.',
      '- TDD RED: "the test compiles and describes the behaviour" (compile it with /aldc-verify:al-verify --l1). Running tests needs BC v28+: without a sandbox, report it as not-run.',
      '- If the mcp__al__al_compile / al_build tools are not available, use aldc-verify instead.',
      '- Analyzers (L2): /aldc-verify:al-verify without --l1. Only fix warnings on lines you changed.',
    ],
    overlayConductor: [
      '- After each implementation phase, launch the aldc-verify:al-build-validator agent and paste its result into the phase-complete. Pass .claude/.aldc-verify/last-report.json to the reviewer.',
      '- To deliver, use /aldc-verify:al-go: it verifies, reviews, commits, pushes and opens the draft PR without waiting for anyone.',
    ],
    overlayPlanner: ['- In plans, the "compiles" criterion is checked with /aldc-verify:al-verify; include it as a verification step in each phase.'],

    // toolchain (SessionStart)
    tcTail: (bc, names) => `BC ${bc}, projects: ${names}. Compile with /aldc-verify:al-verify; the Stop hook compiles what you change.`,
    tcAldc: 'With ALDC (al-conductor): after each implementation phase launch aldc-verify:al-build-validator and cite its result; to deliver, /aldc-verify:al-go.',
    tcPinnedFrom: 'pinned in .claude/aldc-verify.json',
    tcDefaultFrom: 'plugin default; pin it in .claude/aldc-verify.json',
    tcReady: (what) => `aldc-verify: AL compiler ready (${what}).`,
    tcPinned: ', pinned',
    tcUnpinned: ', not pinned in .claude/aldc-verify.json',
    tcNotRun: (err) => `aldc-verify: not-run, no AL compiler: ${err}. Do not say the code compiles.`,
    tcInstallFailedUser: (err) => `aldc-verify: could not install the AL compiler (${err}).`,
    tcInstalled: (ver, from, secs) => `aldc-verify: AL compiler installed (dotnet tool al ${ver}, ${from}, ${secs} s).`,
    tcInstalledUser: (ver, secs, steps) => `aldc-verify: installed dotnet tool al ${ver} in ${secs} s (${steps}).`,
    tcNoCompilerContext: (err) => `aldc-verify: not-run, ${err}. Do not say the code compiles.`,
    tcNoCompilerUser: (err) => `aldc-verify: no AL compiler: ${err}.`,
    tcInternal: (m) => `aldc-verify: internal error checking the compiler (${m}).`,
    tcNoDotnet: 'no dotnet and no apt-get to install it',
    tcAptFailed: (o) => `apt could not install dotnet8 (${o})`,
    tcUninstalled: (v) => `uninstalled al ${v}`,
    tcToolFailed: (o) => `dotnet tool install failed (${o})`,

    // guard
    guardMerge: 'merging a PR is a person\'s decision. Leave the PR open and report.',
    guardForce: 'forced push or remote branch deletion. Do a normal push of a claude/... branch.',
    guardPushDefault: (targets) => `push to the default branch (${targets}). Work on a claude/... branch and open a PR.`,
    guardOnDefault: (branch) => `you are on ${branch}: create a claude/... branch before pushing.`,
    guardMassAdd: 'mass git add. Add the files one by one by path.',
    guardProtected: (a, hit) => `${a} is in a protected folder (${hit}): data that must never be committed.`,
    guardCommitA: 'git commit -a. Add the files one by one and commit without -a.',

    // init
    initNoProjects: (root) => `aldc-verify init: not-run, there is no app.json in ${root}.`,
    initPinnedSource: 'pinned in .claude/aldc-verify.json',
    initDetectedSource: 'detected; will be pinned',
    initExists: 'already exists',
    initInvalidJson: 'not valid JSON; left untouched',
    initHasAll: 'already has everything',
    initClaudeMdExists: 'already exists; use /aldc-verify:al-learn to add rules',
    initGitignoreHas: 'already ignores .claude/.aldc-verify/',
    initNoSymbolsCi: 'the repo does not version symbols in .alpackages; CI could not compile',
    initHeader: (dry, root) => `aldc-verify init${dry ? ' (dry-run)' : ''}: ${root}`,
    initSummary: (repo, bc, projects, ext, tool, source, plans, branch) =>
      `${repo} · BC ${bc} · projects: ${projects} · alExtension ${ext} · alTool ${tool} (${source}) · plans ${plans} · branch ${branch}`,
    initInternal: (m) => `aldc-verify init: internal error (${m}).`,
  },

  es: {
    compilerPathMissing: (p) => `compiler.path no existe: ${p}`,
    pinnedExtMissing: (ver, list) => `no encuentro la extensión AL fijada (alExtension ${ver}); instaladas: ${list || 'ninguna'}`,
    pinnedToolMissing: (ver) => `no encuentro la herramienta dotnet 'al' fijada (alTool ${ver})`,
    noCompiler: 'no encuentro alc.exe (extensión AL de VS Code) ni la herramienta dotnet `al`',
    projectNotFound: (name) => `no encuentro el proyecto ${name}`,
    dependsOnFailed: (rel) => `depende de ${rel}, que no compila`,
    noSymbols: (dir) => `no hay símbolos en ${dir}`,
    mainCheckout: 'checkout principal',
    lockTimeout: 'otra compilación de este repo sigue en marcha tras 5 min de espera',

    andMore: (n) => `… y ${n} más`,
    unpinned: ' (sin fijar en .claude/aldc-verify.json)',
    alcNoDiag: (rel, code, tail) => `- ${rel}: alc terminó con código ${code} sin diagnósticos. Salida:\n${tail}`,

    projectSummary: (name, e, w, s) => `${name}: ${e} errores, ${w} warnings (${s} s)`,
    whoClaude: 'Claude',
    whoSubagent: (t) => `el subagente ${t}`,
    seeReport: '(ver .claude/.aldc-verify/last-report.json)',
    noChangeAfterBlock: 'sin cambios tras el bloqueo',
    releasedNoChange: (who, listed) => `aldc-verify: ${who} no ha cambiado nada tras el bloqueo; dejo parar. Sigue sin compilar:\n${listed}`,
    gateNotRun: (reason) => `aldc-verify: not-run. No he compilado: ${reason}.`,
    greenAfterBlockReason: (bc, who, sum) => `aldc-verify: ahora compila en verde (BC ${bc}, ${who}). ${sum}. ` +
      'No hace falta volver a compilar. Termina tu respuesta citando este resultado.',
    greenAfterBlockSystem: (n, sum) => `aldc-verify: compila tras ${n} ${n === 1 ? 'bloqueo' : 'bloqueos'}. ${sum}.`,
    green: (bc, who, sum) => `aldc-verify: compila (BC ${bc}, ${who}). ${sum}.`,
    incomplete: (status, listed) => `aldc-verify: verificación incompleta (${status}).\n${listed}`,
    releasedMax: (who, max, listed) => `aldc-verify: ${who} sigue sin compilar tras ${max} intentos; dejo parar. Errores pendientes:\n${listed}`,
    blocked: (bc, who, attempt, max, listed) =>
      `aldc-verify: la compilación AL falla (BC ${bc}, ${who}; intento ${attempt}/${max}). ` +
      `Corrige estos errores antes de terminar y no des el trabajo por bueno hasta que compile:\n${listed}\n` +
      'Cuando lo corrijas, termina sin más: este gate vuelve a compilar al parar y te dirá el resultado.\n',
    gateInternal: (m) => `aldc-verify: error interno del gate, no he verificado nada (${m}).`,

    verifyNoProjects: (level, root) => `aldc-verify ${level}: not-run, no hay ningún app.json en ${root}.`,
    verifyNotRun: (level, reason) => `aldc-verify ${level}: not-run, ${reason}.`,
    verifyHeader: (level, bc, ver, unpinned) => `aldc-verify ${level}: BC ${bc}, alc ${ver}${unpinned}`,
    analyzersPart: (n, names, source, ruleset) => ` · ${n} de analizadores [${names}; ${source}${ruleset ? `; ruleset ${ruleset}` : ''}]`,
    projectLine: (mark, name, project, e, cw, l2, s) => `${mark} ${name} (${project}): ${e} errores · ${cw} warnings del compilador${l2} · ${s} s`,
    l2Incomplete: (missing, total, list) => `    ⚠ L2 incompleto: no encuentro ${missing} de ${total} analizadores (${list}) junto a alc`,
    symbolsFrom: (src) => `    símbolos tomados de: ${src}`,
    alcNoDiagShort: '    alc terminó con error sin diagnósticos (ver last-report.json)',
    errorsHeader: (n) => `Errores (${n}):`,
    warningsHeader: (shown, total, per) => `Warnings (primeros ${shown} de ${total}: ${per}):`,
    partialState: 'Estado: partial. L1 vale, pero L2 no se ha ejecutado completo: no digas que los analizadores pasan.',
    fullDetail: (p) => `Detalle completo: ${p}`,
    verifyInternal: (m) => `aldc-verify: error interno, no he verificado nada (${m}).`,

    overlayCommon: 'aldc-verify está activo en este repo: el compilador AL real está disponible y el Stop/SubagentStop hook compila lo que cambies.',
    overlayReviewer: [
      '- Evidencia de build: si existe .claude/.aldc-verify/last-report.json, léelo y cita errores y warnings reales (código, fichero y línea) junto a BCQuality. Si no existe o es anterior a los cambios, di "build: not-run" y pide que se ejecute aldc-verify:al-build-validator.',
      '- No ejecutes nada: tu revisión sigue siendo de solo lectura.',
    ],
    overlayWriter: [
      '- "Verify Build Compiles" / "0 compilation errors": ejecútalo con /aldc-verify:al-verify --l1 (o delega en el agente aldc-verify:al-build-validator) y cita su línea de resultado. Nunca lo declares sin ese resultado.',
      '- TDD RED: "el test compila y describe el comportamiento" (compílalo con /aldc-verify:al-verify --l1). Ejecutar tests necesita BC v28+: si no hay sandbox, dilo como not-run.',
      '- Si las herramientas mcp__al__al_compile / al_build no están disponibles, usa aldc-verify en su lugar.',
      '- Analizadores (L2): /aldc-verify:al-verify sin --l1. Arregla solo los warnings de líneas que hayas cambiado.',
    ],
    overlayConductor: [
      '- Tras cada fase de implementación, lanza el agente aldc-verify:al-build-validator y pega su resultado en el phase-complete. Pásale .claude/.aldc-verify/last-report.json al revisor.',
      '- Para entregar, usa /aldc-verify:al-go: verifica, revisa, hace commit, push y abre la PR en borrador sin esperar a nadie.',
    ],
    overlayPlanner: ['- En los planes, el criterio de "compila" se comprueba con /aldc-verify:al-verify; inclúyelo como paso de verificación de cada fase.'],

    tcTail: (bc, names) => `BC ${bc}, proyectos: ${names}. Compila con /aldc-verify:al-verify; el Stop hook compila lo que cambies.`,
    tcAldc: 'Con ALDC (al-conductor): tras cada fase de implementación lanza aldc-verify:al-build-validator y cita su resultado; para entregar, /aldc-verify:al-go.',
    tcPinnedFrom: 'fijada en .claude/aldc-verify.json',
    tcDefaultFrom: 'por defecto del plugin; fíjala en .claude/aldc-verify.json',
    tcReady: (what) => `aldc-verify: compilador AL listo (${what}).`,
    tcPinned: ', fijado',
    tcUnpinned: ', sin fijar en .claude/aldc-verify.json',
    tcNotRun: (err) => `aldc-verify: not-run, no hay compilador AL: ${err}. No digas que el código compila.`,
    tcInstallFailedUser: (err) => `aldc-verify: no he podido instalar el compilador AL (${err}).`,
    tcInstalled: (ver, from, secs) => `aldc-verify: compilador AL instalado (dotnet tool al ${ver}, ${from}, ${secs} s).`,
    tcInstalledUser: (ver, secs, steps) => `aldc-verify: instalado dotnet tool al ${ver} en ${secs} s (${steps}).`,
    tcNoCompilerContext: (err) => `aldc-verify: not-run, ${err}. No digas que el código compila.`,
    tcNoCompilerUser: (err) => `aldc-verify: sin compilador AL: ${err}.`,
    tcInternal: (m) => `aldc-verify: error interno comprobando el compilador (${m}).`,
    tcNoDotnet: 'no hay dotnet ni apt-get para instalarlo',
    tcAptFailed: (o) => `apt no pudo instalar dotnet8 (${o})`,
    tcUninstalled: (v) => `desinstalado al ${v}`,
    tcToolFailed: (o) => `dotnet tool install falló (${o})`,

    guardMerge: 'el merge de una PR lo decide una persona. Deja la PR abierta e informa.',
    guardForce: 'push forzado o borrado de rama remota. Haz un push normal de una rama claude/... .',
    guardPushDefault: (targets) => `push a la rama por defecto (${targets}). Trabaja en una rama claude/... y abre una PR.`,
    guardOnDefault: (branch) => `estás en ${branch}: crea una rama claude/... antes de hacer push.`,
    guardMassAdd: 'git add masivo. Añade los ficheros uno a uno por su ruta.',
    guardProtected: (a, hit) => `${a} está en una carpeta protegida (${hit}): datos que nunca deben entrar en git.`,
    guardCommitA: 'git commit -a. Añade los ficheros uno a uno y haz commit sin -a.',

    initNoProjects: (root) => `aldc-verify init: not-run, no hay ningún app.json en ${root}.`,
    initPinnedSource: 'fijado en .claude/aldc-verify.json',
    initDetectedSource: 'detectado; se fijará',
    initExists: 'ya existe',
    initInvalidJson: 'no es JSON válido; no lo toco',
    initHasAll: 'ya tiene todo',
    initClaudeMdExists: 'ya existe; usa /aldc-verify:al-learn para añadir reglas',
    initGitignoreHas: 'ya ignora .claude/.aldc-verify/',
    initNoSymbolsCi: 'el repo no versiona símbolos en .alpackages; la CI no podría compilar',
    initHeader: (dry, root) => `aldc-verify init${dry ? ' (dry-run)' : ''}: ${root}`,
    initSummary: (repo, bc, projects, ext, tool, source, plans, branch) =>
      `${repo} · BC ${bc} · proyectos: ${projects} · alExtension ${ext} · alTool ${tool} (${source}) · planes ${plans} · rama ${branch}`,
    initInternal: (m) => `aldc-verify init: error interno (${m}).`,
  },
};

function normalize(v) {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  return /^es\b|^es[-_]/i.test(String(v).trim()) ? 'es' : 'en';
}

function systemLocale() {
  try { return Intl.DateTimeFormat().resolvedOptions().locale || ''; } catch { return ''; }
}

// Pure resolution, exported for tests: config wins, then env, then locale.
function resolveLanguage({ config, env, locale } = {}) {
  return normalize(config) || normalize(env) || (/^es\b|^es[-_]/i.test(String(locale || '')) ? 'es' : 'en');
}

function configLanguage(root) {
  try {
    const raw = fs.readFileSync(path.join(root, '.claude', 'aldc-verify.json'), 'utf8').replace(/^﻿/, '');
    return JSON.parse(raw).language;
  } catch { return undefined; }
}

let current = null;

// Set the language for this process from the repo at `root` (call once per script).
function init(root) {
  current = resolveLanguage({ config: root ? configLanguage(root) : undefined, env: process.env.ALDC_VERIFY_LANG, locale: systemLocale() });
  return current;
}

function lang() {
  return current || init(null);
}

// t('key', ...args): a string, or the result of the message function.
function t(key, ...args) {
  const table = M[lang()];
  const m = key in table ? table[key] : M.en[key];
  if (m === undefined) return key;
  return typeof m === 'function' ? m(...args) : m;
}

module.exports = { t, init, lang, resolveLanguage, systemLocale, MESSAGES: M };
