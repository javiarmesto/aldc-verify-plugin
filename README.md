# aldc-verify (personal)

Plugin personal de Claude Code para que el agente **verifique su propio trabajo en AL**: compilar, analizadores y un Stop hook que no le deja terminar con errores. Es independiente de `aldc`; más adelante se decide si se integra.

## Instalación

```bash
claude plugin marketplace add javiarmesto/aldc-verify-plugin
claude plugin install aldc-verify@aldc-verify-dev
```

**En entornos cloud** (claude.ai/code): una sesión cloud arranca en su propia rama y `claude -p` no registra `extraKnownMarketplaces` (CLI 2.1.300, comprobado el 15/10/2026). Lo que funciona es añadir al **setup script del entorno**:

```bash
claude plugin marketplace add javiarmesto/aldc-verify-plugin && claude plugin install aldc-verify@aldc-verify-dev
```

Tarda unos 2 s. Después, el SessionStart instala dotnet8 y `al` (unos 22 s la primera vez y 50 ms en caliente).

- El setup script solo se ejecuta en sesiones **nuevas**. Una sesión reanudada desde caché (`has_init_script:false`) no lo ejecuta.
- El `.claude/settings.json` del repo no basta en headless ni en cloud: hace falta el setup script.
- Para probar una copia local del plugin sin instalarla: `claude --plugin-dir <ruta-al-plugin>` (vale también con `-p`).

También se puede activar por repo en `.claude/settings.json`. Con esto en modo interactivo se ofrece instalarlo tras aceptar la confianza del proyecto (sin verificar); en headless y en cloud, no:

```json
{
  "extraKnownMarketplaces": { "aldc-verify-dev": { "source": { "source": "github", "repo": "javiarmesto/aldc-verify-plugin" } } },
  "enabledPlugins": { "aldc-verify@aldc-verify-dev": true }
}
```

## Estado

v0.2.2: la fase 1 completa, probada en dos repos (BC 27 y BC 28).

| Pieza | Qué hace |
|---|---|
| SessionStart | Asegura el compilador AL: lo detecta en Windows y lo instala en la nube |
| UserPromptSubmit | Guarda la huella del árbol al empezar cada turno |
| Stop / **SubagentStop** | Compilan lo que cambió en el turno y bloquean con errores. SubagentStop solo actúa en los subagentes que escriben código (`implement`, `developer`, `builder`) y cada uno lleva su propio contador |
| `/aldc-verify:al-verify` | L1+L2 bajo demanda. Si lo lanza el usuario, solo informa |
| Agente `aldc-verify:al-build-validator` | Compila y devuelve los errores agrupados por causa, con un arreglo propuesto. Solo lectura: la salida de alc no llega al contexto principal |
| `/aldc-verify:al-go` | verify → revisión BCQuality (si está instalada) → commit fichero a fichero → push → PR en borrador. Solo lo lanza el usuario |
| `/aldc-verify:al-learn` | Tras una corrección, propone **una** línea para el `CLAUDE.md` del repo y solo la escribe si dices que sí |
| `/aldc-verify:init` | Aplica la capa sin pisar nada: `aldc-verify.json`, `settings.json` (solo añade lo que falta), `CLAUDE.md`, la línea del `.gitignore` y la CI. Primero muestra un dry-run |

**Concurrencia:** las compilaciones de un mismo repo van de una en una, con un lock en `.claude/.aldc-verify/compile.lock` que espera hasta 5 minutos y limpia los locks huérfanos. Cada ejecución usa su propia caché en `run/`, que se borra al terminar. Si dos `alc` compilan el mismo proyecto a la vez, chocan y fallan sin dar diagnósticos.

## Stop gate

`hooks/hooks.json` → `node scripts/al-verify-gate.js`. Cuando Claude va a terminar:

1. Si el repo no tiene ningún `app.json`, sale.
2. **UserPromptSubmit** (`al-verify-baseline.js`) guarda la huella del árbol al empezar cada turno. Si al parar la huella no ha cambiado, Claude no ha tocado AL en ese turno: el gate sale sin compilar, aunque el árbol esté rojo. Lo que ya estaba roto no es motivo para bloquear.
3. Calcula una huella con el contenido de los `.al`, los `app.json`, los recursos y la lista de símbolos. Si coincide con la del último build verde, sale (≈0,2 s).
4. Si no coincide, compila todos los proyectos en orden de dependencias (App antes que Test). Cada proyecto usa un package cache filtrado en `.claude/.aldc-verify/cache/`:
   - Símbolos Microsoft: la versión mayor de BC objetivo si existe; si no, la que haya.
   - Apps del propio repo: se descartan los símbolos viejos y se usa la `.app` recién compilada.
5. Con errores, `exit 2` y la lista por stderr (como mucho 40). Claude sigue corrigiendo. El mensaje le pide confirmar con `/aldc-verify:al-verify --l1` y citar el resultado, porque el verde final del gate solo lo ve el usuario, no el modelo.
6. Si tras `maxAttempts` (3) bloqueos seguidos sigue rojo, deja parar y avisa al usuario con los errores pendientes. Una vez dado ese resumen, mientras el árbol no cambie no vuelve a compilar (`releasedFp`). El contador se reinicia en cada parada nueva (`stop_hook_active=false`).
7. Si no hay compilador, faltan símbolos o alc falla sin dar diagnósticos, muestra `not-run` o `verificación incompleta` y **no bloquea**.

`state.json` guarda un `history` con los últimos 20 eventos (`blocked`, `released`, `green`, `not-run`…, con `attempt` y `errorCodes`), para auditar cuántas veces bloqueó. El estado y la caché van en `.claude/.aldc-verify/`. Esa carpeta crea su propio `.gitignore` con `*`, así que no ensucia ningún repo aunque este no la ignore. Aun así, conviene añadirla al `.gitignore` del repo.

### Configuración por repo: `.claude/aldc-verify.json` (opcional)

```json
{
  "bcMajor": 27,
  "compiler": { "alExtension": "18.0" },
  "maxAttempts": 3
}
```

- `bcMajor`: versión mayor de BC del cliente. Por defecto, la menor de `application` en los `app.json`.
- `compiler.alExtension`: prefijo de versión de la extensión AL de VS Code (`ms-dynamics-smb.al-<ver>`). Si la versión fijada no está instalada, da `not-run`; no cae a otra en silencio.
- `compiler.alTool`: versión de la herramienta dotnet `al` (nube y Linux).
- `compiler.path`: ruta explícita a `alc`. También vale la variable de entorno `ALDC_VERIFY_ALC`.
- Sin nada fijado, usa la extensión AL más alta instalada y lo indica en el mensaje: "sin fijar".

## Plantillas (`templates/`)

- `CLAUDE.md`: reglas que no se negocian, cómo compilar, warnings conocidos, dónde están los planes y una sección `## Aprendido` para `/al-learn`. Menos de 200 líneas.
- `settings.json`:
  - activa el plugin;
  - permite `git status`, `git diff`, `git log`, `git branch` y `al compile`;
  - **deniega** `git add -A`, `git add .`, `git commit -a` y `git push --force`.
- `github/al-compile.yml`: GitHub Actions en ubuntu-latest. Instala dotnet 8 y la herramienta `al` en la versión de `aldc-verify.json`, clona este plugin en el tag de la versión y ejecuta `al-verify.js`. Solo pasa con exit 0. Deja el resumen en el step summary y `last-report.json` como artefacto. `init` solo lo crea si el repo versiona los símbolos.

## SessionStart: toolchain

`scripts/ensure-al-toolchain.js` solo actúa en repos con `app.json`:

- **Windows/macOS:** solo detecta: extensión AL de VS Code, o la herramienta dotnet `al`, respetando la versión fijada. Nunca instala. Si falta el compilador, se lo dice a Claude y al usuario (not-run).
- **Linux/nube:**
  - Si ya está la herramienta `al` en la versión fijada (`compiler.alTool`, por defecto 18.1.43.24897), sale en menos de 1 s.
  - Si no, instala `dotnet8` con apt (o `dotnet-sdk-8.0` si falla) y `dotnet tool install --global Microsoft.Dynamics.BusinessCentral.Development.Tools --version <alTool>`.
  - Si había otra versión instalada, la cambia por la fijada.
  - Añade `~/.dotnet/tools` al PATH con `CLAUDE_ENV_FILE`, así que solo vale dentro de la sesión. Si ejecutas el script a mano, `al` no queda en el PATH. El plugin no lo necesita: usa la ruta absoluta.
  - Los analizadores de la herramienta están en `~/.dotnet/tools/.store/…/tools/net8.0/any/` y L2 los busca allí.
- **Salida:** una línea de contexto para Claude con el compilador, la versión de BC y los proyectos. El usuario solo ve un mensaje cuando se instala algo o hay un fallo.

## /al-verify (L1+L2)

`/aldc-verify:al-verify [--l1] [--project <nombre|carpeta>]` → `node scripts/al-verify.js`. Devuelve un resumen corto por proyecto (errores, warnings del compilador y de analizadores, agrupados por código) y guarda el detalle en `.claude/.aldc-verify/last-report.json`. Exit: `0` sin errores, `1` errores, `3` not-run. Si todo sale verde, marca la huella como verde y el Stop gate no recompila.

**Analizadores**, por proyecto y en este orden de preferencia:
1. `analyzers` y `ruleset` en `.claude/aldc-verify.json`.
2. `al.codeAnalyzers` y `al.ruleSetPath` del `.vscode/settings.json` del proyecto.
3. Por defecto: CodeCop, UICop y PerTenantExtensionCop. Son apps PTE, así que AppSourceCop no.

Las DLL se resuelven junto a `alc` (carpeta `bin\` de la extensión). Los warnings nunca bloquean. Una regla subida a `Error` en el ruleset sí bloquea.

**Comportamiento:**
- Si la invoca el usuario, solo informa y no edita.
- Si la invoca el agente durante una tarea, corrige los errores del código que ha cambiado.

## Pruebas (15/10/2026, Windows, copias `git archive` de un repo piloto de cliente: App + Test, BC 27)

| Caso | Resultado |
|---|---|
| `main`, en frío | Verde: App con 0 errores y 3 warnings en 5,6 s; Test con 0 errores en 5,4 s |
| `main`, en caliente sin cambios | Sale en 0,18 s sin compilar |
| regresión conocida (commit anterior a un fix), 5 paradas seguidas | Bloquea 3 veces con `AL0519` (Test: not-run por dependencia); a la 4.ª deja parar con resumen |
| `alExtension: "99.0"` (no instalada) | `not-run` con la lista de versiones instaladas; no bloquea |
| `claude -p` real sobre regresión conocida (commit anterior a un fix), pidiendo solo un comentario | Claude corrige `AL0519` y luego el error de `UploadIntoStream` sin que se lo pidan (el mismo fix que se hizo a mano); el gate acaba en verde |
| `/al-verify` sobre `main` | App: 0 errores, 3 del compilador (AL0482×2, AL0432) y 15 de analizadores. Test: 0 errores y 22 de analizadores. Unos 13 s. Después, el gate sale en 0,2 s |
| Ruleset con AA0137 → Error | App en rojo con 1 error y Test not-run por dependencia; exit 1 |
| `claude -p "/aldc-verify:al-verify"` sobre regresión conocida (commit anterior a un fix) | Informa de los 3 errores de la línea 111, no edita y el gate no bloquea (turno sin cambios en AL) |
| Ídem, pero con "no toques nada más" | Claude respeta la restricción, agota los 3 intentos y explica el error preexistente |

### v0.2.2 (Windows, 15/10/2026): segundo repo, SalesMargin (BC 28, `.alpackages` ignorado por git, trabajando en un worktree)

| Caso | Resultado |
|---|---|
| `init` dry-run | **Antes:** BC 27 (la mínima de los `app.json`) y rama `test/aldc-evidence` (`origin/HEAD` local desfasado). **Ahora:** BC 28 (la de la app principal), rama `main` (preguntando al remoto), y los planes en `.github/plans` y `.claude/plans` |
| `init` y CI | Omite la CI con razón: los símbolos no están versionados |
| L1+L2 desde el worktree | **Antes:** sin símbolos. **Ahora:** los toma del checkout principal. App con 0 errores y 3 de analizadores (incluido PTE0020 en `app.json`); Test con 0 errores y 2 |
| Gate con un error inyectado y Claude que no lo arregla | **Antes:** 3 compilaciones hasta soltar. **Ahora:** si tras un bloqueo no cambia nada, suelta al momento sin recompilar |
| Verde después de bloquear | Le devuelve el verde a Claude una vez (`decision: block` con el resultado), para que su respuesta final lo cite. Probado simulado; en sesión real, not-run |

### v0.2.0 (Windows, 15/10/2026)

| Caso | Resultado |
|---|---|
| `init` en una copia limpia: dry-run, aplicar y repetir | Crea los 5 ficheros; al repetir, salta los 5 |
| `init` con un `settings.json` previo | Solo añade claves; conserva `model` y los permisos existentes |
| SubagentStop ×5 (`al-implement-subagent`) | 3 bloqueos y suelta en la 4.ª; el contador del principal sigue aparte |
| 3 compilaciones a la vez (gate principal, gate de subagente y `al-verify`) | Antes del lock: AL1022 o fallo sin diagnósticos. Con el lock: las 3 correctas, 3 de 3 veces |
| `claude -p` delegando en `aldc:al-developer` | SubagentStop bloquea, el subagente corrige AL0519 y pregunta antes de tocar AL0133, que cambia comportamiento |
| `claude -p` con `al-build-validator` | Agrupa los 3 diagnósticos en 1 causa y propone un arreglo; no edita nada |
| CI `al-compile.yml` | **not-run**: no se ha ejecutado en GitHub Actions |

### Nube (Linux, CLI 2.1.300, 15/10/2026, sesión cloud sobre la PR de la capa)

| Caso | Resultado |
|---|---|
| SessionStart en frío / en caliente | 21,9 s (apt dotnet8 + dotnet tool al 18.1.43.24897) / 0,05 s |
| L1 | Igual que en Windows: App con 0 errores (AL0482×2, AL0432) y Test con 0 errores, en unos 15 s |
| L1+L2 (v0.1.0) | **Fallo:** 0 analizadores sin avisar. Corregido en v0.1.1: se buscan en el `.store` de la herramienta y avisa de `L2 incompleto` |
| Gate tras verde | 0,06 s, en silencio |
| Regresión ×5 | Bloquea 3 veces con AL0519 y suelta en la 4.ª, igual que en Windows |
| Plugin desde `.claude/settings.json` | **No** se carga solo (ni en cloud ni con `-p`). Instalación manual: unos 9 s |
| `claude -p` real sobre la regresión | Corrige AL0519 y AL0133 sin que se lo pidan y el gate acaba en verde, en 69 s |

## Hechos verificados en Windows (15/10/2026)

- `alc.exe` está en `%USERPROFILE%\.vscode\extensions\ms-dynamics-smb.al-<ver>\bin\alc.exe` (AL 18.0.43). **No** en `bin\win32\`.
- Los analizadores están en la misma carpeta `bin\`: `Microsoft.Dynamics.Nav.CodeCop.dll`, `UICop`, `PerTenantExtensionCop` y `AppSourceCop`.
- Flags de `alc`: `/analyzer:<lista>`, `/ruleset:<fichero>`, `/errorlog:<fichero>` (JSON), `/errorsonlyinconsole`, `/packagecachepath:`, `/project:`, `/out:`.
- Hay .NET 10 solo como runtime, sin SDK. `dotnet tool install` no está disponible aquí, así que se usa el `alc.exe` de VS Code.

## Contrato de hooks (code.claude.com/docs/en/hooks)

- **Stop:** por stdin llegan `stop_hook_active` y `last_assistant_message`. Con `exit 2` se toma stderr como motivo y Claude sigue trabajando; también vale `{"decision":"block","reason":"..."}`. Claude Code corta solo tras 8 bloqueos seguidos (`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`).
- **SessionStart:** `exit 2` no bloquea. El stdout se añade como contexto. `CLAUDE_ENV_FILE` acepta líneas `export`.
- **Shell en Windows:** los hooks en forma shell se ejecutan con Git Bash.
- **Variables disponibles:** `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA` y `CLAUDE_PROJECT_DIR`.
