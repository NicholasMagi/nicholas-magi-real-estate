import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";
import { useAuth } from "@/features/auth/AuthProvider";
import {
  addPhoneContactsChangeListener,
  getPhoneContactsPermission,
  requestPhoneContactsPermission,
  syncPhoneContacts,
  type PhoneContactSyncResult
} from "@/features/crm/phoneContactsSync";
import { theme } from "@/shared/theme";

type PermissionState = "checking" | "not_granted" | "granted" | "blocked";

export function CrmScreen() {
  const { user } = useAuth();
  const [permission, setPermission] = useState<PermissionState>("checking");
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<PhoneContactSyncResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const syncInProgress = useRef(false);

  const runSync = useCallback(async () => {
    if (!user?.id || syncInProgress.current) return;
    syncInProgress.current = true;
    setSyncing(true);
    setMessage(null);
    try {
      const next = await syncPhoneContacts(user.id);
      setResult(next);
      setMessage("Rubrica sincronizzata. I dati già presenti nel CRM sono stati preservati.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sincronizzazione non riuscita. Riprovi.");
    } finally {
      syncInProgress.current = false;
      setSyncing(false);
    }
  }, [user?.id]);

  useEffect(() => {
    let active = true;
    void getPhoneContactsPermission()
      .then(permissionResult => {
        if (!active) return;
        if (permissionResult.granted) {
          setPermission("granted");
          void runSync();
        } else {
          setPermission(permissionResult.canAskAgain ? "not_granted" : "blocked");
        }
      })
      .catch(() => {
        if (active) {
          setPermission("not_granted");
          setMessage("Non è stato possibile verificare il permesso della rubrica.");
        }
      });
    return () => { active = false; };
  }, [runSync]);

  useEffect(() => {
    if (permission !== "granted") return;
    const contactsSubscription = addPhoneContactsChangeListener(() => { void runSync(); });
    const appStateSubscription = AppState.addEventListener("change", state => {
      if (state === "active") void runSync();
    });
    return () => {
      contactsSubscription.remove();
      appStateSubscription.remove();
    };
  }, [permission, runSync]);

  const enableImport = async () => {
    setMessage(null);
    try {
      const permissionResult = await requestPhoneContactsPermission();
      if (permissionResult.granted) {
        setPermission("granted");
        await runSync();
      } else {
        setPermission(permissionResult.canAskAgain ? "not_granted" : "blocked");
        setMessage("Per importare automaticamente i contatti, autorizzi NMRE ad accedere alla rubrica del telefono.");
      }
    } catch {
      setMessage("Non è stato possibile richiedere il permesso. Verifichi le impostazioni del dispositivo.");
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>RELAZIONI E AGENDA</Text>
        <Text style={styles.title}>Rubrica NMRE</Text>
        <Text style={styles.description}>
          Importazione automatica dei contatti del telefono e riconoscimento degli annunci tramite numero.
        </Text>
      </View>

      <View style={styles.card}>
        <View style={styles.cardHeading}>
          <View style={styles.iconCircle}><Text style={styles.icon}>♙</Text></View>
          <View style={styles.headingText}>
            <Text style={styles.cardTitle}>Sincronizzazione rubrica</Text>
            <Text style={styles.cardSubtitle}>
              {permission === "granted" ? "Accesso autorizzato" : "Collegamento non ancora attivo"}
            </Text>
          </View>
          {syncing ? <ActivityIndicator color={theme.colors.gold} /> : null}
        </View>

        {permission === "checking" ? (
          <Text style={styles.body}>Verifica dei permessi in corso…</Text>
        ) : permission === "granted" ? (
          <>
            <Text style={styles.body}>
              NMRE aggiorna la rubrica quando apre questa schermata, quando l'app torna attiva e quando il telefono segnala modifiche ai contatti.
            </Text>
            <Pressable style={[styles.button, syncing && styles.buttonDisabled]} onPress={() => void runSync()} disabled={syncing}>
              <Text style={styles.buttonText}>{syncing ? "Sincronizzazione…" : "Sincronizza adesso"}</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.body}>
              Dopo la Sua autorizzazione, NMRE importerà automaticamente i contatti disponibili e li confronterà con quelli già presenti nel gestionale. Non verranno cancellati contatti CRM.
            </Text>
            <Pressable style={styles.button} onPress={() => void (permission === "blocked" ? Linking.openSettings() : enableImport())}>
              <Text style={styles.buttonText}>{permission === "blocked" ? "Apri impostazioni" : "Autorizza e importa tutti i contatti"}</Text>
            </Pressable>
          </>
        )}

        {message ? <Text style={styles.message}>{message}</Text> : null}
      </View>

      {result ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Ultima sincronizzazione</Text>
          <View style={styles.statsGrid}>
            <Stat label="Contatti letti" value={result.deviceContacts} />
            <Stat label="Nuovi contatti" value={result.created} />
            <Stat label="Dati completati" value={result.enriched} />
            <Stat label="Già presenti" value={result.alreadyPresent} />
            <Stat label="Annunci associati" value={result.listingsLinked} />
            <Stat label="Da verificare" value={result.ambiguous} />
          </View>
          <Text style={styles.footnote}>
            Le associazioni vengono create solo quando il numero identifica un unico contatto. I casi ambigui non vengono collegati automaticamente.
          </Text>
        </View>
      ) : null}

      <View style={styles.notice}>
        <Text style={styles.noticeTitle}>Protezione dei dati</Text>
        <Text style={styles.noticeText}>
          La rubrica viene letta solo dopo il consenso del dispositivo. NMRE salva nel CRM i dati necessari al lavoro; non conserva una copia locale permanente della rubrica e non sovrascrive i campi CRM già compilati.
        </Text>
      </View>
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value.toLocaleString("it-IT")}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.paper },
  content: { padding: theme.spacing.screen, paddingBottom: 40, gap: 16 },
  header: { gap: 8, paddingTop: 10, paddingBottom: 6 },
  eyebrow: { color: theme.colors.gold, fontSize: 11, fontWeight: "800", letterSpacing: 1.4 },
  title: { color: theme.colors.ink, fontSize: 29, fontWeight: "800" },
  description: { color: theme.colors.muted, fontSize: 14, lineHeight: 21 },
  card: { backgroundColor: theme.colors.white, borderRadius: theme.radius.card, padding: 18, gap: 14 },
  cardHeading: { flexDirection: "row", alignItems: "center", gap: 12 },
  iconCircle: { width: 42, height: 42, borderRadius: 21, backgroundColor: theme.colors.softGold, alignItems: "center", justifyContent: "center" },
  icon: { color: theme.colors.navy, fontSize: 21 },
  headingText: { flex: 1, gap: 3 },
  cardTitle: { color: theme.colors.ink, fontSize: 17, fontWeight: "800" },
  cardSubtitle: { color: theme.colors.success, fontSize: 12, fontWeight: "700" },
  body: { color: theme.colors.muted, fontSize: 14, lineHeight: 21 },
  button: { minHeight: 48, borderRadius: theme.radius.control, backgroundColor: theme.colors.navy, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: theme.colors.white, fontSize: 14, fontWeight: "800" },
  message: { color: theme.colors.ink, fontSize: 13, lineHeight: 19 },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  stat: { width: "47%", minHeight: 65, borderRadius: 12, backgroundColor: theme.colors.paper, padding: 12, gap: 3 },
  statValue: { color: theme.colors.navy, fontSize: 22, fontWeight: "800" },
  statLabel: { color: theme.colors.muted, fontSize: 11 },
  footnote: { color: theme.colors.muted, fontSize: 12, lineHeight: 18 },
  notice: { borderRadius: theme.radius.card, backgroundColor: theme.colors.softGold, padding: 16, gap: 6 },
  noticeTitle: { color: theme.colors.navy, fontSize: 13, fontWeight: "800" },
  noticeText: { color: theme.colors.ink, fontSize: 12, lineHeight: 18 }
});
