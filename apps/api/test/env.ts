// Préchargé avant chaque fichier de test (voir le script « test » du package.json) :
// fixe l'environnement avant que src/config.ts ne le lise.
// Base MariaDB jetable et faux Traccar local : aucune valeur ici n'est un secret.
//   docker run -d --name autolocalize-wt-test -e MARIADB_ROOT_PASSWORD=test \
//     -e MARIADB_DATABASE=autolocalize_test -p 127.0.0.1:3317:3306 mariadb:10.5
//   DATABASE_URL=mysql://root:test@127.0.0.1:3317/autolocalize_test npx prisma migrate deploy

import { tmpdir } from "node:os";
import { join } from "node:path";

export const FAKE_TRACCAR_PORT = 18082;
export const LOGO_DIR = join(tmpdir(), `autolocalize-test-logos-${process.pid}`);
export const FAKE_TRACCAR_TOKEN = "test-traccar-token";
export const PUBLIC_URL = "http://localhost:3100";

Object.assign(process.env, {
  NODE_ENV: "test",
  LOG_LEVEL: "fatal",
  PUBLIC_URL,
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? "mysql://root:test@127.0.0.1:3317/autolocalize_test",
  BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0123456789",
  TRACCAR_URL: `http://127.0.0.1:${FAKE_TRACCAR_PORT}`,
  TRACCAR_TOKEN: FAKE_TRACCAR_TOKEN,
  CORS_ORIGINS: "",
  LOGO_DIR,
});
