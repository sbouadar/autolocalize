import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Card } from "@/components/Card";
import { PhotoPicker } from "@/components/PhotoPicker";
import { PrivateImage } from "@/components/PrivateImage";
import { Banner } from "@/components/States";
import { ApiError, formMessage } from "@/lib/api";
import { confirmAction } from "@/lib/confirm";
import { rentalFilePaths, useRentalPhotoActions, useRentalPhotos, type RentalPhase } from "@/lib/rentals";
import { colors, fonts, radius, spacing } from "@/lib/theme";

const PHASE_TITLES: Record<RentalPhase, string> = { PICKUP: "Photos au départ", RETURN: "Photos au retour" };

interface RentalPhotosProps {
  rentalId: string;
  phase: RentalPhase;
  /** Ajout de photos (admin et agents, tant que l'étape est ouverte). */
  canAdd: boolean;
  /** Suppression (admin seulement). */
  canDelete: boolean;
}

/** Photos d'état des lieux d'une étape de la location. Fichiers privés, servis après contrôle de session. */
export function RentalPhotos({ rentalId, phase, canAdd, canDelete }: RentalPhotosProps) {
  const { data } = useRentalPhotos(rentalId);
  const actions = useRentalPhotoActions(rentalId);
  const [message, setMessage] = useState<string | null>(null);
  const photos = (data?.photos ?? []).filter((p) => p.phase === phase);
  const full = data ? photos.length >= data.limitPerPhase : false;
  if (!canAdd && photos.length === 0) return null;

  const add = async (dataUrl: string) => {
    setMessage(null);
    try {
      await actions.upload.mutateAsync({ phase, data: dataUrl });
    } catch (err) {
      // Réseau coupé (parking, sous-sol) : la photo n'est pas perdue de vue, on invite à réessayer.
      setMessage(err instanceof ApiError && err.status === 0 ? "Envoi impossible : pas de connexion. Réessayez quand le réseau revient." : formMessage(err));
    }
  };
  const remove = async (photoId: string) => {
    if (!(await confirmAction("Supprimer cette photo ?", "Elle sera effacée définitivement.", "Supprimer"))) return;
    setMessage(null);
    try {
      await actions.remove(photoId);
    } catch (err) {
      setMessage(formMessage(err));
    }
  };

  return (
    <Card title={`${PHASE_TITLES[phase]} (${photos.length})`}>
      {photos.length > 0 ? (
        <View style={styles.grid}>
          {photos.map((p, index) => (
            <View key={p.id} style={styles.item}>
              <PrivateImage path={rentalFilePaths.photo(rentalId, p.id)} style={styles.image} accessibilityLabel={p.caption ?? `Photo ${index + 1}`} />
              {canDelete ? (
                <Pressable accessibilityRole="button" accessibilityLabel={`Supprimer la photo ${index + 1}`} onPress={() => void remove(p.id)} hitSlop={8}>
                  <Text style={styles.delete}>Supprimer</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.muted}>Aucune photo : photographiez l’extérieur, l’intérieur et tout dégât existant.</Text>
      )}
      {message ? <Banner message={message} tone="danger" /> : null}
      {canAdd ? (
        full ? (
          <Text style={styles.muted}>Nombre maximal de photos atteint pour cette étape.</Text>
        ) : (
          <PhotoPicker onPick={add} disabled={actions.upload.isPending} />
        )
      ) : null}
      {actions.upload.isPending ? <Text style={styles.muted}>Envoi de la photo…</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  item: { width: 104, gap: spacing.xs, alignItems: "center" },
  image: { width: 104, height: 78, borderRadius: radius.sm, backgroundColor: colors.border },
  delete: { fontFamily: fonts.bold, fontSize: 12, color: colors.danger },
  muted: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
});
