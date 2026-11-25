import * as SecureStore from "expo-secure-store";

const CHUNK_SIZE = 512;
const MAX_CHUNKS = 256;
const CHUNK_PREFIX = "nmre-secure-chunks:v1:";
type ChunkReference = { generation: string; count: number };

function parseChunkReference(value: string | null): ChunkReference | null {
  if (!value || !value.startsWith(CHUNK_PREFIX)) return null;
  const match = /^([a-z0-9]+):(\d+)$/.exec(value.slice(CHUNK_PREFIX.length));
  if (!match) throw new Error("Il contenuto della sessione protetta non è valido.");
  const count = Number(match[2]);
  if (!Number.isInteger(count) || count < 1 || count > MAX_CHUNKS) {
    throw new Error("La sessione protetta supera il limite previsto.");
  }
  return { generation: match[1], count };
}
function chunkKey(key: string, generation: string, index: number): string {
  return key + ".v." + generation + ".chunk." + index;
}
async function removeChunks(key: string, reference: ChunkReference): Promise<void> {
  for (let i = 0; i < reference.count; i += 1) {
    await SecureStore.deleteItemAsync(chunkKey(key, reference.generation, i));
  }
}

export const secureStoreAdapter = {
  async getItem(key: string): Promise<string | null> {
    const stored = await SecureStore.getItemAsync(key);
    if (stored === null) return null;
    const reference = parseChunkReference(stored);
    if (!reference) return stored;
    const chunks: string[] = [];
    for (let i = 0; i < reference.count; i += 1) {
      const chunk = await SecureStore.getItemAsync(chunkKey(key, reference.generation, i));
      if (chunk === null) {
        throw new Error("La sessione protetta è incompleta. Effettui nuovamente l'accesso.");
      }
      chunks.push(chunk);
    }
    return chunks.join("");
  },

  async setItem(key: string, value: string): Promise<void> {
    const previousValue = await SecureStore.getItemAsync(key);
    const previousReference = parseChunkReference(previousValue);
    if (value.length <= CHUNK_SIZE) {
      await SecureStore.setItemAsync(key, value);
      if (previousReference) await removeChunks(key, previousReference);
      return;
    }

    const chunks: string[] = [];
    for (let offset = 0; offset < value.length; offset += CHUNK_SIZE) {
      chunks.push(value.slice(offset, offset + CHUNK_SIZE));
    }
    if (chunks.length > MAX_CHUNKS) {
      throw new Error("La sessione supera la capacità di archiviazione protetta.");
    }

    const generation = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    try {
      for (let i = 0; i < chunks.length; i += 1) {
        await SecureStore.setItemAsync(chunkKey(key, generation, i), chunks[i]);
      }
      // Publish the new pointer only after every encrypted chunk has been stored.
      await SecureStore.setItemAsync(key, CHUNK_PREFIX + generation + ":" + chunks.length);
    } catch (error) {
      await removeChunks(key, { generation, count: chunks.length }).catch(() => undefined);
      throw error;
    }
    if (previousReference) await removeChunks(key, previousReference);
  },

  async removeItem(key: string): Promise<void> {
    const stored = await SecureStore.getItemAsync(key);
    const reference = parseChunkReference(stored);
    await SecureStore.deleteItemAsync(key);
    if (reference) await removeChunks(key, reference);
  }
};
