# Image de production du backend. Contexte de build : racine du dépôt.
#   docker build -f apps/api/Dockerfile -t autolocalize-api .

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
RUN npm ci --workspace @autolocalize/api --include-workspace-root --no-audit --no-fund
COPY apps/api apps/api
WORKDIR /app/apps/api
# prisma.config.ts exige DATABASE_URL, même pour générer le client.
RUN DATABASE_URL=mysql://build:build@localhost:3306/build npx prisma generate \
 && npx tsc -p tsconfig.json
RUN npm prune --omit=dev --workspace @autolocalize/api --include-workspace-root --no-audit --no-fund

FROM node:24-alpine
ENV NODE_ENV=production
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/apps/api/package.json /app/apps/api/prisma.config.ts ./apps/api/
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/apps/api/dist ./apps/api/dist
WORKDIR /app/apps/api
USER node
# Applique les migrations en attente puis démarre le serveur.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
