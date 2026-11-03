# THE1500 | UX-002 — Entrega para Antigravity

Construye las interfaces (inglés por defecto, español en `/es/`) sobre las APIs existentes, **sin modificar `src/core/**`, `db/**` ni los endpoints**.

1. `/admin`: proteger la página por sesión + rol server-side. Consultar `/api/v1/admin/overview` y `/api/v1/admin/companies`. La confirmación de identidad solo se registra después de revisión documental auténtica. Enviar POST `/api/v1/admin/review-company` con motivo y evidencia interna. Mostrar errores HTTP sin fingir éxito.
2. Invitación fundadora: desde la página de administración, enviar POST `/api/v1/admin/founder-invite` con `companyId` de una empresa elegible. Informar **"Available in owner portal"**, nunca **"Email sent"**. No mostrar como adjudicada hasta aceptación del propietario.
3. `/mi-cuenta`: consultar `/api/v1/me/founder-invitations` y ofrecer aceptación expresa vía POST `/api/v1/me/founder-invitations/accept`. Si vence, mostrar la caducidad y no inventar renovación.
4. Perfil: consumir `GET/PUT /api/v1/me/company/profile`, `/approve` y `/publish`, mostrando datos, versión, `contentDigest`, autorizaciones y restricciones de cupo. Evitar aprobación automática por consulta.
5. Directorio: conectar una búsqueda semántica textual al endpoint `/api/v1/public/search`; conectar el asistente al `/api/v1/public/ask` y etiquetarlo de manera veraz como **búsqueda de perfiles** hasta habilitar generación con IA real.
6. No inventar empresas fundadoras, cupos ocupados, sellos de verificación, testimonios, garantías de recomendaciones de IA externas ni cobros activos.

Fuentes de verdad: `docs/API_CONTRACT.md`, `docs/CORE004_IMPLEMENTATION.md`, el registro de decisiones en Google Drive y componentes ya disponibles en `src/pages`. Las versiones antiguas de los prompts en `docs/source/` pueden contener reglas anteriores sobre fundadores, idiomas y checkout.
