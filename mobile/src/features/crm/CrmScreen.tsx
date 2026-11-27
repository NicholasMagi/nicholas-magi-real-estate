import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  Text,
  View
} from "react-native";
import { useAuth } from "@/features/auth/AuthProvider";
import {
  addPhoneContactsChangeListener,
  getPhoneContactsPermission,
  loadCrmContacts,
  requestPhoneContactsPermission,
  syncPhoneContacts,
  type CrmContactSummary,
  type PhoneContactSyncResult
} from "@/features/crm/phoneContactsSync";
import { theme } from "@/shared/theme";

type PermissionState = "checking" | "not_granted" | "granted" | "limited" | "blocked";

export function CrmScreen() {
  const { user } = useAuth();
  const userId = user?.id;
  const [permission, setPermission] = useState<PermissionState>("checking");
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<PhoneContactSyncResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [contacts, setContacts] = useState<CrmContactSummary[]>([]);
  const [search, setSearch] = useState("");
  const syncInProgress = useRef(false);

  const runSync = useCallback(async () => {
    if (!userId || syncInProgress.current) return;
    syncInProgress.current = true;
    setSyncing(true);
    setMessage(null);
    try {
      const permissionResult = await getPhoneContactsPermission();
      if (!permissionResult.granted) {
        setPermission(permissionResult.canAskAgain ? "not_granted" : "blocked");
        setMessage("Il permesso alla rubrica non è più attivo. Lo riabiliti per continuare la sincronizzazione.");
        return;
      }
      setPermission(permissionResult.accessPrivileges === "limited" ? "limited" : "granted");
      const next = await syncPhoneContacts(userId);
      setResult(next);
      setContacts(await loadCrmContacts(userId));
      setMessage("Rubrica sincronizzata. I dati già presenti nel CRM sono stati preservati.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sincronizzazione non riuscita. Riprovi.");
    } finally {
      syncInProgress.current = false;
      setSyncing(false);
    }
  }, [userId]);

  useEffect(() => {
    let active = true;
    if (userId) {
      void loadCrmContacts(userId).then(rows => {
        if (active) setContacts(rows);
      }).catch(() => {
        if (active) setMessage("Non è stato possibile caricare la rubrica CRM.");
      });
    }
    void getPhoneContactsPermission()
      .then(permissionResult => {
        if (!active) return;
        if (permissionResult.granted) {
          setPermission(permissionResult.accessPrivileges === "limited" ? "limited" : "granted");
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
  }, [runSync, userId]);

  useEffect(() => {
    const contactsSubscription = permission === "granted" || permission === "limited"
      ? addPhoneContactsChangeListener(() => { void runSync(); })
      : null;
    const appStateSubscription = AppState.addEventListener("change", state => {
      if (state !== "active") return;
      void getPhoneContactsPermission().then(permissionResult => {
        if (permissionResult.granted) {
          setPermission(permissionResult.accessPrivileges === "limited" ? "limited" : "granted");
          void runSync();
        } else {
          setPermission(permissionResult.canAskAgain ? "not_granted" : "blocked");
        }
      });
    });
    return () => {
      contactsSubscription?.remove();
      appStateSubscription.remove();
    };
  }, [permission, runSync]);

  const enableImport = async () => {
    setMessage(null);
    try {
      const permissionResult = await requestPhoneContactsPermission();
      if (permissionResult.granted) {
        setPermission(permissionResult.accessPrivileges === "limited" ? "limited" : "granted");
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
              {permission === "limited" ? "Accesso limitato ai contatti selezionati" : permission === "granted" ? "Accesso autorizzato" : "Collegamento non ancora attivo"}
            </Text>
          </View>
          {syncing ? <ActivityIndicator color={theme.colors.gold} /> : null}
        </View>

        {permission === "checking" ? (
          <Text style={styles.body}>Verifica dei permessi in corso…</Text>
        ) : permission === "granted" || permission === "limited" ? (
          <>
            <Text style={styles.body}>
              {permission === "limited"
                ? "Il telefono consente l'accesso solo ai contatti selezionati. NMRE sincronizza questo gruppo; per importare l'intera rubrica, abiliti l'accesso completo nelle impostazioni del dispositivo."
                : "NMRE importa i nuovi contatti e completa solo i campi CRM vuoti quando apre questa schermata, quando l'app torna attiva e quando il telefono segnala modifiche."}
            </Text>
            <Pressable style={[styles.button, syncing && styles.buttonDisabled]} onPress={() => void runSync()} disabled={syncing}>
              <Text style={styles.buttonText}>{syncing ? "Sincronizzazione…" : permission === "limited" ? "Sincronizza contatti selezionati" : "Sincronizza adesso"}</Text>
            </Pressable>
            {permission === "limited" ? (
              <Pressable style={styles.button} onPress={() => void Linking.openSettings()}>
                <Text style={styles.buttonText}>Gestisci accesso alla rubrica</Text>
              </Pressable>
            ) : null}
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

      <View style={styles.card}>
        <View style={styles.contactsHeader}>
          <Text style={styles.cardTitle}>Contatti in NMRE</Text>
          <Text style={styles.cardSubtitle}>{contacts.length === 100 ? "Primi 100 contatti" : contacts.length + " contatti"}</Text>
        </View>
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Cerca nome, telefono o email"
          placeholderTextColor={theme.colors.muted}
          autoCapitalize="none"
        />
        {contacts.filter(contact => [contact.full_name, contact.phone, contact.email].some(value => String(value ?? "").toLocaleLowerCase("it-IT").includes(search.trim().toLocaleLowerCase("it-IT")))).length === 0 ? (
          <Text style={styles.body}>Nessun contatto trovato.</Text>
        ) : contacts.filter(contact => [contact.full_name, contact.phone, contact.email].some(value => String(value ?? "").toLocaleLowerCase("it-IT").includes(search.trim().toLocaleLowerCase("it-IT")))).slice(0, 50).map(contact => (
          <View key={contact.id} style={styles.contactRow}>
            <View style={styles.contactMain}>
              <Text style={styles.contactName}>{contact.full_name}</Text>
              <Text style={styles.contactMeta}>{contact.phone || "Telefono non presente"}{contact.email ? " · " + contact.email : ""}</Text>
            </View>
            <Text style={styles.contactStatus}>{contact.contact_type || "altro"}</Text>
          </View>
        ))}
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
          La rubrica viene letta solo dopo il consenso del dispositivo. Tutti i numeri disponibili sono usati per il riconoscimento; il CRM attuale conserva un solo numero principale per contatto. NMRE non conserva una copia locale permanente della rubrica e non sovrascrive i campi CRM già compilati.
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
  contactsHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  searchInput: { minHeight: 44, borderWidth: 1, borderColor: theme.colors.line, borderRadius: theme.radius.control, paddingHorizontal: 12, color: theme.colors.ink, fontSize: 14 },
  contactRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: theme.colors.line },
  contactMain: { flex: 1, gap: 4 },
  contactName: { color: theme.colors.ink, fontSize: 14, fontWeight: "700" },
  contactMeta: { color: theme.colors.muted, fontSize: 12 },
  contactStatus: { color: theme.colors.muted, fontSize: 10, textTransform: "capitalize" },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  stat: { width: "47%", minHeight: 65, borderRadius: 12, backgroundColor: theme.colors.paper, padding: 12, gap: 3 },
  statValue: { color: theme.colors.navy, fontSize: 22, fontWeight: "800" },
  statLabel: { color: theme.colors.muted, fontSize: 11 },
  footnote: { color: theme.colors.muted, fontSize: 12, lineHeight: 18 },
  notice: { borderRadius: theme.radius.card, backgroundColor: theme.colors.softGold, padding: 16, gap: 6 },
  noticeTitle: { color: theme.colors.navy, fontSize: 13, fontWeight: "800" },
  noticeText: { color: theme.colors.ink, fontSize: 12, lineHeight: 18 }
});
