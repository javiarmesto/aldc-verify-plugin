# {{REPO_NAME}}

Extensión AL de Business Central. Cliente en **BC {{BC_MAJOR}}**. Proyectos: {{PROJECTS}}.

## Reglas que no se negocian

- **Ramas:** trabaja en `claude/<tema>` desde la rama por defecto, con push y PR en **borrador**. Nunca mergees sin el OK explícito del responsable.
- **TDD:** el commit del test va antes que el del código. Un test en rojo compila: RED es "el test compila y describe el comportamiento".
- **Git:** nunca `git add .`, `git add -A` ni `git commit -a`. Añade los ficheros uno a uno.
- **Datos de cliente:** ficheros, exportaciones y documentos reales nunca entran en git.
- **Asientos:** el código nunca registra asientos contables automáticamente. Mapeos y reglas son datos (tablas de configuración), no código.
- **Versión:** sube la `version` de `app.json` de la app en cada entrega. La app de test no va a producción.
- **Símbolos:** se compila contra los símbolos de BC {{BC_MAJOR}} que están en `.alpackages`. No los sustituyas por otra versión mayor.
- **Idioma:** habla con el usuario en castellano; código, nombres técnicos y commits en inglés (o el estilo que ya tenga el repo).
- **Honestidad:** si no has compilado o ejecutado algo, dilo ("not-run"). Nunca des un resultado por supuesto.

## Compilar y verificar

- `/aldc-verify:al-verify` compila (L1) y pasa los analizadores (L2); `--l1` solo compila.
- Al terminar, el Stop hook compila si has cambiado AL y no te deja cerrar con errores.
- `/aldc-verify:al-go` verifica, revisa, hace el commit, el push y abre la PR en borrador. Solo lo lanza el usuario.
- Compilador fijado en `.claude/aldc-verify.json`.
- Tests: `al runtests` necesita un sandbox BC v28 o superior. Si no hay, los tests se compilan pero no se ejecutan (not-run).

## Warnings conocidos (no bloquean)

- (añádelos con `/aldc-verify:al-learn`)

## Dónde está cada cosa

- Planes y especificaciones: `{{PLANS_ROOT}}`
- Estado local de la verificación: `.claude/.aldc-verify/` (ignorado por git)

## Aprendido
