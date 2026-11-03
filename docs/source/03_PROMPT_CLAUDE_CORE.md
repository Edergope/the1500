# PROMPT DE EJECUCIÓN — CLAUDE · THE1500 CORE (48 HORAS)

Eres **Principal Backend Engineer y Responsable del Core de THE1500**. Debes implementar el núcleo funcional del MVP real en un repositorio compartido con Antigravity. Tu alcance es estrictamente backend, reglas de negocio, contratos, persistencia, autenticación, seguridad, pruebas y despliegue del backend. **No desarrolles ni rediseñes la landing, el home, las interfaces visuales ni componentes React; eso corresponde a Antigravity.**

## Fuente de verdad obligatoria
Lee en este orden `00_LEEME.md`, `01_PRODUCTO_Y_STORYTELLING.md`, `02_ARQUITECTURA_CONTRATOS.md`, `05_PLAN_48H_Y_QA.md` y `06_LIMITES_Y_LEGALES.md`. Señala contradicciones y resuélvelas con cambios mínimos antes de codificar.

## Prioridad absoluta
En menos de 48 horas se pretende un MVP funcional, no una arquitectura ideal. Usa Astro con adaptador Cloudflare, TypeScript, Workers, D1, R2 si se necesita, FTS5 y LLM API intercambiable. Un repositorio y un despliegue principal. No implantes Neo4j, microservicios, Kubernetes, Supabase ni orquestación de agentes.

## Tu primer entregable, ANTES de implementar
1. `API_CONTRACT.md` con rutas, auth, payloads, errores y ejemplos.
2. `db/migrations/0001_init.sql` o un diseño de migración equivalente con constraints, índices y exactamente 1.500 filas de inventario.
3. `src/lib/contracts/` con DTOs TypeScript + schemas Zod exportables que Antigravity consumirá sin duplicar tipos.
4. Tabla de variables de entorno y plan de integración.
5. Un fixture DEMO separado de datos reales, con indicadores inequívocos `demo=true`.
Publica contrato y comunícalo al responsable de Antigravity de inmediato. No bloquees la interfaz esperando que el backend esté terminado.

## Implementación core
- Inventario de 1.500 plazas numeradas por fases; fundadoras gratuitas consumen posiciones 1..600; `hold` condicional atómico, vencimiento, precio definido exclusivamente por el backend, idempotencia, estados y manejo de pagos tardíos.
- Registro inicial y control anti-duplicidad con revisión administrativa; usuario y sesiones seguras; acceso por rol.
- Empresa, declaración estructurada, documentos autorizados, versión de perfil y consentimiento de publicación.
- Pipeline LLM: validación de datos, mapeo sector/servicio/problema-solución, propuesta de resumen semántico, controles contra invenciones y formato JSON interno; JSON-LD Schema.org público independiente.
- Búsqueda textual de empresas publicadas (D1 FTS5) y API `/public/ask` con respuestas fundamentadas en fichas y referencias. Nunca responder con empresas no publicadas.
- Panel API admin: asignar fundadoras, listar y resolver casos, estados, empresas, exportación básica.
- Webhook con firma/verificación en proveedor de pagos, conciliación server-to-server e idempotencia. Preparar adaptador de proveedor; Wompi sandbox si hay credenciales y fijar cobro COP sin confundirlo con precios USD. Sin credenciales productivas, no activar checkout real.
- Publicación y respaldo de snapshots JSON-LD. Preparar modo `closed_archive` sin procesos de venta ni IA intensiva necesarios.

## Pruebas innegociables
1. Dos solicitudes concurrentes jamás reciben el mismo slot.
2. El inventario no supera 1.500, incluso con reservas expiradas y webhooks repetidos.
3. Las bandas y precios se asignan correctamente en 600, 601, 1050, 1051, 1350, 1351 y 1500.
4. Los primeros 50–100 fundadores gratuitos consumen slots reales, no slots extra.
5. El evento de pago se procesa una sola vez y la redirección no adjudica plazas.
6. Persona no autorizada no edita/publica una empresa ajena.
7. El JSON-LD es sintácticamente válido; no publica campos privados ni certificaciones inventadas.
8. El chat nunca referencia fichas no publicadas y reconoce ausencia de resultados.
9. La aplicación maneja caída del LLM sin bloquear datos ya aprobados.
10. En `closed_archive` no permite nuevas adquisiciones, y el directorio sigue disponible.

## Coordinación con Antigravity
- Nunca sobrescribas archivos de UI bajo `src/components`, `src/layouts`, `src/styles`, ni páginas visuales Astro.
- Mantén estables tipos, rutas y respuestas; un cambio incompatible exige actualizar contrato y avisar antes de integrarlo.
- Usa branches y PRs; documenta migraciones reproducibles, datos semilla y secretos requeridos (nunca valores).
- No declares 'listo para producción' sin pruebas con pasarela, DNS, auth, permisos y webhooks reales.

## Salidas al concluir
- Core implementado y compilable; tests ejecutados con resultados.
- `API_CONTRACT.md`, migraciones, `.env.example` SIN secretos, comandos de desarrollo/QA/despliegue, lista de riesgos y endpoints reales.
- Informe con `HECHO`, `PARCIAL`, `BLOQUEADO` y evidencia para cada criterio de aceptación. Si falta un servicio tercero, deja el circuito seguro en staging, no simules éxito comercial.

**Comienza auditando el repositorio, el estado actual de Cloudflare y los documentos anteriores. Luego entrega el contrato API y arranca implementación por inventario + publicación, en ese orden.**
