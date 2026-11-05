# THE1500: plan del Admin Control Center

Revisión de arquitectura previa a ADMIN-001. Fecha: 2026-11-05.

**Dos condiciones fijan el orden del trabajo:**

- PERF-001 no está desplegado: el presupuesto de D1 de hoy está agotado hasta las 00:00 UTC. Por eso **ADMIN-001 no añade ninguna migración**.
- El panel no se publica en producción. Nada de este plan habilita cobros reales.

## 1. API administrativas existentes

Todas pasan por `adminGet` o `adminPost` (`src/core/http.ts`): sesión del servidor y `platform_admins`, y además `requireSameOrigin` en las escrituras.

| Área | Rutas bajo `/api/v1/admin/` |
|---|---|
| Resumen | `overview` |
| Empresas | `companies`, `review-company`, `company-action`, `users/block` |
| Perfiles | `profiles`, `profiles/review` |
| Inventario | `inventory` |
| Fundadores y Premium | `founder-invite`, `founder-award`, `founder-revoke`, `premium/requests`, `premium/assign` |
| Solicitudes | `requests`, `requests/resolve`, `requests/legal-deadline`, `withdrawals/execute` |
| Onboarding | `onboarding`, `onboarding/reactivation`, `onboarding/resolve`, `onboarding/final-notice` |
| Incidencias | `incidents`, `incidents/resolve` |
| Pagos | `payments`, `payments/reconcile`, `payments/refund`, `payments/refund-alternative`, `payments/resolve-late`, `payments/chargeback-resolve`, `payments/payer-authorization` |
| Configuración | `integrations` (solo lectura), `seller` |

## 2. Funciones reutilizables

- **Autorización:** `authenticatedPrincipal`, `requirePlatformAdmin`, `requireSameOrigin`.
- **Auditoría:** `adminEvent`, `requireEvidence`. `admin_events` es inmutable por trigger.
- **Acciones:** `reviewCompany`, `companyAdminAction`, `reviewProfile`. El panel las llama por su API, sin duplicarlas.
- **Lecturas públicas:** `readCommerce` y `readCatalog` de PERF-001, para que el Overview no recorra `slots`.
- **Perfiles:** `contentDigestSource`, el mismo digest con que se aprueba y se publica.
- **Integraciones:** `integrationStatus`, `mailStatus`, `paymentsGate`, `getLlmProvider`.
- **Pagos:** `src/core/stripe.ts`, `payments.ts`, y `convertHold` y `assignFreeSlotInPhase` como únicas vías de adjudicación de un pago.

## 3. Funciones que faltaban

| Falta | Sprint | Solución |
|---|---|---|
| Interfaz de administración | ADMIN-001 | SSR en `/admin` y `/es/admin` |
| Búsqueda por correo, país, sector, estado y posición | ADMIN-001 | `searchCompanies` |
| Ficha completa de empresa | ADMIN-001 | `getCompanyDossier` |
| Documentos e integridad de cada versión | ADMIN-001 | `getProfileDossier` |
| Consulta de auditoría | ADMIN-001 | `listAuditEvents` |
| Métricas de negocio | ADMIN-001 | `getControlOverview` |
| Alta del superadministrador y retirada del demo | ADMIN-001 | `scripts/superadmin.cjs`, procedimiento en `docs/ADMIN_STAGED_DEPLOY.md` |
| Reautenticación reciente | ADMIN-002 | Sección 4 |
| Secretos, proveedores, pruebas de conexión | ADMIN-002 | Sección 6 |
| Mercado Pago y orquestador | PAY-002 | Sección 7 |
| Módulos de inventario, solicitudes y pagos | Revisión de ADMIN-001 | Las API existen; se añaden al panel cuando se decida. No se muestran vacíos |

## 4. Autorización del superadministrador

- **Autoridad:** `platform_admins`, sin cambios. Ningún correo escrito en el frontend ni campo de perfil concede permisos.
- **Guarda única de páginas:** el middleware protege `/admin` y `/es/admin` antes de renderizar. Sin sesión redirige al login. Con sesión sin permiso responde 404, para no revelar que el panel existe. Las respuestas llevan `no-store` y `noindex`.
- **Alta inicial:** `scripts/superadmin.cjs`, en línea de comandos y sin ruta web. Exige un inicio de sesión real de la última hora, el identificador de usuario comprobado antes, el correo repetido y quién autorizó. Se niega si ya hay un administrador activo que no sea de demostración. El procedimiento completo está en `docs/ADMIN_STAGED_DEPLOY.md`. **Ninguna cuenta se da de alta en remoto sin tu autorización.**
- **Pendiente antes de producción:** staging tiene un administrador de demostración (`admin@demo-the1500.example`). `superadmin.cjs revoke-demo` lo revoca y `verify` comprueba que solo queda el propietario.
- **Reautenticación (ADMIN-002):** las operaciones críticas exigirán un enlace de correo reciente, de un solo uso, con vigencia de 15 minutos. Requiere una columna en `sessions`, de ahí la migración 0012.
- **Roles futuros:** añadir una columna `role` a `platform_admins`, con `superadmin` por defecto. No se implementa multiusuario ahora.

## 5. Módulos del panel

| Módulo | Estado tras ADMIN-001 |
|---|---|
| Overview | Funcional |
| Empresas | Funcional, con revisión y bloqueo |
| Perfiles y JSON | Funcional, con revisión, visor y comparación |
| Auditoría | Funcional |
| Inventario, Solicitudes, Pagos | No aparecen en la navegación. La ficha de empresa muestra sus solicitudes, incidencias y pagos en modo lectura |
| Inteligencia artificial, Integraciones, Configuración | ADMIN-002. El Overview muestra el estado real de las integraciones en modo lectura |

**Lo tomado de las referencias, sin copiar código ni recursos:**

- **DeepBook:** un solo acento sobre fondo oscuro y arquitectura visible de un vistazo.
- **Ethiack:** metadatos técnicos legibles y señales de riesgo puntuales y muy visibles.
- **Colescomex:** sobriedad empresarial sobre azul profundo.
- **dozfx:** jerarquía editorial firme con pocos elementos.

## 6. Configuración segura de proveedores (ADMIN-002)

**La limitación que hay que explicar primero.** Una aplicación no puede escribir en los mecanismos gestionados de Cloudflare sin tener credenciales de la propia cuenta:

| Opción | Lectura desde el Worker | Escritura desde el panel | Conclusión |
|---|---|---|---|
| Worker Secrets | Sí | Solo mediante un token de API de la cuenta; cada cambio crea una versión del Worker | No |
| Secrets Store (beta abierta, 100 secretos por cuenta, según su documentación) | Sí, `get()` de solo lectura | Solo con un token con permiso de edición sobre un almacén **de toda la cuenta**, compartida con Palmera | No |
| **Cifrado de sobre en D1, con clave maestra en Worker Secret** | Sí | Sí | **Recomendada** |

Guardar en el Worker un token capaz de editar secretos de la cuenta sería un riesgo mayor que el que resuelve, y afectaría a Palmera.

**Diseño recomendado:**

- **Clave maestra:** `SECRETS_MASTER_KEY`, 32 bytes aleatorios, como Worker Secret. Se fija con `wrangler secret put`, nunca desde el panel, y no vive en D1. Es distinta en staging y en producción.
- **Cifrado:** AES-256-GCM de Web Crypto, con un IV aleatorio de 96 bits por escritura. Los datos asociados (AAD) son `proveedor|entorno|nombre|versión`: un valor copiado a otra fila no se descifra.
- **Sobre:** una clave de datos por credencial, cifrada con la maestra. Rotar la maestra solo recifra esas claves.
- **Almacenamiento:** `provider_credentials` guarda el cifrado, el IV, la versión de clave, el estado, los últimos 4 caracteres y las fechas. No hay ninguna ruta que devuelva el valor.
- **Uso:** la clave se descifra solo dentro de la solicitud que la necesita y no se registra. `integrationStatus` sigue diciendo si hay clave, nunca cuál.
- **Controles:** solo superadministrador, reautenticación reciente, confirmación, motivo y `admin_events`. El evento registra que hubo un cambio, nunca el valor.
- **Límite que queda:** quien tenga a la vez la clave maestra y una copia de D1 puede descifrar. Es un riesgo aceptado, y es menor que el de las alternativas.

Coste adicional: ninguno. Secrets Store no se usa, y la decisión puede revisarse cuando THE1500 tenga cuenta propia.

**Separación funcional de la IA.** Se añade `ai_function_config` con tres funciones: estructuración, traducción y asistente. El adaptador común es el actual `getLlmProvider`. Anthropic es el primer proveedor real. OpenAI y Gemini quedan como adaptadores futuros, tras verificar sus contratos. La cadena de validación de `claims.ts`, la procedencia y la aprobación del titular no cambian. **La IA nunca publica.**

## 7. Contrato de Stripe y Mercado Pago (PAY-002)

```ts
interface PaymentProvider {
  id: 'stripe' | 'mercadopago';
  capabilities(market: MarketCode): ProviderCapabilities;
  createCheckout(attempt: PurchaseAttempt, ctx: CheckoutContext): Promise<CheckoutSession>;
  getPaymentState(ref: ProviderRef): Promise<ProviderPaymentState>;
  verifyNotification(rawBody: string, headers: Headers, now: Date): Promise<VerifiedNotification>;
  refund(ref: ProviderRef, amount: Money, idempotencyKey: string): Promise<RefundResult>;
  listForReconciliation(window: TimeWindow): Promise<ProviderPaymentState[]>;
}
```

**Regla fundamental:** los proveedores solo informan de pagos verificados. La adjudicación sigue en el core: intento de compra, importe, moneda, estado y reserva se comprueban ahí. No habrá una segunda lógica de asignación.

**Verificado en la documentación oficial de Mercado Pago (Colombia):**

- Checkout Pro vía Orders API existe, con crear, obtener, buscar, cancelar y reembolsar órdenes.
- Hay endpoints de contracargos.
- Hay guías para definir la vigencia de la orden, y consideraciones sobre el IVA en Colombia.

**Pendiente de verificar al empezar PAY-002, antes de escribir código:**

- El esquema exacto de firma de los webhooks.
- La disponibilidad por país y si las credenciales son por cuenta y país. El plan asume una cuenta por país, nunca una sola para toda Latinoamérica.
- Las monedas admitidas y los plazos reales de vigencia.

**Decisiones que necesitan al propietario antes de cualquier cobro, incluso simulado con moneda local:**

| Decisión | Por qué |
|---|---|
| Fuente de la tasa de cambio, vigencia y redondeo | El precio en USD es la fuente de verdad. La conversión debe poder trazarse. No se implementarán estimaciones como cobros |
| Tratamiento de impuestos | Sin él no puede fijarse el importe final |
| Entidad vendedora por país | Sigue pendiente de definir |

**Controles.** El checkout expira antes que la reserva interna de 20 minutos, sin suponer que coincidan. Un pago tardío entra en el flujo `late_review` existente. El importe y la moneda confirmados quedan en el intento antes de pagar.

**Estados por proveedor:** `registrada → credenciales verificadas → sandbox habilitado → pruebas aprobadas → producción autorizada`. Este último no es alcanzable en estos sprints.

## 8. Dependencias entre sprints

```text
PERF-001 desplegado y validado en staging  (presupuesto de D1 disponible)
        │
ADMIN-001 (sin migraciones; local)  ── revisión del propietario
        │
Migración 0011 (solo índices del panel)
        │
ADMIN-002 (secretos, IA, correo)  ── migración 0012
        │
PAY-002 (contrato, Mercado Pago en pruebas)  ── migración 0013
        │
ADMIN-003 (QA integral)
```

PAY-002 necesita los secretos de ADMIN-002 para registrar credenciales de prueba desde el panel.

## 9. Migraciones necesarias

| Migración | Sprint | Contenido |
|---|---|---|
| Ninguna | ADMIN-001 | El esquema actual basta |
| `0011` | ADMIN-001 (rendimiento) | Cinco índices: `companies(created_at)`, `memberships(company_id)`, perfiles por fecha, `admin_events` por fecha y por acción. Preparada en `db/pending/`; se aplica después de 0010 |
| `0012` | ADMIN-002 | `provider_credentials`, `provider_settings`, `ai_function_config`, reautenticación en `sessions` |
| `0013` | PAY-002 | Ampliar `purchase_attempts.provider` (hoy admite `stripe`, `bank`, `manual`), moneda local, tasa, vigencia y mercado |

La migración 0013 reconstruye una tabla con `CHECK`, así que se prueba primero sobre una copia. No se elimina ningún dato.

## 10. Riesgos y pruebas de seguridad

| Riesgo | Control | Prueba |
|---|---|---|
| Acceso sin permiso a páginas o API | Guarda única en middleware y `adminGet` | Anónimo redirigido, usuario normal con 404 o 403, administrador revocado sin acceso |
| Escritura desde otro sitio | `requireSameOrigin` | POST sin origen o de otro origen rechazado |
| Datos privados en caché compartida | `no-store` en páginas y API | Cabeceras comprobadas por HTTP |
| Filtración de tokens de sesión | Las consultas no seleccionan digests ni tokens | Revisión de la respuesta de la ficha |
| JSON público distinto del autorizado | Digest de aprobación y de publicación comprobados y mostrados | Versión manipulada marcada como fallo de integridad |
| Administrador que sustituye la aprobación del titular | No existe ninguna ruta para editar un perfil, y los triggers lo impiden | Prueba de inmutabilidad y ausencia de la ruta |
| Adjudicación arbitraria | El panel no ofrece asignar ni cambiar posiciones | Sin acción disponible; el trigger de irreversibilidad sigue vigente |
| Consumo excesivo de D1 | Sin sondeos, con paginación; filas medidas | Límite comprobado por prueba y medido con 1.500 empresas |
| Inyección en búsqueda o HTML | Parámetros enlazados; escape de Astro y React | Filtros con caracteres especiales; nombre de empresa con HTML |
| Claves en registros (ADMIN-002) | Sin valores en eventos ni logs | Prueba con clave centinela |
| Reenvío de webhooks (PAY-002) | Firma e idempotencia | Prueba con evento repetido y firma inválida |

ADMIN-003 repetirá estas pruebas sobre todos los recorridos del administrador.

**Filas por página del panel con 1.500 empresas:** la medición vigente está en `docs/ADMIN_STAGED_DEPLOY.md`, sección 3. La primera medición de este documento omitía a los titulares de las empresas y subestimaba el filtro por correo; queda sustituida.
