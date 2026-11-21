import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Redirect, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Banner, ErrorState, LoadingState } from "@/components/States";
import { TextField } from "@/components/TextField";
import { CredentialsCard } from "@/features/admin/CredentialsCard";
import type { Credentials } from "@/lib/admin";
import { formMessage, userMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useBranding } from "@/lib/branding-context";
import { confirmAction } from "@/lib/confirm";
import { colors, fonts, radius, spacing } from "@/lib/theme";
import {
  TENANT_ROLE_HINTS,
  TENANT_ROLE_LABELS,
  tenantRoleSchema,
  useTenantUserActions,
  useTenantUsers,
  type TenantRole,
  type TenantUser,
} from "@/lib/tenant-users";
import { useDocumentTitle } from "@/lib/use-document-title";

const ROLES = tenantRoleSchema.options;

function RolePicker({ value, onChange, label }: { value: TenantRole; onChange: (role: TenantRole) => void; label: string }) {
  const branding = useBranding();
  return (
    <View style={styles.roles} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {ROLES.map((role) => {
        const active = role === value;
        return (
          <Pressable
            key={role}
            accessibilityRole="radio"
            accessibilityState={{ checked: active }}
            onPress={() => onChange(role)}
            style={({ pressed }) => [styles.role, active && { backgroundColor: branding.primaryColor }, pressed && { opacity: 0.8 }]}
          >
            <Text style={[styles.roleText, active && { color: branding.onPrimary }]}>{TENANT_ROLE_LABELS[role]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function NewUserForm({ onCreated, onCancel }: { onCreated: (c: Credentials) => void; onCancel: () => void }) {
  const { create } = useTenantUserActions();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TenantRole>("AGENT");
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!name.trim() || !/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError("Indiquez un nom et une adresse e-mail valide.");
      return;
    }
    try {
      const result = await create.mutateAsync({ name: name.trim(), email: email.trim(), role });
      onCreated({ email: result.user.email, temporaryPassword: result.temporaryPassword });
    } catch (err) {
      setError(formMessage(err));
    }
  };

  return (
    <Card title="Nouveau compte">
      <TextField label="Nom" value={name} onChangeText={setName} maxLength={191} />
      <TextField
        label="E-mail"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={191}
      />
      <Text style={styles.fieldLabel}>Rôle</Text>
      <RolePicker value={role} onChange={setRole} label="Rôle du nouveau compte" />
      <Text style={styles.muted}>{TENANT_ROLE_HINTS[role]}</Text>
      {error ? <Banner message={error} tone="danger" /> : null}
      <View style={styles.pair}>
        <View style={styles.flex}>
          <Button label="Créer le compte" onPress={() => void submit()} loading={create.isPending} />
        </View>
        <View style={styles.flex}>
          <Button label="Annuler" variant="secondary" onPress={onCancel} disabled={create.isPending} />
        </View>
      </View>
    </Card>
  );
}

function UserRow({
  user,
  isSelf,
  onError,
  onCredentials,
}: {
  user: TenantUser;
  isSelf: boolean;
  onError: (message: string | null) => void;
  onCredentials: (c: Credentials) => void;
}) {
  const actions = useTenantUserActions();
  const [open, setOpen] = useState(false);
  const disabled = user.disabledAt != null;

  const run = async (action: () => Promise<unknown>) => {
    onError(null);
    try {
      await action();
    } catch (err) {
      onError(formMessage(err));
    }
  };

  const changeRole = (role: TenantRole) => {
    if (role !== user.role) void run(() => actions.setRole(user.id, role));
  };
  const reset = async () => {
    const ok = await confirmAction(
      "Réinitialiser le mot de passe ?",
      `${user.name} sera déconnecté de tous ses appareils et devra utiliser un nouveau mot de passe provisoire.`,
      "Réinitialiser",
    );
    if (ok) await run(async () => onCredentials(await actions.resetPassword(user.id)));
  };
  const toggle = async () => {
    if (disabled) return run(() => actions.enable(user.id));
    const ok = await confirmAction(
      "Désactiver ce compte ?",
      `${user.name} sera déconnecté immédiatement et ne pourra plus se connecter. Vous pourrez le réactiver.`,
      "Désactiver",
    );
    if (ok) await run(() => actions.disable(user.id));
  };

  return (
    <View style={styles.user}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${user.name}, ${TENANT_ROLE_LABELS[user.role]}${disabled ? ", désactivé" : ""}`}
        onPress={() => setOpen((v) => !v)}
        style={({ pressed }) => [styles.userHead, pressed && { opacity: 0.7 }]}
      >
        <View style={styles.flex}>
          <Text style={[styles.userName, disabled && styles.disabledText]} numberOfLines={1}>
            {user.name}
            {isSelf ? " (vous)" : ""}
          </Text>
          <Text style={styles.muted} numberOfLines={1}>
            {user.email}
          </Text>
          <Text style={styles.muted}>
            {TENANT_ROLE_LABELS[user.role]}
            {disabled ? " · désactivé" : user.mustChangePassword ? " · mot de passe provisoire" : ""}
          </Text>
        </View>
        {isSelf ? null : <MaterialCommunityIcons name={open ? "chevron-up" : "chevron-down"} size={22} color={colors.muted} />}
      </Pressable>
      {open && !isSelf ? (
        <View style={styles.userActions}>
          <RolePicker value={user.role} onChange={changeRole} label={`Rôle de ${user.name}`} />
          <View style={styles.pair}>
            <View style={styles.flex}>
              <Button label="Nouveau mot de passe" variant="secondary" onPress={() => void reset()} />
            </View>
            <View style={styles.flex}>
              <Button label={disabled ? "Réactiver" : "Désactiver"} variant={disabled ? "secondary" : "danger"} onPress={() => void toggle()} />
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

/** Comptes du client (admin du client) : création, rôle, mot de passe provisoire, désactivation. */
export function UsersScreen() {
  const { me } = useAuth();
  const branding = useBranding();
  const router = useRouter();
  useDocumentTitle(`Utilisateurs — ${branding.name}`);
  const { data, isPending, error, refetch } = useTenantUsers();
  const [creating, setCreating] = useState(false);
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (me && me.user.role !== "TENANT_ADMIN") return <Redirect href="/profile" />;
  if (isPending) return <LoadingState />;
  if (!data) return <ErrorState message={userMessage(error)} onRetry={() => void refetch()} />;
  const full = data.users.length >= data.limit;

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Pressable
        accessibilityRole="link"
        onPress={() => (router.canGoBack() ? router.back() : router.replace("/profile"))}
        hitSlop={8}
        style={styles.back}
      >
        <MaterialCommunityIcons name="arrow-left" size={22} color={colors.text} />
        <Text style={styles.backText}>Profil</Text>
      </Pressable>

      <Text style={styles.title} accessibilityRole="header">
        Utilisateurs
      </Text>
      <Text style={styles.muted}>
        {data.users.length} compte{data.users.length > 1 ? "s" : ""} sur {data.limit} possibles.
      </Text>

      {credentials ? (
        <CredentialsCard credentials={credentials} slug={me?.tenant?.slug ?? ""} recipient="à votre collaborateur" />
      ) : null}
      {message ? <Banner message={message} tone="danger" /> : null}

      {creating ? (
        <NewUserForm
          onCreated={(c) => {
            setCreating(false);
            setCredentials(c);
          }}
          onCancel={() => setCreating(false)}
        />
      ) : (
        <Button
          label={full ? `Limite de ${data.limit} comptes atteinte` : "Ajouter un compte"}
          disabled={full}
          onPress={() => {
            setCredentials(null);
            setCreating(true);
          }}
        />
      )}

      <View style={styles.list}>
        {data.users.map((u) => (
          <UserRow key={u.id} user={u} isSelf={u.id === data.currentUserId} onError={setMessage} onCredentials={setCredentials} />
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.lg, gap: spacing.md, width: "100%", maxWidth: 640, alignSelf: "center" },
  flex: { flex: 1 },
  back: { flexDirection: "row", alignItems: "center", gap: spacing.sm, alignSelf: "flex-start", minHeight: 44 },
  backText: { fontFamily: fonts.bold, fontSize: 15, color: colors.text },
  title: { fontFamily: fonts.heavy, fontSize: 24, letterSpacing: -0.4, color: colors.text },
  muted: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
  fieldLabel: { fontSize: 13, fontFamily: fonts.bold, color: colors.text },
  pair: { flexDirection: "row", gap: spacing.sm },
  roles: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  role: { minHeight: 40, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: radius.full, backgroundColor: colors.fill },
  roleText: { fontFamily: fonts.bold, fontSize: 14, color: colors.text },
  list: { gap: spacing.sm, marginTop: spacing.sm },
  user: { borderRadius: radius.md, backgroundColor: colors.fill, padding: spacing.md, gap: spacing.md },
  userHead: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 44 },
  userName: { fontFamily: fonts.bold, fontSize: 15, color: colors.text },
  disabledText: { color: colors.muted, textDecorationLine: "line-through" },
  userActions: { gap: spacing.md },
});
