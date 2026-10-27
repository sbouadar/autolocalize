import type { FastifyPluginAsync } from "fastify";
import { auth } from "../lib/auth.js";

// Relaie /api/auth/* vers Better Auth (connexion, déconnexion, session, double authentification).
const authRoutes: FastifyPluginAsync = async (app) => {
  app.route({
    method: ["GET", "POST"],
    url: "/auth/*",
    async handler(request, reply) {
      const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);

      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) {
        if (value !== undefined) headers.append(key, Array.isArray(value) ? value.join(", ") : value);
      }

      const response = await auth.handler(
        new Request(url, {
          method: request.method,
          headers,
          body: request.body ? JSON.stringify(request.body) : undefined,
        }),
      );

      reply.status(response.status);
      response.headers.forEach((value, key) => {
        if (key !== "set-cookie") reply.header(key, value);
      });
      for (const cookie of response.headers.getSetCookie()) reply.header("set-cookie", cookie);

      return reply.send(response.body ? await response.text() : null);
    },
  });
};

export default authRoutes;
