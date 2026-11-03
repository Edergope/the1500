# THE1500 · Índice maestro de documentación
**Versión documental:** 1.1 | **Fecha:** 2026-11-03 | **Estado:** base de ejecución del MVP; no equivale a plataforma implementada ni lanzamiento autorizado

## Objetivo del proyecto
MVP en un sprint intensivo de 48 horas: `/` directorio público, `/unirse` landing comercial, compra/registro sujeto a integración de pagos, 1.500 cupos globales, estructura de datos empresariales, JSON-LD, búsqueda y asistente sobre perfiles autorizados, administración mínima.

## Distribución de propiedad
- Claude: core, modelo de datos, APIs, seguridad, inventario, pagos y generación semántica.
- Antigravity: UX, diseño, páginas públicas, formularios, panel visual, integración frontend.
- Propietario del negocio: cuentas de infraestructura, operador contractual, consentimiento, precios/monedas y aprobaciones.

## Índice de documentos
| Orden | Archivo | Finalidad | Estado |
|---|---|---|---|
| 00 | `00_LEEME.md` | Arranque original 1.0 | Existente; consultar este índice v1.1 para complementos |
| 01 | `01_PRODUCTO_Y_STORYTELLING.md` | PRD, recorridos, copy y landing | Base definida |
| 02 | `02_ARQUITECTURA_CONTRATOS.md` | Stack y contrato API preliminar | Claude debe materializar DTO/OpenAPI finales |
| 03 | `03_PROMPT_CLAUDE_CORE.md` | Mandato técnico a Claude | Listo para uso |
| 04 | `04_PROMPT_ANTIGRAVITY.md` | Mandato UX a Antigravity | Listo para uso |
| 05 | `05_PLAN_48H_Y_QA.md` | Sprint y casos mínimos | Base definida; exigir evidencias |
| 06 | `06_LIMITES_Y_LEGALES.md` | Límites de promesas y obligaciones | Criterios; no términos contractuales finales |
| 07 | `07_REGISTRO_DECISIONES_Y_BLOQUEOS.md` | Gobierno de decisiones, GO/NO-GO | Pendientes de aprobación enumerados |
| 08 | `08_CONTRATO_DE_DATOS_SEMANTICOS.md` | JSON, JSON-LD, procedencia y recuperación | Listo para implementación técnica |
| 09 | `09_PLAN_CONSERVACION_10_ANOS.md` | Archivo, backups, costos y continuidad | Política propuesta; reservas/RPO/RTO pendientes |

## Lectura obligatoria por responsable
**Claude:** 00 (este índice), 01, 02, 05, 06, 07, 08, 09, luego 03. Primer entregable: DTO/API contract tipados + migraciones + matriz de estados.

**Antigravity:** 00 (este índice), 01, 02, 05, 06, 07, luego 04. Primer entregable: tokens de diseño + rutas `/` y `/unirse` y componentes de datos; la UI no puede sustituir las reglas backend.

## No confundir preparación con producción
**Se puede empezar a programar:** sí, usando estos documentos como base, con contratos que Claude entregará primero.

**Se pueden cobrar pagos reales:** no hasta aprobar documentos de venta, tratamiento de datos, operador, pasarela/moneda, seguridad, verificación de webhooks y pruebas QA.

**Se puede garantizar 10 años de operación:** no como garantía incondicional; se requiere titularidad de dominio, fondo de conservación, respaldos, plan de restauración y condiciones contractuales realistas.

## Orden de ejecución
1. Propietario confirma decisiones B01–B09, o quedan explícitas como bloqueos.
2. Claude cierra `API_CONTRACT.md`, tipos, modelos y pruebas de estado.
3. Antigravity implementa páginas y formularios contra dicho contrato.
4. Integración de sandbox con demostración de RAG grounded.
5. QA y checklist GO/NO-GO; activar pagos reales solo si todos los controles críticos están comprobados.

**Nota de control documental:** mantener versión, fecha, dueño y estado de aprobación de cada especificación. No cambiar la capacidad, precios, permanencia ni promesa comercial unilateralmente desde el frontend.
