export function normalizePhoneNumber(value: string): string | null {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  // Italian +39 and local formats should resolve to the same national number.
  if (digits.startsWith("39") && digits.length >= 11) digits = digits.slice(2);
  return digits.length >= 7 && digits.length <= 15 ? digits : null;
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
  const matches = text.match(/(?:\+?39|0039)?[\s()./-]*(?:0\d{1,3}|3\d{2})[\s()./-]*\d{3,4}[\s()./-]*\d{3,4}/g) ?? [];
  return unique(matches
    .map(item => normalizePhoneNumber(item))
    .filter((item): item is string => item !== null));
}

export function canUseNameFallback(input: {
  phoneNumbers: string[];
  email: string | null;
  deviceNameCount: number;
}): boolean {
  // Names alone are weak identifiers. Never use a name to override a different
  // phone/email identity; only use it when the device contact has no strong ID.
  return input.phoneNumbers.length === 0 && !input.email && input.deviceNameCount === 1;
}

export function uniqueContactMatch<T extends { id: string }>(ids: T[]): T | null {
  const uniqueIds = new Set(ids.map(item => item.id));
  return uniqueIds.size === 1 ? ids.find(item => item.id === [...uniqueIds][0]) ?? null : null;
}

/**
 * A matching name is not enough to merge two records when the device contact
 * carries a phone/email that does not match any CRM identity. Treat it as a
 * conflict instead of silently creating a duplicate person.
 */
export function hasNameIdentityConflict(input: {
  nameMatchCount: number;
  hasStrongIdentifier: boolean;
  strongMatchCount: number;
}): boolean {
  return input.nameMatchCount > 0 &&
    input.hasStrongIdentifier &&
    input.strongMatchCount === 0;
}


export type DuplicateContactIdentity = { id: string; full_name: string | null; phone: string | null; email: string | null };

function normalizeContactName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("it-IT");
}

function normalizeContactEmail(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

/** Merge only when name and a strong identifier match without conflicting identifiers. */
export function findCertainDuplicateGroups<T extends DuplicateContactIdentity>(contacts: T[]): T[][] {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const current = parent.get(id) ?? id;
    if (current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootB, rootA);
  };
  contacts.forEach(contact => parent.set(contact.id, contact.id));
  for (let i = 0; i < contacts.length; i += 1) {
    const a = contacts[i];
    if (!a.full_name?.trim()) continue;
    for (let j = i + 1; j < contacts.length; j += 1) {
      const b = contacts[j];
      if (!b.full_name?.trim() || normalizeContactName(a.full_name) !== normalizeContactName(b.full_name)) continue;
      const phoneA = a.phone ? normalizePhoneNumber(a.phone) : null;
      const phoneB = b.phone ? normalizePhoneNumber(b.phone) : null;
      const emailA = a.email?.trim() ? normalizeContactEmail(a.email) : null;
      const emailB = b.email?.trim() ? normalizeContactEmail(b.email) : null;
      const phoneConflict = Boolean(phoneA && phoneB && phoneA !== phoneB);
      const emailConflict = Boolean(emailA && emailB && emailA !== emailB);
      if (phoneConflict || emailConflict) continue;
      if ((phoneA && phoneA === phoneB) || (emailA && emailA === emailB)) union(a.id, b.id);
    }
  }
  const groups = new Map<string, T[]>();
  for (const contact of contacts) {
    const root = find(contact.id);
    const group = groups.get(root) ?? [];
    group.push(contact);
    groups.set(root, group);
  }
  return [...groups.values()].filter(group => group.length > 1);
}
