import { Redirect, useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Banner, EmptyState, ErrorState, LoadingState } from "@/components/States";
import { ApiError, formMessage, userMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useBranding } from "@/lib/branding-context";
import { confirmAction } from "@/lib/confirm";
import { formatDateOnly } from "@/lib/dates";
import { ID_DOCUMENT_LABELS, useCustomer, useCustomerActions, useRentals } from "@/lib/rentals";
import { colors, fonts, spacing } from "@/lib/theme";
import { useDocumentTitle } from "@/lib/use-document-title";
import { CustomerForm } from "./CustomerForm";
import { RentalRow } from "./RentalRow";

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value} selectable>
        {value}
      </Text>
    </View>
  );
}

/** Fiche d'un locataire : coordonnées, pièces (masquées, affichage complet sur demande), locations. */
export function CustomerDetailScreen({ id }: { id: string }) {
  const { me } = useAuth();
  const branding = useBranding();
  const router = useRouter();
  const { data, isPending, error, refetch } = useCustomer(id);
  const rentals = useRentals({ customerId: id }).data?.rentals ?? [];
  const actions = useCustomerActions();
  const [editing, setEditing] = useState(false);
  // Numéros complets : gardés dans l'état de l'écran seulement, effacés en le quittant.
  const [identity, setIdentity] = useState<{ idDocumentNumber: string | null; licenseNumber: string | null } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useDocumentTitle(`${data?.customer.name ?? "Locataire"} — ${branding.name}`);

  const role = me?.user.role;
  if (me && (!me.tenant?.rentalsEnabled || (role !== "TENANT_ADMIN" && role !== "AGENT"))) return <Redirect href="/" />;
  if (isPending) return <LoadingState />;
  if (!data) {
    if (error instanceof ApiError && error.status === 404) return <EmptyState title="Locataire introuvable" />;
    return <ErrorState message={userMessage(error)} onRetry={() => void refetch()} />;
  }
  const c = data.customer;

  const run = async (action: () => Promise<unknown>) => {
    setMessage(null);
    try {
      await action();
    } catch (err) {
      setMessage(formMessage(err));
    }
  };
  const reveal = () => run(async () => setIdentity(await actions.revealIdentity(c.id)));
  const anonymize = async () => {
    const ok = await confirmAction(
      "Anonymiser ce locataire ?",
      "Son nom, ses coordonnées et ses numéros de pièce seront effacés définitivement. Ses locations resteront, sans son identité.",
      "Anonymiser",
    );
    if (ok) await run(() => actions.anonymize(c.id));
  };

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <ScreenHeader title={c.name} subtitle={c.kind === "COMPANY" ? "Société" : "Particulier"} fallback="/customers" />
      {message ? <Banner message={message} tone="danger" /> : null}
      {c.anonymized ? <Banner message="Ce locataire a été anonymisé : ses données personnelles ont été effacées." /> : null}

      {editing ? (
        <Card title="Modifier le locataire">
          <CustomerForm customer={c} onSaved={() => setEditing(false)} onCancel={() => setEditing(false)} />
        </Card>
      ) : (
        <>
          <Card title="Coordonnées" right={c.anonymized ? null : <Button label="Modifier" variant="secondary" onPress={() => setEditing(true)} />}>
            <Row label="Téléphone" value={c.phone} />
            <Row label="E-mail" value={c.email} />
            <Row label="Adresse" value={c.address} />
            <Row label="Date de naissance" value={c.birthDate ? formatDateOnly(c.birthDate) : null} />
            <Row label="Notes" value={c.notes} />
            {!c.phone && !c.email && !c.address && !c.birthDate && !c.notes ? <Text style={styles.muted}>Aucune coordonnée renseignée.</Text> : null}
          </Card>

          {c.anonymized ? null : (
            <Card title="Pièce d’identité et permis">
              <Row
                label={c.idDocumentType ? ID_DOCUMENT_LABELS[c.idDocumentType] : "Pièce d’identité"}
                value={identity ? (identity.idDocumentNumber ?? "Non renseignée") : (c.idDocumentMasked ?? "Non renseignée")}
              />
              <Row
                label="Permis de conduire"
                value={identity ? (identity.licenseNumber ?? "Non renseigné") : (c.licenseMasked ?? "Non renseigné")}
              />
              <Row label="Expiration du permis" value={c.licenseExpiresOn ? formatDateOnly(c.licenseExpiresOn) : null} />
              {c.idDocumentMasked || c.licenseMasked ? (
                identity ? (
                  <Button label="Masquer les numéros" variant="secondary" onPress={() => setIdentity(null)} />
                ) : (
                  <>
                    <Button label="Afficher les numéros complets" variant="secondary" onPress={() => void reveal()} />
                    <Text style={styles.muted}>Chaque consultation est enregistrée dans le journal.</Text>
                  </>
                )
              ) : null}
            </Card>
          )}
        </>
      )}

      <Card title={`Locations (${rentals.length})`}>
        {rentals.length === 0 ? (
          <Text style={styles.muted}>Aucune location sur les 30 derniers jours ni à venir.</Text>
        ) : (
          rentals.map((r) => <RentalRow key={r.id} rental={r} onPress={() => router.push({ pathname: "/rentals/[id]", params: { id: r.id } })} />)
        )}
      </Card>

      {role === "TENANT_ADMIN" && !c.anonymized && !editing ? (
        <Button label="Anonymiser ce locataire" variant="danger" onPress={() => void anonymize()} />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.lg, gap: spacing.md, width: "100%", maxWidth: 640, alignSelf: "center" },
  row: { gap: 2 },
  label: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
  value: { fontFamily: fonts.bold, fontSize: 15, color: colors.text },
  muted: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
});
