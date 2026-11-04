# CORE-006 — Estado de entrega

**Fecha:** 2026-11-04 · **Versión:** 0.6.0 · **Repositorio:** https://github.com/Edergope/the1500 (privado), rama `feature/core-claude`.
**Evidencia:** `docs/CORE006_REMOTE_EVIDENCE.txt`, `docs/CORE006_QA.txt`, `docs/CORE005_E2E_EVIDENCE.txt`. **Contrato:** `docs/API_CONTRACT.md` v1.1. **Staging:** `docs/STAGING.md`. **Secretos:** `docs/SECRETS_AND_INTEGRATIONS.md`.

> `DONE` significa implementado y verificado en el Worker desplegado con D1 y R2 remotos, salvo donde se indique "local". Correo, Stripe y LLM reales **no** se han ejercitado. **No está listo para producción ni para cobrar.**

## Decisiones del propietario aplicadas (2026-11-04)

| Decisión | Implementación | Estado |
|---|---|---|
| Retiro: el titular solicita, administración ejecuta, con trazabilidad | Ejecutar exige solicitud. Ejecución y rechazo guardan quién, cuándo, motivo y evidencia, y avisan al titular | DONE. Rechazo: local |
| Publicado: cupo consumido; retirado desaparece de ficha, buscador, JSON-LD y asistente; número visible como «Cupo retirado — No disponible» | Protegido también por triggers | DONE |
| Solicitudes legales | `legalBasis`, registro por administración si llegan de fuera, primeras en la cola, plazo fijado por administración, incidencia crítica si vence | DONE. Alerta de vencimiento: local |
| Reactivación: solicitud hasta el día 45; 15 días desde aprobación notificada; sin prórroga; reincidir lleva a revisión individual sin perder cupo ni dinero | El plazo arranca al entregarse el aviso, o al registrar administración otro medio de aviso con evidencia | DONE. Arranque por correo y vencimiento: local |
| Pagos tardíos: conciliación humana | Hechos: momento del pago y su fuente, fin de reserva, estado del número, disponibilidad real. Decisión con evidencia. Solo toma un número libre | DONE. Fuente `provider_charge` y reembolso: local |
| Decisión 64: formulario en el portal, sin checkout, reunión opcional | `POST /me/company/premium-request` | DONE |
| Entidad vendedora sin definir | Sigue como configuración, sin nombres en código, sin cobros reales | Sin cambios |

**Criterio aplicado, a corregir si no es lo que quieres:** el formulario Premium solo admite solicitudes cuando Premium es el tramo disponible, porque la Decisión 64 se plantea para "cuando el siguiente tramo disponible sea Premium". Es una línea en `submitPremiumRequest`.

## Matriz de integración

| Módulo | Estado | Notas |
|---|---|---|
| Migraciones 0001–0007 en D1 remoto | DONE | |
| Worker de staging y cron real | DONE | El cron venció una reserva sin tráfico HTTP |
| Concurrencia en D1 remoto | DONE | Ver abajo |
| Copia inmutable en R2 remoto | DONE | |
| Sesiones, cookie, enlaces de un solo uso, aislamiento | DONE | Los enlaces se sembraron en D1 |
| Envío real de correo | BLOCKED | Falta `RESEND_API_KEY` y dominio verificado |
| Stripe sandbox real | BLOCKED | Faltan claves de prueba. Webhooks probados con firma válida contra la ruta real, sin Stripe |
| LLM real | BLOCKED | Falta `AI_API_KEY`. Controles sin calibrar |
| Modo real de pagos | BLOCKED | Requiere entidad, impuestos y autorización |
| Última notificación y plazos de resolución (Decisiones 22–24) | PARTIAL | Pasa a revisión con incidencia; el flujo sigue siendo manual |
| Contracargo perdido sobre publicado (Decisión 28) | PARTIAL | Abre incidencia; plazo manual |
| Pagador tercero (Decisión 45) | PARTIAL | Se guarda el correo del pagador |
| Impuestos y ofertas revisadas (50–63) | NOT_STARTED | Bloquea cobro real |
| Transferencia bancaria (43–44), facturación (46–49), reembolso a medio alternativo (25) | NOT_STARTED | |
| Interfaz | NOT_STARTED aquí | Antigravity. Pruebas de navegador con su UI |

## Resultados en D1 remoto

| Prueba | Resultado |
|---|---|
| 40 reservas simultáneas | 40 aceptadas, todas distintas, 101–140. p50 901 ms, p95 1.018 ms |
| 60 webhooks simultáneos, con duplicados | Exactamente 20 adjudicaciones, 101–120, 20 asientos de auditoría, 3,5 s |
| 15 compradores por los últimos 5 cupos pagados | Exactamente 5 ganan. Ninguna venta sobre 600 ni en 1–100 |
| 55 verificaciones de acceso simultáneas | 55 sesiones, 663 ms |
| 6 publicaciones simultáneas, con FTS5 | Todas correctas (regresión A-13) |
| Nueva versión del Worker | Datos, publicaciones y sesiones se conservan |

Las latencias se midieron desde un solo cliente hacia una base en el este de Estados Unidos: orientativas, no una prueba de carga. El volumen es de decenas, no de miles.

## Limitaciones que conviene conocer

1. **El retiro no borra datos internos.** Las versiones aprobadas siguen en D1 y las copias en R2, con el contenido bloqueado por diseño. Una solicitud de supresión legal puede exigir más que sacarlo de la vista pública, y hoy eso sería una operación manual. Conviene validarlo con asesoría.
2. **No hay ocultación temporal reversible.** Ante un contenido presuntamente ilícito, hoy las opciones son reabrir para rectificar o el retiro definitivo.
3. **Los terceros no tienen formulario.** Administración registra lo que le llegue por cualquier vía.
4. **Pagos:** en staging, una reserva se crea aunque los pagos estén apagados y `stats.checkoutOpen` indica solo el estado de venta. El contrato le dice al frontend que use `checkoutEnabled`.

## Para continuar

Local:
```bash
npm ci
```
```bash
npm run db:migrate:local
```
```bash
npm run test:local
```
```bash
npm run test:e2e
```
