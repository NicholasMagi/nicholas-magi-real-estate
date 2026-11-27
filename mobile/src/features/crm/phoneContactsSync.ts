import { Contact, ContactField } from "expo-contacts";
import * as ContactsLegacy from "expo-contacts/legacy";
import { supabase } from "@/shared/supabase/client";
import { canUseNameFallback, extractPhoneNumbers, findCertainDuplicateGroups, hasNameIdentityConflict, normalizePhoneNumber } from "@/features/crm/phoneContactMatching";

const CONTACT_FIELDS = [
  ContactField.FULL_NAME,
  ContactField.GIVEN_NAME,
  ContactField.FAMILY_NAME,
  ContactField.PHONES,
  ContactField.EMAILS
] as const;

const CONTACT_PAGE_SIZE = 100;
const LISTING_PAGE_SIZE = 100;
const MAX_LISTINGS_TO_MATCH = 5000;

type DeviceContact = {
  fullName: string | null;
  phoneNumbers: string[];
  emails: string[];
};

export type PhoneContactSyncResult = {
  deviceContacts: number;
  created: number;
  enriched: number;
  alreadyPresent: number;
  ambiguous: number;
  listingsLinked: number;
};

type CrmContact = {
  id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
};

type ListingRow = {
  id: string;
  contatto: unknown;
  seller_identity: unknown;
};

function normalizeEmail(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("it-IT");
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

async function readDeviceContacts(): Promise<DeviceContact[]> {
  const output: DeviceContact[] = [];
  for (let offset = 0; ; offset += CONTACT_PAGE_SIZE) {
    const page = await Contact.getAllDetails(CONTACT_FIELDS, {
      limit: CONTACT_PAGE_SIZE,
      offset
    });
    output.push(...page.map(item => ({
      fullName: (item.fullName ?? [item.givenName, item.familyName].filter(Boolean).join(" ")).trim() || null,
      phoneNumbers: unique((item.phones ?? []).map(phone => phone.number ?? "")),
      emails: unique((item.emails ?? []).map(email => email.address ?? ""))
    })));
    if (page.length < CONTACT_PAGE_SIZE) break;
  }
  return output.filter(item => item.fullName || item.phoneNumbers.length || item.emails.length);
}

function indexBy<T>(items: T[], keyOf: (item: T) => string | null): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    if (!key) continue;
    const values = result.get(key) ?? [];
    values.push(item);
    result.set(key, values);
  }
  return result;
}

async function importDeviceContacts(
  ownerId: string,
  deviceContacts: DeviceContact[]
): Promise<{
  contacts: CrmContact[];
  phoneToContactIds: Map<string, Set<string>>;
  created: number;
  enriched: number;
  alreadyPresent: number;
  ambiguous: number;
}> {
  if (!supabase) throw new Error("Configurazione Supabase non disponibile.");

  const contacts: CrmContact[] = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await supabase
      .from("nmre_contacts")
      .select("id,full_name,phone,email")
      .eq("owner_id", ownerId)
      .order("full_name", { ascending: true })
      .range(offset, offset + 99);
    if (error) throw new Error("Non è stato possibile leggere la Rubrica NMRE.");
    const page = (data ?? []) as CrmContact[];
    contacts.push(...page);
    if (page.length < 100) break;
  }
  const mergedDuplicates = await mergeCertainDuplicateContacts(ownerId, contacts);\n  const byPhone = new Map<string, CrmContact[]>();
  const byEmail = indexBy(contacts, item => item.email ? normalizeEmail(item.email) : null);
  const byName = indexBy(contacts, item => item.full_name ? normalizeName(item.full_name) : null);

  for (const contact of contacts) {
    const phone = contact.phone ? normalizePhoneNumber(contact.phone) : null;
    if (phone) byPhone.set(phone, [...(byPhone.get(phone) ?? []), contact]);
  }

  const deviceNameCounts = new Map<string, number>();
  const devicePhoneCounts = new Map<string, number>();
  for (const item of deviceContacts) {
    for (const phone of unique(item.phoneNumbers.map(value => normalizePhoneNumber(value)).filter((value): value is string => value !== null))) {
      devicePhoneCounts.set(phone, (devicePhoneCounts.get(phone) ?? 0) + 1);
    }
    const name = item.fullName ? normalizeName(item.fullName) : "";
    if (name) deviceNameCounts.set(name, (deviceNameCounts.get(name) ?? 0) + 1);
  }

  const phoneToContactIds = new Map<string, Set<string>>();
  let created = 0;
  let enriched = 0;
  let alreadyPresent = 0;
  let ambiguous = 0;

  for (const item of deviceContacts) {
    const phoneNumbers = unique(item.phoneNumbers
      .map(value => normalizePhoneNumber(value))
      .filter((value): value is string => value !== null));
    const email = item.emails.map(normalizeEmail).find(Boolean) ?? null;
    const nameKey = item.fullName ? normalizeName(item.fullName) : "";
    if (phoneNumbers.some(phone => (devicePhoneCounts.get(phone) ?? 0) > 1)) {
      ambiguous += 1;
      continue;
    }

    const candidates = new Map<string, CrmContact>();
    for (const phone of phoneNumbers) {
      for (const match of byPhone.get(phone) ?? []) candidates.set(match.id, match);
    }
    if (email) {
      for (const match of byEmail.get(email) ?? []) candidates.set(match.id, match);
    }
    const strongMatchCount = candidates.size;
    const sameNameContacts = nameKey ? byName.get(nameKey) ?? [] : [];
    if (hasNameIdentityConflict({
      nameMatchCount: sameNameContacts.length,
      hasStrongIdentifier: phoneNumbers.length > 0 || Boolean(email),
      strongMatchCount
    })) {
      // Same name but a different phone/email: do not create a second CRM person
      // automatically. Leave the conflict for manual verification.
      ambiguous += 1;
      continue;
    }
    if (candidates.size === 0 && nameKey && canUseNameFallback({
      phoneNumbers,
      email,
      deviceNameCount: deviceNameCounts.get(nameKey) ?? 0
    })) {
      for (const match of byName.get(nameKey) ?? []) candidates.set(match.id, match);
    }

    if (
      candidates.size > 1 ||
      (candidates.size === 0 && !item.fullName) ||
      (candidates.size === 0 && phoneNumbers.length === 0 && !email && (deviceNameCounts.get(nameKey) ?? 0) > 1)
    ) {
      ambiguous += 1;
      continue;
    }

    const matchedCandidate = candidates.size === 1 ? candidates.values().next().value as CrmContact | undefined : undefined;
    let matched: CrmContact | null = matchedCandidate ?? null;
    const primaryPhone = item.phoneNumbers.find(value => normalizePhoneNumber(value) !== null)?.trim() ?? null;
    const primaryEmail = item.emails.find(value => value.includes("@"))?.trim() ?? null;

    if (!matched) {
      const { data: inserted, error: insertError } = await supabase
        .from("nmre_contacts")
        .insert({
          owner_id: ownerId,
          full_name: item.fullName ?? "Contatto senza nome",
          contact_type: "altro",
          phone: primaryPhone,
          email: primaryEmail,
          source: "rubrica_telefono",
          status: "nuovo"
        })
        .select("id,full_name,phone,email")
        .single();
      if (insertError || !inserted) {
        throw new Error("Importazione di un contatto non riuscita. Gli altri dati CRM non sono stati eliminati.");
      }
      matched = inserted as CrmContact;
      contacts.push(matched);
      created += 1;
      if (matched.phone) {
        const key = normalizePhoneNumber(matched.phone);
        if (key) byPhone.set(key, [...(byPhone.get(key) ?? []), matched]);
      }
      if (matched.email) {
        const key = normalizeEmail(matched.email);
        byEmail.set(key, [...(byEmail.get(key) ?? []), matched]);
      }
      if (matched.full_name) {
        const key = normalizeName(matched.full_name);
        byName.set(key, [...(byName.get(key) ?? []), matched]);
      }
    } else {
      const patch: Record<string, string> = {};
      if (!matched.full_name && item.fullName) patch.full_name = item.fullName;
      if (!matched.phone && primaryPhone) patch.phone = primaryPhone;
      if (!matched.email && primaryEmail) patch.email = primaryEmail;

      if (Object.keys(patch).length) {
        const { data: updated, error: updateError } = await supabase
          .from("nmre_contacts")
          .update(patch)
          .eq("owner_id", ownerId)
          .eq("id", matched.id)
          .select("id,full_name,phone,email")
          .maybeSingle();
        if (updateError) throw new Error("Aggiornamento prudente di un contatto non riuscito.");
        if (updated) {
          Object.assign(matched, updated);
          enriched += 1;
        } else {
          alreadyPresent += 1;
        }
      } else {
        alreadyPresent += 1;
      }
    }

    for (const phone of phoneNumbers) {
      const ids = phoneToContactIds.get(phone) ?? new Set<string>();
      ids.add(matched.id);
      phoneToContactIds.set(phone, ids);
    }
    if (matched.phone) {
      const key = normalizePhoneNumber(matched.phone);
      if (key) {
        const ids = phoneToContactIds.get(key) ?? new Set<string>();
        ids.add(matched.id);
        phoneToContactIds.set(key, ids);
      }
    }
  }

  return { contacts, phoneToContactIds, created, enriched, alreadyPresent, ambiguous, mergedDuplicates };
}

async function linkListingsByPhone(
  ownerId: string,
  phoneToContactIds: Map<string, Set<string>>
): Promise<number> {
  if (!supabase || phoneToContactIds.size === 0) return 0;
  let linked = 0;
  const rowsToCheck: ListingRow[] = [];

  // Read pages before writing: updating contact_id changes the filtered result set,
  // so writing while offset-paginating could skip later listings.
  for (let offset = 0; offset < MAX_LISTINGS_TO_MATCH; offset += LISTING_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("annunci")
      .select("id,contatto,seller_identity")
      .eq("owner_id", ownerId)
      .is("contact_id", null)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .range(offset, offset + LISTING_PAGE_SIZE - 1);

    if (error) throw new Error("Contatti importati, ma non è stato possibile verificare gli annunci da associare.");
    const page = (data ?? []) as ListingRow[];
    rowsToCheck.push(...page);
    if (page.length < LISTING_PAGE_SIZE) break;
  }

  for (const row of rowsToCheck) {
    const listingPhones = unique([
        ...extractPhoneNumbers(row.contatto),
        ...extractPhoneNumbers(row.seller_identity)
      ]);
    const matches = new Set<string>();
    for (const phone of listingPhones) {
      for (const id of phoneToContactIds.get(phone) ?? []) matches.add(id);
    }
    if (matches.size !== 1) continue;
    const contactId = matches.values().next().value as string | undefined;
    if (!contactId) continue;
    const { data: updated, error: updateError } = await supabase
      .from("annunci")
      .update({ contact_id: contactId })
      .eq("owner_id", ownerId)
      .eq("id", row.id)
      .is("contact_id", null)
      .is("deleted_at", null)
      .select("id")
      .maybeSingle();
    if (!updateError && updated) linked += 1;
  }

  return linked;
}

export async function syncPhoneContacts(ownerId: string): Promise<PhoneContactSyncResult> {
  if (!ownerId) throw new Error("Sessione utente non disponibile.");
  if (!supabase) throw new Error("Configurazione Supabase non disponibile.");

  const deviceContacts = await readDeviceContacts();
  const imported = await importDeviceContacts(ownerId, deviceContacts);
  const listingsLinked = await linkListingsByPhone(ownerId, imported.phoneToContactIds);

  return {
    deviceContacts: deviceContacts.length,
    created: imported.created,
    enriched: imported.enriched,
    alreadyPresent: imported.alreadyPresent,
    ambiguous: imported.ambiguous,
    listingsLinked
  };
}

export async function getPhoneContactsPermission() {
  return ContactsLegacy.getPermissionsAsync();
}

export async function requestPhoneContactsPermission() {
  return ContactsLegacy.requestPermissionsAsync();
}

export function addPhoneContactsChangeListener(listener: () => void) {
  return ContactsLegacy.addContactsChangeListener(listener);
}

export type CrmContactSummary = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  contact_type: string | null;
  status: string | null;
  source: string | null;
};

export async function loadCrmContacts(ownerId: string): Promise<CrmContactSummary[]> {
  if (!ownerId) throw new Error("Sessione utente non disponibile.");
  if (!supabase) throw new Error("Configurazione Supabase non disponibile.");
  const contacts: CrmContactSummary[] = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await supabase
      .from("nmre_contacts")
      .select("id,full_name,phone,email,contact_type,status,source,notes")
      .eq("owner_id", ownerId)
      .order("full_name", { ascending: true })
      .range(offset, offset + 99);
    if (error) throw new Error("Non è stato possibile caricare i contatti CRM.");
    const page = (data ?? []) as CrmContactSummary[];
    contacts.push(...page);
    if (page.length < 100) break;
  }
  return contacts;
}

export async function updateCrmContact(
  ownerId: string,
  contactId: string,
  patch: Pick<CrmContactSummary, "full_name" | "phone" | "email" | "contact_type">
): Promise<void> {
  if (!ownerId || !contactId) throw new Error("Contatto non valido.");
  if (!supabase) throw new Error("Configurazione Supabase non disponibile.");
  const fullName = patch.full_name.trim();
  if (!fullName) throw new Error("Inserisca nome e cognome.");
  const { error } = await supabase
    .from("nmre_contacts")
    .update({
      full_name: fullName,
      phone: patch.phone?.trim() || null,
      email: patch.email?.trim() || null,
      contact_type: patch.contact_type
    })
    .eq("owner_id", ownerId)
    .eq("id", contactId);
  if (error) throw new Error("Non è stato possibile salvare le modifiche al contatto.");
}


export type CrmLinkedProperty = {
  id: string;
  title: string;
  municipality: string;
  status: string;
  asking_price: number | null;
  relation_role: string;
};

export type CrmInteraction = {
  id: string;
  interaction_type: string;
  outcome: string | null;
  outcome_code: string | null;
  notes: string | null;
  next_contact_at: string | null;
  created_at: string;
  property_id: string | null;
};

export async function loadContactRelations(
  ownerId: string,
  contactId: string
): Promise<{ properties: CrmLinkedProperty[]; interactions: CrmInteraction[] }> {
  if (!ownerId || !contactId) throw new Error("Contatto non valido.");
  if (!supabase) throw new Error("Configurazione Supabase non disponibile.");

  const [linksResult, interactionsResult] = await Promise.all([
    supabase
      .from("nmre_property_contacts")
      .select("property_id,relation_role")
      .eq("owner_id", ownerId)
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false }),
    supabase
      .from("nmre_contact_interactions")
      .select("id,interaction_type,outcome,outcome_code,notes,next_contact_at,created_at,property_id")
      .eq("owner_id", ownerId)
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false })
      .limit(50)
  ]);
  if (linksResult.error) throw new Error("Non è stato possibile caricare gli immobili associati.");
  if (interactionsResult.error) throw new Error("Non è stato possibile caricare lo storico delle interazioni.");

  const links = (linksResult.data ?? []) as { property_id: string; relation_role: string }[];
  const roleById = new Map(links.map(link => [link.property_id, link.relation_role]));
  // Include legacy/direct contact_id relations as well as the normalized link table.
  const { data: directlyLinked, error: directError } = await supabase
    .from("nmre_properties")
    .select("id,title,municipality,status,asking_price")
    .eq("owner_id", ownerId)
    .eq("contact_id", contactId);
  if (directError) throw new Error("Non è stato possibile leggere gli immobili collegati al contatto.");
  const linkedIds = new Set(links.map(link => link.property_id));
  const directRows = (directlyLinked ?? []) as Omit<CrmLinkedProperty, "relation_role">[];
  const directIds = directRows.map(property => property.id);
  const linkOnlyIds = [...linkedIds].filter(id => !directIds.includes(id));
  let linkOnlyRows: Omit<CrmLinkedProperty, "relation_role">[] = [];
  if (linkOnlyIds.length) {
    const { data, error } = await supabase
      .from("nmre_properties")
      .select("id,title,municipality,status,asking_price")
      .eq("owner_id", ownerId)
      .in("id", linkOnlyIds);
    if (error) throw new Error("Non è stato possibile leggere i dati degli immobili associati.");
    linkOnlyRows = (data ?? []) as Omit<CrmLinkedProperty, "relation_role">[];
  }
  const properties: CrmLinkedProperty[] = [...directRows, ...linkOnlyRows].map(property => ({
    ...property,
    relation_role: roleById.get(property.id) ?? "proprietario"
  }));

  return {
    properties,
    interactions: (interactionsResult.data ?? []) as CrmInteraction[]
  };
}

export async function searchAvailableProperties(ownerId: string): Promise<{
  id: string;
  title: string;
  municipality: string;
  status: string;
}[]> {
  if (!ownerId) throw new Error("Sessione utente non disponibile.");
  if (!supabase) throw new Error("Configurazione Supabase non disponibile.");
  const { data, error } = await supabase
    .from("nmre_properties")
    .select("id,title,municipality,status")
    .eq("owner_id", ownerId)
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error) throw new Error("Non è stato possibile cercare gli immobili.");
  return (data ?? []) as { id: string; title: string; municipality: string; status: string }[];
}

export async function linkPropertyToContact(
  ownerId: string,
  contactId: string,
  propertyId: string,
  relationRole = "proprietario"
): Promise<void> {
  if (!ownerId || !contactId || !propertyId) throw new Error("Associazione non valida.");
  if (!supabase) throw new Error("Configurazione Supabase non disponibile.");
  const { error } = await supabase
    .from("nmre_property_contacts")
    .upsert({
      owner_id: ownerId,
      contact_id: contactId,
      property_id: propertyId,
      relation_role: relationRole
    }, { onConflict: "owner_id,property_id,contact_id", ignoreDuplicates: true });
  if (error) throw new Error("Non è stato possibile associare l'immobile al contatto.");
}

export async function unlinkPropertyFromContact(
  ownerId: string,
  contactId: string,
  propertyId: string
): Promise<void> {
  if (!ownerId || !contactId || !propertyId) throw new Error("Associazione non valida.");
  if (!supabase) throw new Error("Configurazione Supabase non disponibile.");
  const [linkDelete, propertyUpdate] = await Promise.all([
    supabase
      .from("nmre_property_contacts")
      .delete()
      .eq("owner_id", ownerId)
      .eq("contact_id", contactId)
      .eq("property_id", propertyId),
    supabase
      .from("nmre_properties")
      .update({ contact_id: null })
      .eq("owner_id", ownerId)
      .eq("id", propertyId)
      .eq("contact_id", contactId)
  ]);
  if (linkDelete.error || propertyUpdate.error) throw new Error("Non è stato possibile rimuovere l'associazione.");
}

export async function addContactInteraction(
  ownerId: string,
  contactId: string,
  input: { interaction_type: string; notes: string; outcome?: string | null; next_contact_at?: string | null }
): Promise<void> {
  if (!ownerId || !contactId) throw new Error("Contatto non valido.");
  if (!supabase) throw new Error("Configurazione Supabase non disponibile.");
  const { error } = await supabase
    .from("nmre_contact_interactions")
    .insert({
      owner_id: ownerId,
      contact_id: contactId,
      interaction_type: input.interaction_type,
      notes: input.notes.trim() || null,
      outcome: input.outcome?.trim() || null,
      next_contact_at: input.next_contact_at || null
    });
  if (error) throw new Error("Non è stato possibile registrare l'interazione.");
}
