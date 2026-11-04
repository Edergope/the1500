# Staging en Cloudflare

Todo lleva `staging` en el nombre. No existe producción.

| Recurso | Nombre | Identificador |
|---|---|---|
| Worker | `the1500-staging` | https://the1500-staging.admonpalmerafood.workers.dev |
| D1 | `the1500-staging` | `05012b7a-5b93-41a5-8bb1-5b12905dc5e5` |
| R2 | `the1500-staging-snapshots` | |
| Cron | cada 5 minutos | Vence reservas, mueve plazos, envía correos |
| Correo | binding `EMAIL`, `MAIL_PROVIDER=cloudflare` | Sin remitente ni dominio: no envía. Ver `docs/SECRETS_AND_INTEGRATIONS.md` |

Cuenta de Cloudflare: la asociada a `admonpalmerafood@gmail.com`, la única con sesión en Wrangler. Comparte cuenta con los recursos `palmera-*`, que no se tocan.

## Desplegar

```bash
npm run build
```
```bash
npx wrangler deploy --config dist/server/wrangler.json
```

## Migrar

```bash
npm run db:migrate:remote
```

## Datos de demostración y acceso sin correo

Mientras no haya proveedor de correo, quien tenga acceso a Cloudflare puede sembrar datos y obtener un enlace de un solo uso, válido 15 minutos:

```bash
node scripts/demo.cjs link admin@demo-the1500.example --target staging
```

El administrador de demostración solo existe en staging. Para crear un administrador real: `docs/CORE004_IMPLEMENTATION.md` §3, añadiendo `--remote` al comando.

## Pruebas remotas

`tests/remote/staging.cjs` se ejecuta contra el Worker desplegado y D1 remoto, y deja datos de prueba y una ocupación agotada. Necesita un `STRIPE_WEBHOOK_SECRET` temporal, conocido solo por quien la ejecuta: al terminar se elimina, o se reemplaza por el de Stripe. Una vez puesto el real, no volver a ejecutarla sin cambiarlo.

Devolver D1 a su estado limpio después de una ejecución:

```bash
npx wrangler d1 time-travel restore DB --bookmark=0000001c-00000002-00005119-c308f4550e210473e6708e17fd735d50
```

Ese marcador corresponde a la base recién migrada (0001–0009) y caduca con la ventana de Time Travel. Con migraciones nuevas: restaurar y luego migrar, o tomar otro marcador con `wrangler d1 time-travel info DB --json`.
