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
  loadContactRelations,
  searchAvailableProperties,
  linkPropertyToContact,
  unlinkPropertyFromContact,
  addContactInteraction,
  requestPhoneContactsPermission,
  syncPhoneContacts,
  updateCrmContact,
  type CrmContactSummary,
  type CrmLinkedProperty,
  type CrmInteraction,
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
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState("altro");
  const [savingContact, setSavingContact] = useState(false);
  const [linkedProperties, setLinkedProperties] = useState<CrmLinkedProperty[]>([]);
  const [interactions, setInteractions] = useState<CrmInteraction[]>([]);
  const [availableProperties, setAvailableProperties] = useState<{ id: string; title: string; municipality: string; status: string }[]>([]);
  const [interactionNote, setInteractionNote] = useState("");
  const [loadingRelations, setLoadingRelations] = useState(false);
  const [savingInteraction, setSavingInteraction] = useState(false);
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

  const selectedContact = contacts.find(contact => contact.id === selectedContactId) ?? null;

  const refreshRelations = useCallback(async (contactId: string) => {
    if (!userId) return;
    setLoadingRelations(true);
    try {
      const [relations, properties] = await Promise.all([
        loadContactRelations(userId, contactId),
        searchAvailableProperties(userId)
      ]);
      setLinkedProperties(relations.properties);
      setInteractions(relations.interactions);
      setAvailableProperties(properties);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Non è stato possibile caricare i dettagli del contatto.");
    } finally {
      setLoadingRelations(false);
    }
  }, [userId]);

  const openContact = (contact: CrmContactSummary) => {
    setSelectedContactId(contact.id);
    setEditName(contact.full_name ?? "");
    setEditPhone(contact.phone ?? "");
    setEditEmail(contact.email ?? "");
    setEditRole(contact.contact_type ?? "altro");
    void refreshRelations(contact.id);
  };

  const attachProperty = async (propertyId: string) => {
    if (!userId || !selectedContactId) return;
    try {
      await linkPropertyToContact(userId, selectedContactId, propertyId);
      await refreshRelations(selectedContactId);
      setMessage("Immobile associato al contatto.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Associazione non riuscita.");
    }
  };

  const detachProperty = async (propertyId: string) => {
    if (!userId || !selectedContactId) return;
    try {
      await unlinkPropertyFromContact(userId, selectedContactId, propertyId);
      await refreshRelations(selectedContactId);
      setMessage("Associazione rimossa. L'immobile non è stato eliminato.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Rimozione associazione non riuscita.");
    }
  };

  const saveInteraction = async () => {
    if (!userId || !selectedContactId || !interactionNote.trim()) return;
    setSavingInteraction(true);
    try {
      await addContactInteraction(userId, selectedContactId, {
        interaction_type: "telefonata",
        notes: interactionNote
      });
      setInteractionNote("");
      await refreshRelations(selectedContactId);
      setMessage("Interazione registrata nello storico.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Registrazione interazione non riuscita.");
    } finally {
      setSavingInteraction(false);
    }
  };

  const saveContact = async () => {
    if (!userId || !selectedContactId) return;
    setSavingContact(true);
    try {
      await updateCrmContact(userId, selectedContactId, {
        full_name: editName,
        phone: editPhone,
        email: editEmail,
        contact_type: editRole
      });
      setContacts(await loadCrmContacts(userId));
      setMessage("Contatto aggiornato.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Salvataggio non riuscito.");
    } finally {
      setSavingContact(false);
    }
  };

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
          <Text style={styles.cardSubtitle}>{contacts.length + " contatti"}</Text>
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
        ) : contacts.filter(contact => [contact.full_name, contact.phone, contact.email].some(value => String(value ?? "").toLocaleLowerCase("it-IT").includes(search.trim().toLocaleLowerCase("it-IT")))).map(contact => (
          <Pressable key={contact.id} style={styles.contactRow} onPress={() => openContact(contact)}>
            <View style={styles.contactMain}>
              <Text style={styles.contactName}>{contact.full_name}</Text>
              <Text style={styles.contactMeta}>{contact.phone || "Telefono non presente"}{contact.email ? " · " + contact.email : ""}</Text>
            </View>
            <Text style={styles.contactStatus}>{contact.contact_type || "altro"} · Modifica</Text>
          </Pressable>
        ))}
      </View>

      {selectedContact ? (
        <View style={styles.card}>
          <View style={styles.contactsHeader}>
            <Text style={styles.cardTitle}>Scheda contatto</Text>
            <Pressable onPress={() => setSelectedContactId(null)}><Text style={styles.contactStatus}>Chiudi</Text></Pressable>
          </View>
          <Text style={styles.fieldLabel}>Nome e cognome</Text>
          <TextInput style={styles.searchInput} value={editName} onChangeText={setEditName} placeholder="Nome e cognome" />
          <Text style={styles.fieldLabel}>Telefono principale</Text>
          <TextInput style={styles.searchInput} value={editPhone} onChangeText={setEditPhone} placeholder="Numero telefonico" keyboardType="phone-pad" />
          <Text style={styles.fieldLabel}>Email</Text>
          <TextInput style={styles.searchInput} value={editEmail} onChangeText={setEditEmail} placeholder="Email" keyboardType="email-address" autoCapitalize="none" />
          <Text style={styles.fieldLabel}>Ruolo del contatto</Text>
          <TextInput style={styles.searchInput} value={editRole} onChangeText={setEditRole} placeholder="es. venditore, acquirente, altro" />
          <Text style={styles.footnote}>Provenienza: {selectedContact.source === "rubrica_telefono" ? "Rubrica del telefono" : "Inserimento manuale o altra origine"}.</Text>
          <Pressable style={[styles.button, savingContact && styles.buttonDisabled]} onPress={() => void saveContact()} disabled={savingContact}>
            <Text style={styles.buttonText}>{savingContact ? "Salvataggio…" : "Salva modifiche"}</Text>
          </Pressable>
          <View style={styles.sectionDivider} />
          <Text style={styles.cardTitle}>Immobili associati</Text>
          {loadingRelations ? <ActivityIndicator color={theme.colors.gold} /> : null}
          {linkedProperties.length === 0 ? <Text style={styles.body}>Nessun immobile associato.</Text> : linkedProperties.map(property => (
            <View key={property.id} style={styles.relationRow}>
              <View style={styles.contactMain}>
                <Text style={styles.contactName}>{property.title}</Text>
                <Text style={styles.contactMeta}>{property.municipality} · {property.status} · {property.relation_role}</Text>
              </View>
              <Pressable onPress={() => void detachProperty(property.id)}><Text style={styles.removeLink}>Rimuovi</Text></Pressable>
            </View>
          ))}
          <Text style={styles.fieldLabel}>Associa un immobile esistente</Text>
          {availableProperties.filter(property => !linkedProperties.some(link => link.id === property.id)).slice(0, 20).map(property => (
            <Pressable key={property.id} style={styles.relationRow} onPress={() => void attachProperty(property.id)}>
              <View style={styles.contactMain}>
                <Text style={styles.contactName}>{property.title}</Text>
                <Text style={styles.contactMeta}>{property.municipality} · {property.status}</Text>
              </View>
              <Text style={styles.addLink}>+ Associa</Text>
            </Pressable>
          ))}
          <View style={styles.sectionDivider} />
          <Text style={styles.cardTitle}>Storico interazioni</Text>
          <TextInput
            style={[styles.searchInput, styles.multilineInput]}
            value={interactionNote}
            onChangeText={setInteractionNote}
            placeholder="Annoti telefonata, appuntamento o altro contatto…"
            multiline
          />
          <Pressable style={[styles.button, savingInteraction && styles.buttonDisabled]} onPress={() => void saveInteraction()} disabled={savingInteraction || !interactionNote.trim()}>
            <Text style={styles.buttonText}>{savingInteraction ? "Registrazione…" : "Registra telefonata / nota"}</Text>
          </Pressable>
          {interactions.length === 0 ? <Text style={styles.body}>Nessuna interazione registrata.</Text> : interactions.map(interaction => (
            <View key={interaction.id} style={styles.interactionItem}>
              <View style={styles.contactsHeader}>
                <Text style={styles.contactName}>{interaction.interaction_type.replaceAll("_", " ")}</Text>
                <Text style={styles.contactStatus}>{new Date(interaction.created_at).toLocaleString("it-IT")}</Text>
              </View>
              {interaction.outcome ? <Text style={styles.contactMeta}>Esito: {interaction.outcome}</Text> : null}
              {interaction.notes ? <Text style={styles.body}>{interaction.notes}</Text> : null}
              {interaction.next_contact_at ? <Text style={styles.contactMeta}>Richiamare: {interaction.next_contact_at}</Text> : null}
            </View>
          ))}
        </View>
      ) : null}

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
  fieldLabel: { color: theme.colors.ink, fontSize: 12, fontWeight: "700" },
  sectionDivider: { height: 1, backgroundColor: theme.colors.line, marginVertical: 5 },
  relationRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.colors.line },
  addLink: { color: theme.colors.success, fontSize: 12, fontWeight: "800" },
  removeLink: { color: theme.colors.warning, fontSize: 12, fontWeight: "700" },
  interactionItem: { paddingVertical: 10, gap: 5, borderBottomWidth: 1, borderBottomColor: theme.colors.line },
  multilineInput: { minHeight: 76, textAlignVertical: "top", paddingTop: 12 },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  stat: { width: "47%", minHeight: 65, borderRadius: 12, backgroundColor: theme.colors.paper, padding: 12, gap: 3 },
  statValue: { color: theme.colors.navy, fontSize: 22, fontWeight: "800" },
  statLabel: { color: theme.colors.muted, fontSize: 11 },
  footnote: { color: theme.colors.muted, fontSize: 12, lineHeight: 18 },
  notice: { borderRadius: theme.radius.card, backgroundColor: theme.colors.softGold, padding: 16, gap: 6 },
  noticeTitle: { color: theme.colors.navy, fontSize: 13, fontWeight: "800" },
  noticeText: { color: theme.colors.ink, fontSize: 12, lineHeight: 18 }
});
