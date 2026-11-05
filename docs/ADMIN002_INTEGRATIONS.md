# THE1500: ADMIN-002, integraciones y credenciales

Construido y probado en local. **No está desplegado**, la migración `0012` no se ha aplicado en remoto y no hay ninguna credencial real registrada. Su despliegue va después de los pasos de `docs/ADMIN_STAGED_DEPLOY.md`, sección 0, y necesita tu autorización.

## Qué hace

Página privada en `/admin/integraciones` y `/es/admin/integraciones`, solo para administradores de `platform_admins`.

| Proveedor | Estado en el panel |
|---|---|
| Anthropic Claude | Completo: clave, modelo, verificación, activar y desactivar, modelo por función |
| OpenAI, Gemini | «No disponible»: no admiten credenciales ni selección hasta tener adaptador |
| Stripe | Clave secreta y secreto de webhook en modo de pruebas, verificación de cuenta y webhook, activar y desactivar pagos de prueba |
| Mercado Pago | País, moneda, credenciales y verificación de la cuenta. No se puede activar: checkout y conciliación son de PAY-002 |
| Cloudflare Email, Resend | Remitente, clave de Resend, mensaje de prueba al propio administrador y elección del proveedor en uso |

**Reglas de la interfaz:**
- Cada botón visible tiene una función real. Lo que no existe aparece como «No disponible».
- Un mensaje de prueba se presenta como «aceptado por el proveedor (entrega sin confirmar)», nunca como entregado.
- La IA redacta y no publica. Las validaciones de contenido, procedencia, JSON y aprobación del titular no cambian.
- Las posiciones solo las asigna el core.

## Cómo se aplica la configuración

`runtimeEnv()` en `src/core/integrations.ts` construye la configuración de cada solicitud:

- **Proveedor sin fila en `provider_settings`:** se sigue usando la configuración del Worker. Hasta que actúes, nada cambia.
- **Proveedor con fila:** lo gobierna el panel. «Desactivado» significa apagado, aunque el Worker tenga una clave.
- **Qué credenciales se descifran:** solo las que la solicitud usa (IA, correo o Stripe). Las rutas de perfil, asistente, acceso, compra, webhook, pagos administrativos, `/unirse` y el cron pasan por aquí.
- **Caché:** solo se guarda en memoria el estado cifrado, 30 segundos por isolate, para no leer D1 en cada página pública.
- **Sin la migración `0012`:** todo funciona como hoy, y el panel lo indica.

## Seguridad

| Requisito | Cómo se cumple |
|---|---|
| Cifrado | AES-256-GCM de Web Crypto, en sobre. Cada valor tiene su propia clave de datos, cifrada con la maestra. IV aleatorio en cada escritura. Los datos asociados (`proveedor\|entorno\|nombre\|versión`) impiden abrir un valor copiado a otra fila |
| Clave maestra | `SECRETS_MASTER_KEY`, 32 bytes en base64, como secreto del Worker. No está en D1 ni en el repositorio. En local hay una aleatoria en `.dev.vars`, que está excluido de git |
| Nunca vuelve al navegador | La vista solo muestra los 4 últimos caracteres. Ninguna ruta devuelve el valor. El campo se vacía al enviar, y Enter pasa por la misma confirmación, así que el valor nunca llega a una URL |
| Fuera de logs y auditoría | `admin_events` registra credencial y versión, nunca el valor. Se rechaza un motivo que contenga la clave. Los errores de proveedor se guardan como código HTTP, sin su mensaje |
| Sustituir y desactivar | Cada sustitución crea una versión y retira la anterior. Un índice único impide dos valores activos. Desactivar una credencial necesaria apaga el proveedor |
| Superadministrador y reautenticación | Toda la API exige sesión y `platform_admins`. Los cambios exigen además un enlace de un solo uso enviado a tu correo y abierto en la misma sesión en los últimos 15 minutos. Abrir el enlace no confirma nada: hay que pulsar «Confirmar», así un escáner de correo no puede usarlo |
| Claves reales | Stripe rechaza las claves `_live_` al guardarlas, y `paymentsGate` las sigue rechazando aunque llegaran por otra vía |
| Activación con garantías | Solo se activa un proveedor con todas sus credenciales y una verificación correcta posterior a la última credencial. Un proveedor de correo solo se elige tras un mensaje de prueba aceptado en las últimas 24 horas, porque los enlaces de acceso dependen de él |

**Riesgo aceptado (plan, sección 6):** quien tenga a la vez la clave maestra y una copia de D1 puede descifrar.

## Verificaciones de conexión

Todas son explícitas y no cobran ni cambian nada en el proveedor.

| Proveedor | Comprobación | Límite |
|---|---|---|
| Anthropic | `GET /v1/models/{modelo}` con la clave registrada | Confirma clave y acceso al modelo. No ejecuta una generación |
| Stripe | `GET /v1/balance` (debe ser modo de pruebas) y `GET /v1/webhook_endpoints` | Busca la dirección de este entorno, que esté habilitada y con los 7 eventos que usa `payments.ts`. Stripe no revela el secreto de firma: la coincidencia la prueba el primer evento firmado |
| Mercado Pago | `GET /users/me` y su `site_id` contra el país elegido | **Verificar contra la documentación oficial al empezar PAY-002**, junto con la firma de notificaciones |
| Correo | Un mensaje al correo del propio administrador | «Aceptado» no es «entregado» |

## Migración 0012

Está en `db/pending/0012_admin002_integrations.sql`, no en `db/migrations/`, por el mismo motivo que `0011`: `wrangler d1 migrations apply --remote` la aplicaría junto con `0010`. Una prueba lo comprueba.

**Contenido:**
- `sessions.reauthenticated_at`
- `reauth_challenges`
- `provider_credentials`
- `provider_settings`
- `ai_function_config` (generación de perfiles y asistente)
- `integration_choices`

**Aplicación:** no borra ni cambia datos. Añade una columna y tablas nuevas. `ALTER TABLE` no es repetible, así que se aplica una sola vez, con el seguimiento de `d1_migrations`.

## Activación futura en staging (no ejecutada)

1. Aplicar `0012`, cuando lo autorices y tras los pasos de la sección 0 del plan de despliegue.
2. Fijar la clave maestra con `openssl rand -base64 32 | npx wrangler secret put SECRETS_MASTER_KEY`. Nunca desde el panel ni en el chat.
3. Desplegar ADMIN-002.
4. Entrar como superadministrador, reautenticarse y registrar credenciales de prueba.

## Pruebas

`tests/integration/admin002.test.cjs`, sobre D1 local con `0012` y un servidor falso para Anthropic, Stripe y Mercado Pago. Cubre:
- Cifrado y manipulación.
- Ausencia del valor en todas las tablas y en `admin_events`.
- Formatos, claves reales y proveedores sin adaptador.
- Activación y desactivación, y modelo por función.
- Webhook de Stripe y país de Mercado Pago.
- Correo «aceptado».
- Reautenticación: un solo uso, 15 minutos, ligada al usuario y límite de solicitudes.
- Que las rutas de cambio exijan reautenticación.
- Que nada del navegador importe el módulo de credenciales.
