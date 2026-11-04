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

## Primer administrador

Tras iniciar sesión por primera vez, con correo ya configurado: `docs/CORE004_IMPLEMENTATION.md` §3, añadiendo `--remote` al comando.

## Pruebas remotas

`tests/remote/staging.cjs` se ejecuta contra el Worker desplegado y D1 remoto, y deja datos de prueba y una ocupación agotada. Necesita un `STRIPE_WEBHOOK_SECRET` temporal, conocido solo por quien la ejecuta: al terminar se elimina, o se reemplaza por el de Stripe. Una vez puesto el real, no volver a ejecutarla sin cambiarlo.

Devolver D1 a su estado limpio después de una ejecución:

```bash
npx wrangler d1 time-travel restore DB --bookmark=00000009-00000002-00005119-86ea2fb0121e43b3c923188270100d53
```

Ese marcador corresponde a la base recién migrada (0001–0008) y caduca con la ventana de Time Travel. Con migraciones nuevas: restaurar y luego migrar, o tomar otro marcador con `wrangler d1 time-travel info DB --json`.
