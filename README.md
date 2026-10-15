# aldc-verify (personal)

Plugin personal de Claude Code para que el agente **verifique su propio trabajo en AL**: compilar, analizadores y un Stop hook que no le deja terminar con errores. Es independiente de `aldc`; más adelante se decide si se integra.

## Instalación

```bash
claude plugin marketplace add javiarmesto/aldc-verify-plugin
claude plugin install aldc-verify@aldc-verify-dev
```

También se puede activar por repo en `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": { "aldc-verify-dev": { "source": { "source": "github", "repo": "javiarmesto/aldc-verify-plugin" } } },
  "enabledPlugins": { "aldc-verify@aldc-verify-dev": true }
}
```

## Estado

v0.1.0. Hechos y probados: el **Stop gate** (L1), la skill **`/al-verify`** (L1+L2) y el **SessionStart** del toolchain. Faltan `al-build-validator`, `/al-go`, `/al-learn` y las plantillas.

## Stop gate

`hooks/hooks.json` → `node scripts/al-verify-gate.js`. Cuando Claude va a terminar:

1. Si el repo no tiene ningún `app.json`, sale.
2. **UserPromptSubmit** (`al-verify-baseline.js`) guarda la huella del árbol al empezar cada turno. Si al parar la huella no ha cambiado, Claude no ha tocado AL en ese turno: el gate sale sin compilar, aunque el árbol esté rojo. Lo que ya estaba roto no es motivo para bloquear.
3. Calcula una huella con el contenido de los `.al`, los `app.json`, los recursos y la lista de símbolos. Si coincide con la del último build verde, sale (≈0,2 s).
4. Si no coincide, compila todos los proyectos en orden de dependencias (App antes que Test). Cada proyecto usa un package cache filtrado en `.claude/.aldc-verify/cache/`:
   - Símbolos Microsoft: la versión mayor de BC objetivo si existe; si no, la que haya.
   - Apps del propio repo: se descartan los símbolos viejos y se usa la `.app` recién compilada.
5. Con errores, `exit 2` y la lista por stderr (como mucho 40). Claude sigue corrigiendo.
6. Si tras `maxAttempts` (3) bloqueos seguidos sigue rojo, deja parar y avisa al usuario con los errores pendientes. El contador se reinicia en cada parada nueva (`stop_hook_active=false`).
7. Si no hay compilador, faltan símbolos o alc falla sin dar diagnósticos, muestra `not-run` o `verificación incompleta` y **no bloquea**.

El estado y la caché van en `.claude/.aldc-verify/`, que hay que añadir al `.gitignore` del repo.

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

## SessionStart: toolchain

`scripts/ensure-al-toolchain.js` solo actúa en repos con `app.json`:

- **Windows/macOS:** solo detecta: extensión AL de VS Code, o la herramienta dotnet `al`, respetando la versión fijada. Nunca instala. Si falta el compilador, se lo dice a Claude y al usuario (not-run).
- **Linux/nube:**
  - Si ya está la herramienta `al` en la versión fijada (`compiler.alTool`, por defecto 18.1.43.24897), sale en menos de 1 s.
  - Si no, instala `dotnet8` con apt (o `dotnet-sdk-8.0` si falla) y `dotnet tool install --global Microsoft.Dynamics.BusinessCentral.Development.Tools --version <alTool>`.
  - Si había otra versión instalada, la cambia por la fijada.
  - Añade `~/.dotnet/tools` al PATH con `CLAUDE_ENV_FILE`.
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

Sin probar: Linux/nube con la herramienta dotnet `al`, e instalación desde el marketplace.

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
