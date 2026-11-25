import { useRouter } from "expo-router";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { theme } from "@/shared/theme";
import { useAuth } from "@/features/auth/AuthProvider";

const metrics = [
  { label: "OPPORTUNITÀ", hint: "In attesa del collegamento" },
  { label: "DA CONTATTARE", hint: "Dati non ancora caricati" },
  { label: "RICHIAMI", hint: "Agenda non collegata" },
  { label: "INCARICHI", hint: "CRM non collegato" }
];

export function DashboardScreen() {
  const router = useRouter();
  const { signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
    } catch {
      Alert.alert("Disconnessione non riuscita", "Controlli la connessione e riprovi.");
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>NICHOLAS MAGI</Text>
            <Text style={styles.brandSub}>REAL ESTATE · MOBILE</Text>
          </View>
          <View style={styles.headerActions}>
            <Pressable accessibilityRole="button" accessibilityLabel="Esci dall'app"
              disabled={signingOut} onPress={() => void handleSignOut()} style={styles.signOutButton}>
              <Text style={styles.signOutText}>{signingOut ? "…" : "Esci"}</Text>
            </Pressable>
            <View style={styles.avatar}><Text style={styles.avatarText}>NM</Text></View>
          </View>
        </View>

        <View style={styles.greeting}>
          <Text style={styles.kicker}>LA SUA AREA OPERATIVA</Text>
          <Text style={styles.title}>Buongiorno.</Text>
          <Text style={styles.subtitle}>La Sua attività immobiliare, in un unico spazio.</Text>
        </View>

        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <Text style={styles.heroLabel}>NMRE MOBILE</Text>
            <View style={styles.statusPill}><View style={styles.statusDot} /><Text style={styles.statusText}>ANTEPRIMA</Text></View>
          </View>
          <Text style={styles.heroTitle}>Un nuovo modo di lavorare.</Text>
          <Text style={styles.heroBody}>
            Stiamo preparando il collegamento sicuro al Suo gestionale. L'archivio attuale resta invariato.
          </Text>
          <View style={styles.heroBottom}>
            <Text style={styles.heroFoot}>FASE 02 · STRUTTURA MOBILE</Text>
            <Text style={styles.heroMark}>NMRE</Text>
          </View>
        </View>

        <View style={styles.sectionHeading}>
          <Text style={styles.sectionTitle}>La Sua attività</Text>
          <Text style={styles.sectionHint}>Dati non collegati</Text>
        </View>
        <View style={styles.metrics}>
          {metrics.map(item => (
            <View key={item.label} style={styles.metric}>
              <Text style={styles.metricLabel}>{item.label}</Text>
              <Text style={styles.metricValue}>—</Text>
              <Text style={styles.metricHint}>{item.hint}</Text>
            </View>
          ))}
        </View>

        <View style={styles.sectionHeading}>
          <Text style={styles.sectionTitle}>Accessi rapidi</Text>
          <Text style={styles.sectionHint}>Navigazione in anteprima</Text>
        </View>
        <View style={styles.actions}>
          <QuickAction title="Archivio immobili" subtitle="Annunci e schede" symbol="▤" onPress={() => router.push("/listings")} />
          <QuickAction title="Nuove opportunità" subtitle="Coda da verificare" symbol="◎" onPress={() => router.push("/leads")} />
          <QuickAction title="CRM e agenda" subtitle="Contatti e appuntamenti" symbol="♙" onPress={() => router.push("/crm")} />
        </View>

        <View style={styles.notice}>
          <Text style={styles.noticeLabel}>PROSSIMA TAPPA</Text>
          <Text style={styles.noticeTitle}>Collegamento sicuro a Supabase</Text>
          <Text style={styles.noticeBody}>
            Dopo l'autenticazione vedrà gli annunci e i contatti già presenti, senza creare un secondo archivio.
          </Text>
        </View>
        <Text style={styles.footer}>NMRE MOBILE · VERSIONE 0.1.0 · DATI NON COLLEGATI</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function QuickAction({ title, subtitle, symbol, onPress }: {
  title: string; subtitle: string; symbol: string; onPress: () => void;
}) {
  return (
    <Pressable style={({ pressed }) => [styles.action, pressed && styles.actionPressed]} onPress={onPress}>
      <View style={styles.actionIcon}><Text style={styles.actionSymbol}>{symbol}</Text></View>
      <View style={styles.actionCopy}>
        <Text style={styles.actionTitle}>{title}</Text>
        <Text style={styles.actionSubtitle}>{subtitle}</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.paper },
  content: { padding: 20, paddingBottom: 34 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 9 },
  signOutButton: { minWidth: 42, minHeight: 38, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 },
  signOutText: { color: theme.colors.muted, fontSize: 10, fontWeight: "800" },
  brand: { color: theme.colors.navy, fontSize: 13, fontWeight: "900", letterSpacing: 2.2 },
  brandSub: { color: theme.colors.muted, fontSize: 9, letterSpacing: 1.6, marginTop: 4 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.navy, alignItems: "center", justifyContent: "center" },
  avatarText: { color: theme.colors.gold, fontWeight: "800", fontSize: 12 },
  greeting: { marginTop: 35, marginBottom: 21 },
  kicker: { color: "#9A7C4D", fontSize: 9, fontWeight: "800", letterSpacing: 1.8, marginBottom: 9 },
  title: { color: theme.colors.ink, fontSize: 32, fontWeight: "800", letterSpacing: -1 },
  subtitle: { color: theme.colors.muted, fontSize: 14, marginTop: 7 },
  hero: { borderRadius: 20, backgroundColor: theme.colors.navy, padding: 20, overflow: "hidden" },
  heroTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  heroLabel: { color: theme.colors.gold, fontSize: 9, letterSpacing: 2, fontWeight: "800" },
  statusPill: { flexDirection: "row", alignItems: "center", backgroundColor: "#27364B", paddingHorizontal: 9, paddingVertical: 6, borderRadius: 99 },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.colors.gold, marginRight: 6 },
  statusText: { color: "#E6D4B4", fontSize: 8, fontWeight: "700", letterSpacing: 1 },
  heroTitle: { color: theme.colors.white, fontSize: 22, fontWeight: "800", marginTop: 26 },
  heroBody: { color: "#C1C9D5", fontSize: 12, lineHeight: 19, marginTop: 8, maxWidth: 280 },
  heroBottom: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopWidth: 1, borderTopColor: "#344156", marginTop: 23, paddingTop: 13 },
  heroFoot: { color: "#AAB4C2", fontSize: 8, letterSpacing: 1.1, fontWeight: "700" },
  heroMark: { color: "#65748A", fontSize: 13, fontWeight: "900", letterSpacing: 2 },
  sectionHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginTop: 25, marginBottom: 12 },
  sectionTitle: { fontSize: 16, color: theme.colors.ink, fontWeight: "800" },
  sectionHint: { color: theme.colors.muted, fontSize: 9 },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  metric: { width: "48%", flexGrow: 1, minHeight: 112, padding: 13, backgroundColor: theme.colors.white, borderColor: theme.colors.line, borderWidth: 1, borderRadius: 15 },
  metricLabel: { color: theme.colors.muted, fontSize: 8, fontWeight: "800", letterSpacing: 1 },
  metricValue: { color: theme.colors.navy, fontSize: 26, fontWeight: "800", marginTop: 10 },
  metricHint: { color: "#9AA2AF", fontSize: 9, marginTop: 4 },
  actions: { gap: 8 },
  action: { backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 13, padding: 12, flexDirection: "row", alignItems: "center" },
  actionPressed: { opacity: 0.75 },
  actionIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: theme.colors.softGold, alignItems: "center", justifyContent: "center" },
  actionSymbol: { color: theme.colors.navy, fontSize: 18, fontWeight: "700" },
  actionCopy: { flex: 1, marginLeft: 11 },
  actionTitle: { color: theme.colors.ink, fontSize: 12, fontWeight: "800" },
  actionSubtitle: { color: theme.colors.muted, fontSize: 10, marginTop: 3 },
  chevron: { color: theme.colors.gold, fontSize: 24, paddingHorizontal: 6 },
  notice: { backgroundColor: "#F1EDE5", borderRadius: 15, padding: 16, marginTop: 23 },
  noticeLabel: { color: "#927447", fontSize: 8, fontWeight: "900", letterSpacing: 1.4 },
  noticeTitle: { color: theme.colors.ink, fontSize: 13, fontWeight: "800", marginTop: 8 },
  noticeBody: { color: "#657083", fontSize: 11, lineHeight: 17, marginTop: 5 },
  footer: { color: "#A3AAB5", fontSize: 8, letterSpacing: 0.7, textAlign: "center", marginTop: 24 }
});
