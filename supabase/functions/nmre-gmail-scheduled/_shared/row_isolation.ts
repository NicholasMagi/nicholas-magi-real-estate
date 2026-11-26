// Elaborazione isolata delle email di un ciclo di sincronizzazione.
//
// Un'email che non può essere salvata non deve impedire il salvataggio delle altre:
// ogni email viene elaborata separatamente e gli errori vengono raccolti. Se anche una
// sola email non è stata salvata, assertAllRowsSaved() solleva IncompleteSyncError
// PRIMA del salvataggio del cursore Gmail: il cursore non avanza, le email già salvate
// restano salvate (le operazioni sono idempotenti) e quelle non salvate vengono
// ritentate al ciclo successivo, insieme alle nuove email.

export type RowFailure = { sourceEmailId: string; reason: string };

export class IncompleteSyncError extends Error {
  constructor(public failures: RowFailure[]) {
    super("Elaborazione incompleta: " + failures.length + (failures.length === 1 ? " email non salvata" : " email non salvate") +
      " (" + failures.slice(0, 5).map(item => item.sourceEmailId + ": " + item.reason).join("; ") + (failures.length > 5 ? "; …" : "") +
      "). Il cursore Gmail non avanza: verranno ritentate al prossimo ciclo; le altre email sono state salvate.");
    this.name = "IncompleteSyncError";
  }
}

export async function processRowsIsolated<T>(
  items: T[],
  idOf: (item: T) => string,
  handler: (item: T) => Promise<void>
): Promise<RowFailure[]> {
  const failures: RowFailure[] = [];
  for (const item of items) {
    try {
      await handler(item);
    } catch (error) {
      failures.push({ sourceEmailId: idOf(item), reason: error instanceof Error ? error.message.slice(0, 160) : "errore sconosciuto" });
    }
  }
  return failures;
}

export function assertAllRowsSaved(failures: RowFailure[]): void {
  if (failures.length) throw new IncompleteSyncError(failures);
}
