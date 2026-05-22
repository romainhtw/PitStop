import { db } from "@/lib/firebase";
import { doc, getDoc, setDoc } from "firebase/firestore/lite";

export interface SkuMapping {
  supplierSku: string;
  supplier: string;
  variantId: string;
  inventoryItemId: string;
  productTitle: string;
  confirmedAt: string;
  confirmedCount: number;
}

function mappingId(supplier: string, sku: string): string {
  const clean = (s: string) =>
    s.toLowerCase().trim().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").slice(0, 80);
  return `${clean(supplier)}__${clean(sku)}`;
}

export async function lookupMapping(supplier: string, sku: string): Promise<SkuMapping | null> {
  if (!sku || !supplier) return null;
  try {
    const snap = await getDoc(doc(db, "supplierSkuMappings", mappingId(supplier, sku)));
    return snap.exists() ? (snap.data() as SkuMapping) : null;
  } catch {
    return null;
  }
}

export async function saveMapping(
  supplier: string,
  sku: string,
  match: { variantId: string; inventoryItemId: string; productTitle: string }
): Promise<void> {
  if (!sku || !supplier) return;
  try {
    const id = mappingId(supplier, sku);
    const existing = await getDoc(doc(db, "supplierSkuMappings", id));
    const prevCount = existing.exists() ? ((existing.data().confirmedCount as number) || 0) : 0;
    await setDoc(doc(db, "supplierSkuMappings", id), {
      supplierSku: sku,
      supplier,
      variantId: match.variantId,
      inventoryItemId: match.inventoryItemId,
      productTitle: match.productTitle,
      confirmedAt: new Date().toISOString(),
      confirmedCount: prevCount + 1,
    });
  } catch {
    // non-critical — never block a sync for a mapping write failure
  }
}
