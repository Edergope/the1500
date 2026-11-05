# AUDIT-001: consumo de Cloudflare D1

Datos tomados el 2026-11-05 hacia las 16:25 UTC. El día UTC del incidente aún no había terminado, así que las cifras de ese día son parciales.

Cada cifra lleva su origen:

- **MEDIDO-REMOTO:** métricas históricas de Cloudflare.
- **MEDIDO-LOCAL:** `meta.rows_read` en copias locales de D1.
- **REGISTRO:** archivos de las sondas, con marca de tiempo.
- **DERIVADO:** cálculo a partir de lo anterior.
- **HIPOTÉTICO:** supuesto explícito, no un dato.

Durante la auditoría no se ejecutaron sondas, pruebas de carga, despliegues, migraciones ni escrituras en remoto.

## 1. Resumen ejecutivo

**Las tres preguntas:**

**1. ¿Qué consultas consumieron los cinco millones de filas?**
Tres sentencias sobre `slots`, todas dentro de `getPublicStats()`, suman el **98,4 %** de las filas atribuidas por sentencia:

| Sentencia | Función | Filas el 5-nov | Ejecuciones |
|---|---|---:|---:|
| Estado de venta (`MIN(phase)` y contadores) | `getSalesState()` | 2.567.799 | 1.343 |
| Resumen por fase (`GROUP BY phase`) | `getPublicStats()` | 1.719.000 | 1.207 |
| Contadores globales (`SUM(CASE…)`) | `getPublicStats()` | 1.704.000 | 1.170 |

`getPositionMap()`, la sospechosa inicial, **no es la causa**: 27.264 filas en todo el día (0,4 %).

**2. ¿Por qué se ejecutaron tantas veces sin clientes?**
Principalmente por mis sondas de despliegue. Pedían el Home cada 250 ms: **960 cargas registradas**, unas 4,87 millones de filas (DERIVADO), el **89 %** de lo consumido por THE1500 ese día. El resto es, en su mayor parte, verificación con navegador. Entre las 00:00 y las 11:59 UTC solo hubo el cron y ninguna lectura de páginas, de modo que **no hay indicios de bots ni de tráfico orgánico**.

La causa de fondo es de diseño: **cada carga pública lee unas 5.070 filas** para mostrar unos contadores, y nada se reutiliza. Con ese coste, unas 985 cargas agotan el límite diario.

**3. ¿Qué cambios permitirán recibir miles de visitas?**
En este orden:

1. Reescribir `getSalesState()`: **de 1.986 a 4 filas** (MEDIDO-LOCAL).
2. Sustituir los dos recorridos por contadores mantenidos: **de 3.000 a 6 filas** (MEDIDO-LOCAL para la lectura).
3. Reutilizar una representación del mosaico en vez de reconstruirla: hace falta para escalar, porque con 1.500 empresas esas consultas pasan a leer unas 10.500 filas.
4. Añadir caché HTTP en las páginas públicas, separando primero el HTML personalizado por cookie.

**La caché sola no es la corrección:** seguiría costando unas 5.000 filas en cada fallo de caché.

### Qué está confirmado y qué no

| Afirmación | Estado |
|---|---|
| `the1500-staging` leyó 5.468.716 filas el 5-nov, el 99,6 % de la cuenta | **Confirmado** (MEDIDO-REMOTO) |
| El acumulado de la cuenta cruzó los 5 M en el minuto 15:02 UTC | **Confirmado** (MEDIDO-REMOTO, sumado por minuto) |
| Las tres sentencias anteriores son el 98,4 % | **Confirmado**, con la reserva de la sección 12: el desglose por sentencia es muestreado y suma 6,09 M, no 5,47 M |
| Una carga del Home en staging lee unas 5.070 filas | **Confirmado**: 5.070 filas y 9 consultas a las 16:10 (MEDIDO-REMOTO); 5.085 en local |
| Hubo 960 cargas de sonda | **Confirmado** (REGISTRO) |
| Las sondas consumieron unos 4,87 M, el 89 % | **Estimado.** 960 × 5.070. Cloudflare no identifica el origen de cada consulta, pero los minutos de mayor consumo coinciden con las sondas |
| Los ~600.000 restantes fueron mi verificación con navegador | **Sin demostrar.** Los Workers no registran quién pidió. Pudo haber visitas del propietario |
| Palmera sufrió errores por el límite | **Indicio fuerte, no prueba.** Ver sección 9 |

**Corrección a lo que dije en UX-007:** afirmé «del orden de 10.000 filas por visita» sin medir. La cifra real es unas 5.070 por carga. También presenté las 960 solicitudes como causa sin esta evidencia; ahora queda respaldada, pero como una estimación del 89 %, no del total.

## 2. Cronología reconstruida (5-nov, UTC)

| Hora | Hecho | Filas de THE1500 en esa hora | Acumulado de la cuenta |
|---:|---|---:|---:|
| 00–11 | Solo cron: 12 ejecuciones por hora, 28 filas cada una | 336 / hora | 24.455 |
| 12 | Despliegue y verificación de UX-003 (12:46), sin sondas | 177.578 | 202.552 |
| 13 | **Sondas UX-004:** 13:35–13:38 (324), 13:39–13:42 (263), 13:46–13:48 (162) | **4.047.652** | 4.251.252 |
| 14 | Sonda UX-005: 14:57–14:59 (75) | 411.148 | 4.663.024 |
| 15:00–15:01 | Sonda UX-005: 64 cargas | 334.788 | ~5,0 M |
| **15:02** | **Se cruzan los 5 M** | | **≥ 5.000.000** |
| 15:33–15:34 | Sonda UX-006: 72 cargas | 370.352 | ~5,45 M |
| ~15:58–16:05 | Primeros rechazos que observé: 503 en estadísticas y error 7500 | | ~5,47 M |
| 16:20 | Última actividad medida en esta auditoría | 5.068 | 5.496.913 |

Filas por minuto en los picos de sonda (MEDIDO-REMOTO): 13:36 → 593.424, 13:37 → 588.352, 13:40 → 563.020, 13:47 → 557.920.

**Lo que no pude determinar:**
- **Cuándo empezó a aplicarse el límite.** Se siguieron registrando lecturas después de las 15:02, incluso cuando la API ya devolvía el error 7500, y el rechazo fue intermitente: al investigar, una carga de `/unirse` funcionó y las siguientes no. Cloudflare no expone esa marca en estas métricas.
- **Si las filas registradas tras el corte son lecturas reales** o intentos contabilizados.

## 3. Consumo por base de datos

| Base | Día | Consultas de lectura | De escritura | Filas leídas | Filas escritas |
|---|---|---:|---:|---:|---:|
| `the1500-staging` | 5-nov (parcial) | 11.985 | 1 | **5.468.716** | 2 |
| `palmera-v2-db-staging` | 5-nov (parcial) | 2.189 | 221 | 23.126 | 359 |
| `palmera-db` | 2 a 5-nov | sin actividad registrada | | 0 | 0 |
| `the1500-staging` | 4-nov | 6.284 | 3.293 | 774.054 | 25.466 |
| `palmera-v2-db-staging` | 4-nov | 3.663 | 442 | 39.850 | 811 |

Son las tres únicas bases de la cuenta.

- **Atribución del 5-nov:** THE1500 **99,6 %**, Palmera 0,4 %.
- **Sin THE1500:** Palmera habría usado el 0,46 % del límite ese día.
- **Antes, durante y después de las sondas (día 5):**
    - Antes (hasta las 13:34): unos 0,2 M.
    - Durante las ventanas de sonda y su entorno: unos 4,9 M.
    - Después: lo demás.
- **El 4-nov no cuenta para este límite** porque es diario, y tampoco lo agotó por sí solo: 813.904 filas en total.

## 4. Consultas más costosas (5-nov, `the1500-staging`)

Origen: `d1QueriesAdaptiveGroups`.

| # | Sentencia | Filas leídas | Ejecuciones | Filas devueltas | Filas leídas por devuelta |
|---:|---|---:|---:|---:|---:|
| 1 | `getSalesState`: `MIN(phase)`, `paid_free`, `price`, `founder_free` | 2.567.799 | 1.343 | 1.291 | 1.989 |
| 2 | `getPublicStats`: resumen por fase | 1.719.000 | 1.207 | 4.584 | 375 |
| 3 | `getPublicStats`: contadores globales | 1.704.000 | 1.170 | 1.136 | 1.500 |
| 4 | `listMosaicCompanies` | 40.223 | 1.390 | 9.709 | 4,1 |
| 5 | `getPositionMap` | 27.264 | 859 | 9.372 | 2,9 |
| 6 | `COUNT(*)` de publicadas | 10.752 | 1.417 | 1.344 | 8 |
| 7 | `COUNT(DISTINCT industry)` | 5.040 | 664 | 630 | 8 |
| 8 | `findPublicProfile` | 3.552 | 891 | 888 | 4 |
| 9 | `COUNT(*)` de comprobación (mía, manual) | 3.026 | 2 | 2 | 1.513 |
| 10 | `listRetiredPositions` | 2.382 | 1.193 | 1.191 | 2 |

### Desglose de la consulta nº 1 (MEDIDO-LOCAL, 1.986 filas)

| Parte | Filas | Problema |
|---|---:|---|
| `founder_free`: `COUNT(*) … number<101 AND status='available'` | **1.488** | El plan usa el índice por `status` y revisa todas las disponibles para contar unas 99. El código solo necesita saber si hay alguna |
| `paid_free`: `COUNT(*)` de disponibles de pago | 489 | Igual: solo importa si es cero |
| `price` | 5 | Repite `MIN(phase)` |
| `MIN(phase)` | 4 | Barata |

## 5. Consumo por ruta

MEDIDO-LOCAL sobre una copia con 9 empresas publicadas y 11 posiciones asignadas (staging tiene 7 y 10). Las columnas de 100 y 1.500 empresas usan copias con datos sintéticos.

| Ruta | Consultas | Filas @9 | Devueltas @9 | Filas @100 | Filas @1.500 | ¿Tiempo real? | Prioridad |
|---|---:|---:|---:|---:|---:|---|---|
| `GET /`, `/es/` | 9 | **5.085** | 31 | 5.813 | 16.492 | No: basta con segundos o minutos | CRÍTICO |
| `GET /unirse`, `/es/unirse` | 10 | **5.089** | 32 | 5.817 | 16.496 | La oferta informa; lo vinculante se comprueba al reservar | CRÍTICO |
| `GET /empresas`, `/es/empresas` | 8 | **5.073** | 19 | 5.801 | 16.480 | No | CRÍTICO |
| `GET /empresas?query=` | 8 | 5.033 | 11 | 5.306 | 9.005 | No | ALTO |
| `GET /api/v1/public/stats` | 5 | **5.006** | 8 | 5.097 | 6.004 | No; `max-age=15` solo en navegador | CRÍTICO |
| `GET /api/v1/public/companies` | 2 | 65 | 10 | 702 | **10.474** | No | ALTO |
| Ficha, `companies/:slug`, `:slug.json` | 1 | 4 | 1 | 4 | 4 | No | Correcto |
| `GET /api/v1/public/retired-positions` | 1 | 2 | 1 | 2 | 2 | No | Correcto |
| `GET /api/v1/public/search` | 1 | 8 | 1 | 8 | 8 | Sí, por consulta | Correcto |
| `POST /api/v1/public/ask` sin LLM | 2 | 10 | 2 | 10 | 10 | Sí, por consulta | Correcto |
| Cron cada 5 min | 12 | 28 remoto; 41 local | 0 | 40 | 40 | Sí | Correcto |
| Sesión con cookie | 1 | 2 (remoto, 296 ejecuciones) | 1 | | | Sí, privada | Correcto |
| `/mi-cuenta`, `/admin/*` | Varias, según acción | No medidas por separado | | | | Sí, privadas | Sin caché pública |

En staging la misma medición dio: `/api/v1/public/stats` 5.005 filas, Home 5.070 (MEDIDO-REMOTO). **Cada recarga repite todas las consultas:** no hay caché de ningún tipo en el servidor.

## 6. Consultas repetidas y análisis de código

### `getPublicStats()` — CRÍTICO
- **Dos recorridos completos de `slots` que podrían ser uno.** `EXPLAIN QUERY PLAN`: ambos hacen `SCAN slots USING COVERING INDEX idx_slots_phase_open`, 1.500 filas cada uno. Una sola agrupación por fase y estado da lo mismo: 1.500 filas en total (MEDIDO-LOCAL).
- **Ni siquiera hace falta recorrer:** seis contadores mantenidos en una tabla costarían **6 filas** (MEDIDO-LOCAL para la lectura).
- **`getSalesState()` lee 1.986 filas para decidir un estado** que requiere 4 con `EXISTS` y `LIMIT 1` (MEDIDO-LOCAL). Esta reescritura no altera el coste de los contadores de la página.
- **Escala parcial:** `COUNT` de publicadas y de sectores leen 10 filas hoy y 1.497 cada una con 1.500 empresas.

### `getPositionMap()` — respuestas a las preguntas obligatorias
- **Filas que examina:** 36 con 12 posiciones, 309 con 103, 4.497 con 1.499. Unas 3 por posición asignada. **No recorre las 1.500:** solo las asignadas o retiradas.
- **Índices:** `idx_slots_status_phase` (`status=?`), `sqlite_autoindex_companies_1` (`id=?`) e `idx_profiles_publication`.
- **Subconsulta correlacionada:** sí, un `EXISTS` sobre `profile_versions`, una por posición asignada, con índice cubriente. Es barata hoy, pero explica el crecimiento.
- **¿Se reconstruye en cada petición?** Sí. Hoy cuesta poco; con el muro lleno serían 4.497 filas por carga.
- **¿Se puede reutilizar?** Sí: es una cadena de 1.500 caracteres que se puede guardar en una sola fila.
- **¿Cuándo invalidarla?** Solo al asignar, retirar, publicar, retirar la publicación o suspender. Una reserva no la cambia, porque el mapa trata `held` como libre.

### `loadHome()` — ALTO
Lanza en paralelo cuatro operaciones con este coste (filas @9 / @1.500):

| Operación | @9 | @1.500 |
|---|---:|---:|
| `getPublicStats` (5 consultas) | 5.006 | 6.004 |
| `listMosaicCompanies` | 37 | 5.985 |
| `getPositionMap` | 36 | 4.497 |
| `listRetiredPositions` | 2 | 2 |
| `findPublicProfile` | 4 | 4 |

- **Solapamiento a escala:** el mosaico y el mapa recorren casi lo mismo. Una sola consulta los cubriría: 27 filas hoy, 3.001 con el muro lleno, frente a 10.482 (MEDIDO-LOCAL).
- **Hoy:** las operaciones distintas de estadísticas suman solo el 1,6 %. A escala dominan.

### `loadJoin()` — ALTO (introducido por mí en UX-007)
Sí repite trabajo, como sospechabas:
- Llama a `loadHome()` y luego vuelve a ejecutar `findPublicProfile()` para el mismo perfil.
- Pide `listMosaicCompanies()` y `listRetiredPositions()`, cuyos resultados no usa.
- Solo necesita estadísticas, oferta, mapa y un perfil.

El coste de esto hoy es pequeño (unas 43 filas). Con 1.500 empresas serían unas 6.000.

### `/empresas` — ALTO
Ejecuta `getPublicStats()` solo para una tarjeta de telemetría. Su listado lee 10.474 filas con el muro lleno para devolver 24 (cuenta total y orden sobre todo el conjunto).

### HTML dependiente de cookie — ALTO
`Shell.astro` lee la cookie de sesión para cambiar una etiqueta: «Sign in» o «My account». **Por eso hoy no se puede cachear ninguna página pública con seguridad.** Hay que resolverlo antes de cualquier caché de páginas, por ejemplo moviendo ese detalle al navegador.

## 7. Cron, sondeo y reintentos

### Cron — no es la causa
- **Función:** `sweepPayments` (se salta con los pagos desactivados) y `maintenanceSweep` (caducar invitaciones y reservas, onboarding, solicitudes legales, plazos, notificaciones).
- **Medido:** 12 consultas y 28 filas por ejecución; 144 consultas y **336 filas por hora**, 8.064 al día: **el 0,16 % del límite**.
- **Frecuencia efectiva:** exactamente 12 por hora, sin duplicados visibles.
- **Reintentos:** no hay en el código. No pude comprobar reintentos de la plataforma, pero el conteo constante no los sugiere.
- **Recomendación:** no tocarlo. Esas tareas son las que liberan reservas vencidas.

### Descartados expresamente, con evidencia

| Sospecha | Veredicto | Evidencia |
|---|---|---|
| **Animaciones y movimiento del mosaico** | **No acceden a D1** | Se ejecutan con `requestAnimationFrame` y WebGL en el navegador. `mosaic-stage.ts` solo hace `fetch` al **seleccionar** una empresa, con caché en memoria |
| Consultas durante el scroll | No | Los manejadores de scroll no contienen `fetch` |
| Polling en React en páginas públicas | No | `DiscoveryHub` solo consulta al enviar; `setInterval` solo existe en `AccountWorkspace` |
| Solicitudes duplicadas tras hidratación | No | Las islas públicas no piden datos al montarse |
| Prefetch de rutas | No | Astro no tiene `prefetch` configurado |
| Cambio de idioma | Sin coste extra | Es una navegación normal: una carga |
| Health checks o monitores | No existen en el repositorio | Entre las 00:00 y las 11:59 solo aparece el cron |
| Bots y rastreadores | Sin indicios | 12 peticiones por hora en esas horas (21 a las 02:00, sin lecturas añadidas). Staging está en `noindex`. Cloudflare no da agente de usuario en esta métrica |
| Webhooks | No | Sin actividad con los pagos desactivados |
| Batería remota | No el día 5 | Solo 1 consulta de escritura ese día. Las 3.264 de las 15:00 y las 17:00 del día 4 son de otro día y no cuentan para este límite; no determiné su origen exacto |

### Hallazgos menores
- **MEDIO. Sondeo tras el pago:** `AccountWorkspace.tsx:216` consulta cada 3,5 s al volver del pago, sin máximo, mientras no aparezca la posición. Solo afecta a usuarios autenticados en ese estado, pero conviene limitarlo.
- **MEDIO. Cabeceras:** `/api/v1/public/stats` tiene `max-age=15` y el JSON-LD `max-age=300`, ambas sin efecto en el servidor. El HTML público no declara nada.

## 8. Causa raíz

**Demostrado:**
1. **Causa estructural:** tres sentencias sobre `slots` hacen que cada carga pública cueste unas 5.000 filas, para producir datos casi estáticos, sin reutilización alguna.
2. **Desencadenante:** una actividad mía de alta frecuencia sobre esa ruta. Entre las 13:35 y las 15:34 hay 960 cargas registradas, y las horas de mayor consumo coinciden con ellas.

**Sin las sondas (DERIVADO):** el día habría acabado en unas 600.000 filas, sin llegar al límite. **Sin el diseño caro:** esas 960 cargas, a unas 109 filas cada una con contadores y la reescritura de `getSalesState()`, habrían costado unas 105.000 filas (estimado).

**Sigue siendo hipótesis:**
- El origen exacto de las ~600.000 filas restantes.
- El instante real en que se aplicó el límite.

## 9. Riesgo para Palmera

- **Responsable principal:** THE1500, con el **99,6 %** de las lecturas del día.
- **`palmera-v2-staging`:** **cero excepciones de 00:00 a 14:59; 1 a las 15:00; 5 de 12 peticiones a las 16:00** (6 en el día, MEDIDO-REMOTO). Coinciden con el agotamiento, pero **no he leído los mensajes de error**, así que es un indicio fuerte, no una prueba.
- **`palmera-food-gastro-bar`:** 1 petición en el día, sin errores. No se ve afectación.
- **`palmera-db`:** sin consultas registradas del 2 al 5 de noviembre. No se puede deducir si tiene usuarios o qué pasaría al usarla.
- **Modificaciones:** ninguna. Solo métricas de lectura.

**Esto volverá a pasar mientras compartan cuenta:** el límite es de toda la cuenta y Palmera no puede protegerse de THE1500. La separación sigue siendo necesaria, pero **migrar sin corregir las consultas solo traslada el problema**: THE1500 agotaría sola su propia cuota con unas 985 cargas.

**Otro límite compartido:** el plan gratuito de Workers permite 100.000 peticiones al día por cuenta. El 5-nov THE1500 hizo 1.505, así que no está en riesgo hoy, pero una caché dentro del Worker **no lo reduce**, y limitará el tráfico antes que D1 si se corrige lo demás.

## 10. Plan de corrección priorizado

No ejecutado. Requiere tu autorización.

| # | Nivel | Acción | Antes → después | Riesgo |
|---:|---|---|---|---|
| 0 | CRÍTICO | **Proceso:** nunca sondear páginas que lean D1. Para vigilar despliegues, pedir el HTML una vez y sondear solo recursos estáticos. Ya registrado | Evita la repetición | Ninguno |
| 1 | CRÍTICO | Reescribir `getSalesState()` con `EXISTS` y `LIMIT 1` | 1.986 → 4 filas | Bajo. Requiere pruebas de equivalencia en todos los modos de venta; el modo sigue saliendo de datos reales |
| 2 | CRÍTICO | Unificar los dos recorridos de `getPublicStats()` | 3.000 → 1.500 filas | Bajo, sin migración |
| 3 | CRÍTICO | Tabla de contadores mantenida por triggers en `slots` | 1.500 → 6 filas | Medio: requiere migración y pruebas de consistencia. Coste: escrituras extra solo al cambiar una posición |
| 4 | ALTO | Separar del HTML la etiqueta dependiente de la cookie | Permite la caché | Bajo |
| 5 | ALTO | Acotar `loadJoin()` y quitar `getPublicStats()` de `/empresas` si la tarjeta no se justifica | ~43 filas hoy; ~6.000 a escala | Bajo |
| 6 | ALTO | Una sola consulta para mapa y mosaico; a escala, guardar el resultado en una fila | 10.482 → 3.001 → unas pocas filas a escala | Medio |
| 7 | ALTO | Caché HTTP de páginas públicas (sección 11) | Depende de la tasa de acierto | Medio |
| 8 | ALTO | Listado de `/empresas` con paginación por cursor | 10.474 → ~100 (estimado) a escala | Medio |
| 9 | MEDIO | Máximo de intentos en el sondeo tras el pago | | Bajo |
| 10 | MEDIO | Vigilancia diaria de filas por base, con un solo informe al día vía GraphQL | Aviso antes del límite | Bajo |
| 11 | ALTO | Separar THE1500 en su propia cuenta, **después de 1 a 3** | Protege a Palmera | Decisión tuya |

Los puntos 1 y 2 no requieren migración y por sí solos bajan cada página de 5.070 a unas 1.600 filas (MEDIDO-LOCAL por partes).

### Comparación de opciones de caché

Según la documentación consultada, sin haberlas probado:

| Opción | Reduce lecturas D1 | ¿Ejecuta el Worker? | Invalidación | Notas |
|---|---|---|---|---|
| **Mejoras SQL** | Sí, siempre | Sí | No aplica | Primero. Sin riesgo de datos viejos |
| **Workers Caching** (`Cache-Control`) | Sí, con recolapso de peticiones | No en acierto | `ctx.cache.purge()` por etiqueta, global | Candidata principal. **Pendiente comprobar disponibilidad en el plan gratuito y si un acierto cuenta para las 100.000 peticiones** |
| **Cache API** (`caches.default`) | Sí | Sí, siempre | `cache.delete` solo en ese centro de datos | Cada ubicación tiene su copia. Su funcionamiento en `workers.dev` hay que comprobarlo |
| **Tabla de contadores en D1** | Sí, siempre | Sí | Transaccional, por trigger | Sin datos viejos. Sin servicio nuevo |
| **KV, Durable Objects** | | | | No propuestos: lo anterior basta |

### Reglas de consistencia para cualquier caché
- **Nunca** en caché pública: `/mi-cuenta`, `/login`, `/auth`, `/admin`, ni cualquier respuesta con `Set-Cookie` o que dependa de la sesión.
- **Las decisiones comerciales siguen en D1.** `createCheckoutHold()` ya vuelve a comprobar el modo y toma el número con una sentencia atómica; ninguna página cacheada puede adjudicar nada.
- **Precio al contratar:** debe salir siempre del servidor en el momento de reservar y pagar, no de una página cacheada.
- **Datos que pueden quedar viejos:** una página cacheada puede mostrar disponibilidad con retraso. Por eso conviene un TTL corto y una purga al cambiar de fase, cerrar la venta, publicar o retirar.
- **Copias por ubicación:** el diseño no puede depender de `cache.delete`, que solo actúa en un centro de datos.

## 11. Modelo de capacidad

**Visita (HIPOTÉTICA):** 1 Home + 0,4 Unirse + 0,3 Directorio + 0,3 Ficha + 0,2 Búsquedas. Un visitante son unas 3 peticiones que leen D1. Se suman 8.064 filas al día del cron. No hay datos reales de navegación, porque no hay clientes.

| Escenario | Base | Filas por visita | 100 visitas/día | 1.000 | 10.000 | 100.000 | Visitas/día hasta 5 M |
|---|---|---:|---:|---:|---:|---:|---:|
| **Actual, 9 empresas** | MEDIDO | 8.645 | 0,87 M | **8,7 M** | 86 M | 865 M | **577** |
| **Actual, 1.500 empresas** | MEDIDO | 28.037 | 2,8 M | **28 M** | 280 M | 2.804 M | **178** |
| **SQL optimizado, 9** (planes 1, 2, 5, 6) | MEDIDO por partes | 2.657 | 0,27 M | 2,7 M | **27 M** | 266 M | **1.878** |
| **SQL optimizado, 1.500** | MEDIDO por partes | 14.999 | 1,5 M | **15 M** | 150 M | 1.500 M | **332** |
| **SQL + contadores + mosaico en una fila** (planes 1 a 6, 8) | ESTIMADO de diseño | ~60 | 14.000 | 68.000 | 0,6 M | **6 M** | **~83.000** |
| **Lo anterior + caché, 90 % de acierto** | HIPOTÉTICO | ~6 | 8.700 | 14.000 | 68.000 | 0,6 M | **~830.000** |

Las negritas de las columnas de visitas superan el límite gratuito.

**Lecturas clave:**
- **El problema empeora al crecer.** Con el diseño actual, un producto exitoso aguanta **menos** visitas: 578 hoy, 178 con el muro lleno.
- **Solo SQL no basta a escala:** mejora mucho hoy, pero con 1.500 empresas hay que dejar de reconstruir el mosaico.
- **La estructura correcta hace que el coste dependa de los cambios, no de las visitas:** reconstruir el mosaico al publicar cuesta unas 10.000 filas por evento, muy pocas veces al día.
- **El 90 % de acierto es un supuesto, no una predicción.** Sin caché, 10.000 visitas al día ya entran en el límite con el diseño correcto.
- **A partir de unas 33.000 visitas diarias** (a 3 peticiones cada una) se alcanza el límite de 100.000 peticiones de Workers, sea cual sea la mejora de D1, salvo que los aciertos de caché no cuenten. Hay que comprobarlo.

## 12. Evidencias y metodología

**Remoto, solo lectura:**
- `wrangler d1 info <base>` para el resumen de 24 h.
- `wrangler d1 insights the1500-staging --sort-by=reads --limit=25 --json`.
- GraphQL Analytics con la sesión de Wrangler ya autorizada, en cuatro consultas:
    - `d1AnalyticsAdaptiveGroups` por hora y por minuto.
    - `d1QueriesAdaptiveGroups` del 5-nov.
    - `workersInvocationsAdaptive` por hora y estado.

**Local:**
- Arnés que envuelve `env.DB` y registra `meta.rows_read` de cada sentencia, llamando a las mismas funciones de `src/core` que usa cada ruta.
- Copias desechables de la D1 local. Las de 100 y 1.500 empresas usan datos sintéticos, con los triggers de esas tablas retirados solo en la copia.
- `EXPLAIN QUERY PLAN` de las cinco consultas principales.

**Límites de la evidencia:**
- **Discrepancia entre fuentes:** `d1AnalyticsAdaptiveGroups` da 5.468.716 filas; el desglose por sentencia suma 6.089.956, un 11 % más, sobre el mismo día. También difiere `d1 info` (5.927.232), que cubre 24 h móviles. Uso la primera para los totales y la segunda solo para las proporciones. **No pude determinar la causa de la diferencia**; podría deberse al muestreo adaptativo.
- **`wrangler d1 insights --time-period=1d` abarca más de lo que indica:** devolvió sentencias `ALTER TABLE` y altas del 4-nov. Por eso no lo uso para el día del incidente.
- **Cloudflare no identifica el origen de una consulta.** La atribución a las sondas se basa en la coincidencia temporal y en el recuento.
- **No hay texto de los errores de Palmera:** las métricas indican `scriptThrewException`, no la causa.
- **Mensajes de error de THE1500:** no consulté registros históricos, que no estaban disponibles.
- **Datos del 5-nov incompletos:** el día no había terminado, y las cifras más recientes pueden seguir ajustándose.
- **Diferencia entre local y remoto:** el Home costó 5.085 filas en local con 9 empresas y 5.070 en staging con 7. Son coherentes, pero el resto de las cifras por ruta son locales.
- **Sin probar:** las reescrituras se midieron como lecturas; las equivalencias funcionales se comprobarán en el sprint de corrección. La fila de contadores se probó solo como lectura, sin triggers.
