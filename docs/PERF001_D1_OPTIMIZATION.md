# PERF-001: optimización estructural del consumo de D1

Línea base: `docs/AUDIT001_D1_CONSUMPTION.md`. Fecha de la medición: 2026-11-05.

**Resultado.** Una visita tipo pasa de 8.680 a 41 filas leídas con los datos de demostración, y de 29.889 a entre 47 y 1.856 filas con 1.500 empresas. El rango depende de cuántas empresas coincidan con la búsqueda. Las 17 rutas comparadas devuelven exactamente lo mismo que antes, y los 9 HTML y JSON comparados son idénticos.

**Staging no está desplegado.** El presupuesto de D1 de hoy está agotado y no se recupera hasta las 00:00 UTC (sección 10). Todo lo que sigue se midió en local.

Cómo leer las etiquetas:

- **MEDIDO-LOCAL:** viene de `meta.rows_read` de D1 local o de solicitudes HTTP al Worker construido en workerd local.
- **MODELO:** es aritmética sobre medidas locales con una hipótesis de visita. No es una medida.
- Nada de este documento se midió en Cloudflare.

Reproducir la medición:

```bash
node tests/perf/measure.cjs --root . --scenario full --out after.json
```

```bash
node tests/perf/http.cjs --root . --scenario full --out http.json
```

```bash
node tests/perf/compare.cjs before.json after.json
```

La versión anterior se mide con una copia de trabajo del commit `b7bb7d1` pasada como `--root`. Cada versión se mide sobre su propio esquema. Los datos completos están en `docs/PERF001_MEASUREMENTS.json`.

Escenarios (`tests/perf/scenario.cjs`), con datos deterministas:

- **demo:** 9 empresas publicadas, 2 asignadas sin publicar y 1 retirada.
- **full:** 1.500 empresas simuladas publicadas. Es el directorio agotado, sin plazas libres.

## 1. Consultas originales y optimizadas

### getSalesState: de 1.999 a 4 filas

Original. Dos `COUNT(*)` recorrían todas las posiciones libres solo para saber si quedaba alguna.

```sql
SELECT (SELECT MIN(phase) FROM slots WHERE status IN('available','held')) AS phase,
  (SELECT COUNT(*) FROM slots WHERE phase=1 AND status='available' AND number>=101) AS paid_free,
  (SELECT price_usd_cents FROM slots WHERE phase=(SELECT MIN(phase) FROM slots WHERE status IN('available','held')) LIMIT 1) AS price,
  (SELECT COUNT(*) FROM slots WHERE number<101 AND status='available') AS founder_free
```

Optimizada. Cada subconsulta se detiene en su primera entrada de índice.

```sql
WITH a(p) AS (SELECT phase FROM slots WHERE status='available' ORDER BY phase LIMIT 1),
     h(p) AS (SELECT phase FROM slots WHERE status='held' ORDER BY phase LIMIT 1),
     c(p) AS (SELECT MIN(p) FROM (SELECT p FROM a UNION ALL SELECT p FROM h))
SELECT c.p AS phase,(SELECT price_usd_cents FROM slots WHERE phase=c.p LIMIT 1) AS price,
  EXISTS(SELECT 1 FROM slots WHERE phase=1 AND status='available' AND number>=101) AS paid_free,
  EXISTS(SELECT 1 FROM slots WHERE phase=1 AND status='available' AND number<101) AS founder_free FROM c
```

La lógica de decisión no cambió, porque solo necesita saber si hay plazas (`paid_free===0`, `founder_free>0`). El precio sigue leyéndose de la base de datos. El `UPDATE` atómico de la reserva y el orden de adjudicación no se tocaron.

### getPublicStats: comparación antes de decidir

El mandato pedía comparar primero. Resultados con 1.500 empresas:

| Alternativa | Filas por lectura | Se puede desincronizar | Filas por cambio real |
|---|---|---|---|
| Original (5 consultas, 3 recorridos) | 6.009 | No | 0 |
| Una sola consulta `GROUP BY phase,status` más publicadas y sectores (SQL optimizado) | 1.502 de inventario + 1.497 de catálogo | No | 0 |
| Contar solo posiciones no libres | 1.503 con el registro lleno | No | 0 |
| Tabla de contadores con triggers (medida en AUDIT-001) | 6 | **Sí, si un trigger y una regla divergen** | 1 por cambio |
| **Modelo derivado validado por revisión (elegido)** | **4** | **No: siempre se recalcula desde `slots`** | 1 revisión, más una reconstrucción de 1.514 filas en la siguiente lectura |

El SQL optimizado solo no basta. Un mínimo de 1.500 filas por visita sigue dejando unas 3.300 visitas diarias en el mejor caso, y eso sin contar el mosaico. Los contadores leen poco, pero son lo que el mandato prohíbe si pueden desincronizarse. Tendrían que replicar en triggers cada regla de reservas, vencimientos, retiros y fases.

Por eso los triggers no guardan ningún número. Solo incrementan una revisión que significa «algo cambió». El dato se recalcula siempre desde las tablas con la consulta unificada, y por eso no puede derivar del inventario.

### Mosaico y mapa de posiciones: una sola consulta

Antes eran dos consultas, 5.985 y 4.497 filas, con la lista de retirados aparte.

```sql
SELECT s.number AS position,s.status,c.slug,c.display_name AS name,c.country,c.industry,
  (s.status='assigned' AND c.publication_status='published' AND EXISTS(
    SELECT 1 FROM profile_versions v WHERE v.company_id=c.id AND v.published_at IS NOT NULL)) AS listed
FROM slots s LEFT JOIN companies c ON c.id=s.company_id WHERE s.status IN('assigned','retired') ORDER BY s.number
```

El criterio de publicación es el mismo que antes, incluido el `EXISTS` sobre `profile_versions`. Esta consulta solo se ejecuta al reconstruir.

### Directorio

- **Sin filtro:** el total y las posiciones de la página salen del mapa ya calculado. Solo se leen las filas de esa página, sea cual sea su número. La página 40 cuesta lo mismo que la 1, de modo que `OFFSET` deja de ser un problema aquí. Las condiciones de publicación se siguen comprobando contra las tablas.

  ```sql
  SELECT ... FROM slots s NOT INDEXED CROSS JOIN companies c ON c.id=s.company_id
  WHERE s.number IN (?, ...) AND <mismas condiciones> ORDER BY s.number
  ```

- **Con filtro:** una sola pasada devuelve página y total con `COUNT(*) OVER()`. Antes eran dos pasadas (`COUNT` y luego la página). Si se pide una página más allá de la última, no hay fila que lleve el total y se ejecuta el `COUNT`.

No hizo falta ningún índice nuevo. La búsqueda de texto (`searchPublishedProfiles`) no se modificó (sección 8).

## 2. Filas leídas: antes y después

MEDIDO-LOCAL. «Fría» es la primera lectura sin nada almacenado. «Caliente» es la lectura normal. Antes de PERF-001 no existía esa diferencia.

| Ruta | demo antes | demo fría | demo caliente | 1.500 antes | 1.500 fría | 1.500 caliente |
|---|---:|---:|---:|---:|---:|---:|
| `/` | 5.098 | 1.570 | **11** | 16.516 | 9.012 | **11** |
| `/es/` | 5.098 | 11 | **11** | 16.516 | 11 | **11** |
| `/unirse` | 5.102 | 8 | **8** | 16.520 | 8 | **8** |
| `/es/unirse` | 5.102 | 8 | **8** | 16.520 | 8 | **8** |
| `/empresas` | 5.086 | 40 | **40** | 16.510 | 100 | **100** |
| `/es/empresas` | 5.095 | 49 | **49** | 16.598 | 124 | **124** |
| `/empresas?page=40` | 5.086 | 4 | **4** | 16.510 | 100 | **100** |
| `/empresas?query=` sin coincidencias | 5.042 | 16 | **16** | 9.011 | 1.506 | **1.506** |
| `/empresas?query=` pocas coincidencias | 5.046 | 20 | **20** | 9.565 | 2.060 | **2.060** |
| `/empresas?query=` todas coinciden | 5.086 | 60 | **60** | 16.510 | 9.005 | **9.005** |
| `/empresas?country=` | 5.051 | 25 | **25** | 10.510 | 3.005 | **3.005** |
| `/api/v1/public/stats` | 5.019 | 4 | **4** | 6.009 | 4 | **4** |
| `/api/v1/public/companies` | 65 | 38 | **38** | 10.500 | 98 | **98** |
| `/api/v1/public/retired-positions` | 2 | 2 | **2** | 1 | 2 | **2** |
| Ficha de empresa | 4 | 4 | **4** | 4 | 4 | **4** |
| Búsqueda, una coincidencia | 8 | 8 | **8** | 8 | 8 | **8** |
| Búsqueda, todas coinciden | 70 | 70 | **70** | 9.052 | 9.052 | **9.052** |
| `getSalesState` | 1.999 | 4 | **4** | 9 | 2 | **2** |

Consultas por ruta (caliente):

| Ruta | Antes | Después | Repetidas antes | Repetidas después |
|---|---:|---:|---:|---:|
| Home | 9 | 3 | 0 | 0 |
| `/unirse` | 10 | 3 | 1 | 0 |
| `/empresas` | 8 | 3 | 0 | 0 |
| Estadísticas | 5 | 2 | 0 | 0 |

Las filas de esta tabla «antes» difieren ligeramente de AUDIT-001 (5.085 frente a 5.098 en la Home) porque aquel informe midió la copia de la base local y este usa un escenario reproducible.

Tiempo y CPU por solicitud. MEDIDO-LOCAL, 30 solicitudes por ruta sobre el Worker construido. La CPU es la del proceso workerd local, que también ejecuta D1, y no equivale a la CPU facturable de Cloudflare.

| Ruta | demo p50 ms antes → después | demo CPU ms | 1.500 p50 ms | 1.500 p95 ms | 1.500 CPU ms |
|---|---|---|---|---|---|
| `/` | 8,8 → 6,5 | 9,7 → 7,0 | 33,0 → 26,6 | 41,4 → 32,4 | 37,3 → 32,7 |
| `/es/` | 8,0 → 6,4 | 8,0 → 6,7 | 29,8 → 25,9 | 35,4 → 32,1 | 33,0 → 29,0 |
| `/unirse` | 5,6 → 4,0 | 5,3 → 3,7 | 9,0 → 3,9 | 17,0 → 5,0 | 9,3 → 3,3 |
| `/es/unirse` | 5,4 → 3,8 | 5,3 → 3,7 | 9,6 → 3,9 | 13,0 → 8,2 | 9,3 → 3,7 |
| `/empresas` | 4,9 → 3,7 | 5,0 → 3,7 | 6,6 → 3,9 | 7,4 → 4,7 | 6,3 → 3,7 |
| `/empresas?query=simulated 7` | 5,2 → 3,6 | 4,7 → 3,3 | 6,3 → 4,5 | 8,3 → 4,9 | 6,0 → 4,3 |
| `/api/v1/public/stats` | 2,7 → 2,5 | 2,3 → 2,3 | 2,7 → 1,9 | 3,7 → 2,5 | 2,3 → 2,0 |
| Búsqueda, todas coinciden | 1,9 → 2,2 | 1,7 → 2,3 | 4,3 → 4,3 | 5,5 → 5,3 | 4,3 → 4,3 |

En local, D1 es rápido y el tiempo depende sobre todo del renderizado. El beneficio principal de este sprint son las filas, no los milisegundos. En D1 remoto cada consulta añade latencia de red, pero eso no se midió.

## 3. Cambios arquitectónicos

- **`db/migrations/0010_perf001.sql`:** añade las tablas `read_models` y `read_model_revisions`, y triggers que incrementan una revisión en la misma transacción que el cambio. No toca datos existentes.
- **`src/core/read-model.ts` (nuevo):** lectura con validación de revisión, y construcción de los dos conjuntos de datos.
- **`src/core/inventory.ts`:** nueva consulta de `getSalesState`.
- **`src/core/home.ts`:** lee los modelos una sola vez por solicitud.
- **`src/core/join.ts`:** deja de llamar a `loadHome`. Ya no lee la lista de empresas ni los retirados, y lee el perfil de demostración una sola vez.
- **`src/core/public.ts`:** añade `loadDirectory`, que evita leer tres veces los mismos datos en `/empresas`.
- **`src/core/directory.ts`:** directorio sin filtro por posiciones conocidas y con filtro en una sola pasada.
- **`src/middleware.ts`:** las páginas HTML llevan `Cache-Control: private, no-cache`.
- **`src/components/AccountWorkspace.tsx`:** la consulta tras volver del pago se detiene a los 3,5 minutos (punto 9 de AUDIT-001).
- **`admin.ts`, `inventory.ts`, `profiles.ts`:** cuatro comprobaciones de filas cambiadas (sección 8).

**Decisión sobre `/unirse`.** El mandato pide quitar «datos del muro que la página no utiliza». La página sí utiliza el mapa de posiciones (muro del hero y muro pequeño de UX-007), así que se conserva, y cuesta una fila almacenada. Lo que no usa, la lista de empresas y los retirados, ya no se lee. Si se prefiere retirar los muros de esa página, sería una decisión de producto.

### Dos conjuntos de datos

| Conjunto | Contiene | Cambia cuando | Coste de reconstrucción con 1.500 |
|---|---|---|---|
| `commerce` (variable) | Disponibilidad, reservas activas, precio vigente, estado de venta, fases | Cambia el `status` de una posición | 1.514 filas |
| `catalog` + `mosaic` (poco frecuente) | Mapa de posiciones, empresas publicadas, retiradas, sectores, identidad visible en el mosaico | Asignación, retiro, publicación, retiro de perfil, cambio de nombre, slug, país o sector | 7.515 filas |

Una reserva no reconstruye el mosaico, porque una posición reservada se muestra como abierta. Hay una prueba de ello. El perfil de cada empresa no se almacena: se lee de `profile_versions` con 4 filas.

## 4. Política de caché e invalidación

**Separación de datos públicos y autenticados.** Los modelos se construyen sin sesión y no contienen usuarios, correos, reservas ni identificadores internos de empresa. Hay una prueba que lo verifica.

**Qué se puede cachear:**

| Respuesta | Política | Motivo |
|---|---|---|
| Páginas HTML | `private, no-cache`, nunca en caché compartida | `Shell.astro` cambia la navegación según la cookie de sesión |
| `/api/v1/public/stats` | `public, max-age=15` (sin cambios) | No depende de la sesión. Prueba e2e: la respuesta es idéntica con y sin sesión, y sin `Set-Cookie` |
| Ficha JSON de empresa | `public,max-age=300` (sin cambios) | Solo datos públicos |
| Modelos en D1 | Sin caducidad por tiempo | Válidos mientras su revisión coincida con la vigente |

**Invalidación.** Cada lectura compara la revisión almacenada con la vigente, en la misma consulta. Si un cambio ya terminó, ninguna lectura posterior recibe el dato anterior, porque no existe un plazo durante el que el dato pueda estar desfasado.

**Cuando un dato queda obsoleto.** El siguiente visitante lo reconstruye desde las tablas y lo guarda. Si varios coinciden, reconstruyen todos y gana la revisión más reciente, de modo que una reconstrucción antigua no puede pisar una nueva. Si falla la escritura, el visitante recibe igualmente el dato correcto.

**EN/ES.** Las cifras son compartidas, sin clave por idioma, y los textos por idioma no se almacenan en los modelos. Hay una prueba que lo verifica.

**HTML en caché: no implementado.** No se añadió por cuatro razones:

1. Ya no es necesario para el consumo de D1: la Home lee 11 filas.
2. Exigiría sacar el estado de sesión del HTML. La cookie es `HttpOnly`, así que habría que añadir un indicador legible o una consulta adicional, y eso es un cambio de autenticación.
3. Según la documentación de Cloudflare, los aciertos de Workers Caching también cuentan como solicitudes, de modo que no amplía el límite de 100.000 diarias.
4. No se ha verificado su disponibilidad en este plan ni el comportamiento de la Cache API en `workers.dev`.

**La caché no es autoridad de una venta.** `createCheckoutHold`, los pagos y la adjudicación no leen estas tablas. Hay una prueba que examina el código de `inventory`, `payments`, `admin`, `stripe` y `cases`. Otras dos pruebas almacenan un dato falso que dice «venta abierta» sobre un registro agotado, y «cerrada» sobre uno abierto: la reserva se decide igual en ambos casos, y al precio correcto.

No se añadieron KV, Durable Objects ni otros servicios. Todo vive en la D1 existente.

## 5. Pruebas de equivalencia funcional

`tests/integration/perf001.test.cjs` conserva las consultas originales, literales, como referencia, y compara con ellas cada respuesta nueva.

**Estados de venta**, comparando estado, estadísticas, mapa, mosaico, retirados y directorio, en lectura fría y almacenada:

| Estado del mandato | Casos probados |
|---|---|
| Venta abierta | Venta inicial; segundo tramo a mitad |
| Reserva y adjudicación de fundadores | Fundadores en curso con ventas pagadas |
| Espera de adjudicación de fundadores | Plazas pagadas agotadas, fundadores libres |
| Transición de fases | Fase recién agotada; plaza pagada solo reservada; plaza antigua reabierta |
| Premium por solicitud | Recién abierto; a mitad |
| Directorio agotado | 1.500 asignadas |

También se comprueba que cada estado llega a la decisión de checkout correcta (`SALES_CLOSED`, `PREMIUM_ADMISSION_REQUIRED`, `PAID_CAPACITY_PENDING_FOUNDERS`, `PHASE_PENDING`), y que una plaza reabierta conserva su precio original.

**Comparación completa entre versiones**, con el código anterior ejecutado sobre el mismo escenario:

- 17 de 17 rutas con respuesta idéntica, en demo y en 1.500 (`tests/perf/compare.cjs`).
- 9 de 9 respuestas HTTP con cuerpo idéntico, en demo y en 1.500. Se normalizan los nombres de archivos con hash y el `uid` que Astro deriva de la compilación.

**Directorio:** 12 combinaciones de filtros, incluidas página posterior a la última, caracteres especiales de `LIKE`, español y servicios.

## 6. Resultados de concurrencia

Sobre el motor D1 real (workerd local):

| Prueba | Resultado |
|---|---|
| 40 reservas y 80 lecturas públicas simultáneas | 40 reservas con números distintos, de 101 a 140, sin rechazos; las cifras finales coinciden con la referencia |
| 5 plazas y 30 compradores simultáneos | Exactamente 5 reservas; `held` = 5 y `available` = 900 |
| Lectura durante cada una de 12 reservas | Nunca anterior al último cambio terminado |
| Lote fallido | La revisión no se mueve y la posición no cambia |
| Reconstrucción antigua contra una más nueva | La nueva se conserva y la respuesta es correcta |
| 12 reservas HTTP concurrentes (e2e) | 12 números distintos |

## 7. Modelo de capacidad actualizado

**MODELO**, sobre filas MEDIDO-LOCAL. Hipótesis de visita, la misma de AUDIT-001 y **no observada**: Home + 0,4 Unirse + 0,3 Directorio + 0,3 Ficha + 0,2 Búsquedas. Presupuesto: 5.000.000 de filas al día, menos 8.064 del cron (28 filas × 288 ejecuciones, medidas en remoto), compartido con toda la cuenta.

| Escenario | Filas por visita | Visitas al día que caben en D1 |
|---|---:|---:|
| Antes, demo | 8.680 | 575 |
| Antes, 1.500 | 29.889 | 167 |
| Después, demo | 41 | ~120.000 |
| Después, 1.500, búsquedas con una coincidencia | 47 | ~106.000 |
| Después, 1.500, búsquedas donde todas coinciden | 1.856 | ~2.700 |

**El límite pasa a ser otro.** Con 2,2 solicitudes por visita, las 100.000 solicitudes diarias de Workers Free equivalen a unas 45.000 visitas. Eso queda por debajo de lo que cabe en D1, salvo en el peor caso de búsqueda.

**Coste de los cambios reales**, que se suma al de las visitas. Ejemplo con 200 cambios comerciales y 20 de catálogo al día, con 1.500 empresas: 200 × 1.514 + 20 × 7.515 = 453.100 filas, un 9 % del presupuesto. Como máximo se reconstruye una vez por cambio, y solo si alguien visita la página después.

**Escrituras adicionales.** Una reserva escribe una fila más, y una asignación dos. Una reconstrucción escribe una o dos filas. El límite gratuito es de 100.000 escrituras al día.

El plan de Cloudflare no necesita cambiar por las lecturas de D1. Sí sigue pendiente lo indicado en la sección 8 sobre la CPU de la Home.

## 8. Riesgos y limitaciones

1. **CPU y peso de la Home con 1.500 empresas.** Es el riesgo principal que queda. La Home pesa 922 KB y usa unos 33 ms de CPU en workerd local, con 11 filas de D1: el coste está en parsear y renderizar el mosaico completo, no en la base de datos. El plan Free de Workers limita la CPU a 10 ms por solicitud. La medida local no es comparable con Cloudflare, pero el margen es preocupante. Con los datos de demostración son 82 KB y 7 ms. No se abordó porque no es un problema de D1 y porque reducirlo cambia cómo se entrega el mosaico (UX-003, UX-004).
2. **Búsqueda con muchas coincidencias.** Una búsqueda que coincide con todas las empresas lee 9.052 filas con 1.500. El orden por relevancia tiene que evaluar cada coincidencia, y no se modificó para no alterar los resultados. Los filtros del directorio llegan a 9.005 filas en el mismo caso. Una búsqueda repetida a propósito sigue siendo cara: el límite de frecuencia de estas rutas debería revisarse antes de producción.
3. **Cuatro comprobaciones transaccionales cambiaron.** D1 cuenta en `meta.changes` lo que escriben los triggers (medido: 2 en vez de 1), y esto no se podía evitar con triggers de escritura. Las comprobaciones `changes!==1` sobre `UPDATE slots` (reserva, adjudicación de fundador, Premium) y sobre la publicación de `profile_versions` pasaron a «ninguna fila cambió». Cada sentencia afecta como máximo a una fila por clave primaria, de modo que la decisión es la misma. Las 132 pruebas previas, incluidas las de concurrencia, pasan sin cambios.
4. **Orden del despliegue.** Si la migración se aplica con el Worker anterior en servicio, ese Worker interpretaría una reserva correcta como fallida, porque `changes` valdría 2. En staging, sin compradores y con pagos desactivados, basta con migrar y desplegar seguido. **En producción, con ventas activas, exigiría dos pasos:** primero el código que tolera ambos valores, después la migración y por último la lectura de modelos.
5. **Reconstrucciones simultáneas.** Tras un cambio, varios visitantes pueden reconstruir a la vez, y cada uno paga el coste. No hay riesgo de datos, solo de filas. No se añadió un bloqueo porque exigiría más escrituras en lecturas públicas.
6. **Las escrituras a mano dependen de los triggers.** Un SQL directo sobre `slots` o `companies` invalida correctamente. Si alguien eliminara un trigger, los datos públicos quedarían obsoletos sin aviso hasta el siguiente cambio, porque no hay caducidad por tiempo. Forzar una reconstrucción solo requiere incrementar la revisión.
7. **Las lecturas públicas fallan si falta la migración.** Si el código nuevo se despliega sin ella, las páginas se muestran sin datos, como ya hacen ante un error de D1. No se añadió una vía alternativa que oculte ese error.
8. **Datos simulados.** El escenario de 1.500 empresas tiene perfiles uniformes y el registro lleno. Perfiles reales de mayor tamaño aumentarían el peso de las páginas, no las filas.
9. **Discrepancia histórica sin resolver.** Los totales del 5 de noviembre no coinciden entre fuentes (5.468.716, 6.089.956 y 5.927.232); ver la sección 12 de AUDIT-001.

## 9. Commit publicado

Rama `feature/core-claude`. El informe de AUDIT-001 se conservó primero en `b7bb7d1`. El commit de este sprint es `2803d1e`, y `package.json` queda en la versión 0.16.0.

**Suites:**

| Suite | Resultado |
|---|---|
| `npm run test:db` | 42 de 42 |
| `npm run test:core:runtime` | 164 de 164 (132 previas y 32 nuevas) |
| `npm run test:e2e` | 31 de 31 pasos (30 previos y 1 nuevo). Email, LLM y Stripe son sustitutos locales, no los proveedores reales |
| `npx tsc --noEmit` | Sin errores |
| `npm audit --omit=dev` | 0 vulnerabilidades |

Las pruebas nuevas cubren los diez puntos del mandato:

| Punto | Prueba |
|---|---|
| Agotamiento de una fase | 5 plazas y 30 compradores; estados de transición |
| Reservas concurrentes | 40 reservas con lecturas simultáneas |
| Vencimiento de reservas | La plaza vuelve y las cifras lo reflejan |
| Adjudicación de fundadores | Adjudicación en orden y revocación |
| Premium | Solicitud, asignación en orden y precio, sin checkout |
| Retiro y reactivación | Retiro con número retirado; la suspensión y reactivación no mueven cifras públicas por sí solas |
| Publicación de empresas | Muro, directorio y cifras en la misma respuesta |
| Invalidación y actualización de estadísticas | Comparación con la referencia tras cada evento |
| Disponibilidad durante cambios simultáneos | Lecturas durante reservas |
| Ausencia de datos de sesión en caché pública | Contenido de los modelos; cabeceras e identidad de respuesta con sesión (e2e) |

## 10. Estado de staging y evidencia de verificación

**No desplegado. Staging sigue en la versión `97707a44`, commit `5dd7122`.**

La condición del mandato es que el presupuesto de D1 esté disponible, y hoy no lo está: el consumo del 5 de noviembre superó los 5.000.000 de filas a las 15:02 UTC, y el límite se reinicia a las 00:00 UTC. No se hizo ninguna solicitud a staging durante este sprint, ni se aplicó la migración remota. Palmera no se tocó.

Tampoco está verificado en staging, con datos, el `/unirse` de UX-007: se vio en estado «desconocido» mientras duraba el límite.

**Plan de despliegue propuesto, una vez reiniciado el presupuesto:**

| Paso | Detalle |
|---|---|
| Comprobación previa | Consultar analíticas de D1 del día (sin leer D1): continuar solo si el consumo está por debajo de 1.000.000 de filas. Verificar la cuenta `25765199…` y la base `05012b7a-…` |
| Migración | `0010_perf001.sql`, seguida inmediatamente del despliegue (riesgo 4) |
| Solicitudes máximas | 10 en total, sin sondeos: `/`, `/es/`, `/unirse`, `/es/unirse`, `/empresas`, estadísticas, retirados, más 3 de reserva |
| Consumo estimado | ~1.700 filas: la primera Home reconstruye (1.570 + 71 en demo) y el resto lee unas 100. **Es una estimación** |
| Límite de seguridad | Detenerse si la prueba supera 10.000 filas según las analíticas |
| Condición de parada | Cualquier 5xx, un error 7500 o cifras distintas a las esperadas: parar y no reintentar |
| Evidencia | Filas reales de la Home antes y después, tomadas de `d1QueriesAdaptiveGroups` |
| Reversión | Volver a la versión anterior no basta (riesgo 4). Hay que eliminar también los triggers `trg_rm_*`. Eso no borra datos de negocio |

La batería remota `tests/remote/staging.cjs` no se ejecutará sobre los datos de demostración.
