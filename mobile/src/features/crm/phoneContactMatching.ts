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
