import { useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/features/auth/AuthProvider";
import { toFriendlyAuthError } from "@/features/auth/authErrors";
import { theme } from "@/shared/theme";

export function SignInScreen() {
  const { status, isConfigured, errorMessage, signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSignIn() {
    const normalizedEmail = email.trim();
    if (!normalizedEmail || !password || submitting || !isConfigured) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await signIn(normalizedEmail, password);
    } catch (error) {
      setFormError(toFriendlyAuthError(error));
    } finally {
      setSubmitting(false);
    }
  }

  const visibleError = formError ?? (status === "error" ? errorMessage : null);
  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.brandMark}><Text style={styles.brandMarkText}>NM</Text></View>
          <Text style={styles.eyebrow}>NICHOLAS MAGI · REAL ESTATE</Text>
          <Text style={styles.title}>Bentornato.</Text>
          <Text style={styles.subtitle}>
            Acceda alla Sua area operativa con le credenziali già utilizzate per il gestionale NMRE.
          </Text>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Accedi a NMRE Mobile</Text>
            {!isConfigured ? (
              <View style={styles.notice}>
                <Text style={styles.noticeTitle}>Configurazione necessaria</Text>
                <Text style={styles.noticeBody}>
                  Il collegamento Supabase non è ancora configurato. Nel file locale mobile/.env inserisca l&apos;URL del progetto e la chiave publishable. Non inserisca mai una service_role o una secret key.
                </Text>
              </View>
            ) : null}
            {visibleError ? <View style={styles.errorBox}><Text style={styles.errorText}>{visibleError}</Text></View> : null}

            <Text style={styles.label}>EMAIL</Text>
            <TextInput
              value={email} onChangeText={setEmail} style={styles.input}
              placeholder="nome@azienda.it" placeholderTextColor="#929BA8"
              keyboardType="email-address" textContentType="emailAddress" autoComplete="email"
              autoCapitalize="none" autoCorrect={false} editable={isConfigured && !submitting}
              accessibilityLabel="Indirizzo email" returnKeyType="next"
            />
            <Text style={[styles.label, styles.passwordLabel]}>PASSWORD</Text>
            <TextInput
              value={password} onChangeText={setPassword} style={styles.input}
              placeholder="La Sua password" placeholderTextColor="#929BA8"
              secureTextEntry textContentType="password" autoComplete="current-password"
              editable={isConfigured && !submitting} accessibilityLabel="Password"
              returnKeyType="go" onSubmitEditing={() => void handleSignIn()}
            />
            <Pressable
              accessibilityRole="button" accessibilityLabel="Accedi a NMRE Mobile"
              disabled={!isConfigured || submitting || !email.trim() || !password}
              onPress={() => void handleSignIn()}
              style={({ pressed }) => [
                styles.submit,
                (!isConfigured || submitting || !email.trim() || !password) && styles.submitDisabled,
                pressed && styles.submitPressed
              ]}
            >
              {submitting ? <ActivityIndicator color={theme.colors.white} /> : <Text style={styles.submitText}>Accedi in sicurezza</Text>}
            </Pressable>
            <Text style={styles.helper}>
              L&apos;app non crea nuovi account e non modifica i dati del gestionale durante l&apos;accesso.
            </Text>
          </View>
          <Text style={styles.footer}>NMRE MOBILE · ACCESSO RISERVATO</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: theme.colors.paper },
  content: { flexGrow: 1, justifyContent: "center", padding: 24, paddingBottom: 34 },
  brandMark: { width: 56, height: 56, borderRadius: 18, backgroundColor: theme.colors.navy, alignItems: "center", justifyContent: "center", marginBottom: 22 },
  brandMarkText: { color: theme.colors.gold, fontSize: 19, fontWeight: "900", letterSpacing: 1 },
  eyebrow: { color: "#987A4E", fontSize: 9, fontWeight: "900", letterSpacing: 1.7 },
  title: { color: theme.colors.ink, fontSize: 34, fontWeight: "900", letterSpacing: -1, marginTop: 10 },
  subtitle: { color: theme.colors.muted, fontSize: 13, lineHeight: 20, marginTop: 8, maxWidth: 330 },
  card: { backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 19, padding: 19, marginTop: 28 },
  cardTitle: { color: theme.colors.ink, fontSize: 17, fontWeight: "800", marginBottom: 20 },
  label: { color: theme.colors.muted, fontSize: 9, fontWeight: "900", letterSpacing: 1.2, marginBottom: 7 },
  passwordLabel: { marginTop: 17 },
  input: { height: 49, borderRadius: 11, borderWidth: 1, borderColor: theme.colors.line, backgroundColor: "#FBFCFD", paddingHorizontal: 13, color: theme.colors.ink, fontSize: 14 },
  submit: { height: 50, borderRadius: 12, backgroundColor: theme.colors.navy, alignItems: "center", justifyContent: "center", marginTop: 22 },
  submitDisabled: { opacity: 0.4 },
  submitPressed: { opacity: 0.8 },
  submitText: { color: theme.colors.white, fontSize: 13, fontWeight: "800" },
  helper: { color: theme.colors.muted, fontSize: 10, lineHeight: 16, textAlign: "center", marginTop: 14 },
  notice: { padding: 12, borderRadius: 11, backgroundColor: "#F4EFE5", marginBottom: 17 },
  noticeTitle: { color: theme.colors.ink, fontSize: 11, fontWeight: "800" },
  noticeBody: { color: "#667184", fontSize: 10, lineHeight: 15, marginTop: 5 },
  errorBox: { padding: 11, borderRadius: 10, backgroundColor: "#FCEDEC", marginBottom: 15 },
  errorText: { color: "#A13F3A", fontSize: 11, lineHeight: 16 },
  footer: { textAlign: "center", color: "#A0A8B4", fontSize: 8, letterSpacing: 1.1, marginTop: 28 }
});
