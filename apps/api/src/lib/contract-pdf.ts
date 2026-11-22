import { readFile } from "node:fs/promises";
import { join } from "node:path";
import PDFDocument from "pdfkit";
import { LOGO_FILE, LOGO_URL_PREFIX, logoDir } from "./logos.js";

// Contrat de location et rapport de retour en PDF (français uniquement). Polices standard du PDF
// (Helvetica, encodage WinAnsi) : elles couvrent les caractères accentués du français.
// Le contrat porte le numéro complet de la pièce d'identité (décision du 2026-11-21) : le fichier
// produit est une donnée sensible, à ne stocker et servir qu'en privé.

const INK = "#141414";
const MUTED = "#5C5C58";
const LINE = "#D9D9D5";
const MARGIN = 48;

export interface ContractData {
  /** Référence courte de la location (affichée, pas un secret). */
  reference: string;
  tenant: { name: string; address: string | null; phone: string | null; email: string | null; logoUrl: string | null; timezone: string; currency: string };
  customer: {
    kind: string;
    name: string;
    address: string | null;
    phone: string | null;
    email: string | null;
    birthDate: Date | null;
    idDocumentLabel: string;
    idDocumentNumber: string | null;
    licenseNumber: string | null;
    licenseExpiresOn: Date | null;
  };
  driverName: string | null;
  vehicle: { name: string; plate: string | null; brand: string | null; model: string | null; year: number | null; vin: string | null; color: string | null };
  startAt: Date;
  endAt: Date;
  pickedUpAt: Date;
  odometerOutKm: number;
  fuelOut: number;
  price: string | null;
  deposit: string | null;
  terms: string | null;
}

export interface ReturnReportData {
  reference: string;
  tenant: ContractData["tenant"];
  customerName: string;
  vehicle: { name: string; plate: string | null };
  startAt: Date;
  endAt: Date;
  pickedUpAt: Date | null;
  returnedAt: Date;
  odometerOutKm: number | null;
  odometerInKm: number | null;
  fuelOut: number | null;
  fuelIn: number | null;
  gpsDistanceKm: number | null;
  /** Photos de retour (JPEG) et leur légende. */
  photos: { bytes: Buffer; caption: string | null }[];
}

const CURRENCY_LABEL: Record<string, string> = { MAD: "DH", EUR: "€", USD: "$" };

function formatter(timeZone: string, withTime: boolean) {
  try {
    return new Intl.DateTimeFormat("fr-FR", { timeZone, dateStyle: "long", ...(withTime && { timeStyle: "short" }) });
  } catch {
    return new Intl.DateTimeFormat("fr-FR", { timeZone: "Africa/Casablanca", dateStyle: "long", ...(withTime && { timeStyle: "short" }) });
  }
}

/** Les polices standard n'ont pas les espaces fines insécables produites par Intl : espaces simples. */
const plain = (s: string) => s.replace(/[\u202f\u00a0]/g, " ").replace(/^1 /, "1er ");
const dateOnly = (d: Date) => plain(new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", dateStyle: "long" }).format(d));
const money = (amount: string | null, currency: string) =>
  amount == null ? "—" : `${plain(new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2 }).format(Number(amount)))} ${CURRENCY_LABEL[currency] ?? currency}`;
const km = (n: number | null) => (n == null ? "—" : `${plain(new Intl.NumberFormat("fr-FR").format(n))} km`);
const fuel = (n: number | null) => (n == null ? "—" : `${n}/8`);

/** Logo du client, si c'est un PNG ou un JPEG stocké par l'API (le PDF ne gère pas le WebP). */
async function loadLogo(logoUrl: string | null): Promise<Buffer | null> {
  if (!logoUrl?.startsWith(LOGO_URL_PREFIX)) return null;
  const file = logoUrl.slice(LOGO_URL_PREFIX.length);
  if (!LOGO_FILE.test(file) || file.endsWith(".webp")) return null;
  try {
    return await readFile(join(logoDir(), file));
  } catch {
    return null;
  }
}

type Doc = InstanceType<typeof PDFDocument>;

function render(build: (doc: Doc) => void, title: string): Promise<Buffer> {
  return new Promise((resolvePdf, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: MARGIN, info: { Title: title, Creator: "AutoLocalize" } });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolvePdf(Buffer.concat(chunks)));
    doc.on("error", reject);
    try {
      build(doc);
      doc.end();
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

function header(doc: Doc, tenant: ContractData["tenant"], logo: Buffer | null, title: string, subtitle: string) {
  const top = doc.y;
  if (logo) {
    try {
      doc.image(logo, MARGIN, top, { fit: [90, 56] });
    } catch {
      // Logo illisible par le PDF : le contrat reste valable sans lui.
    }
  }
  const x = logo ? MARGIN + 104 : MARGIN;
  doc.font("Helvetica-Bold").fontSize(14).fillColor(INK).text(tenant.name, x, top);
  doc.font("Helvetica").fontSize(9).fillColor(MUTED);
  for (const line of [tenant.address, tenant.phone, tenant.email]) if (line) doc.text(line, x);
  doc.y = Math.max(doc.y, top + 60) + 8;
  doc.x = MARGIN;
  doc.font("Helvetica-Bold").fontSize(18).fillColor(INK).text(title);
  doc.font("Helvetica").fontSize(10).fillColor(MUTED).text(subtitle);
  doc.moveDown(0.8);
}

function section(doc: Doc, title: string) {
  if (doc.y > doc.page.height - 140) doc.addPage();
  doc.moveDown(0.6);
  doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text(title.toUpperCase(), MARGIN);
  const y = doc.y + 2;
  doc.moveTo(MARGIN, y).lineTo(doc.page.width - MARGIN, y).lineWidth(0.5).strokeColor(LINE).stroke();
  doc.y = y + 6;
}

function rows(doc: Doc, items: [string, string | null | undefined][]) {
  const width = doc.page.width - 2 * MARGIN;
  for (const [label, value] of items) {
    if (!value) continue;
    const y = doc.y;
    doc.font("Helvetica").fontSize(10).fillColor(MUTED).text(label, MARGIN, y, { width: 170 });
    doc.font("Helvetica-Bold").fontSize(10).fillColor(INK).text(value, MARGIN + 176, y, { width: width - 176 });
    doc.y = Math.max(doc.y, y + 14) + 2;
  }
}

export async function generateContractPdf(data: ContractData): Promise<Buffer> {
  const logo = await loadLogo(data.tenant.logoUrl);
  const dateTime = (d: Date) => plain(formatter(data.tenant.timezone, true).format(d));
  const day = (d: Date) => plain(formatter(data.tenant.timezone, false).format(d));
  const c = data.customer;
  const v = data.vehicle;

  return render((doc) => {
    header(doc, data.tenant, logo, "Contrat de location de véhicule", `Contrat n° ${data.reference} · établi le ${day(data.pickedUpAt)}`);

    section(doc, "Le loueur");
    // Coordonnées complètes du loueur : dans l'en-tête, pas répétées ici.
    rows(doc, [["Société", data.tenant.name]]);

    section(doc, "Le locataire");
    rows(doc, [
      [c.kind === "COMPANY" ? "Raison sociale" : "Nom", c.name],
      ["Adresse", c.address],
      ["Téléphone", c.phone],
      ["E-mail", c.email],
      ["Date de naissance", c.birthDate ? dateOnly(c.birthDate) : null],
      [c.idDocumentLabel, c.idDocumentNumber],
      ["Permis de conduire n°", c.licenseNumber],
      ["Permis valable jusqu'au", c.licenseExpiresOn ? dateOnly(c.licenseExpiresOn) : null],
      ["Conducteur", data.driverName],
    ]);

    section(doc, "Le véhicule");
    rows(doc, [
      ["Véhicule", [v.brand, v.model].filter(Boolean).join(" ") || v.name],
      ["Immatriculation", v.plate],
      ["Année", v.year != null ? String(v.year) : null],
      ["Couleur", v.color],
      ["N° de série", v.vin],
    ]);

    section(doc, "La location");
    rows(doc, [
      ["Départ prévu", dateTime(data.startAt)],
      ["Retour prévu", dateTime(data.endAt)],
      ["Remise du véhicule", dateTime(data.pickedUpAt)],
      ["Compteur au départ", km(data.odometerOutKm)],
      ["Carburant au départ", fuel(data.fuelOut)],
      ["Prix de la location", money(data.price, data.tenant.currency)],
      ["Caution", money(data.deposit, data.tenant.currency)],
    ]);

    section(doc, "Conditions générales");
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor(INK)
      .text(data.terms?.trim() || "Aucune condition particulière n'a été ajoutée par le loueur.", MARGIN, doc.y, {
        width: doc.page.width - 2 * MARGIN,
        align: "justify",
      });

    // Signatures : toujours ensemble, sur la même page (≈ 112 points de haut).
    if (doc.y + 112 > doc.page.height - MARGIN) doc.addPage();
    doc.moveDown(1.2);
    doc.font("Helvetica").fontSize(10).fillColor(INK).text(`Fait en deux exemplaires, le ${day(data.pickedUpAt)}.`, MARGIN);
    doc.moveDown(0.8);
    const y = doc.y;
    const boxWidth = (doc.page.width - 2 * MARGIN - 24) / 2;
    for (const [i, label] of ["Le loueur", "Le locataire (« lu et approuvé »)"].entries()) {
      const x = MARGIN + i * (boxWidth + 24);
      doc.font("Helvetica-Bold").fontSize(10).fillColor(INK).text(label, x, y, { width: boxWidth });
      doc.rect(x, y + 16, boxWidth, 64).lineWidth(0.5).strokeColor(LINE).stroke();
    }
    doc.y = y + 88;
  }, `Contrat de location ${data.reference}`);
}

export async function generateReturnReportPdf(data: ReturnReportData): Promise<Buffer> {
  const logo = await loadLogo(data.tenant.logoUrl);
  const dateTime = (d: Date) => plain(formatter(data.tenant.timezone, true).format(d));
  const driven = data.odometerOutKm != null && data.odometerInKm != null ? data.odometerInKm - data.odometerOutKm : null;
  const lateMs = data.returnedAt.getTime() - data.endAt.getTime();

  return render((doc) => {
    header(doc, data.tenant, logo, "État de retour du véhicule", `Location n° ${data.reference} · retour le ${dateTime(data.returnedAt)}`);

    section(doc, "Location");
    rows(doc, [
      ["Locataire", data.customerName],
      ["Véhicule", data.vehicle.plate ? `${data.vehicle.name} (${data.vehicle.plate})` : data.vehicle.name],
      ["Départ prévu", dateTime(data.startAt)],
      ["Retour prévu", dateTime(data.endAt)],
      ["Remise du véhicule", data.pickedUpAt ? dateTime(data.pickedUpAt) : null],
      ["Retour du véhicule", dateTime(data.returnedAt)],
      ["Retard", lateMs > 15 * 60_000 ? `${Math.floor(lateMs / 3_600_000)} h ${String(Math.floor((lateMs % 3_600_000) / 60_000)).padStart(2, "0")}` : "Aucun"],
    ]);

    section(doc, "Compteur et carburant");
    rows(doc, [
      ["Compteur au départ", km(data.odometerOutKm)],
      ["Compteur au retour", km(data.odometerInKm)],
      ["Distance au compteur", km(driven)],
      ["Distance mesurée par GPS", data.gpsDistanceKm != null ? km(Math.round(data.gpsDistanceKm)) : "Non disponible"],
      ["Carburant au départ", fuel(data.fuelOut)],
      ["Carburant au retour", fuel(data.fuelIn)],
    ]);

    if (data.photos.length > 0) {
      section(doc, `Photos au retour (${data.photos.length})`);
      const perRow = 3;
      const gap = 10;
      const size = (doc.page.width - 2 * MARGIN - gap * (perRow - 1)) / perRow;
      let x = MARGIN;
      let y = doc.y;
      for (const [i, photo] of data.photos.entries()) {
        if (i > 0 && i % perRow === 0) {
          x = MARGIN;
          y += size * 0.75 + 26;
        }
        if (y + size * 0.75 + 20 > doc.page.height - MARGIN) {
          doc.addPage();
          y = MARGIN;
        }
        try {
          doc.image(photo.bytes, x, y, { fit: [size, size * 0.75], align: "center", valign: "center" });
        } catch {
          doc.rect(x, y, size, size * 0.75).strokeColor(LINE).stroke();
        }
        if (photo.caption) doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(photo.caption, x, y + size * 0.75 + 3, { width: size, height: 18, ellipsis: true });
        x += size + gap;
      }
      doc.y = y + size * 0.75 + 26;
    }
  }, `État de retour ${data.reference}`);
}
