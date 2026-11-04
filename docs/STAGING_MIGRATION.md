# Traslado de staging a una cuenta independiente

**Estado: preparado, sin ejecutar.** Requiere la cuenta nueva y el dominio. La cuenta actual, con los recursos `palmera-*`, solo se toca en el paso 8, y únicamente para retirar los tres recursos `the1500-staging` de la tabla.

Staging tiene la base de datos y R2 limpios, así que no hay datos que exportar. GitHub y el frontend no cambian: el contrato es de mismo origen.

## Orden, para no migrar dos veces

1. El propietario crea la cuenta nueva.
2. El dominio se compra **directamente en la cuenta nueva**. Evita el traslado entre cuentas, que exige 10 días desde el registro y deja el dominio bloqueado 30 días.
3. Se recrea staging en `staging.the1500.com`. Esa URL ya no depende de la cuenta.
4. Se retira el staging anterior.

## Lo que hace el propietario

1. Crear la cuenta con un correo dedicado a THE1500, que no sea de Palmera. Verificarlo y activar 2FA.
2. Comprar el dominio y aceptar los acuerdos: `docs/DOMAIN_REVIEW_2026-11-04.md`.
3. Autorizar a Wrangler en el navegador, seleccionando **solo** la cuenta nueva:

```bash
npx wrangler auth create the1500
```

## Lo que hace Claude, desde la carpeta del proyecto

**1. Separar la sesión.** Enlaza un perfil solo a esta carpeta; los demás proyectos conservan el suyo.

```bash
npx wrangler auth activate the1500 .
```
```bash
npx wrangler d1 list
```

**Punto de control:** la lista no debe mostrar ningún `palmera-*`. Si los muestra, se detiene todo. Los perfiles de Wrangler están en beta, por eso se añade también el `account_id` del paso 3.

**2. Crear los recursos, solo los del plan gratuito.**

```bash
npx wrangler d1 create the1500-staging
```
```bash
npx wrangler r2 bucket create the1500-staging-snapshots
```

R2 puede pedir activarse con un método de pago en la cuenta nueva, aunque no genere cargo dentro del nivel gratuito. Si lo pide, se avisa antes de continuar.

**3. Actualizar `wrangler.jsonc`.** Fijar `account_id` impide desplegar en otra cuenta por error.

| Campo | Valor |
|---|---|
| `account_id` | El de la cuenta nueva |
| `d1_databases[0].database_id` | El del paso 2 |
| `vars.PUBLIC_BASE_URL` | `https://staging.the1500.com` |
| `routes` | `[{"pattern": "staging.the1500.com", "custom_domain": true}]` |

**4. Migrar y desplegar.**

```bash
npm run db:migrate:remote
```
```bash
npm run build
```
```bash
npx wrangler deploy --config dist/server/wrangler.json
```

**5. Verificar.** Ejecutar `tests/remote/staging.cjs` con un secreto de webhook temporal, conservar la evidencia, restaurar D1 con Time Travel y borrar ese secreto, como se documenta en `docs/STAGING.md`.

**6. Actualizar referencias.** Sustituir la URL anterior en `docs/STAGING.md`, `docs/SECRETS_AND_INTEGRATIONS.md`, `docs/START_HERE_ANTIGRAVITY.md` y `wrangler.jsonc`, y publicar en `feature/core-claude`. Avisar a Antigravity.

**7. Correo.** Continuar con `docs/SECRETS_AND_INTEGRATIONS.md` §1. Cualquier secreto o webhook se configura en la cuenta nueva.

**8. Retirar el staging anterior, con autorización expresa y solo cuando lo anterior funcione.** Se quita primero el enlace del perfil, para operar sobre la cuenta anterior, y se comprueba cada nombre.

```bash
npx wrangler auth deactivate .
```
```bash
npx wrangler delete --name the1500-staging
```
```bash
npx wrangler d1 delete the1500-staging
```
```bash
npx wrangler r2 bucket delete the1500-staging-snapshots
```
```bash
npx wrangler auth activate the1500 .
```

| Se retira | No se toca |
|---|---|
| Worker `the1500-staging` | `palmera-db` |
| D1 `the1500-staging` | `palmera-v2-db-staging` |
| R2 `the1500-staging-snapshots` (vacío) | `palmera-v2-media-staging` y cualquier otro recurso |

## Marcha atrás

Hasta el paso 8 el staging anterior sigue funcionando sin cambios. Si algo falla, se revierte `wrangler.jsonc` con git y se quita el enlace del perfil.

## Fuera de este procedimiento

Workers Paid, producción, cobros reales y claves de proveedores requieren autorización aparte.
