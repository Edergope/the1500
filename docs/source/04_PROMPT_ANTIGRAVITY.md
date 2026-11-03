# PROMPT DE EJECUCIÓN — ANTIGRAVITY · THE1500 EXPERIENCE (48 HORAS)

Actúa como **Lead Product Designer, Frontend Engineer y Growth UX Architect de THE1500**. Diseña e implementa todo el frontend y las páginas del MVP sobre un repositorio único en Astro + React, Cloudflare Workers, TypeScript. **Claude es dueño exclusivo del core, APIs, bases de datos, autenticación, pagos reales, inventario y motor de IA.** No dupliques ni modifiques lógica crítica ni inventes una segunda base de datos.

## Fuente de verdad
Lee `00_LEEME.md`, `01_PRODUCTO_Y_STORYTELLING.md`, `02_ARQUITECTURA_CONTRATOS.md`, `05_PLAN_48H_Y_QA.md`, `06_LIMITES_Y_LEGALES.md` y el `API_CONTRACT.md` que debe entregar Claude. Usa los DTO compartidos de `src/lib/contracts`; al faltar temporalmente API, usa mocks explícitos y aislados sin mezclarlos con producción.

## Norte de producto (inmodificable)
**`/` = HOME DEL DIRECTORIO DE EMPRESAS. ` /unirse` (sin espacio) = LANDING DE VENTAS Y STORYTELLING.** No conviertas la raíz en la landing comercial. La landing conduce al registro; el home muestra las empresas que se van incorporando. Ambos comparten nav, identidad de marca y componentes visuales, con objetivos distintos.

## Marca
THE1500: concepto inspirado en The Million Dollar Homepage; sin vínculo, respaldo o afiliación atribuida. Diseño elegante, de alto valor B2B, navy profundo, dorado cálido, marfil y contrastes accesibles. El hero debe contar una historia, no parecer un sitio de criptomonedas. Tipografía editorial de alto contraste + sans funcional. Diseño mobile-first, estados reales, microanimaciones discretas, performance.

## Páginas obligatorias
1. `/`: directorio público: hero con cupos ocupados y publicaciones, buscador, sectores, tarjetas empresas, filtro, área «Pregunta al Corpus», CTA discreto `/unirse`. En modo archivo, solo directorio.
2. `/unirse`: storytelling con secuencia «cambio del descubrimiento empresarial → inspiración de un espacio limitado → problema de ser incomprendido → solución verificable → demostración → disponibilidad real → fases/precio → adquisición → preguntas y límites». Una única acción primaria por sección.
3. `/empresas`: listado filtrable y paginado (no listar 1.500 en un único payload).
4. `/empresas/[slug]`: ficha empresa pública, responsable, servicios, problemas/soluciones, fuentes, enlace JSON público.
5. `/registro`: captura mínima de interés/solicitud de plaza y acceso; sin contador cliente.
6. `/mi-cuenta`: formulario progresivo, vista previa, aprobación explícita y estado de publicación.
7. `/admin`: solo interfaz de inventario, revisión, fundadoras, solicitudes Enterprise; consumir APIs de Claude.
8. `/terminos`, `/privacidad`, `/metodologia`: páginas con borradores claramente sujetos a aprobación legal.
9. `/pago/resultado`: estados informativos, nunca marcar pagado solo por redirect.

## Componentes reutilizables
Header, footer, SectorFilter, CompanyCard, CompanySearch, AvailabilityCounter, PhasePricing, StorytellingSteps, ChatDemo, ProfilePreview, PublishStatus, RegistrationStepper, EnterpriseApplication, ErrorState, EmptyState, LoadingState, SoldOutBanner, ConsentDisclosure.

## Copy comercial de base
- H1 `/unirse`: «Tu empresa existe. ¿La inteligencia artificial puede entenderla?».
- Sub: «Un perfil semántico público, estructurado y consultable. Una edición limitada a 1.500 empresas».
- CTA: «Reservar mi lugar» si está habilitado; «Solicitar incorporación» si pagos productivos no lo están.
- H1 `/`: «Descubre las empresas que forman THE1500».
- Descriptor: «Un directorio empresarial estructurado para facilitar el descubrimiento y la consulta de capacidades, sectores y servicios».
- Cierre agotado: «Los 1.500 lugares ya están ocupados. El directorio permanece abierto para explorar».
- Aclaración visible: «La presencia en THE1500 no garantiza recomendaciones ni indexación en plataformas externas de IA».

## Regla estricta de verdad
- Métricas e inventario deben venir de `GET /api/v1/public/stats`, nunca hardcodear 1.200 ocupadas, 32 sectores o 100% de un sector.
- Fichas y logos reales solo si vienen del backend como `published`. Los datos de diseño ficticios deben estar marcados como DEMOSTRACIÓN y no usarse como prueba social.
- Estados `Publicado`, `Autodeclarado` o `Verificado` deben corresponder a la verificación real que suministre API.
- Nunca decir que el proveedor de IA externo aprenderá el perfil o recomendará la empresa.
- El chat nunca hace recomendaciones inventadas: muestra respuestas verificables de `/api/v1/public/ask` y enlaces a fichas.
- Fase Enterprise final: formulario de solicitud, nunca checkout automático.
- No configurar 100% completo por industria sin cuotas sectoriales explícitas y respaldadas.

## Integración con Claude
Consume exclusivamente endpoints según `API_CONTRACT.md` (no D1 desde browser, no llamadas a LLM desde frontend, no secrets). Usa `fetch` tipado y módulos de servicio. Mantén interfaces por archivos separados. Los mocks se activan solo en modo dev con rótulo visible. Respetar loading, empty, permission denied, payment pending, sold out, error y success.

## Entregables y evidencia
- Diseño responsive en desktop, tablet, móvil para `/` y `/unirse`.
- Implementación de rutas y componentes; navegación y formularios conectados a APIs reales.
- Capturas/preview de esas dos páginas y pruebas funcionales de rutas, accesibilidad elemental, carga y contrastes.
- Estado por entrega `HECHO/PARCIAL/BLOQUEADO` con archivos, comandos y limitaciones.

**Arranca por el sistema visual y las dos páginas clave; acepta el contrato de Claude antes de construir formularios y pantallas con efectos reales. Trabaja en rama propia y no toques core.**
