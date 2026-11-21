import { escapeHtml, markerHtml } from "../marker-html";

const look = {
  label: "GPS1",
  color: "#0E7A43",
  heading: null,
  selected: false,
  selectedBg: "#141414",
  selectedFg: "#FFFFFF",
  text: "#141414",
  surface: "#FFFFFF",
};

describe("markerHtml", () => {
  it("n'interprète jamais le nom du véhicule comme du HTML", () => {
    expect(escapeHtml(`<img src=x onerror="alert(1)">&'`)).toBe("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;");
    const html = markerHtml({ ...look, label: "<script>alert(1)</script>" });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("refuse une couleur qui n'est pas au format #RRGGBB", () => {
    const html = markerHtml({ ...look, color: "red;background:url(x)" });
    expect(html).not.toContain("url(x)");
  });

  it("ajoute la flèche de cap seulement quand le véhicule roule", () => {
    expect(markerHtml(look)).not.toContain("rotate(");
    expect(markerHtml({ ...look, heading: 90 })).toContain("rotate(90deg)");
  });
});
