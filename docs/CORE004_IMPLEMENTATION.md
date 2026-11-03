# THE1500 | CORE-004 — Administración, fundadores y recuperación del corpus

**Fecha:** 2026-11-03  
**Versión fuente:** 0.3.0  
**Estado:** código funcional probado sobre SQLite y TypeScript; **NO probado todavía sobre Cloudflare Workers/D1 ni desplegado**.

## 1. Qué se implementó

- `db/migrations/0005_core004_admin_and_search.sql`: administración con asignación manual de privilegios, invitaciones a fundadores con expiración a siete días, auditoría de revisión e índice FTS5 exclusivo de publicaciones autorizadas. Incluye backfill para publicaciones preexistentes.
- `src/core/admin.ts`: autorización de administrador, cola de revisión, revisión con referencia documental, invitación fundada y aceptación por el propietario autenticado; adjudicación de un cupo reservado entre 1 y 100, en lote transaccional, con auditoría.
- `src/core/search.ts`: sanitización de preguntas, búsqueda FTS5 de perfiles aprobados y efectivamente publicados, resultados enlazados y respuesta determinista basada en fuentes publicadas. El modo de respuesta actual se identifica expresamente como `retrieval_only`: **todavía no está conectado a un modelo generativo**.
- `src/core/profiles.ts`: publicación atómica de la versión aprobada y sincronización del índice FTS5 en el mismo lote; un perfil retirado se elimina del índice por trigger.
- Rutas `/api/v1/admin/*`, `/api/v1/me/founder-invitations/*` y `/api/v1/public/search` y `/api/v1/public/ask`.

## 2. Nuevos contratos HTTP

| Método | Ruta | Auth | Función |
|---|---|---|---|
| GET | `/api/v1/admin/overview` | admin | Inventario por tramo, fundadores, revisión pendiente |
| GET | `/api/v1/admin/companies?limit=30` | admin | Empresas con validación pendiente |
| POST | `/api/v1/admin/review-company` | admin, mismo origen | `{companyId, decision: "approved" | "rejected", reasonCode, evidenceReference}` |
| POST | `/api/v1/admin/founder-invite` | admin, mismo origen | `{companyId}` para empresa registrada y elegible |
| GET | `/api/v1/me/founder-invitations` | propietario autenticado | Invitaciones pendientes de sus empresas |
| POST | `/api/v1/me/founder-invitations/accept` | propietario, mismo origen | `{invitationId}`; adjudicación fundada y auditable |
| GET | `/api/v1/public/search?query=...&limit=6` | público | Resultados publicados y URLs de fichas |
| POST | `/api/v1/public/ask` | mismo origen | `{question, language:"en"|"es"}`; recuperación comprobable con `citations` |

Todos los POST de mutación exigen la comprobación de origen que usa el resto del proyecto. El contenido administrativo no aparece en APIs públicas.

### Ejemplo de respuesta a una pregunta

```json
{
  "mode": "retrieval_only",
  "language": "en",
  "answer": "Published company profiles that may be relevant: Ocean Line LLC. Check the linked profiles for their owner-declared capabilities.",
  "citations": [
    {"companyId":"ocean","slug":"ocean-line","title":"Ocean Line LLC","url":"/empresas/ocean-line","profileVersion":1}
  ],
  "limitations":"This is keyword retrieval of published, owner-approved data; it does not certify companies or guarantee external AI recommendations."
}
```

*Respuesta ilustrativa de pruebas. No es una empresa real registrada ni prueba social.*

## 3. Alta segura del primer administrador

No existe una API pública ni un administrador creado de oficio. Registrar primero una cuenta real por magic link, identificar en D1 el `user_id` correspondiente y corroborar manualmente el control de esa cuenta. Luego, desde el entorno administrativo y con autorización del titular:

```sql
-- Ejecutar solo tras comprobar identidad, cuenta y autorización.
INSERT INTO platform_admins(user_id,granted_at,granted_by)
VALUES('<ID_USUARIO_VERIFICADO>',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'manual approved bootstrap');
```

Nunca colocar una dirección de email en una lista privilegiada codificada en frontend. Revocar acceso actualizando `platform_admins.revoked_at` y, si procede, las sesiones.

## 4. Limitaciones actuales que no deben ocultarse

- La invitación fundadora se crea y puede consultarse en el portal autenticado, **pero todavía no se envía un correo de invitación automáticamente**. La vigencia de siete días se computa desde su creación; el aviso de correo y la equivalencia con "invitación enviada" requerirán implementación y aceptación comercial antes del lanzamiento.
- El propietario debe registrar la empresa para poder recibir la invitación en este MVP. La invitación a empresas aún no registradas forma parte del trabajo pendiente.
- La revisión administrativa exige `evidenceReference`, pero no verifica por sí misma los documentos; un administrador debe comprobarlos de verdad.
- No hay aún interfaz administrativa ni pantalla de aceptación de invitaciones terminada; Antigravity debe consumir estas APIs.
- La recuperación se basa en FTS5 y documentos aprobados, no en embeddings o un LLM conectado. No afirmar que el chatbot generativo está disponible.
- No hay Stripe ni adjudicación de pago real; solo el circuito gratuito de fundadores puede adjudicar posiciones en esta versión.
- No hay pruebas contra Workers/D1 real ni compilación de Astro, debido a dependencias npm no descargables en este entorno.

## 5. Verificaciones reproducibles

```sh
python3 -m unittest discover -s tests -p 'test_*.py' -q
npm run test:types:isolated
npm run test:core:runtime
```

Los tests Python examinan restricciones SQL. El script de runtime transpila TypeScript y ejecuta **las funciones reales del core** contra SQLite mediante un adaptador de prueba para los métodos D1. No sustituye pruebas de integración Cloudflare.

## 6. Siguiente orden para Claude y Antigravity

**Claude — CORE-005:** instalar dependencias en un entorno con npm, compilar Astro 6, aplicar 0001–0005 en D1 local y remoto de staging, comprobar transacciones concurrentes de D1 y los contratos administrativos, agregar envío de invitaciones y proveedor de IA server-side con rate limit y respuestas fundamentadas. Mantener Stripe deshabilitado hasta configuración de operador y flujo de pagos test.

**Antigravity — UX-002:** construir `/admin` con cola y revisión, panel `/mi-cuenta` con invitaciones fundadoras, formulario de borrador y aprobación de perfil, y búsqueda en el directorio; usar textos ingleses por defecto y español en `/es/`.

**Criterio de aceptación funcional:** una empresa fundadora autorizada obtiene uno de los 100 cupos, completa su declaración, aprueba y publica el perfil y aparece en la búsqueda; el sistema nunca cita un borrador, no admite dos adjudicaciones ni permite acceso administrativo a usuarios no autorizados.
