import * as SecureStore from "expo-secure-store";

const CHUNK_SIZE = 384;
const MAX_CHUNKS = 256;
const CHUNK_PREFIX = "nmre-secure-chunks:v1:";
type ChunkReference = { generation: string; count: number };

function parseChunkReference(value: string | null): ChunkReference | null {
  if (!value || !value.startsWith(CHUNK_PREFIX)) return null;
  const match = /^([a-z0-9]+):(\d+)$/.exec(value.slice(CHUNK_PREFIX.length));
  if (!match) throw new Error("Il contenuto della sessione protetta non è valido.");
  const generation = match[1];
  const count = Number(match[2]);
  if (!generation || !Number.isInteger(count) || count < 1 || count > MAX_CHUNKS) {
    throw new Error("La sessione protetta supera il limite previsto.");
  }
  return { generation, count };
}

function chunkKey(key: string, generation: string, index: number): string {
  return key + ".v." + generation + ".chunk." + index;
}

async function removeChunks(key: string, reference: ChunkReference): Promise<void> {
  for (let index = 0; index < reference.count; index += 1) {
    await SecureStore.deleteItemAsync(chunkKey(key, reference.generation, index));
  }
}

async function readValue(key: string, retryOnConcurrentUpdate: boolean): Promise<string | null> {
  const stored = await SecureStore.getItemAsync(key);
  if (stored === null) return null;

  const reference = parseChunkReference(stored);
  if (!reference) return stored;

  const chunks: string[] = [];
  for (let index = 0; index < reference.count; index += 1) {
    const chunk = await SecureStore.getItemAsync(chunkKey(key, reference.generation, index));
    if (chunk === null) {
      const latestPointer = await SecureStore.getItemAsync(key);
      if (retryOnConcurrentUpdate && latestPointer !== stored) return readValue(key, false);
      throw new Error("La sessione protetta è incompleta. Effettui nuovamente l'accesso.");
    }
    chunks.push(chunk);
  }
  return chunks.join("");
}

function splitIntoChunks(value: string): string[] {
  const codePoints = Array.from(value);
  const chunks: string[] = [];
  for (let offset = 0; offset < codePoints.length; offset += CHUNK_SIZE) {
    chunks.push(codePoints.slice(offset, offset + CHUNK_SIZE).join(""));
  }
  return chunks;
}

export const secureStoreAdapter = {
  getItem(key: string): Promise<string | null> {
    return readValue(key, true);
  },

  async setItem(key: string, value: string): Promise<void> {
    const previousValue = await SecureStore.getItemAsync(key);
    const previousReference = parseChunkReference(previousValue);

    if (Array.from(value).length <= CHUNK_SIZE) {
      await SecureStore.setItemAsync(key, value);
      if (previousReference) {
        await removeChunks(key, previousReference).catch(() => undefined);
      }
      return;
    }

    const chunks = splitIntoChunks(value);
    if (chunks.length > MAX_CHUNKS) {
      throw new Error("La sessione supera la capacità di archiviazione protetta.");
    }

    const generation = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    try {
      for (let index = 0; index < chunks.length; index += 1) {
        const chunk = chunks[index];
        if (chunk === undefined) throw new Error("Frammento di sessione non disponibile.");
        await SecureStore.setItemAsync(chunkKey(key, generation, index), chunk);
      }
      // Publish the new pointer only after every encrypted chunk has been stored.
      await SecureStore.setItemAsync(key, CHUNK_PREFIX + generation + ":" + chunks.length);
    } catch (error) {
      await removeChunks(key, { generation, count: chunks.length }).catch(() => undefined);
      throw error;
    }

    if (previousReference) {
      await removeChunks(key, previousReference).catch(() => undefined);
    }
  },

  async removeItem(key: string): Promise<void> {
    const stored = await SecureStore.getItemAsync(key);
    const reference = parseChunkReference(stored);
    await SecureStore.deleteItemAsync(key);
    if (reference) await removeChunks(key, reference);
  }
};
