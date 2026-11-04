# Encargo para Antigravity: frontend de THE1500

Repositorio privado: https://github.com/Edergope/the1500. Base: `feature/core-claude`. Tu rama: `feature/ux-antigravity`.

No edites `src/core/`, `src/pages/api/`, `db/` ni `tests/`. Si necesitas un cambio de API, pídelo: una prueba falla si una ruta no figura en el contrato.

**Fuentes de verdad:** `docs/API_CONTRACT.md` y `src/lib/contracts/api.ts`.

## Arrancar en local

```bash
git checkout -b feature/ux-antigravity origin/feature/core-claude
```
```bash
npm ci
```
```bash
cp .dev.vars.example .dev.vars
```
```bash
npm run db:migrate:local
```
```bash
npm run dev
```

Con el servidor en marcha, en otra terminal:

```bash
npm run demo:seed:local
```

Imprime un enlace de acceso por cada estado de usuario, válido una sola vez. Para otro enlace:

```bash
node scripts/demo.cjs link owner@demo-ocean-freight.example --target local
```

Para empezar de cero: detén el servidor, borra `.wrangler/state`, y repite desde la migración. El correo no sale de tu equipo: el simulador deja el mensaje en un archivo cuya ruta aparece en la terminal del servidor.

## Consultar staging

https://the1500-staging.admonpalmerafood.workers.dev muestra el backend real con empresas "Demo …". Sirve para rutas públicas sin instalar nada. Esta URL cambiará cuando exista el dominio, así que nunca la escribas en el código: todas las llamadas son de mismo origen, con rutas relativas.

## Pantallas, por prioridad

| # | Pantalla | Rutas | Estados a cubrir |
|---|---|---|---|
| 1 | Inicio, `/unirse`, directorio y ficha, en inglés y español | `/public/stats`, `/public/companies`, `/public/companies/:slug` | Según `salesMode`; lista vacía; cupo retirado |
| 2 | Búsqueda y asistente | `/public/search`, `/public/ask` | `llm_grounded`, `retrieval_only`, `abstained`, con citas y `limitations` |
| 3 | Acceso | `/auth/request-link`, `/auth/verify` | 202, 503 mientras no haya correo, enlace vencido |
| 4 | Mi cuenta | `/auth/me`, `/me/company` | Sin cupo, formulario pendiente, publicado, retirado |
| 5 | Compra | `/orders/hold`, `/orders/checkout` | Cuenta atrás de 20 minutos. Con `checkoutEnabled:false` no enviar a pagar |
| 6 | Formulario, vista previa, aprobación y publicación | `/me/company/profile`, `/approve`, `/publish` | Procedencia del texto; `deterministic` nunca se llama IA |
| 7 | Solicitudes del titular | `/me/company/requests`, `/reactivate`, `/final-notice-response`, `/premium-request` | Contrato §8 |
| 8 | Fundadores | `/me/founder-invitations` | Sin distintivo público de fundador |
| 9 | Administración | `/admin/*` | Decisiones con `reasonCode` y `evidenceReference`; casos, pagos tardíos, retiros, Premium, integraciones |

## Reglas que no se negocian

- El frontend nunca calcula precio, número, disponibilidad ni permisos.
- Volver de Stripe no prueba nada: consulta `GET /me/company` hasta que aparezca `position`.
- Búsqueda léxica: no llamarla semántica ni IA.
- Cupo retirado: solo el número y la etiqueta exacta de la API.
- El dominio no se presenta como marca registrada. No uses ® ni texto que sugiera titularidad.
- Nada de datos inventados como reales. Las empresas "Demo" son de prueba.

## Entrega

Abre un PR hacia `feature/core-claude` con capturas de móvil y escritorio, y prueba en navegador el acceso real: confirmar el enlace, entrar y cerrar sesión. Esa prueba ya destapó un fallo que las pruebas por HTTP no veían.
