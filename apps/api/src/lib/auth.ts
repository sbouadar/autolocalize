import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { bearer } from "better-auth/plugins/bearer";
import { twoFactor } from "better-auth/plugins/two-factor";
import { config, isProduction } from "../config.js";
import { prisma } from "./prisma.js";

export const auth = betterAuth({
  appName: "AutoLocalize",
  baseURL: config.PUBLIC_URL,
  basePath: "/api/auth",
  secret: config.BETTER_AUTH_SECRET,
  trustedOrigins: [config.PUBLIC_URL],
  database: prismaAdapter(prisma, { provider: "mysql" }),
  emailAndPassword: {
    enabled: true,
    // Les comptes sont créés par un admin, jamais en libre inscription.
    disableSignUp: true,
    minPasswordLength: 12,
  },
  user: {
    additionalFields: {
      role: { type: "string", input: false, defaultValue: "VIEWER" },
      tenantId: { type: "string", input: false, required: false },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
    },
  },
  advanced: {
    useSecureCookies: isProduction,
  },
  // bearer : l'application mobile envoie le jeton de session en en-tête.
  plugins: [twoFactor({ issuer: "AutoLocalize" }), bearer()],
});
