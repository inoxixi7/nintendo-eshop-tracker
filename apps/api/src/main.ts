import { PgDatabaseClient } from '@eshop-tracker/database';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined || databaseUrl.length === 0) {
  process.stderr.write('API configuration is invalid\n');
  process.exit(1);
}

const port = Number(process.env.PORT ?? 3000);
const db = new PgDatabaseClient(databaseUrl);
const webRoot = fileURLToPath(new URL('../../web/dist/', import.meta.url));
// Docker's port proxy, plus Tailscale serve (and the public Caddy in front of it) add forwarded hops.
// Counting from the nearest hop keeps a visitor-supplied X-Forwarded-For from choosing their own IP.
const trustProxy = 2;
const app = buildApp(db, { logger: true, trustProxy, ...(existsSync(webRoot) ? { webRoot } : {}) });

async function shutdown() {
  await app.close();
  await db.close();
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    shutdown().then(() => process.exit(0), () => process.exit(1));
  });
}

await app.listen({ host: '0.0.0.0', port });
