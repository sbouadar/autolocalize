import { z } from "zod";
import { ApiError, api, setUnauthorizedHandler, userMessage } from "../api";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

function mockFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  globalThis.fetch = jest.fn(async () =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    }),
  ) as jest.Mock;
}

afterEach(() => setUnauthorizedHandler(null));

describe("api", () => {
  it("valide la réponse avec le schéma fourni", async () => {
    mockFetch(200, { ok: true, extra: 1 });
    await expect(api("/x", { schema: z.object({ ok: z.boolean() }) })).resolves.toEqual({ ok: true });
  });

  it("rejette une réponse non conforme", async () => {
    mockFetch(200, { ok: "oui" });
    await expect(api("/x", { schema: z.object({ ok: z.boolean() }) })).rejects.toMatchObject({ status: 0 });
  });

  it("signale une session expirée sur 401, sauf pour les routes d'authentification", async () => {
    const onUnauthorized = jest.fn();
    setUnauthorizedHandler(onUnauthorized);

    mockFetch(401, { error: "Unauthorized" });
    await expect(api("/vehicles")).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);

    await expect(api("/auth/sign-in/email", { method: "POST", body: {} })).rejects.toMatchObject({
      status: 401,
    });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("transforme une erreur réseau en ApiError de statut 0", async () => {
    globalThis.fetch = jest.fn(async () => {
      throw new TypeError("Network request failed");
    }) as jest.Mock;
    await expect(api("/me")).rejects.toMatchObject({ status: 0 });
  });

  it("n'envoie jamais de cookie depuis le natif", async () => {
    mockFetch(200, {});
    await api("/me");
    const init = (globalThis.fetch as jest.Mock).mock.calls[0][1] as RequestInit;
    expect(init.credentials).toBe("omit");
  });
});

describe("userMessage", () => {
  it("ne renvoie pas le texte brut du serveur pour les erreurs techniques", () => {
    expect(userMessage(new ApiError(500, "NullPointerException at ..."))).toMatch(/indisponible/);
    expect(userMessage(new ApiError(429, "Too many requests"))).toMatch(/Trop de tentatives/);
    expect(userMessage(new ApiError(401, "Unauthorized"))).toMatch(/session a expiré/);
    expect(userMessage(new Error("boom"))).toMatch(/inattendue/);
  });

  it("garde les messages rédigés par l'application ou le backend pour 0 et 403", () => {
    expect(userMessage(new ApiError(0, "Serveur injoignable."))).toBe("Serveur injoignable.");
    expect(userMessage(new ApiError(403, "Abonnement suspendu"))).toBe("Abonnement suspendu");
  });
});
