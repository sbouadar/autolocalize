import { useState } from "react";
import { StyleSheet, Text } from "react-native";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Banner } from "@/components/States";
import { openPrivatePdf } from "@/lib/private-pdf";
import { rentalFilePaths, type Rental } from "@/lib/rentals";
import { colors, fonts } from "@/lib/theme";

/**
 * Contrat (figé au départ) et rapport de retour en PDF. Web : ouverts dans un nouvel onglet.
 * Mobile : téléchargés avec le jeton de session puis ouverts dans le menu de partage du téléphone.
 */
export function RentalDocuments({ rental }: { rental: Rental }) {
  const [opening, setOpening] = useState<"contract" | "report" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hasContract = rental.pickedUpAt != null;
  const hasReport = rental.status === "COMPLETED";
  if (!hasContract && !hasReport) return null;
  const reference = rental.id.slice(-8).toUpperCase();

  const open = async (kind: "contract" | "report") => {
    setError(null);
    setOpening(kind);
    try {
      if (kind === "contract") await openPrivatePdf(rentalFilePaths.contract(rental.id), `contrat-${reference}.pdf`);
      else await openPrivatePdf(rentalFilePaths.returnReport(rental.id), `etat-de-retour-${reference}.pdf`);
    } catch {
      setError("Le document n’a pas pu être ouvert. Vérifiez la connexion et réessayez.");
    } finally {
      setOpening(null);
    }
  };

  return (
    <Card title="Documents">
      {hasContract ? (
        <Button label="Contrat de location (PDF)" variant="secondary" onPress={() => void open("contract")} loading={opening === "contract"} />
      ) : null}
      {hasReport ? (
        <Button label="État de retour (PDF)" variant="secondary" onPress={() => void open("report")} loading={opening === "report"} />
      ) : null}
      {error ? <Banner message={error} tone="danger" /> : null}
      {hasContract ? <Text style={styles.muted}>Le contrat a été figé au départ : imprimez-le en deux exemplaires pour signature.</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  muted: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
});
