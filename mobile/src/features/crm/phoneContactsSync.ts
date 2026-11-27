import { Contact, ContactField } from "expo-contacts";
import * as ContactsLegacy from "expo-contacts/legacy";
import { supabase } from "@/shared/supabase/client";

const CONTACT_FIELDS = [
  ContactField.FULL_NAME,
  ContactField.GIVEN_NAME,
  ContactField.FAMILY_NAME,
  ContactField.PHONES,
  ContactField.EMAILS
] as const;

const CONTACT_PAGE_SIZE = 100;
const LISTING_PAGE_SIZE = 100;
const MAX_LISTINGS_TO_MATCH = 1000;

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

export function normalizePhoneNumber(value: string): string | null {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  // Italian +39 and local formats should resolve to the same national number.
  if (digits.startsWith("39") && digits.length >= 11) digits = digits.slice(2);
  return digits.length >= 7 && digits.length <= 15 ? digits : null;
}

function normalizeEmail(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("it-IT");
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function collectStrings(value: unknown, depth = 0): string[] {
  if (depth > 5 || value === null || value === undefined) return [];
  if (typeof value === "string" || typeof value === "number") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(item => collectStrings(item, depth + 1));
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>)
      .flatMap(item => collectStrings(item, depth + 1));
  }
  return [];
}

export function extractPhoneNumbers(value: unknown): string[] {
  const text = collectStrings(value).join(" ");
  const matches = text.match(/(?:\+|00)?\d[\d\s()./-]{6,}\d/g) ?? [];
  return unique(matches
    .map(item => normalizePhoneNumber(item))
    .filter((item): item is string => item !== null));
}

export function uniqueContactMatch<T extends { id: string }>(ids: T[]): T | null {
  const uniqueIds = new Set(ids.map(item => item.id));
  return uniqueIds.size === 1 ? ids.find(item => item.id === [...uniqueIds][0]) ?? null : null;
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
      emails: unique((item.emails ?? []).map(email => email.email ?? ""))
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

  const { data, error } = await supabase
    .from("nmre_contacts")
    .select("id,full_name,phone,email")
    .eq("owner_id", ownerId)
    .order("full_name", { ascending: true });
  if (error) throw new Error("Non è stato possibile leggere la Rubrica NMRE.");

  const contacts = (data ?? []) as CrmContact[];
  const byPhone = new Map<string, CrmContact[]>();
  const byEmail = indexBy(contacts, item => item.email ? normalizeEmail(item.email) : null);
  const byName = indexBy(contacts, item => item.full_name ? normalizeName(item.full_name) : null);

  for (const contact of contacts) {
    const phone = contact.phone ? normalizePhoneNumber(contact.phone) : null;
    if (phone) byPhone.set(phone, [...(byPhone.get(phone) ?? []), contact]);
  }

  const deviceNameCounts = new Map<string, number>();
  for (const item of deviceContacts) {
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

    const candidates = new Map<string, CrmContact>();
    for (const phone of phoneNumbers) {
      for (const match of byPhone.get(phone) ?? []) candidates.set(match.id, match);
    }
    if (email) {
      for (const match of byEmail.get(email) ?? []) candidates.set(match.id, match);
    }
    if (candidates.size === 0 && nameKey && deviceNameCounts.get(nameKey) === 1) {
      for (const match of byName.get(nameKey) ?? []) candidates.set(match.id, match);
    }

    if (candidates.size > 1 || (candidates.size === 0 && !item.fullName)) {
      ambiguous += 1;
      continue;
    }

    let matched = candidates.size === 1 ? [...candidates.values()][0] : null;
    const primaryPhone = item.phoneNumbers[0]?.trim() || null;
    const primaryEmail = item.emails[0]?.trim() || null;

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

  return { contacts, phoneToContactIds, created, enriched, alreadyPresent, ambiguous };
}

async function linkListingsByPhone(
  ownerId: string,
  phoneToContactIds: Map<string, Set<string>>
): Promise<number> {
  if (!supabase || phoneToContactIds.size === 0) return 0;
  let linked = 0;

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
    const rows = (data ?? []) as ListingRow[];
    for (const row of rows) {
      const listingPhones = unique([
        ...extractPhoneNumbers(row.contatto),
        ...extractPhoneNumbers(row.seller_identity)
      ]);
      const matches = new Set<string>();
      for (const phone of listingPhones) {
        for (const id of phoneToContactIds.get(phone) ?? []) matches.add(id);
      }
      if (matches.size !== 1) continue;
      const contactId = [...matches][0];
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
    if (rows.length < LISTING_PAGE_SIZE) break;
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
