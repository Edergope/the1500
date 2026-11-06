# THE1500: DEPLOY-002, despliegue de staging y auditoría de D1

**Fecha:** 6 de noviembre de 2026, de 16:05 a 16:58 UTC.

**Entorno:** solo staging de THE1500.
- Cuenta `25765199…`.
- Worker `the1500-staging`.
- D1 `the1500-staging` (`05012b7a-…`).
- No se tocó ningún recurso de Palmera ni de otros proyectos.

**Lo que no se hizo:**
- No hay cobros reales.
- No se registró ninguna credencial.
- No se concedió ni revocó ningún administrador.

## Resultado

| Componente | Versión del Worker | Código | Resultado |
|---|---|---|---|
| Puente | `c4f86206` | `c45b40e` | Correcto. Sirvió mientras se aplicó 0010 |
| PERF-001 | `31d8f4b8` | `c3387c4` | Correcto. Las cifras públicas coinciden con las locales |
| ADMIN-001 | `f06ed9cb` | `f06ef0e` | Correcto. Acceso, páginas y visor JSON verificados con datos de staging |
| Clave maestra | `c414c3bc` | (`f06ef0e` + secreto) | `SECRETS_MASTER_KEY` generada y guardada como secreto sin mostrarse |
| ADMIN-002, en servicio | `2a91d4c3` | `c1e596a` | Correcto. Panel de integraciones sin credenciales y pagos cerrados |

Versión anterior a DEPLOY-002: `97707a44` (commit `5dd7122`).

## Migraciones

| Migración | Aplicada | Comprobación |
|---|---|---|
| 0010 | 16:13 | 8 triggers `trg_rm_*` y 2 tablas. Ninguna tabla de negocio cambió su número de filas |
| 0011 | 16:26 | 10 índices: 5 del panel y 5 del cron. `EXPLAIN QUERY PLAN` en staging confirma que cada consulta usa su índice |
| 0012 | 16:36 | 5 tablas y `sessions.reauthenticated_at`. 0 credenciales y 0 configuraciones |

**Respaldo previo:**
- Marcador de Time Travel `0000024b-00000000-0000511b-3e5758f90056fc06c9f7b33e7630ea6e`.
- Copia JSON del esquema y de las 1.725 filas, fuera del repositorio. `wrangler d1 export` no admite bases con tablas FTS5.

## Lecturas de D1 observadas

Fuente: analíticas de Cloudflare por minuto. Una solicitud por minuto, fuera de los minutos del cron.

| Ruta | Staging | Local (PERF-001) |
|---|---:|---:|
| Home `/` y `/es/`, modelos vigentes | 11 | 11 |
| `/unirse`, `/es/unirse` | 8 | 8 |
| `/empresas` | 32 | — |
| `/api/v1/public/stats` | 4 | 4 |
| `/api/v1/public/retired-positions` | 2 | — |
| Reconstrucción tras desplegar PERF-001 | ≈3.000, una vez | 1.570 por modelo |

**Sobre la reconstrucción:**
- Ocurrió en el minuto 16:13, con una solicitud que no hice yo, justo después del despliegue.
- Se calcularon en paralelo los dos modelos de comercio (2 × 1.500 filas) y el catálogo (32 filas).
- Las solicitudes siguientes ya usaron los modelos vigentes.

| Página del panel (datos demo) | Filas |
|---|---:|
| Resumen | 80 (incluye el acceso) |
| Empresas | 91 |
| Filtro por correo | 32 |
| Ficha de empresa | 41 |
| Perfiles | 36 |
| Detalle con visor JSON | 16 |
| Auditoría | 12 |

## ¿Consume D1 sin visitantes?

**Sí, y solo por el cron**, cada 5 minutos. De 16:40 a 16:55, sin ninguna solicitud mía, hubo una invocación por ciclo, todas del cron:

| Estado | Filas por ciclo | Consultas por ciclo | Filas al día |
|---|---:|---:|---:|
| Antes de DEPLOY-002 | 28 | 12 | ≈ 8.064 |
| Tras desplegar todo | 18 | 16 | ≈ 5.184 |

**Las 16 consultas por ciclo** son 12 del barrido y 4 de la configuración de integraciones, que cada cron carga en un isolate nuevo; esas 4 leen 0 a 3 filas.

**Comprobaciones de que no hay otras lecturas:**
- Entre 00:00 y 16:10 todas las consultas de THE1500 fueron del cron.
- No había sondas ni pruebas ejecutándose.
- El navegador no consulta por su cuenta. Las búsquedas y el asistente solo consultan al enviarse, y la ficha del mosaico al hacer clic, con caché.
- La única repetición es la comprobación tras volver de Stripe: como máximo 60 veces en 3,5 minutos, y solo en ese caso.
- El panel no consulta automáticamente.

## Cron

Frecuencia: `*/5 * * * *`, sin cambios. Cada ciclo:
1. Caduca invitaciones y reservas vencidas.
2. Revisa los plazos de onboarding.
3. Revisa los plazos de solicitudes legales y de reembolsos y contracargos.
4. Envía notificaciones si el correo está configurado.
5. Concilia pagos de Stripe solo si los pagos de prueba están activos.

**Problema encontrado y corregido** (`ca1cbcf` y 0011):
- El barrido volvía a leer cada caso en espera.
- La consulta de plazos de resolución recorría toda la tabla.
- Cada aviso a un titular buscaba sus membresías recorriendo la tabla.

Con 1.500 empresas, `tests/perf/cron.cjs` mide:

| Ciclo con 1.500 empresas | Antes | Después |
|---|---:|---:|
| En reposo | 2.125 filas, ≈ 612.000 al día | 15 filas |
| Diez casos vencidos | 17.165 filas | 85 filas |

`tests/integration/cron.test.cjs` mantiene el comportamiento y falla si una consulta de plazos vuelve a recorrer la tabla.

## Caché de integraciones

| Situación | Coste |
|---|---|
| Cada carga | 4 consultas y 3 a 12 filas |
| Isolate en caché | Ninguna consulta, durante 30 segundos |
| Antes de 0012 | Ninguno |

**Qué carga cada ruta:**
- Home, directorio y API públicas no la cargan.
- `/unirse` carga solo el estado de Stripe.
- Asistente, acceso, compra, webhook y cron cargan lo que usan.

**Riesgos:**
- Varios isolates multiplican como mucho una carga cada 30 segundos por isolate.
- Un isolate nuevo carga una vez.

Se mantiene en 30 segundos: ampliarla retrasaría una revocación sin un ahorro apreciable.

## Seguridad comprobada en staging

| Comprobación | Resultado |
|---|---|
| `/es/admin` sin sesión | 302 al login, con `no-store` y `noindex` |
| API del panel sin sesión | 401 |
| Titular demo (no administrador) en la API | 403 |
| Titular demo en `/es/admin` | 404, sin mencionar el panel |
| Administrador demo | Panel completo con datos de staging |
| API de estado de integraciones | 401 sin sesión. Con sesión, `no-store`, sin claves, cifrados ni claves envueltas |
| Credenciales de terceros | Ninguna. Los únicos secretos del Worker son la clave maestra |
| Stripe | Compra cerrada (`PAYMENTS_DISABLED`). Las claves reales se rechazan |
| Mercado Pago | Sin adaptador transaccional; no se puede activar |

## Reversión segura

Cada paso deja un Worker compatible con el esquema que encuentra.

| Desde | Cómo | Esquema |
|---|---|---|
| ADMIN-002 | `wrangler rollback f06ed9cb` | Las tablas de 0012 se quedan; ADMIN-001 no las usa |
| ADMIN-001 | `wrangler rollback 31d8f4b8` | Los índices de 0011 se quedan |
| PERF-001 | `wrangler rollback c4f86206`, el puente | Seguro con los triggers de 0010 |
| Puente | Primero borrar los 8 `trg_rm_*`, las 2 tablas de 0010 y su fila en `d1_migrations`. Solo después, `wrangler rollback 97707a44` | Nunca se vuelve a `97707a44` con los triggers activos |
| Último recurso | Time Travel al marcador anterior | Perdería lo escrito después |

## Pendiente de tu decisión

1. **Correo de staging:**
   - El binding de Email Sending existe, pero no hay `MAIL_FROM`.
   - Sin correo no puedes entrar con tu dirección ni reautenticarte, así que los cambios en integraciones quedan bloqueados.
   - Hace falta un remitente de un dominio verificado.
2. **Activación de tu cuenta de superadministrador:** procedimiento en `docs/ADMIN_STAGED_DEPLOY.md`, sección 4. Requiere el punto 1.
3. **Revocación del administrador demo:** después del punto 2.
4. **Credenciales de prueba** de Anthropic, Stripe o Mercado Pago: se registrarían desde el panel tras el punto 2. No se usará ninguna real.
5. **Clave maestra:** existe solo como secreto del Worker. Si se sustituye, las credenciales guardadas con la anterior habrá que registrarlas de nuevo. Hoy no hay ninguna.
