import Dexie, { type Table } from "dexie";

export interface StockTakeEntry {
  variantId: string;
  counted: number;
  done: boolean;
  updatedAt: number;
}

class StockTakeDatabase extends Dexie {
  entries!: Table<StockTakeEntry, string>;

  constructor() {
    super("pitstop_stocktake");
    this.version(1).stores({
      entries: "variantId, done, updatedAt",
    });
  }
}

export const stockTakeDb = new StockTakeDatabase();

export async function loadEntries(): Promise<Record<string, { counted: number; done: boolean }>> {
  try {
    const rows = await stockTakeDb.entries.toArray();
    const map: Record<string, { counted: number; done: boolean }> = {};
    for (const r of rows) {
      map[r.variantId] = { counted: r.counted, done: r.done };
    }
    return map;
  } catch {
    return {};
  }
}

export async function saveEntry(variantId: string, counted: number, done: boolean): Promise<void> {
  try {
    await stockTakeDb.entries.put({ variantId, counted, done, updatedAt: Date.now() });
  } catch {}
}

export async function clearAllEntries(): Promise<void> {
  try {
    await stockTakeDb.entries.clear();
  } catch {}
}
