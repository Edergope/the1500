# CORE-008 — Avance sin dominio

**Fecha:** 2026-11-04 · **Versión:** 0.8.0 · **Instrucción del propietario:** continuar en staging en la cuenta disponible, sin que el dominio bloquee el desarrollo, sin planes de pago, producción ni cobros reales.

Cuenta verificada antes de cambiar nada: la de Wrangler, `25765199cf0c529e38b9b70fc3de0851`. Solo se tocaron recursos `the1500-*`.

## Hecho

| Decisión | Implementación | Estado |
|---|---|---|
| 22, 23, 34 | Última notificación, 7 días desde la entrega, respuesta del titular, decisión con evidencia en 5 días hábiles, alerta si vence. El silencio no cancela | DONE. Envío por correo: local |
| 24 | Fecha límite de 5 días hábiles para ordenar un reembolso, con alerta | DONE (local) |
| 25 | Reembolso por medio alternativo, con constancia y sin datos financieros | DONE (local) |
| 28 | 15 días para regularizar un contracargo perdido; despublicar es decisión humana y el cupo sigue consumido | DONE (local) |
| 45 | Pagador distinto del titular: el cupo sigue en la empresa, con revisión y autorización documentada | DONE (local) |
| Acceso | **Fallo corregido:** el enlace de acceso no funcionaba en navegadores reales | DONE, con navegador |
| Antigravity | `docs/ANTIGRAVITY_BRIEF.md`, datos de demostración y acceso local sin correo | DONE |

## Criterios aplicados, a corregir si no son lo que quieres

1. **Días hábiles:** de lunes a viernes, sin festivos. El calendario depende de la entidad y del país.
2. **Pagador tercero:** no se detiene la adjudicación, solo se marca para revisión, porque retener un cupo ya pagado perjudicaría al comprador. La Decisión 45 podría leerse más estrictamente.
3. **Cancelación:** solo con reembolso completo, porque la Decisión 10 deja sin definir los reembolsos parciales. Los casos que llegan a revisión casi nunca han empezado la estructuración.
4. **Respuesta a la última notificación:** no se fija plazo de decisión, porque la Decisión 23 solo lo define para la falta de respuesta. Se abre incidencia.

## Bloqueado

| Elemento | Falta |
|---|---|
| Correo real | Dominio y Workers Paid |
| Stripe sandbox | Claves de prueba |
| LLM real | Clave de API |
| Impuestos (50–63), transferencias (43–44), facturación (46–49) | Entidad vendedora; la nota estratégica pide simplificarlos antes de construirlos |
| Dominio definitivo | Compra, pendiente por decisión del propietario |

## Verificación

| Prueba | Resultado |
|---|---|
| Esquema | 42 superadas |
| Integración, en el motor D1 | 105 superadas |
| Recorrido completo local, con proveedores simulados | 27 pasos superados |
| Batería contra el Worker y D1 remotos (`docs/CORE008_REMOTE_EVIDENCE.txt`) | 29 pasos superados |
| Navegador en staging: confirmar enlace, entrar, rutas de administración, cerrar sesión | Correcto |
| `npm audit` | 0 vulnerabilidades |

La evidencia anterior, `docs/CORE006_REMOTE_EVIDENCE.txt`, se conserva. El secreto de webhook temporal se eliminó y staging no tiene secretos.

**Estado de staging:** migraciones 0001–0009 y datos de demostración, todos con nombres "Demo …" y direcciones `.example`, sin indexar. Los enlaces solo los obtiene quien tiene acceso a Cloudflare: `docs/STAGING.md`.

