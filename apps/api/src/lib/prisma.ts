import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { config } from "../config.js";
import { PrismaClient } from "../generated/prisma/client.js";

// Le pilote mariadb est compatible MySQL ; on lui passe une config explicite
// plutôt qu'une URL mysql:// qu'il n'accepte pas telle quelle.
const url = new URL(config.DATABASE_URL);

const adapter = new PrismaMariaDb({
  host: url.hostname,
  port: Number(url.port || 3306),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: url.pathname.slice(1),
  connectionLimit: 10,
  // MySQL 8 : authentification caching_sha2_password sans TLS en local
  allowPublicKeyRetrieval: true,
});

export const prisma = new PrismaClient({ adapter });
