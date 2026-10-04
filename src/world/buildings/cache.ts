import type { Footprint } from './overpass';

/** Gecachte Zellen veralten nach 7 Tagen (Spec 5) (OSM ändert sich, aber selten). */
export const CELL_TTL_MS = 7 * 24 * 3600 * 1000;
const DB_NAME = 'globebox-buildings';
const STORE = 'cells';

interface Entry {
  hash: string;
  t: number;
  data: Footprint[];
}

/**
 * Zwei-Stufen-Cache für Gebäude-Zellen (Spec 5.4): Speicher-LRU plus IndexedDB.
 * Ohne IndexedDB (privates Fenster, Tests) bleibt nur der Speicher; Fehler sind nie fatal.
 */
export class BuildingCache {
  private readonly memory = new Map<string, Footprint[]>();
  private db: Promise<IDBDatabase | null> | null = null;

  constructor(
    private readonly maxMemoryCells = 96,
    private readonly now: () => number = () => Date.now(),
    private readonly idb: IDBFactory | undefined = globalThis.indexedDB,
  ) {}

  private open(): Promise<IDBDatabase | null> {
    if (this.db) return this.db;
    this.db = new Promise((resolve) => {
      if (!this.idb) return resolve(null);
      try {
        const req = this.idb.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'hash' });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    return this.db;
  }

  private remember(hash: string, data: Footprint[]): void {
    this.memory.delete(hash);
    this.memory.set(hash, data);
    while (this.memory.size > this.maxMemoryCells) {
      const oldest = this.memory.keys().next().value as string;
      this.memory.delete(oldest);
    }
  }

  async get(hash: string): Promise<Footprint[] | undefined> {
    const mem = this.memory.get(hash);
    if (mem) {
      this.remember(hash, mem);
      return mem;
    }
    const db = await this.open();
    if (!db) return undefined;
    const entry = await new Promise<Entry | undefined>((resolve) => {
      try {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(hash);
        req.onsuccess = () => resolve(req.result as Entry | undefined);
        req.onerror = () => resolve(undefined);
      } catch {
        resolve(undefined);
      }
    });
    if (!entry || this.now() - entry.t > CELL_TTL_MS) return undefined;
    this.remember(hash, entry.data);
    return entry.data;
  }

  async set(hash: string, data: Footprint[]): Promise<void> {
    this.remember(hash, data);
    const db = await this.open();
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put({ hash, t: this.now(), data } satisfies Entry);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  /** Nur Speicher leeren (IndexedDB bleibt). */
  clearMemory(): void {
    this.memory.clear();
  }
}
