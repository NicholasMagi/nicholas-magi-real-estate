import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { theme } from "@/shared/theme";

type FeaturePlaceholderProps = {
  eyebrow: string;
  title: string;
  description: string;
  icon: string;
  nextStep: string;
};

export function FeaturePlaceholder({
  eyebrow,
  title,
  description,
  icon,
  nextStep
}: FeaturePlaceholderProps) {
  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.brandRow}>
          <View>
            <Text style={styles.brand}>NICHOLAS MAGI</Text>
            <Text style={styles.brandSub}>REAL ESTATE · MOBILE</Text>
          </View>
          <View style={styles.previewPill}>
            <Text style={styles.previewText}>ANTEPRIMA</Text>
          </View>
        </View>
        <Text style={styles.eyebrow}>{eyebrow}</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.description}>{description}</Text>
        <View style={styles.emptyCard}>
          <View style={styles.iconCircle}><Text style={styles.icon}>{icon}</Text></View>
          <Text style={styles.cardTitle}>Area pronta per i dati reali</Text>
          <Text style={styles.cardBody}>
            Il collegamento sicuro al gestionale esistente verrà attivato nella prossima fase.
            In questa anteprima non mostriamo dati dimostrativi.
          </Text>
          <View style={styles.rule} />
          <Text style={styles.nextLabel}>PROSSIMO PASSAGGIO</Text>
          <Text style={styles.nextStep}>{nextStep}</Text>
        </View>
        <Text style={styles.footer}>NMRE MOBILE · UN UNICO ARCHIVIO, DUE ESPERIENZE</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.paper },
  content: { padding: theme.spacing.screen, paddingBottom: 36 },
  brandRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 42 },
  brand: { color: theme.colors.navy, fontSize: 13, fontWeight: "900", letterSpacing: 2.2 },
  brandSub: { color: theme.colors.muted, fontSize: 9, letterSpacing: 1.6, marginTop: 4 },
  previewPill: { borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.colors.gold, paddingHorizontal: 11, paddingVertical: 7 },
  previewText: { color: "#8D7043", fontSize: 9, fontWeight: "800", letterSpacing: 1.1 },
  eyebrow: { color: "#9A7C4D", fontSize: 10, fontWeight: "800", letterSpacing: 2, marginBottom: 10 },
  title: { color: theme.colors.ink, fontSize: 31, fontWeight: "800", letterSpacing: -0.8 },
  description: { color: theme.colors.muted, fontSize: 14, lineHeight: 22, marginTop: 9, marginBottom: 26 },
  emptyCard: { backgroundColor: theme.colors.white, borderRadius: theme.radius.card, borderWidth: 1, borderColor: theme.colors.line, padding: 21 },
  iconCircle: { width: 54, height: 54, borderRadius: 27, backgroundColor: theme.colors.softGold, alignItems: "center", justifyContent: "center", marginBottom: 18 },
  icon: { fontSize: 25, color: theme.colors.navy },
  cardTitle: { color: theme.colors.ink, fontWeight: "800", fontSize: 17 },
  cardBody: { color: theme.colors.muted, fontSize: 13, lineHeight: 20, marginTop: 9 },
  rule: { height: 1, backgroundColor: theme.colors.line, marginVertical: 19 },
  nextLabel: { color: "#9A7C4D", fontSize: 9, fontWeight: "800", letterSpacing: 1.5 },
  nextStep: { color: theme.colors.ink, fontSize: 13, lineHeight: 19, marginTop: 7, fontWeight: "600" },
  footer: { color: "#A3AAB5", fontSize: 9, letterSpacing: 1, textAlign: "center", marginTop: 30 }
});
