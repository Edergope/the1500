# CORE-005 — Estado de entrega

**Fecha:** 2026-11-03 · **Versión:** 0.5.0 · **Rama:** `feature/core-claude` (git local, sin remoto).
**Evidencia:** `docs/CORE005_QA.txt`, `docs/CORE005_E2E_EVIDENCE.txt`. **Contrato:** `docs/API_CONTRACT.md`. **Auditoría:** `CORE005_AUDIT.md`.

> **Lectura obligada.** `DONE` significa implementado y verificado **en workerd con D1 local**, y contra **simuladores locales** de Stripe, LLM y correo. Ningún proveedor real ni Cloudflare remoto ha sido ejercitado. **El core no está listo para producción ni para cobrar.**

## Matriz

| Módulo | Estado | Notas |
|---|---|---|
| Instalación, build, tipos reales, `npm audit` = 0 | DONE | Astro 7.4 por avisos críticos de la 6 |
| Migraciones sobre motor D1 | DONE | Local. Remoto: BLOCKED |
| Inventario: 1.500, tramos, secuencia, 20 min, ascendente, sin sobreventa | DONE | Probado con concurrencia en D1 y por HTTP |
| Fundadores: posiciones 1–100, invitación 7 días, aceptación, adjudicación administrativa, revocación, correo en cola | DONE | Confirmado por el propietario el 2026-11-03; rango protegido por trigger |
| Cupo publicado irrevocable, retiro, `Cupo retirado — No disponible` | DONE | Protegido también por triggers. Etiqueta en inglés pendiente de aprobación |
| Modo archivo (`closed_archive`) | DONE | |
| Identidad: enlace mágico, sesiones revocables, roles, aislamiento, duplicados, auditoría | DONE | Lista de dominios y sufijos compartidos es heurística, no PSL completa |
| Motor de perfiles: declaración, consentimiento, IA, validación, vista previa, aprobación, publicación, HTML, JSON-LD, export, procedencia | DONE | Adaptador probado contra simulador |
| Llamada a un LLM real | BLOCKED | Falta clave. Los controles aún no se han calibrado con un modelo real |
| Copia inmutable en R2 | DONE | Local |
| Directorio, filtros, búsqueda por problema, estadísticas | DONE | Léxica, declarado así en la API |
| Asistente con citas verificables y abstención | DONE | Con simulador; sin clave responde `retrieval_only`, etiquetado |
| Administración: empresas, fundadores, ocupación, perfiles, retiradas, incidencias, pagos, vendedor | DONE (API) | Pantallas: Antigravity |
| Premium | PARTIAL | Registro y asignación por personal. Canal público BLOCKED por Pregunta 64 |
| Stripe: sesión, firma, idempotencia, importe, tardíos, conciliación, reembolso, disputas | PARTIAL | Completo contra simulador. Sandbox real BLOCKED: faltan claves |
| Modo real de pagos | BLOCKED | Claves `sk_live_` rechazadas en código; requiere entidad, impuestos y autorización |
| Internacionalización en-US / es | DONE (core) | Errores, correos, respuestas, JSON-LD. Textos de IA según proveedor |
| Plazos de incorporación (días 15, 30, 45) con cron | DONE | |
| Última notificación y plazos de resolución (Decisiones 22–24) | PARTIAL | Pasa a revisión con incidencia; el flujo de 7 días y 5 hábiles es manual |
| Contracargo perdido sobre publicado (Decisión 28) | PARTIAL | Abre incidencia; plazo de 15 días manual |
| Impuestos y ofertas revisadas (Decisiones 50–63) | NOT_STARTED | Bloquea cobro real. La nota estratégica pide simplificar: decidir antes de construir |
| Transferencia bancaria (Decisiones 43–44) | NOT_STARTED | |
| Facturación y datos fiscales (Decisiones 46–49) | NOT_STARTED | Depende de la entidad |
| Pagador tercero (Decisión 45) | PARTIAL | Se guarda el correo del pagador; sin autorización documentada |
| Reembolso a medio alternativo (Decisión 25) | NOT_STARTED | Solo al medio original |
| D1 remoto, staging, cron real, webhook real | BLOCKED | Requiere autorización |
| Pruebas de navegador | NOT_STARTED | Con la UI de Antigravity |

## Pruebas obligatorias

| # | Requisito | Dónde | Resultado |
|---|---|---|---|
| 1 | Nunca más de 1.500 | `inventory` T01 | PASA |
| 2 | Sin doble adjudicación | `inventory` T02 (concurrente), E2E | PASA |
| 3 | Fundadores consumen cupos reales | `inventory` T03 | PASA |
| 4 | Precios por tramo | `inventory` T04 (600/601/1050/1051/1350/1351) | PASA |
| 5 | Reserva caducada no adjudica | `inventory` T05, `payments` tardíos | PASA |
| 6 | Webhook duplicado sin doble compra | `payments` T06, E2E | PASA |
| 7 | Empresa ajena | `profiles` T07, E2E HTTP | PASA |
| 8 | Sin aprobar no se publica | `profiles` T08, E2E | PASA |
| 9 | Retirada desaparece | `profiles` T09, E2E | PASA |
| 10 | JSON-LD válido y sin datos privados | `profiles` T10 | PASA con lista blanca propia de vocabulario. Falta validador oficial de Schema.org |
| 11 | Solo publicados | `profiles` T11 | PASA |
| 12 | Referencias verificables | `profiles` T12, E2E (digest) | PASA |
| 13 | Inglés y español | `profiles` T13, E2E | PASA |
| 14 | Modo archivo | `inventory` T14 | PASA |
| 15 | Fallos externos | `payments` y `profiles` T15 | PASA |

Totales: 42 esquema · 73 integración en motor D1 · 27 pasos E2E en workerd.

Confirmado por el propietario el 2026-11-03: fundadores en 1–100, pagados en 101–600, numeración ascendente en cada grupo, ventas de 101–600 mientras se incorporan los fundadores, y 601–1050 solo con las 600 definitivamente adjudicadas. También confirmó mantener público el número de posición, aunque 1–100 identifique a los fundadores.

## Decisiones que se necesitan del propietario

1. **Retiro:** el titular solicita y administración ejecuta. Es lo más prudente por ser irreversible, pero no consta en una decisión.
2. **Reactivación:** tras reactivar no se fija nuevo plazo, porque ninguna decisión lo define.
3. **Pregunta 64** y **entidad vendedora**.
4. **Pagos tardíos con tarjeta:** van siempre a conciliación humana. La Decisión 44 fija reglas para transferencias; aquí se aplicaron por analogía, sin autoasignar.

## Para continuar

Local:
```bash
npm ci
npm run db:migrate:local
cp .env.example .dev.vars
npm run test:local
npm run test:e2e
```

Staging, cuando se autorice:
1. `npx wrangler d1 create the1500-staging` y poner el ID en `wrangler.jsonc`. `npx wrangler r2 bucket create the1500-staging-snapshots`.
2. `npm run db:migrate:remote`.
3. `npx wrangler secret put` para `RESEND_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `AI_API_KEY`.
4. `PUBLIC_BASE_URL`, `MAIL_FROM` y `PAYMENTS_ENABLED=true` solo con `sk_test_`.
5. Webhook de Stripe en `/api/v1/webhooks/stripe` con: `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`.
6. Repetir la concurrencia contra D1 remoto, un pago de prueba real y una generación con el LLM real.
7. Alta del primer administrador: `docs/CORE004_IMPLEMENTATION.md` §3.

Antigravity consume `docs/API_CONTRACT.md` y los tipos de `src/lib/contracts/api.ts`. Las páginas provisionales solo recibieron el mínimo técnico para el nuevo JSON-LD.
