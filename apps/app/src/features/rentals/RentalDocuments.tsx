import { Linking, Platform, StyleSheet, Text } from "react-native";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { apiUrl } from "@/lib/api";
import { rentalFilePaths, type Rental } from "@/lib/rentals";
import { colors, fonts } from "@/lib/theme";

/**
 * Contrat (figé au départ) et rapport de retour en PDF. Web : ouverts dans un nouvel onglet, la
 * session de même origine suffit. Mobile : le téléchargement authentifié d'un PDF n'est pas encore
 * géré ; on renvoie vers la version web.
 */
export function RentalDocuments({ rental }: { rental: Rental }) {
  const hasContract = rental.pickedUpAt != null;
  const hasReport = rental.status === "COMPLETED";
  if (!hasContract && !hasReport) return null;
  const open = (path: string) => void Linking.openURL(apiUrl(path));

  return (
    <Card title="Documents">
      {Platform.OS === "web" ? (
        <>
          {hasContract ? <Button label="Contrat de location (PDF)" variant="secondary" onPress={() => open(rentalFilePaths.contract(rental.id))} /> : null}
          {hasReport ? <Button label="État de retour (PDF)" variant="secondary" onPress={() => open(rentalFilePaths.returnReport(rental.id))} /> : null}
          {hasContract ? <Text style={styles.muted}>Le contrat a été figé au départ : imprimez-le en deux exemplaires pour signature.</Text> : null}
        </>
      ) : (
        <Text style={styles.muted}>Le contrat et l’état de retour se consultent et s’impriment depuis la version web (autolocalize.net).</Text>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  muted: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
});
