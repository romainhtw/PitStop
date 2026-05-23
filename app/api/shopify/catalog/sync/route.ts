import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { fetchAllActiveVariants, fetchInventoryLevels, toLocationGid } from "@/lib/shopify";
import type { ShopifyProduct } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  try {
    if (!process.env.SHOPIFY_STORE_DOMAIN || !process.env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
      return NextResponse.json({ error: "Shopify credentials not configured" }, { status: 500 });
    }

    const variants = await fetchAllActiveVariants();
    const syncedAt = new Date().toISOString();

    // Fetch inventory levels for both locations in parallel
    const storeGid = toLocationGid(process.env.SHOPIFY_LOCATION_ID_STORE);
    const warehouseGid = toLocationGid(process.env.SHOPIFY_LOCATION_ID_WAREHOUSE);
    const inventoryItemIds = variants.map((v) => v.inventoryItemId);

    // Batch into 250-item chunks (Shopify nodes() limit)
    const CHUNK = 250;
    const storeMap = new Map<string, { onHandQty: number; unitCost: number | null }>();
    const warehouseMap = new Map<string, number>();

    const chunks: string[][] = [];
    for (let i = 0; i < inventoryItemIds.length; i += CHUNK) {
      chunks.push(inventoryItemIds.slice(i, i + CHUNK));
    }

    const CONCURRENCY = 6;
    for (let i = 0; i < chunks.length; i += CONCURRENCY) {
      const batch = chunks.slice(i, i + CONCURRENCY);
      await Promise.all(
        batch.map(async (chunk) => {
          const [storeLevels, warehouseLevels] = await Promise.all([
            storeGid ? fetchInventoryLevels(chunk, storeGid) : Promise.resolve([]),
            warehouseGid ? fetchInventoryLevels(chunk, warehouseGid) : Promise.resolve([]),
          ]);
          for (const l of storeLevels) {
            storeMap.set(l.inventoryItemId, { onHandQty: l.onHandQty, unitCost: l.unitCost });
          }
          for (const l of warehouseLevels) {
            warehouseMap.set(l.inventoryItemId, l.onHandQty);
          }
        })
      );
    }

    // Write in batches of 499 (Firestore batch limit is 500 ops)
    const col = adminDb.collection("shopifyProducts");
    let batch = adminDb.batch();
    let opCount = 0;

    for (const v of variants) {
      const storeLevel = storeMap.get(v.inventoryItemId);
      const product: ShopifyProduct = {
        ...v,
        syncedAt,
        onHandQtyStore: storeLevel?.onHandQty ?? 0,
        onHandQtyWarehouse: warehouseMap.get(v.inventoryItemId) ?? 0,
        unitCost: storeLevel?.unitCost ?? null,
      };
      const docId = v.variantId.split("/").pop()!;
      batch.set(col.doc(docId), product);
      opCount++;
      if (opCount === 499) {
        await batch.commit();
        batch = adminDb.batch();
        opCount = 0;
      }
    }
    if (opCount > 0) await batch.commit();

    return NextResponse.json({ count: variants.length, syncedAt });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
