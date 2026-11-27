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
  const matches = text.match(/(?:\+|00)?\d[\d\s()./-]{6,}\d/g) ?? [];
  return unique(matches
    .map(item => normalizePhoneNumber(item))
    .filter((item): item is string => item !== null));
}

export function uniqueContactMatch<T extends { id: string }>(ids: T[]): T | null {
  const uniqueIds = new Set(ids.map(item => item.id));
  return uniqueIds.size === 1 ? ids.find(item => item.id === [...uniqueIds][0]) ?? null : null;
}
