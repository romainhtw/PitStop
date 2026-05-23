import { collection, getDocs, query, orderBy } from "firebase/firestore/lite";
import { db } from "@/lib/firebase";
import type { ShopifyProduct } from "@/lib/types";

const CACHE_KEY = "pitstop_catalog_v1";
const TTL_MS = 30 * 60 * 1000; // 30 minutes

interface CacheEntry {
  products: ShopifyProduct[];
  ts: number;
}

function readCache(): ShopifyProduct[] | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry;
    if (Date.now() - entry.ts > TTL_MS) return null;
    return entry.products;
  } catch {
    return null;
  }
}

function writeCache(products: ShopifyProduct[]) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ products, ts: Date.now() } satisfies CacheEntry));
  } catch {}
}

export function invalidateCache() {
  try {
    sessionStorage.removeItem(CACHE_KEY);
  } catch {}
}

export async function loadCatalog(force = false): Promise<ShopifyProduct[]> {
  if (!force) {
    const cached = readCache();
    if (cached) return cached;
  }
  const snap = await getDocs(query(collection(db, "shopifyProducts"), orderBy("productTitle")));
  const products = snap.docs.map((d) => d.data() as ShopifyProduct);
  writeCache(products);
  return products;
}
