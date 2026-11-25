import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/features/auth/AuthProvider";
import {
  candidateSellerPresentation,
  candidateStatusLabel,
  formatCandidateDate,
  formatCandidatePrice,
  safeHttpsUrl
} from "@/features/candidates/candidatePresentation";
import { useCandidates } from "@/features/candidates/useCandidates";
import {
  type CandidateStatusFilter,
  type CandidateSummary
} from "@/shared/data/candidateRepository";
import { theme } from "@/shared/theme";

const filters: { value: CandidateStatusFilter; label: string }[] = [
  { value: "da_verificare", label: "Da verificare" },
  { value: "confermato", label: "Confermati" },
  { value: "scartato", label: "Scartati" },
  { value: "tutti", label: "Tutte" }
];

export function CandidatesScreen() {
  const { user } = useAuth();
  const [filter, setFilter] = useState<CandidateStatusFilter>("da_verificare");
  const [municipalityInput, setMunicipalityInput] = useState("");
  const [municipality, setMunicipality] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const candidates = useCandidates(user?.id ?? "", filter, municipality);

  useEffect(() => {
    const timer = setTimeout(() => setMunicipality(municipalityInput.trim()), 350);
    return () => clearTimeout(timer);
  }, [municipalityInput]);

  function openListing(item: CandidateSummary) {
    const destination = safeHttpsUrl(item.listingUrl);
    if (!destination) {
      Alert.alert("Link non disponibile", "Per questo annuncio non è presente un collegamento HTTPS valido.");
      return;
    }
    void Linking.openURL(destination).catch(() => {
      Alert.alert("Impossibile aprire l'annuncio", "Verifichi la connessione e riprovi.");
    });
  }

  function renderCandidate({ item }: { item: CandidateSummary }) {
    const seller = candidateSellerPresentation({
      sellerType: item.sellerType,
      status: item.status,
      manualOverride: item.sellerManualOverride,
      confidence: item.sellerConfidence,
      evidence: item.sellerEvidence
    });
    const published = formatCandidateDate(item.publishedAt);
    const created = formatCandidateDate(item.createdAt);
    const expanded = expandedId === item.id;

    return (
      <View style={styles.card}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={"Dettagli opportunità: " + (item.title ?? "Annuncio senza titolo")}
          accessibilityState={{ expanded }}
          onPress={() => setExpandedId(expanded ? null : item.id)}
          style={styles.cardPressable}
        >
          <View style={styles.cardTop}>
            <View style={styles.badges}>
              <Badge label={candidateStatusLabel(item.status)} tone={item.status === "confermato" ? "success" : item.status === "scartato" ? "neutral" : "warning"} />
              <Badge label={seller.label} tone={seller.tone} />
            </View>
            <Text style={styles.expandIcon}>{expanded ? "−" : "+"}</Text>
          </View>
          <Text style={styles.cardTitle}>{item.title ?? "Annuncio senza titolo"}</Text>
          <Text style={styles.cardMunicipality}>{item.municipality ?? "Comune non indicato"}</Text>
          <Text style={styles.cardPrice}>{formatCandidatePrice(item.price)}</Text>
          <View style={styles.metaRow}>
            {item.propertyType ? <Text style={styles.metaText}>{item.propertyType}</Text> : null}
            {item.surfaceSqm !== null ? <Text style={styles.metaText}>{item.surfaceSqm} m²</Text> : null}
            {item.rooms !== null ? <Text style={styles.metaText}>{item.rooms} locali</Text> : null}
          </View>
          <View style={styles.cardFooter}>
            <Text style={styles.sourceText}>{item.portal ?? "Fonte non indicata"}</Text>
            <Text style={styles.dateText}>{published ? "Pubblicato " + published : created ? "Ricevuto " + created : ""}</Text>
          </View>
        </Pressable>

        {expanded ? (
          <View style={styles.details}>
            <View style={styles.detailDivider} />
            <Text style={styles.detailHeading}>QUALIFICAZIONE VENDITORE</Text>
            <Text style={styles.detailValue}>{seller.label}</Text>
            {item.sellerConfidence !== null ? (
              <Text style={styles.detailMeta}>Confidenza registrata: {item.sellerConfidence}%</Text>
            ) : (
              <Text style={styles.detailMeta}>Nessun livello di confidenza registrato</Text>
            )}
            {item.sellerManualOverride ? (
              <Text style={styles.manualNote}>Classificazione modificata manualmente</Text>
            ) : null}
            {item.sellerEvidence ? (
              <>
                <Text style={styles.detailHeading}>EVIDENZE REGISTRATE</Text>
                <Text style={styles.evidence}>{item.sellerEvidence}</Text>
              </>
            ) : (
              <Text style={styles.detailMeta}>Non sono presenti evidenze testuali.</Text>
            )}

            <Text style={styles.detailHeading}>DATI IMMOBILE</Text>
            <Text style={styles.detailValue}>
              {[item.propertyType, item.surfaceSqm !== null ? item.surfaceSqm + " m²" : null]
                .filter(Boolean)
                .join(" · ") || "Tipologia e superficie non disponibili"}
            </Text>
            <Text style={styles.detailMeta}>
              {[
                item.rooms !== null ? item.rooms + " locali" : null,
                item.bedrooms !== null ? item.bedrooms + " camere" : null,
                item.bathrooms !== null ? item.bathrooms + " bagni" : null
              ].filter(Boolean).join(" · ") || "Altri dettagli non disponibili"}
            </Text>
            {item.linkedListingId ? (
              <Text style={styles.linkedNote}>Questo candidato è già collegato a un immobile in archivio.</Text>
            ) : null}
            <Pressable accessibilityRole="button" onPress={() => openListing(item)} style={styles.openButton}>
              <Text style={styles.openButtonText}>Apri annuncio originale ↗</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <FlatList
        data={candidates.items}
        keyExtractor={item => item.id}
        renderItem={renderCandidate}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={candidates.refreshing} onRefresh={() => void candidates.refresh(true)} />}
        ListHeaderComponent={
          <View>
            <Text style={styles.eyebrow}>ACQUISIZIONE · NMRE MOBILE</Text>
            <Text style={styles.title}>Nuove opportunità</Text>
            <Text style={styles.subtitle}>Ogni annuncio viene verificato prima di essere considerato un venditore privato.</Text>
            <View style={styles.summary}>
              <Text style={styles.summaryNumber}>{candidates.status === "ready" ? candidates.total : "—"}</Text>
              <View style={styles.summaryCopy}>
                <Text style={styles.summaryTitle}>Opportunità</Text>
                <Text style={styles.summaryHint}>
                  {candidates.status === "ready"
                    ? candidates.items.length + " caricate · massimo 25 per pagina"
                    : "Lettura dall'archivio in corso"}
                </Text>
              </View>
              <View style={styles.readOnlyPill}><Text style={styles.readOnlyText}>SOLA LETTURA</Text></View>
            </View>
            <View style={styles.filters}>
              {filters.map(option => (
                <Pressable
                  key={option.value}
                  accessibilityRole="button"
                  accessibilityState={{ selected: filter === option.value }}
                  onPress={() => {
                    setFilter(option.value);
                    setExpandedId(null);
                  }}
                  style={[styles.filterChip, filter === option.value && styles.filterChipActive]}
                >
                  <Text style={[styles.filterText, filter === option.value && styles.filterTextActive]}>{option.label}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.inputLabel}>FILTRA PER COMUNE</Text>
            <TextInput
              value={municipalityInput}
              onChangeText={value => {
                setMunicipalityInput(value);
                setExpandedId(null);
              }}
              placeholder="Es. Osimo, Ancona, Castelfidardo"
              placeholderTextColor={theme.colors.muted}
              autoCapitalize="words"
              returnKeyType="search"
              style={styles.searchInput}
              accessibilityLabel="Filtra opportunità per comune"
            />
            {candidates.error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{candidates.error}</Text>
                <Pressable onPress={() => void candidates.refresh(true)} accessibilityRole="button">
                  <Text style={styles.retryText}>Riprova</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          candidates.status === "loading" ? (
            <View style={styles.emptyState}>
              <ActivityIndicator color={theme.colors.gold} />
              <Text style={styles.emptyText}>Caricamento opportunità…</Text>
            </View>
          ) : candidates.status === "error" ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>I dati non sono disponibili. Nessuna opportunità è stata considerata come zero.</Text>
            </View>
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>Nessuna opportunità trovata</Text>
              <Text style={styles.emptyText}>Provi a cambiare stato o comune.</Text>
            </View>
          )
        }
        ListFooterComponent={
          candidates.hasMore ? (
            <Pressable
              accessibilityRole="button"
              disabled={candidates.loadingMore}
              onPress={() => void candidates.loadMore()}
              style={styles.loadMoreButton}
            >
              {candidates.loadingMore ? (
                <ActivityIndicator color={theme.colors.navy} />
              ) : (
                <Text style={styles.loadMoreText}>Mostra altre {Math.min(25, candidates.total - candidates.items.length)}</Text>
              )}
            </Pressable>
          ) : candidates.status === "ready" && candidates.items.length > 0 ? (
            <Text style={styles.endNote}>Tutte le opportunità di questo filtro sono state caricate.</Text>
          ) : undefined
        }
      />
    </SafeAreaView>
  );
}

function Badge({ label, tone }: { label: string; tone: "success" | "warning" | "neutral" }) {
  const toneStyle = tone === "success" ? styles.badgeSuccess : tone === "warning" ? styles.badgeWarning : styles.badgeNeutral;
  return (
    <View style={[styles.badge, toneStyle]}>
      <Text style={styles.badgeText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.paper },
  listContent: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 32, flexGrow: 1 },
  eyebrow: { color: "#9A7C4D", fontSize: 9, fontWeight: "900", letterSpacing: 1.7 },
  title: { color: theme.colors.ink, fontSize: 29, fontWeight: "800", letterSpacing: -0.7, marginTop: 8 },
  subtitle: { color: theme.colors.muted, fontSize: 12, lineHeight: 18, marginTop: 7, maxWidth: 330 },
  summary: { flexDirection: "row", alignItems: "center", backgroundColor: theme.colors.navy, borderRadius: 16, padding: 15, marginTop: 18 },
  summaryNumber: { color: theme.colors.gold, fontSize: 29, fontWeight: "900", minWidth: 48 },
  summaryCopy: { flex: 1, marginLeft: 10 },
  summaryTitle: { color: theme.colors.white, fontSize: 13, fontWeight: "800" },
  summaryHint: { color: "#C1C9D5", fontSize: 10, marginTop: 4 },
  readOnlyPill: { backgroundColor: "#27364B", borderRadius: 99, paddingHorizontal: 8, paddingVertical: 6 },
  readOnlyText: { color: "#E6D4B4", fontSize: 7, fontWeight: "800", letterSpacing: 0.8 },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 17 },
  filterChip: { borderWidth: 1, borderColor: theme.colors.line, backgroundColor: theme.colors.white, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 9 },
  filterChipActive: { backgroundColor: theme.colors.navy, borderColor: theme.colors.navy },
  filterText: { color: theme.colors.muted, fontSize: 10, fontWeight: "700" },
  filterTextActive: { color: theme.colors.gold },
  inputLabel: { color: theme.colors.muted, fontSize: 8, fontWeight: "900", letterSpacing: 1.2, marginTop: 17, marginBottom: 7 },
  searchInput: { minHeight: 44, backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 12, paddingHorizontal: 13, color: theme.colors.ink, fontSize: 12 },
  errorBox: { backgroundColor: "#F8EFEA", borderRadius: 12, padding: 12, marginTop: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  errorText: { color: "#854F3C", fontSize: 10, flex: 1 },
  retryText: { color: theme.colors.navy, fontWeight: "800", fontSize: 10 },
  card: { backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 15, marginTop: 11, overflow: "hidden" },
  cardPressable: { padding: 14 },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 6, flex: 1 },
  badge: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 99 },
  badgeSuccess: { backgroundColor: "#EAF2EC" },
  badgeWarning: { backgroundColor: "#F4EFE5" },
  badgeNeutral: { backgroundColor: "#EEF0F3" },
  badgeText: { color: theme.colors.ink, fontSize: 8, fontWeight: "800" },
  expandIcon: { color: theme.colors.gold, fontSize: 20, fontWeight: "800", marginLeft: 8 },
  cardTitle: { color: theme.colors.ink, fontSize: 14, fontWeight: "800", marginTop: 12 },
  cardMunicipality: { color: theme.colors.muted, fontSize: 11, marginTop: 4 },
  cardPrice: { color: theme.colors.navy, fontSize: 21, fontWeight: "900", marginTop: 10 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 9, marginTop: 8 },
  metaText: { color: "#657083", fontSize: 10 },
  cardFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: "#EEF0F3", marginTop: 11, paddingTop: 10 },
  sourceText: { color: "#927447", fontSize: 9, fontWeight: "800", maxWidth: "50%" },
  dateText: { color: "#8A93A2", fontSize: 9 },
  details: { paddingHorizontal: 14, paddingBottom: 14 },
  detailDivider: { height: 1, backgroundColor: theme.colors.line, marginBottom: 13 },
  detailHeading: { color: "#927447", fontSize: 8, fontWeight: "900", letterSpacing: 1.1, marginTop: 6, marginBottom: 6 },
  detailValue: { color: theme.colors.ink, fontSize: 11, fontWeight: "700", lineHeight: 17 },
  detailMeta: { color: theme.colors.muted, fontSize: 10, lineHeight: 16, marginTop: 3 },
  evidence: { color: "#566174", fontSize: 10, lineHeight: 16, backgroundColor: "#F7F7F8", borderRadius: 9, padding: 10, marginTop: 3 },
  manualNote: { color: "#577A64", fontSize: 10, fontWeight: "700", marginTop: 4 },
  linkedNote: { color: theme.colors.muted, fontSize: 9, marginTop: 10, fontStyle: "italic" },
  openButton: { minHeight: 42, borderRadius: 10, backgroundColor: theme.colors.softGold, justifyContent: "center", alignItems: "center", marginTop: 13 },
  openButtonText: { color: theme.colors.navy, fontSize: 11, fontWeight: "900" },
  emptyState: { alignItems: "center", paddingHorizontal: 18, paddingVertical: 34, gap: 10 },
  emptyTitle: { color: theme.colors.ink, fontSize: 13, fontWeight: "800" },
  emptyText: { color: theme.colors.muted, fontSize: 11, textAlign: "center", lineHeight: 17 },
  loadMoreButton: { minHeight: 46, borderRadius: 12, backgroundColor: theme.colors.softGold, justifyContent: "center", alignItems: "center", marginTop: 14 },
  loadMoreText: { color: theme.colors.navy, fontSize: 11, fontWeight: "900" },
  endNote: { textAlign: "center", color: theme.colors.muted, fontSize: 9, paddingVertical: 20 }
});
