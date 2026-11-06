# THE1500: ADMIN-OPS, centro de operaciones

Pantallas para operar THE1500 desde el panel, sin comandos ni ediciones de D1. Todas están en inglés y español, dentro del panel de ADMIN-001.

## Navegación

Resumen · Empresas · **Inventario** · **Fundadores** · Perfiles y JSON · **Solicitudes** · **Pagos** · **Incidencias** · Integraciones · Auditoría

| Pantalla | Rutas | Qué permite |
|---|---|---|
| Inventario | `/admin/inventario` (también `/admin/inventory`), `/es/admin/inventario`, ficha en `/…/inventario/{n}` | Mapa de las 1.500 posiciones, cifras por estado, reservas activas, tabla con filtros, y ficha con movimientos, adjudicaciones de fundador e intentos de compra. **Sin acciones**: las posiciones solo cambian por un pago verificado o por una decisión de fundador o Premium. Una posición publicada aparece bloqueada |
| Fundadores | `/…/fundadores` | Cupos 1–100, invitaciones por estado, invitar por ID de empresa, adjudicar (solo con invitación aceptada) y revocar. Una invitación aceptada se muestra como «Aceptada, sin adjudicar» hasta que alguien decide |
| Solicitudes | `/…/solicitudes` | Colas, de la más urgente a la menos: verificación empresarial, revisión de perfiles, Premium, cancelaciones, retiros y solicitudes legales (con plazo legal), reactivaciones, revisión individual de onboarding y ventanas de corrección |
| Pagos | `/…/pagos`, ficha en `/…/pagos/{id}` | Intentos con proveedor, importe, moneda, estado, posición, reembolso e incidencias. La ficha muestra solo las acciones que el backend admite en ese estado; las que llaman a Stripe solo aparecen con los pagos de prueba activos |
| Incidencias | `/…/incidencias`, ficha en `/…/incidencias/{id}` | Abiertas por severidad, filtros, detalle, historial y resolución con motivo y evidencia |

## API reutilizadas

No se creó ninguna regla de negocio nueva. Las acciones llaman a rutas existentes:
- `founder-invite`, `founder-award`, `founder-revoke`
- `review-company`, `profiles/review`
- `premium/requests`, `premium/assign`
- `requests/resolve`, `requests/legal-deadline`, `withdrawals/execute`
- `onboarding/reactivation`, `onboarding/final-notice`, `onboarding/resolve`
- `payments/reconcile`, `refund`, `refund-alternative`, `resolve-late`, `payer-authorization`, `chargeback-resolve`
- `incidents/resolve`

Las lecturas son nuevas y están en `src/core/admin-ops.ts`. Solo leen, se paginan y usan índices.

## Seguridad

**Garantías comunes:**
- Todas las páginas pasan por el middleware de `/admin`: sesión en el servidor y `platform_admins`, `no-store` y `noindex`.
- Todas las acciones pasan por `adminPost`: verificación de origen, motivo y evidencia, y auditoría inmutable.

**Reautenticación de 15 minutos**, nueva en este sprint. La exigen las acciones irreversibles o que afectan a posiciones o dinero:
- Adjudicar y revocar fundador.
- Asignar Premium.
- Ejecutar retiro.
- Resolver un caso de onboarding.
- Reembolso y reembolso alternativo.
- Pago tardío.
- Contracargo.

**Cómo se confirma:** el botón «Confirmar identidad» de la barra lateral envía un enlace de un solo uso a tu correo. El enlace hay que abrirlo en la misma sesión.

## Rendimiento de D1

Medido con `node tests/perf/ops.cjs`, en local, con 1.500 empresas, todas las posiciones en uso y colas de tamaño realista. Son proyecciones locales, no mediciones de staging.

| Pantalla | Filas antes de 0013 | Con 0013 |
|---|---:|---:|
| Inventario | 207 | 207 |
| Inventario, publicadas | 4.505 | 207 |
| Ficha de posición | 306 | 6 |
| Fundadores | 1.802 | 416 |
| Solicitudes | 4.527 | 28 |
| Pagos | 5.076 | 183 |
| Ficha de pago | 307 | 6 |
| Incidencias | 253 | 253 |
| Ficha de incidencia | 2 | 2 |

**Cómo se consigue:**
- **Mapa del inventario:** sale de los modelos de lectura de PERF-001. Las reservas activas se leen en vivo, así que nunca se muestra una reserva caducada.
- **Listas:** sin consultas periódicas, sin consultas por fila y sin contar totales.
- **Pagos:** solo cuenta los estados que esperan una decisión.

**Migración `0013_admin_ops_indexes.sql`:** solo índices; no cambia tablas ni datos. PAY-002 pasa a la `0014`.

## Pruebas

`tests/integration/adminops.test.cjs` comprueba:
- Inventario frente a las tablas, con reservas incluidas.
- Que una invitación aceptada no es una posición.
- Colas de solicitudes.
- Incidencias resueltas con autoría y auditoría inmutable.
- Validación de filtros.
- Rutas críticas detrás de la reautenticación.
- Que 0013 solo contiene índices y que se usan.
- El rechazo por destinatario del remitente de pruebas de Resend.

El recorrido e2e confirma su identidad antes de adjudicar un fundador.
