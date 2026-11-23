type HistoryChange = {
  message?: {
    id?: unknown;
  };
  labelIds?: unknown;
};

type HistoryRecord = {
  messagesAdded?: unknown;
  labelsAdded?: unknown;
};

function addMessageId(target: Set<string>, value: unknown): void {
  if (!value || typeof value !== "object") return;
  const change = value as HistoryChange;
  const id = change.message?.id;
  if (typeof id === "string" && id.trim()) target.add(id.trim());
}

export function collectHistoryMessageIds(records: unknown[]): string[] {
  const ids = new Set<string>();

  for (const value of records) {
    if (!value || typeof value !== "object") continue;
    const record = value as HistoryRecord;

    if (Array.isArray(record.messagesAdded)) {
      for (const change of record.messagesAdded) addMessageId(ids, change);
    }

    if (Array.isArray(record.labelsAdded)) {
      for (const change of record.labelsAdded) {
        if (!change || typeof change !== "object") continue;
        const labels = (change as HistoryChange).labelIds;
        if (Array.isArray(labels) && labels.includes("INBOX")) {
          addMessageId(ids, change);
        }
      }
    }
  }

  return [...ids];
}