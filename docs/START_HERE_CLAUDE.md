# THE1500 — Sprint 1 / instrucciones para Claude

Toma el rol de Principal Backend Engineer. Revisa primero todos los documentos `docs/source/` y las decisiones más recientes del registro vivo:
https://docs.google.com/document/d/1DwUAgNaIVRbWoqYJ64yeMxINt7pAXulcQ-esIGb0ZBQ/edit

## Ponderación documental
Las decisiones confirmadas 01–63 y la reorientación estratégica prevalecen sobre notas técnicas anteriores. La pregunta 64 continúa pendiente. Hay cambios respecto de v1.2: exactamente **100 fundadores gratuitos**; hold de checkout **20 minutos**; **inglés primero, español segundo** desde MVP; **Stripe como objetivo de integración de pruebas**, operador contractual **LLC estadounidense en evaluación (no aprobado)**; no usar Wompi como supuesto por defecto; los últimos **150 Premium requieren admisión humana**. Mantener USD y mostrar todos los cargos reales antes de pagar. No activar cobros mientras el vendedor y las credenciales no estén aprobados.

## Primero entrega, después programa
1. Audita el bootstrap proporcionado; ejecuta y corrige los tests y la build sin ocultar fallos.
2. Entrega `docs/API_CONTRACT.md` con Zod/types estables; identifica /v1/public/stats, profiles, register, approvals, admin, payments, `/ask`.
3. Amplía el modelo D1 sin romper el inventario (órdenes, pagos, sesiones seguras, roles, perfiles, consentimientos, procedencia, logs).
4. Implementa reserva atómica y control de concurrentes, 20 minutos, expiraciones, reembolsos, estados Premium y fundadores.
5. Implementa perfil semántico generado por IA con su fuente, aprobación explícita del titular y publicación HTML + JSON-LD exportable. Nada de certificados ni clientes inventados.
6. Implementa búsqueda únicamente sobre publicados (FTS5) y API grounded `/ask` que responda con citas internas o abstención.
7. Prepara adaptador Stripe sandbox con verificación de webhook y fuerte idempotencia; no cobrar en vivo hasta selección formal de entidad y configuración.
8. Pruebas obligatorias: doble reserva concurrente, bordes 600/601/1050/1051/1350/1351/1500, 100 cupos fundador dentro de 600, pagos duplicados/tardíos, usurpación de perfil, JSON-LD válido, publicación con aprobación, chat sin alucinaciones y modo archivo sin pagos nuevos.

## Entrega verificable
PR en rama `feature/core-claude`, tests + compilación y endpoints; indicar HECHO/PARCIAL/BLOQUEADO; sin secretos en Git. No modificar páginas visuales, layouts ni CSS: eso es de Antigravity.
