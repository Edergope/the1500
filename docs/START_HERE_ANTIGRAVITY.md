

## Arranque CORE-006 (2026-11-04)

- Repositorio privado: https://github.com/Edergope/the1500. Crea `feature/ux-antigravity` desde `feature/core-claude`. No hace falta esperar a Stripe ni a la facturación.
- Contrato: `docs/API_CONTRACT.md` v1.1. Tipos: `src/lib/contracts/api.ts`. Una prueba falla si una ruta no figura en el contrato, así que un cambio de API lo pide Claude, no el frontend.
- API desplegada para consultar: https://the1500-staging.admonpalmerafood.workers.dev. Sin correo configurado no se puede iniciar sesión allí todavía; las rutas públicas sí responden. Para las pantallas con sesión, usa el entorno local descrito en `CORE006_STATUS.md`.
- Pantallas nuevas: formulario Premium (solo en `premium_admission`, sin checkout y sin presentar la reunión como requisito), estados de reactivación (§8 del contrato), base legal en la solicitud de retiro, y en administración: decisión de retiro, plazo legal, reactivación y conciliación de pagos tardíos con sus hechos.

## Vigente desde CORE-008

El encargo actual, con el arranque local y las pantallas por prioridad, está en `docs/ANTIGRAVITY_BRIEF.md`. Prevalece sobre lo anterior de este archivo.
