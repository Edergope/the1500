# THE1500 · Paquete de ejecución MVP 48 horas
**Versión:** 1.0 · **Fecha:** 2026-11-03 · **Estado:** Especificación de arranque, no implementación

## Objetivo
Disponer en 48 horas de un MVP desplegable de THE1500: portada pública como directorio de empresas, landing comercial separada, incorporación de empresas, inventario real de máximo 1.500 plazas, perfiles semánticos con JSON-LD público, consultas sobre empresas publicadas y un panel mínimo de administración. El cobro real queda sujeto a la activación y verificación de la pasarela.

## Archivos y orden de lectura
1. `01_PRODUCTO_Y_STORYTELLING.md`: producto, journeys, páginas, copy y reglas comerciales.
2. `02_ARQUITECTURA_CONTRATOS.md`: stack, módulos, esquema de datos, API y máquinas de estado.
3. `03_PROMPT_CLAUDE_CORE.md`: instrucción integral lista para entregar a Claude.
4. `04_PROMPT_ANTIGRAVITY.md`: instrucción integral lista para entregar a Antigravity.
5. `05_PLAN_48H_Y_QA.md`: coordinación, cronograma, pruebas y definición de terminado.
6. `06_LIMITES_Y_LEGALES.md`: promesas permitidas, publicación, responsabilidad, seguridad y cierre.

## Regla de coordinación
Claude es propietario exclusivo de `src/core/**`, `src/pages/api/**`, `db/**`, `tests/core/**`, `src/lib/contracts/**` (salvo modificaciones coordinadas), secretos, middleware y acceso a datos. Antigravity es propietario de `src/components/**`, `src/layouts/**`, `src/styles/**` y páginas visuales `src/pages/**` excepto `/api`. Ambos reciben el mismo contrato; Antigravity jamás implementa lógica crítica en cliente ni inventa respuestas de la API.

## Decisiones ya fijadas
- Marca: **THE1500**. Inspiración narrativa en The Million Dollar Homepage, sin sugerir vinculación ni respaldo.
- La raíz `/` es el directorio público; `/unirse` es la landing de ventas.
- El inventario es global: máximo **1.500 asignaciones válidas**. Los 50–100 cupos gratuitos fundadores ocupan posiciones reales de la primera fase.
- No existe compromiso comercial de actualización periódica de perfiles: tras la venta completa el sistema pasa a un **modo archivo** consultable. Habrá operaciones mínimas de seguridad, rectificación, retiro legal y respaldo.
- No prometer recomendaciones ni indexación por LLM externos. El chat consulta únicamente el Corpus propio.
- Precios nominales: 600 × US$100; 450 × US$400; 300 × US$1.000; 150 × US$5.066. Bruto hipotético con todos pagados: US$1.299.900, antes de los cupos gratuitos, impuestos, fees y costos.
- Stack: Astro + React (interactividad), Cloudflare Workers, D1, R2, TypeScript, API LLM intercambiable. Un repositorio y un despliegue principal.

## Bloqueos externos que no deben ocultarse
La compra del dominio, DNS, cuenta Cloudflare, credenciales de email transaccional, LLM y pasarela productiva requieren propietarios/secretos. Sin ellos se puede entregar MVP en staging con pagos sandbox y flujo de interés sin declarar una venta pagada.

## Cómo ejecutar
1. Entregar archivos 01, 02, 03, 05 y 06 a Claude.
2. Entregar archivos 01, 02, 04, 05 y 06 a Antigravity.
3. Exigir que Claude entregue primero el contrato API y datos semilla ficticios marcados como DEMO, nunca presentados como empresas reales.
4. Integrar mediante pull requests, ejecutar los escenarios de QA de 05 y desplegar sólo cuando se cumplan criterios de salida.
