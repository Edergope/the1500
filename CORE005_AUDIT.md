# CORE-005A — Auditoría técnica de THE1500 CORE-004 v0.3.0

**Fecha:** 2026-11-03 · **Base auditada:** commit `59e1119` en git local, manifiesto SHA-256 verificado (100/100 archivos).
**Entorno:** macOS, Node 22.23.2, npm 10.9.8, Python 3.9.6, Wrangler 4.157, workerd vía `getPlatformProxy` y `wrangler dev`.

> Este documento describe el código **tal como se entregó**. Lo corregido después figura en la sección 7 y en `CORE005_STATUS.md`.
> No se tocó Cloudflare remoto, Stripe real, un LLM real ni correo real.

## 1. Comandos ejecutados sobre el código entregado

| Comando | Resultado | Evidencia |
|---|---|---|
| `npm install` | **FALLA** `ERESOLVE`: `astro@^6` contra `@astrojs/cloudflare@^14` (exige `astro@^7.4`); también `workers-types@^4` contra `wrangler` (`^5`) | El manifiesto nunca pudo instalarse. La QA anterior lo registró como "no ejecutado". |
| `npm run test:db` | PASA, 42 pruebas | Solo esquema, con `sqlite3` de Python, no D1. |
| `npm run test:types:isolated` | No corrió hasta arreglar la instalación; luego PASA | Usaba tipos D1 escritos a mano, no los reales. |
| `npm run test:core:runtime` | No corrió hasta arreglar la instalación; luego PASA, 24 comprobaciones | Adaptador sobre SQLite de Node, no workerd. Ocultó A-13. |
| `npm run build` | **FALLA** `main` de `wrangler.jsonc` apunta a `dist/_worker.js/index.js`, inexistente (formato de Astro ≤5). En Astro 6, además, `Syntax error "$"` en `src/pages/empresas/index.astro` | Corregido. |
| `npm audit` con Astro 6.4.8 | **1 crítica, 1 alta, 1 moderada, 1 baja**: RCE por AVIF, XSS, bypass de autorización. Solo se corrigen en `astro>=7.3.2` | Con `astro@^7.4`: 0 vulnerabilidades. |
| `wrangler d1 migrations apply DB --local` | PASA 0001–0005 | Primera evidencia sobre el motor D1. |
| `wrangler dev` + curl de páginas y APIs públicas | 200; `stats` real desde D1 | `request-link` devuelve 503 correctamente sin proveedor de correo. |

## 2. Hallazgos

Severidad: **C** crítica · **A** alta · **M** media · **B** baja. "Sonda" = reproducido con un script contra el motor D1 real.

### Seguridad e integridad

| ID | Sev | Hallazgo | Evidencia |
|---|---|---|---|
| A-13 | C | **Publicar nunca habría funcionado en D1 real.** `publishProfile` exigía `meta.changes===1` en el insert a FTS5, pero D1 devuelve 3 (tablas internas). Cada publicación habría devuelto `PUBLICATION_CONFLICT` *después* de confirmar su lote: datos publicados y error al usuario. El adaptador SQLite devolvía 1, así que el "PASS" anterior era una falsa garantía. | Sonda: `{changes:3,rows_written:1}` |
| A-01 | C | Las dependencias no instalaban, y los avisos críticos de Astro aplicaban al stack documentado "Astro 6". | §1 |
| A-02 | A | **Autoverificación de dominio eludible.** `x@foo.co.uk` registrando `https://co.uk` y `x@gmail.com` registrando `gmail.com` quedan `self_declared` y `checkoutEligible=true`. Incumple la Decisión 13. | Sonda |
| A-03 | A | **Fuga de la condición de fundador.** Con fundadores fijos en 1–100, cualquier posición pública ≤100 delata a un fundador, en tensión con la Decisión 35. El propietario confirmó el rango fijo y mantener público el número (2026-11-03): ver §4. **Aceptado por el propietario.** | `inventory.ts`, trigger de `0005` |
| A-04 | A | No existía retiro: la única "retirada" era una prueba con SQL directo. Decisiones 17 y 29 sin implementar. | `grep` |
| A-05 | A | Sin marca irreversible de primera publicación en `slots` (Decisiones 17, 30). Nada en la base impedía volver a `available` un cupo publicado. | 0001–0005 |
| A-06 | M | `reviewCompany` con sitio web duplicado producía un `D1_ERROR` crudo y un 503 genérico. | Sonda |
| A-07 | M | Se podía publicar una versión aprobada anterior tras una más nueva: la página usaba `MAX(version)` y el índice el texto antiguo. | Revisión |
| A-08 | M | El contenido aprobado no era inmutable: el digest aprobado no garantizaba lo publicado. | Revisión |
| A-09 | M | Sin ventana de corrección (Decisión 06): se podían publicar versiones indefinidamente. | Revisión |
| A-10 | M | Sin limitador utilizable para el coste de LLM en `/public/ask`. | Revisión |
| A-11 | M | Sin cabeceras de seguridad generales y sin registro en `apiError`: los fallos de producción serían invisibles. | Revisión |
| A-12 | B | Bindings `SESSION` (KV) e `IMAGES` autoprovisionados que el core no usa. | Log de build |

### Corrección funcional

| ID | Sev | Hallazgo | Evidencia |
|---|---|---|---|
| B-01 | A | **Concurrencia:** N=20 reservas válidas simultáneas → **1 éxito, 19 `SLOT_CONFLICT`**. Sin sobreventa, pero rechaza compradores legítimos justo en el escenario de lanzamiento. | Sonda |
| B-02 | A | **La ruta de pago no existía:** sin `assign_paid`, checkout ni webhook. Solo los fundadores podían obtener cupo. | `grep` |
| B-03 | A | **Sin flujo de IA:** el "perfil" era una copia determinista. Sin declaración, consentimiento, procedencia ni evento de inicio (Decisiones 11, 12). | `profiles.ts` |
| B-04 | A | JSON-LD con propiedades no válidas para `Organization` (`inLanguage`, `industry`), `@id` no resoluble, sin problemas/soluciones ni procedencia. | `buildJsonLd` |
| B-05 | M | Búsqueda sin filtros `industry`/`service`; `ask` aceptaba cualquier palabra como evidencia y sus citas no traían cita textual ni digest. | `search.ts` |
| B-06 | M | Sin modo archivo ni `salesMode`; sin endpoints admin de pagos, incidencias, retiradas, Premium. | Revisión |
| B-07 | M | Plazos de incorporación (Decisiones 19–23, 34) ausentes. | `grep` |
| B-08 | M | Sin i18n de errores ni comunicaciones; invitaciones de fundador nunca enviadas por correo. | Revisión |
| B-09 | M | Sin revocación global ni bloqueo; el rol `editor` existía en el esquema pero ninguna ruta lo respetaba. | Revisión |
| B-10 | B | Tablas muertas `orders`/`payment_events`; `purchase_attempts` sin los estados de las Decisiones 18 y 42. | Migraciones |
| B-11 | B | Restricción de Stripe sin modelar: `expires_at` debe estar entre **30 min y 24 h** ([referencia](https://docs.stripe.com/api/checkout/sessions/create)), así que una sesión de 20 minutos es imposible. | Referencia API, 2026-11-03 |

### Documentación contra código

| Documento | Afirma | Realidad |
|---|---|---|
| README, `CORE_ARCHITECTURE_v1.md` | "Astro 6" | No instalable con ese adaptador; inseguro según `npm audit`. |
| `API_CONTRACT.md` v0.2 | Sin fundadores ni RAG en una sección, los describe en otra | Contradictorio; sin DTOs ni catálogo de errores. |
| `README.md` | "Ejecuta `npm run build`" | Fallaba. |
| `CORE_ARCHITECTURE_v1.md` | Contratos Zod, snapshots R2, adaptador Stripe | Nada de eso existía. |
| `LAUNCH_GATE.md` | Estado "Sprint 0" | Desactualizado. |

## 3. Verificado como correcto en lo entregado

Migraciones sobre el motor real · 1.500 cupos y CHECK de tramos · secuencia por `MIN(phase)` (cubre la reapertura de la Decisión 40) · TTL de 20 minutos · magic link de un solo uso con digest · revocación al cerrar sesión · validación de origen · invitación de fundador con auditoría · aprobación expresa con digest · trigger de FTS al retirar.

## 4. Contradicciones entre decisiones

| # | Contradicción | Tratamiento |
|---|---|---|
| 1 | **Decisión 05:** los fundadores ocupan "los primeros 100 de los 600". **Decisiones 31, 32 y 35** (posteriores y más específicas): numeración ascendente por orden de confirmación dentro del tramo, y la condición de fundador no puede revelarse. Un rango fijo 1–100 delata a cada fundador. | **Resuelto por el propietario el 2026-11-03: fundadores fijos en 1–100, pagados en 101–600.** El propietario acepta además mantener público el número, aunque las posiciones 1–100 identifiquen a los fundadores. |
| 2 | Decisión 01 nombra a Aurea Investment Capital SAS; la nota estratégica la reabre. | El vendedor es configuración (`legal_seller_configuration`, `unapproved`). Ningún nombre de entidad en el código. |
| 3 | Decisiones 50–63 (revisión fiscal, ofertas) contra nota estratégica puntos 4–5 (simplificar, suspender microdecisiones). | Sin implementar; el modo real sigue bloqueado. Riesgo de lanzamiento. |
| 4 | Decisión 38 (secuencia estricta) + Decisión 32 (fundadores solo por invitación): si se venden los 500 pagados y no se completan las invitaciones, el tramo 2 **nunca abre**. | **Confirmado por el propietario el 2026-11-03:** se vende 101–600 mientras se incorporan los fundadores, y 601–1050 solo abre con las 600 definitivamente adjudicadas. Visible como `salesMode:"awaiting_founder_allocation"`. |

## 5. Bloqueos externos

| Dependencia | Bloquea | Requiere |
|---|---|---|
| Autorización de Cloudflare e IDs reales de D1/R2 | Prueba en D1 remoto, staging, cron real | Propietario |
| Claves de prueba de Stripe (`sk_test_…`, `whsec_…`) | Ida y vuelta real en sandbox | Propietario, tras decidir vendedor |
| Clave de API de LLM | Generación y respuestas reales | Propietario |
| Clave de Resend y dominio verificado | Correo real | Propietario |
| Decisión de entidad vendedora | Modo real, términos, facturas | Propietario |
| Pregunta 64 | Canal de admisión Premium | Propietario |
| Reglas fiscales (Decisiones 50–63) | Totales en checkout real | Propietario / asesor |

## 6. Riesgos de lanzamiento

1. D1 remoto sin ejercitar: latencia y replicación sin probar. Las escrituras se serializan, así que el SQL atómico debería mantenerse, pero falta evidencia en staging.
2. La apertura del tramo 2 depende de completar las 100 adjudicaciones de fundador (regla confirmada, contradicción 4).
3. Sin motor fiscal: el checkout real debe seguir cerrado.
4. Los controles sobre lo que escribe la IA son heurísticos, no prueba de veracidad. El control real sigue siendo la aprobación del titular sobre el digest exacto. También pueden rechazar textos válidos (por ejemplo, un país mencionado en la traducción), y entonces el perfil queda con las palabras del titular: hay que calibrarlos con un modelo real.
5. FTS5 es búsqueda léxica con raíces en inglés: peor exhaustividad en español y sin sinónimos. No puede venderse como búsqueda semántica.
6. `wrangler d1 export` no admite tablas virtuales: hace falta un procedimiento de respaldo que excluya FTS y lo reconstruya.

## 7. Estado de los hallazgos

Corregidos y cubiertos por pruebas: A-01, A-02, A-04 a A-11, A-13, B-01 a B-11. A-03: riesgo aceptado por el propietario; no requiere cambio. Parcial: A-12 (`IMAGES` eliminado; `SESSION` sigue autoprovisionándose, sin uso; bajo riesgo).

## 8. Actualización CORE-006 (2026-11-04)

Primer riesgo de §6 cerrado: las reservas, confirmaciones y publicaciones se ejercitaron en D1 remoto (`docs/CORE006_REMOTE_EVIDENCE.txt`). A-12 corregido: sesiones de Astro desactivadas, ya no se aprovisiona KV. Pregunta 64 resuelta: formulario en el portal. Sigue abierto el resto de §5 y §6.
