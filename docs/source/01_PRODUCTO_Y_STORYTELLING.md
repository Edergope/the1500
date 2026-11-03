# THE1500 · PRD y diseño de las dos experiencias
**Versión:** 1.0 | **Horizonte de implementación:** 48 h | **Objetivo:** MVP real, no prototipo ficticio

## 1. Definición
THE1500 es un registro público de máximo 1.500 empresas que transforma información declarada y aprobada por sus representantes en perfiles empresariales estructurados, relaciones semánticas y representaciones JSON-LD consultables. Su catálogo interno podrá ser recuperado por búsquedas y un asistente de IA. No vende recomendaciones garantizadas en ChatGPT, Gemini, Claude o buscadores externos.

## 2. Dos experiencias independientes sobre el mismo dominio
### `/` — Directorio público / HOME PRINCIPAL
- Hero: «1.500 lugares para empresas que quieren ser comprendidas en la era de la IA».
- Estadísticas derivadas de la base de datos: `ocupados`, `disponibles`, `publicadas`, `sectores_representados`.
- Buscador por nombre, sector, país y necesidad; prioridad a resultados publicados, nunca favoritos pagados ocultos.
- Mosaico de tarjetas de empresas incorporadas, con logo autorizado o monograma, sector y resumen.
- Chat «Pregunta al Corpus», sólo sobre registros publicados y con enlaces a fuentes.
- Módulo de visualización de sectores: números reales. **No presentar porcentaje de ocupación sectorial sin cuota sectorial aprobada.**
- CTA secundario a `/unirse` mientras queden cupos.
- Con cupos agotados, CTA comercial desactivado y home permanece como directorio.
- No usar nombres, logotipos o insignias de empresas que no hayan autorizado su publicación.

### `/unirse` — Landing comercial con storytelling
**El arco narrativo:**
1. **El cambio:** «Antes las empresas competían por clics. Ahora también necesitan que los sistemas de IA puedan comprender qué hacen».
2. **La inspiración histórica:** «La Million Dollar Homepage demostró que un espacio digital finito puede convertirse en un fenómeno cultural. THE1500 adopta esa idea de capacidad limitada, aplicada a un registro empresarial semántico».
3. **La solución concreta:** perfil público estructurado, servicios, problemas que resuelve, evidencias, representación JSON-LD y consulta interna.
4. **La demostración:** búsqueda o chat real sobre empresas fundadoras con datos autorizados. Si aún no hay registros, mostrar explicación interactiva rotulada «DEMO», no simular recomendaciones.
5. **La escasez veraz:** 1.500 posiciones globales; ocupadas y disponibles en tiempo real; etapas económicas basadas en asignaciones reales.
6. **La oferta y la acción:** precio de fase, qué recibe la empresa, formulario de incorporación y checkout si activo.
7. **Confianza:** metodología, límites de garantías, derechos sobre información, términos, privacidad, preguntas frecuentes.
8. **Cierre:** después de ocupar las 1.500 posiciones, la landing pasa a «inscripciones cerradas» con enlace al directorio.

**Titulares sugeridos:**
- H1: «Tu empresa existe. ¿La inteligencia artificial puede entenderla?»
- Subtítulo: «Transformamos la información de tu empresa en un perfil semántico público, estructurado y consultable. Solo 1.500 lugares».
- CTA principal: «Reservar mi lugar» (solo con inventario disponible).
- CTA secundario: «Explorar las empresas».
- Microcopy de transparencia: «No garantizamos recomendaciones, entrenamiento ni indexación por plataformas de IA externas».
- Momento final: «Cuando el lugar 1.500 se ocupe, las incorporaciones se cerrarán. El directorio permanecerá».

## 3. Mapa de rutas MVP
| Ruta | Pública | Finalidad |
|---|---:|---|
| `/` | Sí | Directorio principal con empresas publicadas y chat |
| `/unirse` | Sí | Storytelling, precios, disponibilidad y conversión |
| `/empresas` | Sí | Búsqueda, paginación y filtros |
| `/empresas/[slug]` | Sí | Ficha pública, JSON-LD y vínculo al JSON exportable |
| `/registro` | Sí | Datos iniciales y solicitud/reserva de lugar |
| `/pago/resultado` | Sí | Estado informativo, jamás adjudicación por redirección |
| `/mi-cuenta` | Autenticada | Completar información, revisar y autorizar publicación |
| `/admin` | Administrador | Fundadoras, cola de revisión, cupos, incidencias y exportar |
| `/terminos`, `/privacidad`, `/metodologia` | Sí | Transparencia y políticas |

## 4. Flujo principal del comprador
1. Visita `/unirse` desde redes, noticia, anuncio o CTA del directorio.
2. Observa demostración y cifras reales. Selecciona comprar/solicitar plaza.
3. Registra correo, nombre de marca, razón social, país y sector; confirma titularidad o autorización.
4. Backend comprueba duplicidad y estado del inventario; asigna una plaza en estado `held` con expiración y precio inmutable dentro del plazo.
5. Pago por pasarela conectada. Solo webhook validado y conciliado permite `paid`. Si no hay pasarela productiva, ofrecer «Solicitar incorporación» en lugar de cobrar.
6. Usuario completa perfil: actividad, servicios, clientes objetivo, problemas-soluciones, ubicaciones, referencias, ventajas, evidencias autorizadas.
7. IA extrae entidades y sugiere texto y relaciones; jamás inventa certificaciones, fuentes o experiencia.
8. Usuario revisa la vista previa y aprueba la versión; revisión administrativa solo ante riesgo/excepción, o Enterprise.
9. Publicación: ficha HTML, JSON-LD y índice de búsqueda. Mostrar `Publicado`, sin `Verificado` salvo comprobación humana documentada.

## 5. Programa de fundadoras y precios
- Primeras **50–100** empresas ingresan por invitación gratuita, ocupando posiciones de la fase de 600 × US$100. No son registros extra.
- Fase I: posiciones 1–600, US$100 nominales (fundadoras gratis reducen la facturación de la fase).
- Fase II: posiciones 601–1050, US$400.
- Fase III: posiciones 1051–1350, US$1.000.
- Fase IV: posiciones 1351–1500, US$5.066, **solicitud Enterprise sin checkout automático**; revisión y adquisición manual.
- Un mismo comprador/empresa no podrá acaparar posiciones duplicadas con variaciones de nombre. Control de identidades y resolución administrativa.
- El inventario por sector muestra distribución de empresas, no cupos sectoriales ficticios.

## 6. Estados del producto
**Adquisición:** `available → held → paid`; alternativa `held → expired`; `paid → refunded` bajo control; fundador `available → founder_assigned`. Las solicitudes Enterprise `applied → approved/rejected → contracted` no consumen inventario al aplicarse; la asignación se formaliza conforme a la contratación.
**Perfil:** `draft → ai_prepared → owner_approved → published`; excepciones `flagged` y `withdrawn`.
**Modo global:** `selling → closed_archive` tras agotar cupos válidos. Home siempre público.

## 7. Mínimo indispensable a 48 h
Directorios dinámicos verdaderos; landing responsive; datos de empresas reales únicamente con autorización; formularios; identidad/usuarios, publicación JSON-LD, panel admin sencillo, búsqueda interna, demo IA con fuentes; cobro sandbox y cobro real solo si credenciales verificadas. Evitar integraciones con LLM externos, indexación prometida, facturación sofisticada, CRM completo, vector DB independiente, portal multidioma y alta carga de documentos.

## 8. UX y estados
- Empty state honesto: «Las primeras empresas están preparando su incorporación» con CTA a `/unirse`.
- Cargando, error, campos incompletos, pagos pendientes y cupos agotados tienen estados visibles.
- Contadores actualizados desde backend, sin métricas inventadas.
- Diseños mobile-first, contraste, teclado, foco, loading claro, rendimiento y semántica HTML.
- Nunca usar logos ficticios o nombres de empresas demo como si fueran fundadoras reales.
