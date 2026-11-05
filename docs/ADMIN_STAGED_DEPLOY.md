# THE1500: despliegue escalonado de PERF-001 y ADMIN-001

Nada de este documento se ha ejecutado en remoto. Staging sigue en la versión `97707a44`, commit `5dd7122`. Cada paso remoto necesita tu autorización expresa, y entre un paso y el siguiente me detengo a informar.

Todo ocurre en la cuenta Cloudflare actual (`25765199…`), sobre el Worker `the1500-staging`, la base D1 `the1500-staging` (`05012b7a-…`) y el bucket R2 `the1500-staging-snapshots`. Ningún paso toca recursos de Palmera ni de otros proyectos.

## 1. Orden obligatorio

| # | Paso | Código | Cambio remoto | Solicitudes HTTP |
|---|---|---|---|---|
| 1 | PERF-001: migración `0010` y Worker compatible, uno tras otro | `c3387c4` | Migración y despliegue | 0 |
| 2 | Verificación funcional y de consumo de D1 | — | Ninguno | ≤ 10, según la sección 10 de `PERF001_D1_OPTIMIZATION.md` |
| 3 | ADMIN-001: interfaz y API administrativas | Commit de esta entrega | Solo despliegue, sin migración | 0 |
| 4 | Control de acceso sin administradores reales | — | Ninguno | ≤ 8 |
| 5 | Migración `0011` (índices), si se mantiene la justificación de la sección 3 | Mover `db/pending/0011_admin_indexes.sql` a `db/migrations/` | Migración | ≤ 2 |
| 6 | Alta autorizada del propietario | `scripts/superadmin.cjs` | 2 filas | 1 (el propietario abre el panel) |
| 7 | Revocación verificada del administrador de demostración | `scripts/superadmin.cjs` | 2 filas | 1 |

**Antes de cada paso remoto:**
- Comprobar con `wrangler whoami` que la cuenta es `25765199…`.
- Comprobar en `wrangler.jsonc` que la base es `05012b7a-…`.
- Consultar las analíticas de D1 del día, que no leen D1. Si el consumo pasa de 1.000.000 de filas, no se sigue.

**Condición de parada en cualquier paso:** un 5xx, un error 7500, o cifras distintas de las esperadas. Se para y no se reintenta.

**Por qué el paso 1 despliega `c3387c4` y no el último commit:** para que un fallo del paso 2 se atribuya solo a PERF-001. El despliegue se hace desde una copia limpia de ese commit, con `git worktree add`, no desde la carpeta de trabajo.

**Por qué `0011` no está en `db/migrations/`:** `wrangler d1 migrations apply --remote` aplica todas las pendientes. Si `0011` estuviera ahí, el paso 1 la aplicaría junto con `0010`. Una prueba falla si aparece antes de tiempo.

## 2. Pasos 3 y 4: ADMIN-001 sin administradores reales

En el paso 3 solo cambia el Worker. ADMIN-001 no añade tablas, triggers ni datos.

En el paso 4, con un máximo de 8 solicitudes, se comprueba:

| Comprobación | Esperado |
|---|---|
| `/admin` y `/es/admin` sin sesión | 302 al login, con `no-store` y `noindex` |
| `GET /api/v1/admin/audit` sin sesión | 401 |
| Mismo `GET` con la sesión de un titular demo | 403 |
| `/es/admin` con esa misma sesión | 404 que no menciona el panel |
| `/es/admin` con el administrador demo | 200 con los datos de demostración |

- **Cómo se obtienen las sesiones:** con `scripts/demo.cjs link`, que ahora solo acepta direcciones `.example`.
- **Ningún usuario real tiene acceso en este paso.** El único administrador sigue siendo el de demostración.

## 3. Migración 0011 y medición local

**Contenido:** `db/pending/0011_admin_indexes.sql`, con cinco `CREATE INDEX IF NOT EXISTS`. No añade tablas ni triggers y no cambia datos. Una prueba lo comprueba y verifica con `EXPLAIN QUERY PLAN` que cada listado usa su índice.

| Índice | Para qué |
|---|---|
| `idx_companies_created` | El listado de empresas, de la más reciente a la más antigua, se detiene en la página |
| `idx_memberships_company` | Titular de cada empresa y miembros de la ficha. La clave primaria empieza por `user_id` y no sirve para buscar por empresa |
| `idx_profile_versions_recent` | El listado de perfiles. Su expresión coincide término a término con el `ORDER BY` |
| `idx_admin_events_recent`, `idx_admin_events_action` | La auditoría, por fecha y por acción |

**Cómo se midió:** con D1 local (workerd), sobre el escenario de 1.500 empresas, ahora **cada una con titular**. La medición anterior no los tenía, y por eso no detectó el coste del filtro por correo. Cada página se abre una vez.

```bash
node tests/perf/admin.cjs --scenario full
```

```bash
node tests/perf/admin.cjs --scenario full --with db/pending/0011_admin_indexes.sql
```

La tabla compara tres estados:
- **Antes:** el código del commit de ADMIN-001.
- **Consultas nuevas:** el código de esta entrega, sin `0011`.
- **Con 0011:** el código de esta entrega con los índices.

| Página | Antes | Consultas nuevas | Con 0011 |
|---|---:|---:|---:|
| Resumen | 6.007 | 4.507 | 4.507 |
| Empresas, sin filtro | 8.976 | 4.530 | **306** |
| Empresas, búsqueda por nombre | 30.938 | 30.827 | 2.084 |
| Empresas, filtro por correo | **2.253.003** | 1.504 | 1.504 |
| Empresas, por posición | 3.015 | 17 | 11 |
| Ficha de empresa | 1.515 | 1.515 | **17** |
| Perfiles, sin filtro | 6.151 | 3.153 | **204** |
| Detalle de perfil | 6 | 6 | 6 |
| Auditoría | 5 | 4 | 2 |

Con los datos de demostración, que son los que hay en staging, ninguna página pasa de 150 filas.

**Cambios en el código, que funcionan con o sin `0011`:**
1. **Filtros:** solo los que se usan entran en el SQL. Antes, cada filtro vacío seguía en la consulta como `? IS NULL OR …`, y eso impedía usar los índices.
2. **Total sin filtros:** los listados sin filtro ya no cuentan el total, porque contar lee todas las filas. Piden una fila extra para saber si hay página siguiente. Con filtros, el total exacto se mantiene. El paginador muestra el rango y «Siguiente», y el total de empresas sigue en el Resumen.
3. **Página escrita en la consulta:** `LIMIT` y `OFFSET` se escriben como números, después de validarlos. Con parámetros enlazados, SQLite no sabe que la página es pequeña y recorre la tabla: 3.254 filas en vez de 306.
4. **Filtro por correo:** parte de `users` hacia `memberships`. Pasa de 2,25 millones de filas a 1.504 incluso sin `0011`. Era el único caso con riesgo real para el presupuesto, porque una sola búsqueda gastaba el 45 % del límite diario.

**Justificación del paso 5:** con 1.500 empresas, sin índices, la ficha lee 1.515 filas y la búsqueda por nombre 30.827. Con `0011` bajan a 17 y 2.084. Crear los índices sobre los datos de staging cuesta unas pocas decenas de filas. Recomiendo aplicarla antes del paso 6, para que nadie use el panel sin ella.

**Escrituras:** cada alta o cambio en empresas, membresías, versiones y eventos actualiza también su índice. `meta.changes` cuenta filas y no entradas de índice, así que los controles `changes!==1` no cambian. Esto es distinto de los triggers de `0010`.

## 4. Procedimiento de activación del superadministrador

`platform_admins` sigue siendo la única fuente de autorización. Ninguna ruta web escribe en esa tabla, y una prueba lo comprueba recorriendo `src/`. La única herramienta es `scripts/superadmin.cjs`, en línea de comandos y con credenciales de Wrangler para esta cuenta. No hay contraseñas, tokens fijos ni accesos alternativos.

| Paso | Quién | Qué |
|---|---|---|
| 6.1 | Propietario | Entra en `/es/login` de staging con su correo real y abre el enlace que recibe en su buzón. Así queda un `login_completed` |
| 6.2 | Claude | `superadmin.cjs prepare <correo> --target staging`: muestra el identificador de usuario, el estado y la hora del último acceso. Solo lee |
| 6.3 | Propietario | Confirma en el chat que la cuenta y la hora son suyas y autoriza la elevación con sus palabras |
| 6.4 | Claude | Ejecuta `grant`, con los parámetros de la tabla siguiente. Hay que lanzarlo antes de una hora desde 6.1 |
| 6.5 | Propietario | Abre `/es/admin` una vez y comprueba que ve el panel |
| 7.1 | Claude | `superadmin.cjs revoke-demo --by <correo> --authorized-by "<misma autorización>" --target staging` |
| 7.2 | Claude | `superadmin.cjs verify --expect <correo> --target staging`: termina con error si hay más de un administrador activo o si no es el propietario |
| 7.3 | Administrador demo | Abre `/es/admin` una vez con su sesión y debe recibir 404 |

`grant <correo>` exige:

| Parámetro | Valor |
|---|---|
| `--user-id` | El identificador visto en 6.2 |
| `--confirm` | El mismo correo, repetido |
| `--authorized-by` | Tu autorización, citada |
| `--target` | `staging` |

**Lo que `grant` rechaza:**
- un acceso de más de una hora;
- un identificador distinto del comprobado;
- un correo de demostración;
- una cuenta bloqueada;
- un segundo administrador real.

La condición de que no haya otro administrador real se repite dentro del SQL, por si dos ejecuciones coincidieran.

**Por qué el administrador demo no bloquea el alta:** el orden pide dar de alta primero al propietario y revocar después. Así nunca queda la plataforma sin administrador.

**Auditoría:** las dos actuaciones quedan en `admin_events`, que los triggers impiden editar o borrar.
- **Alta:** `admin_granted`, motivo `bootstrap`, evidencia = tu autorización, y en el detalle la hora del acceso usado.
- **Revocación:** `admin_revoked`, motivo `demo_access_removed`, con el propietario como autor.

Ambas aparecen en la página de Auditoría del panel.

**Enlace del login demo:** `scripts/demo.cjs link` imprimía un enlace de acceso para cualquier correo, sin pasar por el buzón. Ahora solo acepta direcciones `.example`, así que la cuenta del propietario solo puede verificarse con el login real.

Las pruebas cubren todos los rechazos, el alta con el administrador demo activo, la revocación, `verify` en sus dos resultados y la imposibilidad de dar de alta un segundo administrador real.

## 5. Reversión

| Paso revertido | Cómo | Efecto en escrituras y triggers |
|---|---|---|
| 7. Revocación del demo | No se revierte. Si hiciera falta, se crea un acceso demo nuevo con autorización y queda en la auditoría | Ninguno |
| 6. Alta del propietario | `UPDATE platform_admins SET revoked_at=…` y un `admin_revoked` en `admin_events`, solo con tu autorización. El evento de alta no se borra | Ninguno sobre los datos de negocio |
| 5. `0011` | Cinco `DROP INDEX IF EXISTS`. Además, borrar la fila `0011_admin_indexes.sql` de `d1_migrations` si se va a volver a aplicar | No toca datos ni triggers. Las lecturas vuelven a la columna «Consultas nuevas» de la sección 3 |
| 3. ADMIN-001 | `wrangler rollback` a la versión del paso 1 | El panel desaparece; no hay cambio de esquema. Los `admin_events` escritos se conservan porque son inmutables. `platform_admins` no cambia |
| 1. PERF-001 | Volver al Worker `97707a44` **y** eliminar los ocho triggers `trg_rm_*`, en ese orden y sin intervalo | Ver el párrafo siguiente |

**Por qué PERF-001 necesita las dos cosas:** con los triggers de `0010` activos, D1 cuenta sus escrituras en `meta.changes`. El Worker anterior comprueba `changes!==1` en reservas y pagos, y leería como fallida una reserva correcta. Por eso, volver solo al Worker anterior rompe las reservas hasta que se eliminan los triggers.

En sentido contrario, eliminar los triggers dejando el Worker nuevo hace que sus modelos de lectura queden desactualizados. Muestra cifras viejas hasta que su verificación por revisión los reconstruye.

Las tablas `read_models` y `read_model_revisions` pueden quedarse: no afectan al Worker anterior. Ningún paso de reversión borra datos de negocio.

**Restaurar D1 a un punto anterior (Time Travel):** devolvería también cualquier dato escrito después. Solo se haría como último recurso, con tu autorización y tras comprobar la base de destino.

## 6. Riesgos pendientes

| Riesgo | Situación |
|---|---|
| Correo real en staging | El paso 6.1 necesita que el enlace de acceso llegue a tu buzón. Si Email Sending no entrega a tu dirección, el alta se detiene y te consulto. No se usa el enlace demo |
| Búsqueda por nombre sin índice de texto | Con `0011` lee unas 2.000 filas por búsqueda con 1.500 empresas, porque `LIKE '%…%'` recorre la tabla. Es aceptable para un administrador. Si hiciera falta, la solución es un índice FTS, en otra migración |
| Resumen | Lee unas 4.500 filas por apertura con 1.500 empresas, al contar empresas, perfiles y demos. Sin sondeos, es el 0,09 % del límite diario |
| Total de empresas sin filtro | El paginador ya no lo muestra; está en el Resumen |
| `0011` antes de datos reales | Si los pasos 5 y 6 se separan mucho, la ficha y la búsqueda funcionan pero leen más (sección 3) |
| Herramienta con acceso a la base | Quien tenga credenciales de Wrangler en esta cuenta puede escribir en D1 directamente; ese riesgo es previo a este trabajo. El script deja rastro y exige un acceso real reciente, pero no impide un SQL manual. Mitigación: limitar quién tiene acceso a la cuenta |
| Reautenticación para acciones críticas | Pendiente para ADMIN-002 (migración `0012`) |
| Administrador demo hasta el paso 7 | Sigue activo en staging. Es una cuenta `.example` sin buzón, y solo se entra con un enlace generado desde la línea de comandos |
