# aldc-verify

[English](#english) · [Español](#español)

## English

### What it is

aldc-verify is a Claude Code plugin for Business Central AL developers. It makes Claude **verify its own AL work**: it compiles your projects with the real AL compiler (L1), runs the code analyzers (L2), and a Stop hook does not let Claude end a turn with compile errors it introduced. Agents can also deliver on their own (commit file by file, push a `claude/…` branch, open a draft PR) behind a guard that refuses merges, force pushes and pushes to the default branch.

It works on its own. [ALDC](https://github.com/javiarmesto/ALDC-AL-Development-Collection) is an optional integration, not a requirement.

`L1 compile · L2 analyzers` · `Stop gate · guard` · `Windows · Linux/cloud · GitHub Actions` · `MIT`

### Requirements

- **Claude Code** (CLI, desktop or claude.ai/code).
- **Node.js** 20 or later (the hooks are plain Node scripts, no dependencies).
- **An AL compiler**, one of:
  - Windows: `alc.exe` from the **AL Language extension for VS Code** (`ms-dynamics-smb.al-<version>`); the plugin finds it under `~/.vscode*/extensions`.
  - Any platform: the cross-platform **`al` dotnet tool** (`Microsoft.Dynamics.BusinessCentral.Development.Tools`). On Linux (cloud sessions) the plugin installs dotnet 8 and the pinned tool version itself.
- **Symbols** in each project's `.alpackages` (or VS Code's `al.packageCachePath`). Without them the result is not-run, never a false green.

### Install and update

```bash
claude plugin marketplace add javiarmesto/aldc-verify-plugin
claude plugin install aldc-verify@aldc-verify-dev
```

To move to a new version, update the marketplace and the plugin, then restart Claude Code:

```bash
claude plugin marketplace update aldc-verify-dev
claude plugin update aldc-verify@aldc-verify-dev
```

- **Cloud sessions (claude.ai/code):** the repo's `.claude/settings.json` does not install plugins in cloud or headless (`claude -p`) sessions. Put the two install lines in the environment's **setup script**. It only runs in new sessions, not in sessions resumed from cache.
- **Per repo:** `/aldc-verify:init` adds `extraKnownMarketplaces` and `enabledPlugins` to `.claude/settings.json`, so interactive sessions offer the plugin after the project is trusted.
- **Try a local copy without installing it:** `claude --plugin-dir <path-to-plugin>` (also works with `-p`).

### What happens in a session

The plugin registers six hooks. They only act in repos with at least one `app.json`. The key idea is the **fingerprint**: a hash of the `.al` files, the `app.json` files, the resources and the symbol list, taken when the turn starts and compared when it ends. If Claude did not touch AL, nothing is compiled.

| Hook | Script | What it does |
|---|---|---|
| SessionStart | `ensure-al-toolchain.js` | Finds the compiler (Windows/macOS: detect only; Linux: installs dotnet 8 and the pinned `al` tool). Gives Claude one line of context: compiler, BC version, projects. Mentions the ALDC flow only when ALDC is present. |
| UserPromptSubmit | `al-verify-baseline.js` | Stores the fingerprint at the start of each turn. Prints nothing. |
| PreToolUse (Bash, PowerShell) | `guard.js` | Denies `git`/`gh` commands that cannot be undone (see [Guard](#guard)). |
| SubagentStart (`aldc:*`) | `aldc-overlay.js` | Tells each ALDC subagent how to verify with aldc-verify. Never fires without ALDC. |
| SubagentStop (implement, developer, builder) | `al-verify-gate.js` | Same gate as Stop, for code-writing subagents, each with its own attempt counter. |
| Stop | `al-verify-gate.js` | The gate (below). |

**The Stop gate:**

1. No `app.json` in the repo: exit.
2. Fingerprint unchanged since the turn started: exit without compiling, even if the tree is red. What was already broken is not a reason to block.
3. Fingerprint equal to the last green build: exit (about 0.2 s).
4. Otherwise compile every project in dependency order (App before Test), each with a filtered symbol cache: Microsoft symbols of the target BC major; in-repo apps replaced by the fresh build.
5. Errors: `exit 2` with up to 40 diagnostics on stderr, so Claude keeps fixing. The message asks Claude to confirm with `/aldc-verify:al-verify --l1`, because only the user sees the gate's final green.
6. After `maxAttempts` (3) blocks in a row, or when Claude changes nothing after a block, it lets Claude stop and shows the pending errors. If the build turns green after a block, it tells Claude once, so the final answer cites it.
7. No compiler, missing symbols, or `alc` failing without diagnostics: `not-run` or `incomplete verification`, and it **never blocks**.

**Concurrency:** compiles of the same repo run one at a time, with a lock in `.claude/.aldc-verify/compile.lock` (waits up to 5 minutes, cleans orphaned locks). Each run uses its own cache under `run/`, deleted at the end.

### Commands

| Command | Who runs it | What it does | Effects |
|---|---|---|---|
| `/aldc-verify:al-verify [--l1] [--project <name>]` | You or Claude | L1 compile + L2 analyzers (CodeCop, UICop, PerTenantExtensionCop by default), a short summary grouped by code, full detail in `.claude/.aldc-verify/last-report.json`. Exit `0` no errors, `1` errors, `3` not-run. When you run it, it only reports; when Claude runs it during a task, Claude fixes errors in code it changed. | none |
| Agent `aldc-verify:al-build-validator` | Claude (or ALDC) | Subagent that compiles and returns the errors grouped by root cause, with a proposed fix. Read-only: compiler output never reaches the main context. | none |
| `/aldc-verify:al-go [slug] [--no-review]` | Claude or you | Verify → BCQuality review if installed → version bump if the repo rules ask for it → commit file by file → push a `claude/…` branch → draft PR. It does not stop to ask. It **never merges** and never marks the PR ready: a person reviews it. | commit · push · PR |
| `/aldc-verify:al-learn [lesson]` | You or Claude | After a correction, proposes **one** line for the repo's `CLAUDE.md` and writes it only if you say yes. | edits CLAUDE.md on yes |
| `/aldc-verify:init` | Only you | Applies the layer to a repo without overwriting anything: `.claude/aldc-verify.json`, `.claude/settings.json` (adds missing keys only), `CLAUDE.md`, the `.gitignore` line and the CI workflow. Dry run first. | creates files |

**Analyzers**, per project, in this order: `analyzers` and `ruleset` in `.claude/aldc-verify.json`; then `al.codeAnalyzers` and `al.ruleSetPath` from the project's `.vscode/settings.json`; then CodeCop, UICop and PerTenantExtensionCop (PTE apps, so no AppSourceCop). Warnings never block; a rule raised to `Error` in a ruleset does.

### Guard

The guard replaces human supervision for what cannot be undone. It acts on the `git` and `gh` commands Claude runs through Bash or PowerShell, only in AL repos. When it denies a command, Claude gets the reason and an alternative. Everything else goes through.

| Command | What it tells Claude |
|---|---|
| `gh pr merge` | Merging a PR is a person's decision. Leave the PR open and report. |
| `git push -f`, `--force`, `--force-with-lease`, `--force-if-includes`, `--mirror`, `--delete`, `-d`, `+ref` | Forced push or remote branch deletion. Do a normal push of a `claude/…` branch. |
| `git push` to `main`, `master`, `dev`, `develop` (also a push with no target while on one of them) | Work on a `claude/…` branch and open a PR. |
| `git add -A`, `--all`, `.`, `:/`, `*` | Add the files one by one by path. |
| `git commit -a`, `--all`, `-am` | Add the files one by one and commit without `-a`. |
| `git add` of a path in `guard.protectedPaths` | Those folders hold data that must never be committed. |

```jsonc
// .claude/aldc-verify.json
{
  "guard": { "protectedPaths": ["data/real-exports"] }
}
// "guard": false  turns the guard off in this repo
```

### Configuration

Everything is optional. Per repo, in `.claude/aldc-verify.json` (`/aldc-verify:init` creates it):

```json
{
  "bcMajor": 27,
  "compiler": { "alExtension": "18.0", "alTool": "18.1.43.24897" },
  "maxAttempts": 3,
  "language": "en"
}
```

| Key | Meaning |
|---|---|
| `bcMajor` | Target BC major version. Default: the main app's `application` (the first project in dependency order). |
| `compiler.alExtension` | Version prefix of the VS Code AL extension (`ms-dynamics-smb.al-<ver>`). If the pinned version is not installed the result is not-run; it never falls back silently. |
| `compiler.alTool` | Version of the `al` dotnet tool (cloud and Linux; default `18.1.43.24897`). |
| `compiler.path` | Explicit path to `alc`. The environment variable `ALDC_VERIFY_ALC` does the same. |
| `maxAttempts` | Blocks in a row before the gate lets Claude stop (default 3). |
| `analyzers`, `ruleset` | L2 analyzers (names such as `CodeCop` or DLL paths) and ruleset path, overriding `.vscode/settings.json`. |
| `guard` | `false` to turn the guard off, or `{ "protectedPaths": [...] }`. |
| `language` | `"en"` or `"es"` for the plugin's messages. |

**Language of the messages:** English by default. Spanish when `"language": "es"` is set here; otherwise when the environment variable `ALDC_VERIFY_LANG=es` is set; otherwise when the system locale starts with `es`. The repo setting wins over the variable, and the variable over the locale.

Without any pin, the plugin uses the highest AL extension installed and says so ("not pinned").

### CI template

`/aldc-verify:init` adds `.github/workflows/al-compile.yml` (from `templates/github/al-compile.yml`) when the repo versions its symbols in `.alpackages`; without versioned symbols CI could not compile, so it is skipped. The workflow runs on ubuntu-latest: installs dotnet 8 and the `al` tool at the version in `.claude/aldc-verify.json`, clones this plugin at the tag of the installed version, and runs `scripts/al-verify.js`. Only exit `0` passes. The summary goes to the step summary and `last-report.json` is uploaded as an artifact.

### Optional integration with ALDC

[ALDC (AL Development Collection)](https://github.com/javiarmesto/ALDC-AL-Development-Collection) is a separate plugin with agents for planning, implementing and reviewing AL. aldc-verify does not need it. When both are installed, their hooks stay independent and aldc-verify adds two things:

- **SessionStart** reminds Claude of the ALDC conductor flow (validate each phase with `al-build-validator`, deliver with `/al-go`). This line only appears when an `aldc@…` plugin is installed or the project has `aldc.yaml`.
- **SubagentStart overlay**: when an `aldc:*` subagent starts in an AL repo, it gets a few lines by role, without changing the ALDC plugin:

| Role | Subagents | What it gets |
|---|---|---|
| Write code | implement, developer, agent-builder | "Compiles" is checked with `/aldc-verify:al-verify --l1` (or `al-build-validator`) and the result is cited. In TDD, RED means "the test compiles and describes the behaviour". Running tests needs a BC v28+ sandbox; without one it is not-run. |
| Review | review, dredd, triage | Cite real errors and warnings from `last-report.json` next to BCQuality, or write "build: not-run". Still read-only. |
| Conductor | conductor | Validates each phase with `al-build-validator` and delivers with `/aldc-verify:al-go`. |
| Plan | planning, architect, spec, presales | Include the "compiles" check in each phase of the plan. |

### Troubleshooting

| Symptom | What to check |
|---|---|
| Something odd in the gate | Set `ALDC_VERIFY_DEBUG=1` before starting Claude Code (`export ALDC_VERIFY_DEBUG=1`, or `$env:ALDC_VERIFY_DEBUG=1` in PowerShell): the gate writes traces to stderr. |
| How many times did it block? | `.claude/.aldc-verify/state.json` keeps a `history` of the last 20 events (`blocked`, `released`, `green`, `not-run`, with `attempt` and `errorCodes`). |
| Full diagnostics | `.claude/.aldc-verify/last-report.json`, written by every `/al-verify`. |
| `not-run` | No compiler, the pinned version is not installed, or no symbols. The message says which. Nothing can be taken as compiled. |
| "not pinned" | The repo has no compiler pin: run `/aldc-verify:init` or add `compiler` to `.claude/aldc-verify.json`. |
| Plugin missing in a cloud session | Add the install lines to the environment's setup script (see [Install and update](#install-and-update)). |

The state folder `.claude/.aldc-verify/` writes its own `.gitignore` with `*`, so it never dirties a repo; adding it to the repo's `.gitignore` is still recommended (`init` does it).

### Tests

The plugin has its own automated tests in `tests/`, written with `node:test` and no dependencies. They need neither an AL compiler nor symbols: they cover the guard classification, the overlay per role (and its silence outside AL repos), the language selection, the SessionStart ALDC mention with and without ALDC, and the Stop gate's fast paths.

```bash
node --test tests/
# or
npm test
```

GitHub Actions runs them on ubuntu-latest and windows-latest with Node 20 and 22 (`.github/workflows/test.yml`).

Beyond the unit tests, the plugin has been tested by hand on a real BC 27 App + Test project and a BC 28 project, on Windows and in a Linux cloud session: cold and warm compiles, a known regression blocked three times and then released, a pinned compiler that is not installed (not-run), concurrent compiles under the lock, git worktrees without `.alpackages`, real `claude -p` sessions where Claude fixed the errors the gate reported, the guard denying mass `git add` from both Bash and PowerShell, and `/al-go` delivering against a local remote. Not tested yet: opening the PR from `/al-go` against GitHub, and the `al-compile.yml` template on GitHub Actions.

### Licence

[MIT](LICENSE) © 2026 Javier Armesto. Changes are listed in [CHANGELOG.md](CHANGELOG.md).

---

## Español

### Qué es

aldc-verify es un plugin de Claude Code para quien desarrolla en AL para Business Central. Hace que Claude **verifique su propio trabajo en AL**: compila tus proyectos con el compilador AL real (L1), pasa los analizadores de código (L2) y un Stop hook no deja a Claude terminar un turno con errores de compilación que él mismo ha introducido. Los agentes también pueden entregar solos (commit fichero a fichero, push de una rama `claude/…` y PR en borrador), con un guard que rechaza los merges, los push forzados y los push a la rama por defecto.

Funciona por sí solo. [ALDC](https://github.com/javiarmesto/ALDC-AL-Development-Collection) es una integración opcional, no un requisito.

`L1 compilar · L2 analizadores` · `Stop gate · guard` · `Windows · Linux/nube · GitHub Actions` · `MIT`

### Requisitos

- **Claude Code** (CLI, escritorio o claude.ai/code).
- **Node.js** 20 o superior (los hooks son scripts de Node sin dependencias).
- **Un compilador AL**, uno de estos:
  - Windows: `alc.exe` de la **extensión AL Language de VS Code** (`ms-dynamics-smb.al-<versión>`); el plugin lo busca en `~/.vscode*/extensions`.
  - Cualquier plataforma: la **herramienta dotnet `al`** multiplataforma (`Microsoft.Dynamics.BusinessCentral.Development.Tools`). En Linux (sesiones en la nube) el plugin instala él mismo dotnet 8 y la versión fijada de la herramienta.
- **Símbolos** en el `.alpackages` de cada proyecto (o en `al.packageCachePath` de VS Code). Sin ellos el resultado es not-run, nunca un falso verde.

### Instalar y actualizar

```bash
claude plugin marketplace add javiarmesto/aldc-verify-plugin
claude plugin install aldc-verify@aldc-verify-dev
```

Para pasar a una versión nueva, actualiza el marketplace y el plugin, y reinicia Claude Code:

```bash
claude plugin marketplace update aldc-verify-dev
claude plugin update aldc-verify@aldc-verify-dev
```

- **Sesiones en la nube (claude.ai/code):** el `.claude/settings.json` del repo no instala plugins en la nube ni en modo headless (`claude -p`). Pon las dos líneas de instalación en el **setup script** del entorno. Solo se ejecuta en sesiones nuevas, no en las reanudadas desde caché.
- **Por repo:** `/aldc-verify:init` añade `extraKnownMarketplaces` y `enabledPlugins` al `.claude/settings.json`, así que las sesiones interactivas ofrecen el plugin tras aceptar la confianza del proyecto.
- **Probar una copia local sin instalarla:** `claude --plugin-dir <ruta-al-plugin>` (vale también con `-p`).

### Qué pasa en una sesión

El plugin registra seis hooks. Solo actúan en repos con al menos un `app.json`. La idea clave es la **huella**: un hash de los `.al`, los `app.json`, los recursos y la lista de símbolos, que se toma al empezar el turno y se compara al terminar. Si Claude no ha tocado AL, no se compila nada.

| Hook | Script | Qué hace |
|---|---|---|
| SessionStart | `ensure-al-toolchain.js` | Busca el compilador (Windows/macOS: solo detecta; Linux: instala dotnet 8 y la herramienta `al` fijada). Le da a Claude una línea de contexto: compilador, versión de BC y proyectos. Solo menciona el flujo de ALDC cuando ALDC está presente. |
| UserPromptSubmit | `al-verify-baseline.js` | Guarda la huella al empezar cada turno. No imprime nada. |
| PreToolUse (Bash, PowerShell) | `guard.js` | Deniega los comandos `git`/`gh` que no tienen vuelta atrás (ver [Guard](#guard-1)). |
| SubagentStart (`aldc:*`) | `aldc-overlay.js` | Explica a cada subagente de ALDC cómo verificar con aldc-verify. Sin ALDC nunca se dispara. |
| SubagentStop (implement, developer, builder) | `al-verify-gate.js` | El mismo gate que Stop, para los subagentes que escriben código, cada uno con su propio contador. |
| Stop | `al-verify-gate.js` | El gate (abajo). |

**El Stop gate:**

1. Si el repo no tiene ningún `app.json`, sale.
2. Si la huella no ha cambiado desde el inicio del turno, sale sin compilar, aunque el árbol esté rojo. Lo que ya estaba roto no es motivo para bloquear.
3. Si la huella coincide con la del último build verde, sale (unos 0,2 s).
4. Si no, compila todos los proyectos en orden de dependencias (App antes que Test), cada uno con una caché de símbolos filtrada: símbolos de Microsoft de la versión mayor de BC objetivo; las apps del propio repo se sustituyen por la recién compilada.
5. Con errores, `exit 2` y hasta 40 diagnósticos por stderr, así que Claude sigue corrigiendo. El mensaje le pide confirmar con `/aldc-verify:al-verify --l1`, porque el verde final del gate solo lo ve el usuario.
6. Tras `maxAttempts` (3) bloqueos seguidos, o si Claude no cambia nada tras un bloqueo, deja parar y muestra los errores pendientes. Si se pone en verde después de bloquear, se lo dice a Claude una vez, para que su respuesta final lo cite.
7. Sin compilador, sin símbolos o si `alc` falla sin diagnósticos: `not-run` o `verificación incompleta`, y **nunca bloquea**.

**Concurrencia:** las compilaciones de un mismo repo van de una en una, con un lock en `.claude/.aldc-verify/compile.lock` (espera hasta 5 minutos y limpia los locks huérfanos). Cada ejecución usa su propia caché en `run/`, que se borra al terminar.

### Comandos

| Comando | Quién lo lanza | Qué hace | Efectos |
|---|---|---|---|
| `/aldc-verify:al-verify [--l1] [--project <nombre>]` | Tú o Claude | Compila (L1) y pasa los analizadores (L2; por defecto CodeCop, UICop y PerTenantExtensionCop), con un resumen corto agrupado por código y el detalle en `.claude/.aldc-verify/last-report.json`. Exit `0` sin errores, `1` errores, `3` not-run. Si lo lanzas tú, solo informa; si lo lanza Claude durante una tarea, corrige los errores del código que ha cambiado. | ninguno |
| Agente `aldc-verify:al-build-validator` | Claude (o ALDC) | Subagente que compila y devuelve los errores agrupados por causa, con un arreglo propuesto. Solo lectura: la salida del compilador no llega al contexto principal. | ninguno |
| `/aldc-verify:al-go [slug] [--no-review]` | Claude o tú | Verifica → revisión BCQuality si está instalada → sube la versión si las reglas del repo lo piden → commit fichero a fichero → push de una rama `claude/…` → PR en borrador. No para a preguntar. **Nunca mergea** ni marca la PR como lista: la revisa una persona. | commit · push · PR |
| `/aldc-verify:al-learn [lección]` | Tú o Claude | Tras una corrección, propone **una** línea para el `CLAUDE.md` del repo y solo la escribe si dices que sí. | edita CLAUDE.md si dices sí |
| `/aldc-verify:init` | Solo tú | Aplica la capa a un repo sin pisar nada: `.claude/aldc-verify.json`, `.claude/settings.json` (solo añade lo que falta), `CLAUDE.md`, la línea del `.gitignore` y la CI. Primero hace un dry-run. | crea ficheros |

**Analizadores**, por proyecto y en este orden: `analyzers` y `ruleset` de `.claude/aldc-verify.json`; después `al.codeAnalyzers` y `al.ruleSetPath` del `.vscode/settings.json` del proyecto; y si no, CodeCop, UICop y PerTenantExtensionCop (apps PTE, así que AppSourceCop no). Los warnings nunca bloquean; una regla subida a `Error` en un ruleset sí.

### Guard

El guard sustituye la supervisión humana en lo que no tiene vuelta atrás. Actúa sobre los comandos `git` y `gh` que Claude lanza por Bash o PowerShell, y solo en repos AL. Cuando deniega un comando, Claude recibe el motivo y una alternativa. Todo lo demás pasa.

| Comando | Qué le dice a Claude |
|---|---|
| `gh pr merge` | El merge de una PR lo decide una persona. Deja la PR abierta e informa. |
| `git push -f`, `--force`, `--force-with-lease`, `--force-if-includes`, `--mirror`, `--delete`, `-d`, `+ref` | Push forzado o borrado de rama remota. Haz un push normal de una rama `claude/…`. |
| `git push` a `main`, `master`, `dev`, `develop` (también un push sin destino estando en una de ellas) | Trabaja en una rama `claude/…` y abre una PR. |
| `git add -A`, `--all`, `.`, `:/`, `*` | Añade los ficheros uno a uno por su ruta. |
| `git commit -a`, `--all`, `-am` | Añade los ficheros uno a uno y haz commit sin `-a`. |
| `git add` de una ruta de `guard.protectedPaths` | Esas carpetas guardan datos que nunca deben entrar en git. |

```jsonc
// .claude/aldc-verify.json
{
  "guard": { "protectedPaths": ["data/real-exports"] }
}
// "guard": false  apaga el guard en este repo
```

### Configuración

Todo es opcional. Por repo, en `.claude/aldc-verify.json` (lo crea `/aldc-verify:init`):

```json
{
  "bcMajor": 27,
  "compiler": { "alExtension": "18.0", "alTool": "18.1.43.24897" },
  "maxAttempts": 3,
  "language": "es"
}
```

| Clave | Significado |
|---|---|
| `bcMajor` | Versión mayor de BC objetivo. Por defecto, la `application` de la app principal (el primer proyecto en orden de dependencias). |
| `compiler.alExtension` | Prefijo de versión de la extensión AL de VS Code (`ms-dynamics-smb.al-<ver>`). Si la versión fijada no está instalada, el resultado es not-run; nunca cae a otra en silencio. |
| `compiler.alTool` | Versión de la herramienta dotnet `al` (nube y Linux; por defecto `18.1.43.24897`). |
| `compiler.path` | Ruta explícita a `alc`. La variable de entorno `ALDC_VERIFY_ALC` hace lo mismo. |
| `maxAttempts` | Bloqueos seguidos antes de que el gate deje parar a Claude (por defecto 3). |
| `analyzers`, `ruleset` | Analizadores de L2 (nombres como `CodeCop` o rutas a la DLL) y ruta del ruleset; tienen prioridad sobre `.vscode/settings.json`. |
| `guard` | `false` para apagar el guard, o `{ "protectedPaths": [...] }`. |
| `language` | `"en"` o `"es"` para los mensajes del plugin. |

**Idioma de los mensajes:** inglés por defecto. Castellano si aquí pones `"language": "es"`; si no, si la variable de entorno `ALDC_VERIFY_LANG=es` está definida; y si no, si el locale del sistema empieza por `es`. El ajuste del repo gana a la variable, y la variable al locale.

Sin nada fijado, el plugin usa la extensión AL más alta instalada y lo indica ("sin fijar").

### Plantilla de CI

`/aldc-verify:init` añade `.github/workflows/al-compile.yml` (de `templates/github/al-compile.yml`) cuando el repo versiona sus símbolos en `.alpackages`; sin símbolos versionados la CI no podría compilar, así que la omite. El workflow corre en ubuntu-latest: instala dotnet 8 y la herramienta `al` en la versión de `.claude/aldc-verify.json`, clona este plugin en el tag de la versión instalada y ejecuta `scripts/al-verify.js`. Solo pasa con exit `0`. El resumen va al step summary y `last-report.json` se sube como artefacto.

### Integración opcional con ALDC

[ALDC (AL Development Collection)](https://github.com/javiarmesto/ALDC-AL-Development-Collection) es un plugin aparte con agentes para planificar, implementar y revisar AL. aldc-verify no lo necesita. Con los dos instalados, sus hooks siguen siendo independientes y aldc-verify añade dos cosas:

- **SessionStart** le recuerda a Claude el flujo del conductor de ALDC (validar cada fase con `al-build-validator` y entregar con `/al-go`). Esta línea solo aparece si hay un plugin `aldc@…` instalado o el proyecto tiene `aldc.yaml`.
- **Overlay en SubagentStart**: cuando arranca un subagente `aldc:*` en un repo AL, recibe unas líneas según su rol, sin tocar el plugin de ALDC:

| Rol | Subagentes | Qué recibe |
|---|---|---|
| Escriben código | implement, developer, agent-builder | «Compila» se comprueba con `/aldc-verify:al-verify --l1` (o con `al-build-validator`) y se cita el resultado. En TDD, RED es «el test compila y describe el comportamiento». Ejecutar tests necesita un sandbox BC v28+; si no hay, es not-run. |
| Revisan | review, dredd, triage | Citan los errores y warnings reales de `last-report.json` junto a BCQuality, o escriben «build: not-run». Siguen siendo de solo lectura. |
| Conductor | conductor | Valida cada fase con `al-build-validator` y entrega con `/aldc-verify:al-go`. |
| Planifican | planning, architect, spec, presales | Incluyen la comprobación de «compila» en cada fase del plan. |

### Problemas frecuentes

| Síntoma | Qué mirar |
|---|---|
| El gate hace algo raro | Define `ALDC_VERIFY_DEBUG=1` antes de abrir Claude Code (`export ALDC_VERIFY_DEBUG=1`, o `$env:ALDC_VERIFY_DEBUG=1` en PowerShell): el gate escribe trazas por stderr. |
| ¿Cuántas veces ha bloqueado? | `.claude/.aldc-verify/state.json` guarda un `history` con los últimos 20 eventos (`blocked`, `released`, `green`, `not-run`, con `attempt` y `errorCodes`). |
| Diagnósticos completos | `.claude/.aldc-verify/last-report.json`, que escribe cada `/al-verify`. |
| `not-run` | No hay compilador, la versión fijada no está instalada o faltan símbolos. El mensaje dice cuál. No hay nada que dar por compilado. |
| «sin fijar» | El repo no tiene el compilador fijado: ejecuta `/aldc-verify:init` o añade `compiler` a `.claude/aldc-verify.json`. |
| Falta el plugin en una sesión en la nube | Añade las líneas de instalación al setup script del entorno (ver [Instalar y actualizar](#instalar-y-actualizar)). |

La carpeta de estado `.claude/.aldc-verify/` crea su propio `.gitignore` con `*`, así que nunca ensucia un repo; aun así conviene añadirla al `.gitignore` del repo (`init` lo hace).

### Tests

El plugin tiene sus propios tests automáticos en `tests/`, escritos con `node:test` y sin dependencias. No necesitan compilador AL ni símbolos: cubren la clasificación del guard, el overlay por rol (y su silencio fuera de repos AL), la elección de idioma, la mención de ALDC en SessionStart con y sin ALDC, y las salidas rápidas del Stop gate.

```bash
node --test tests/
# o
npm test
```

GitHub Actions los ejecuta en ubuntu-latest y windows-latest con Node 20 y 22 (`.github/workflows/test.yml`).

Además de los tests unitarios, el plugin se ha probado a mano en un proyecto real de BC 27 con App + Test y en un proyecto de BC 28, en Windows y en una sesión Linux en la nube: compilaciones en frío y en caliente, una regresión conocida que bloquea tres veces y luego suelta, un compilador fijado que no está instalado (not-run), compilaciones concurrentes con el lock, worktrees de git sin `.alpackages`, sesiones reales de `claude -p` en las que Claude corrigió los errores que le dio el gate, el guard denegando `git add` masivo desde Bash y desde PowerShell, y `/al-go` entregando contra un remoto local. Sin probar todavía: la apertura de la PR desde `/al-go` contra GitHub y la plantilla `al-compile.yml` en GitHub Actions.

### Licencia

[MIT](LICENSE) © 2026 Javier Armesto. Los cambios están en [CHANGELOG.md](CHANGELOG.md).
