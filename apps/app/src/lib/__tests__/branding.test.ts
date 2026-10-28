import { PLATFORM_NAME, readableTextOn, resolveBranding } from "../branding";

describe("resolveBranding", () => {
  it("retombe sur le branding plateforme sans données", () => {
    const b = resolveBranding(null);
    expect(b.name).toBe(PLATFORM_NAME);
    expect(b.isPlatform).toBe(true);
    expect(b.logoUrl).toBeNull();
    expect(b.primaryColor).toBe("#1E3A8A");
  });

  it("garde les valeurs valides du client", () => {
    const b = resolveBranding({ name: "Démo Transport", primaryColor: "#ff0000", secondaryColor: "#00ff00" });
    expect(b.name).toBe("Démo Transport");
    expect(b.isPlatform).toBe(false);
    expect(b.primaryColor).toBe("#FF0000");
    expect(b.initials).toBe("DT");
  });

  it("remplace les couleurs invalides et développe le format court", () => {
    expect(resolveBranding({ name: "X", primaryColor: "rouge" }).primaryColor).toBe("#1E3A8A");
    expect(resolveBranding({ name: "X", primaryColor: "#abc" }).primaryColor).toBe("#AABBCC");
    expect(resolveBranding({ name: "X", secondaryColor: "" }).secondaryColor).toBe("#F59E0B");
  });

  it("ignore un nom vide ou blanc", () => {
    expect(resolveBranding({ name: "   " }).name).toBe(PLATFORM_NAME);
  });

  it("refuse les URL de logo non http(s)", () => {
    expect(resolveBranding({ name: "X", logoUrl: "javascript:alert(1)" }).logoUrl).toBeNull();
    expect(resolveBranding({ name: "X", logoUrl: "https://cdn.test/logo.png" }).logoUrl).toBe(
      "https://cdn.test/logo.png",
    );
    expect(resolveBranding({ name: "X", logoUrl: "/uploads/logo.png" }).logoUrl).toBe("/uploads/logo.png");
  });

  it("masque les coordonnées vides", () => {
    const b = resolveBranding({ name: "X", address: " ", phone: null });
    expect(b.address).toBeNull();
    expect(b.phone).toBeNull();
  });

  it("calcule des initiales même avec un seul mot ou des symboles", () => {
    expect(resolveBranding({ name: "Transports" }).initials).toBe("TR");
    expect(resolveBranding({ name: "S.A.R.L Atlas" }).initials).toBe("SA");
  });
});

describe("readableTextOn", () => {
  it("choisit le blanc sur fond foncé et le noir sur fond clair", () => {
    expect(readableTextOn("#1E3A8A")).toBe("#FFFFFF");
    expect(readableTextOn("#FDE68A")).toBe("#0F172A");
  });
});
