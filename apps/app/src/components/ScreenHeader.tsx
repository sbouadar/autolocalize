import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useRouter, type Href } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, fonts, radius, spacing } from "@/lib/theme";

interface ScreenHeaderProps {
  title: string;
  subtitle?: string | null;
  /** Écran de repli quand il n'y a pas d'historique (page ouverte par son adresse). */
  fallback: Href;
  right?: ReactNode;
}

/** En-tête d'un écran secondaire : retour, titre, action éventuelle. */
export function ScreenHeader({ title, subtitle, fallback, right }: ScreenHeaderProps) {
  const router = useRouter();
  return (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel="Retour"
        onPress={() => (router.canGoBack() ? router.back() : router.replace(fallback))}
        hitSlop={8}
        style={({ pressed }) => [styles.back, pressed && { opacity: 0.6 }]}
      >
        <MaterialCommunityIcons name="arrow-left" size={22} color={colors.text} />
      </Pressable>
      <View style={styles.flex}>
        <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  back: { width: 44, height: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.fill },
  title: { fontSize: 22, fontFamily: fonts.heavy, letterSpacing: -0.4, color: colors.text },
  subtitle: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
});
