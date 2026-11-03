# THE1500 · Arquitectura y contrato inicial de integración
**Versión:** 1.0 · **Dueño técnico del core:** Claude · **Dueño de UI:** Antigravity

## 1. Stack y despliegue
Un solo repositorio TypeScript, **Astro SSR/híbrido + React para islas interactivas**, desplegado en Cloudflare Workers mediante adaptador oficial. **D1** para modelo relacional, estados, transacciones, usuarios y búsquedas FTS5. **R2** para snapshots JSON-LD y documentos públicos aprobados cuando aplique. API LLM llamada exclusivamente desde servidor. GitHub + Wrangler. No Supabase, Neo4j, Kubernetes ni segundo frontend en este MVP.

### Estructura orientativa
```text
src/
  pages/
    index.astro                   # UI Antigravity: directorio
    unirse.astro                 # UI Antigravity: landing comercial
    empresas/index.astro
    empresas/[slug].astro
    registro.astro
    mi-cuenta.astro
    admin/index.astro
    api/v1/...                   # Claude: rutas API
  components/                    # Antigravity
  layouts/                       # Antigravity
  styles/                        # Antigravity
  core/                          # Claude: reglas de negocio
  lib/contracts/                 # Claude primero; tipos compartidos
 db/migrations/                  # Claude
 tests/core/                     # Claude
 public/                         # Antigravity
 wrangler.jsonc                  # Claude; coordenadas de entorno
```
Crear validación de contratos mediante Zod/TypeScript. Documentar APIs con ejemplos JSON y codificación de errores. Sin acceso directo de frontend a D1, R2 privado, secretos, LLM o pasarela.

## 2. Entidades persistentes imprescindibles
- `companies`: id, corporate_identity, display_name, slug UNIQUE, industry_id, country, city, website, summary, owner_id, status, created_at.
- `company_details`: services JSON, audiences JSON, problems_solutions JSON, advantages JSON, published_contact JSON, evidence_urls JSON, raw_declaration JSON, authorized_at.
- `industries`: id, name, slug UNIQUE.
- `company_industries`: company_id, industry_id (many-to-many).
- `slots`: number INTEGER PRIMARY KEY CHECK(1..1500), phase, price_usd_cents, status, held_until, assigned_company_id UNIQUE nullable; crear exactamente 1.500 filas en migración idempotente.
- `orders`: id, company_id, slot_number, provider, price_usd_cents, charged_currency, amount_minor_units, status, reference UNIQUE, expires_at, created_at.
- `payment_events`: provider_event_id UNIQUE, order_id, payload_digest, verified_at, decision.
- `users`: id, email UNIQUE, status, created_at; `memberships`: user_id, company_id, role.
- `owner_approvals`: company_id, approved_version, approved_by, approved_at, disclosure_digest.
- `profile_versions`: company_id, version, structured_json, public_jsonld, source_refs, validation_findings, status, created_at.
- `enterprise_applications`: id, applicant_company, contact, status, notes, created_at.
- `audit_events`: actor_id, action, entity_type, entity_id, timestamp, outcome.

Constrain ownership of slot through DB indexes, not just application checks. Admin actions are audited; secrets and PII never exposed in public APIs.

## 3. Reglas críticas de inventario
- El cupo pertenece a una de cuatro bandas fijas, por `slots.number`: 1..600; 601..1050; 1051..1350; 1351..1500.
- Precio se determina en servidor desde la fila `slots`, no desde el navegador.
- Reservar solo en bandas auto-checkout 1..1350; el tramo 1351..1500 es manual Enterprise.
- Seleccionar y reclamar un cupo libre mediante escritura condicional atómica, transacción/batch cuando afecta varias tablas. Nunca dos pedidos pendientes para el mismo cupo.
- `held` vence según política de checkout (sugerencia operativa 15 min) y se libera de manera segura. Pagos confirmados tarde pasan a revisión/reembolso o reasignación validada: nunca sobreventa.
- La adquisición validada `paid` o `founder_assigned` ocupa plaza incluso cuando el perfil está todavía en preparación; `published` no determina el precio ni la disponibilidad.
- Reintentos de webhook y eventos duplicados son idempotentes. Comprobar autenticidad, importe, referencia, moneda y estado con proveedor antes de consolidar.
- Datos semilla demo son independientes del inventario real. Las fundadoras consumen plazas reales mediante una acción administrativa auditada.
- Precio en USD es referencia comercial; al cobrar con un proveedor COP se fija precio COP final, tasa aplicada, impuestos y total antes del pago. No simular soporte de dólares si la pasarela no lo ofrece.

Cloudflare D1 soporta transacciones con `batch()` que se revierten si falla una sentencia. Documentación: https://developers.cloudflare.com/d1/worker-api/d1-database/

## 4. API propuesta (Claude entrega contrato primero)
Todas las rutas públicas de lectura deben ser paginadas y filtradas. Esquema de error común: `{ "error": { "code": "SLOT_UNAVAILABLE", "message": "..." } }`.

| Método | Ruta | Autorización | Salida/uso |
|---|---|---|---|
| GET | `/api/v1/public/stats` | Pública | `{capacity:1500, occupied, held, available, published, sectorsRepresented, currentPhase}` |
| GET | `/api/v1/public/companies?query=&industry=&country=&page=` | Pública | `{items:[CompanyCard], page, total}` únicamente publicadas |
| GET | `/api/v1/public/companies/:slug` | Pública | `PublicCompanyProfile` y URL JSON-LD |
| GET | `/api/v1/public/industries` | Pública | Sectores y cantidad real publicada por sector |
| POST | `/api/v1/registrations` | Pública protegida | Registrar candidatura inicial, verificar duplicados, emitir flujo de acceso |
| POST | `/api/v1/orders/hold` | Autenticada | Orden con slot y expiración (nunca en fase Enterprise) |
| POST | `/api/v1/payments/webhook` | Firma del proveedor | Conciliación idempotente; sin confiar en redirección |
| POST | `/api/v1/profiles/generate` | Propietario | IA propone perfil con fuentes y advertencias |
| GET/PUT | `/api/v1/me/company` | Propietario | Editar declaración antes de aprobación/publicación |
| POST | `/api/v1/me/company/approve` | Propietario | Aceptar versión y autorizar divulgación |
| POST | `/api/v1/me/company/publish` | Propietario/Admin | Publicar si condiciones satisfechas |
| POST | `/api/v1/public/ask` | Pública + límites | `{answer, citations:[{companyId,slug}], limitations}` |
| POST | `/api/v1/enterprise/apply` | Pública protegida | Solicitud sin pago ni ocupación automática |
| GET | `/api/v1/admin/overview` | Admin | Cupos, perfiles, alertas, aplicaciones |
| POST | `/api/v1/admin/founder-assign` | Admin | Asigna plaza primera fase, auditada |
| POST | `/api/v1/admin/review` | Admin | Resolver excepciones y publicar/retirar |

Contrato de salida ejemplo `CompanyCard`:
```json
{"id":"company-id","slug":"empresa-demo","brandName":"Empresa de demostración","sector":"LegalTech","location":"Colombia","summary":"...","publicationStatus":"published","verificationStatus":"self_declared"}
```
No asignar badge `Verificada` salvo que `verificationStatus=human_verified` y exista evidencia administrativa.

## 5. Corpus semántico
Dos representaciones distintas:
**Interna**, conforme al objeto originalmente solicitado, con campos `@context`, `@type`, `entity_id`, `brand_name`, `industry_verticals`, `headquarters`, `ai_semantic_embedding` (texto para vectorizar), `problem_solution_mapping`, `competitive_advantage`, `trust_signals`. El `@type` se decide según actividad, con `Organization` como fallback; no todas las empresas son `LegalService`.
**Externa JSON-LD pública** con propiedades Schema.org válidas (`name`, `url`, `address`, `description`, `knowsAbout`, `areaServed`, etc.) y propiedades propias mediante vocabulario/namespace propio cuando sea necesario. El embedding vectorial no es la misma cosa que el texto `ai_semantic_embedding`.
Guardar declaración fuente + resultado IA + aprobación + snapshot publicado. La IA no debe inventar ni concluir verificaciones documentales automáticamente.

## 6. Chat y recuperación
Primero FTS5 y filtros sobre empresas publicadas; obtener candidatos trazables. LLM genera respuesta **solo** a partir de esos fragmentos. Devolver referencias de perfiles como fuentes. Si no hay resultados: «No encuentro empresas publicadas que respondan a esa consulta». Defensas contra prompt injection en declaraciones, límites de tokens, rate limiting y caché si procede. No prometer resultados de LLM ajenos.

## 7. Seguridad mínima
Sesiones firmadas en cookie HttpOnly, Secure, SameSite; autenticación por invitaciones/magic links con proveedor email conectado; roles `owner`, `admin`; verificaciones de autorización en API; Zod en todas las entradas; protección CSRF en mutaciones de sesión; límites de tasa en endpoints públicos y LLM; restricción de tipos/tamaños de subida; logs sin llaves/PII; separado sandbox/producción; secretos via Wrangler, jamás Git. No publicar contacto personal ni evidencia privada por defecto.

## 8. Modo archivo
En `closed_archive`, `/unirse` muestra sold-out y no crea nuevas órdenes; `/` y perfiles quedan disponibles; conservar snapshots públicos y exportables; evitar procesos recurrentes que cuesten por uso; mantener dominios, respaldo técnico y posibilidad de corrección legal, sin prometer gestión periódica de contenidos.

## 9. Condiciones para producción
Dominio DNS y control de titularidad; credenciales activas; email verificado; webhook validado; migraciones aplicadas; pruebas del último cupo, webhooks repetidos, acceso no autorizado, publicación y restauración. Si falta uno, staging + captación de interés, **no cobro real**.
