# THE1500 · Registro de decisiones y bloqueos de lanzamiento
**Versión:** 1.1 | **Fecha:** 2026-11-03 | **Clasificación:** fuente de verdad de decisiones pendientes

## A. Decisiones aprobadas
- **Marca:** THE1500. Nombre comercial provisional hasta comprobación de antecedentes y dominios.
- **Experiencias:** `/` directorio público de empresas; `/unirse` landing de storytelling y venta.
- **Cupo máximo:** exactamente 1.500 posiciones globales, sin ampliar inventario por promociones o fundadores.
- **Fases nominales:** 1–600 US$100, 601–1050 US$400, 1051–1350 US$1.000, 1351–1500 US$5.066; últimas 150 con aplicación y cierre humano.
- **Fundadoras:** hasta 50–100 invitaciones gratuitas dentro de los primeros 600 cupos; no son posiciones adicionales.
- **Permanencia:** publicar y conservar contenido empresarial a largo plazo, objetivo de 10 años; no prometer mantenimiento editorial ni actualizaciones periódicas incluidas.
- **Stack de trabajo:** Astro/React + Cloudflare Workers/D1/R2 + TypeScript, monorepo, backend Claude y frontend Antigravity.
- **No promesas:** no garantizar que LLM externos entrenen sobre el contenido, indexen, citen ni recomienden a empresas.

## B. Bloqueos de propietario — resolver antes de activar cobros reales
| ID | Decisión faltante | Dueño | Consecuencia si no se resuelve |
|---|---|---|---|
| B01 | Entidad jurídica operadora y país de facturación | Propietario | No existe vendedor contractual definido |
| B02 | Dominio elegido y comprobación de disponibilidad y marca | Propietario + asesor legal | Puede lanzarse staging, no identidad definitiva |
| B03 | Pasarela (Wompi, Stripe u otra), cuenta activa y moneda efectiva | Propietario | Solo sandbox / formulario de interés |
| B04 | Impuestos, precio final, tasas de cambio, condiciones de reembolso | Propietario + contabilidad/abogado | No habilitar cobro |
| B05 | Términos de servicio, privacidad, autorización publicación y licencia de uso | Propietario + asesor legal | No publicar datos de clientes reales |
| B06 | Fuente del correo transaccional y credenciales/llaves | Propietario + Claude | Flujos de acceso quedan en staging |
| B07 | Origen verificable de empresas fundadoras y sus consentimientos | Equipo comercial | DEMO rotulada, sin afirmar ventas o recomendaciones reales |
| B08 | Presupuesto de infraestructura y reserva para conservación | Propietario | No prometer duración incondicional |
| B09 | Cuenta Cloudflare, GitHub, LLM API y configuración de secretos | Propietario + Claude | Despliegue parcial o local |

## C. Reglas operativas que Claude debe cerrar en su primer contrato (no inventar en frontend)
1. **Cupo disponible** = fila `slots.status=available`; separar `held` de `occupied` y `published`.
2. **Fase comercial** se determina por el próximo cupo efectivamente asignable, sin saltarse fases por una reserva que luego vence. El algoritmo exacto para reservas concurrentes, cambios de precio y órdenes tardías debe documentarse y probarse.
3. **Estados finales de pago** y anulaciones: no confundir orden cobrada, cupo adquirido y ficha publicada. Reembolso no debe reabrir cupo automáticamente sin política aprobada.
4. **Enterprise:** aplicación no consume cupo por sí sola; aprobación y contratación manual deben asignarlo atómicamente.
5. **Publicación:** necesita declaración, aprobación explícita de la versión y autorización del representante; el estado `publicado` no implica `verificado`.
6. **Chat:** solo registros publicados, con enlaces internos; registrar límites de gastos y rechazar instrucciones provenientes de contenido empresarial.
7. **Límite de disponibilidad sectorial:** no existe mientras no se adopte una cuota sectorial real. Mostrar solamente conteos por sector.
8. **Modo archivo:** tras el cupo 1500, mantener fichas estáticas y buscador, y definir si el chatbot se conserva o se desactiva conforme al contrato comercial y el presupuesto.

## D. Alcance y entregables en 48 horas
**GO técnico mínimo:** `/`, `/unirse`, registro, reserva transaccional, perfil fuente, procesamiento IA, revisión propietaria, publicación HTML/JSON-LD, directorio consultable, demo del chat sobre datos publicados, panel admin mínimo, tests de cupos, auth y estados.

**GO comercial con cobro real:** exige además B01–B06, B09, pruebas de pasarela en producción, webhooks verificados, términos aceptados y checklist QA. Si falla, no simular lanzamiento con pagos.

**Fuera de alcance:** 50–100 empresas fundadoras reales obtenidas automáticamente; integración garantizada a modelos externos; vector DB dedicado; multiidioma; actualizaciones editoriales obligatorias; procesos Enterprise completos a escala.

## E. Protocolo de cambios
Toda decisión que modifique precio, inventario, uso de datos, titularidad, seguridad o permanencia debe tener registro con fecha, responsable, impacto, archivos afectados y pruebas actualizadas. Claude define contrato técnico; Antigravity no crea excepciones comerciales en UI.
