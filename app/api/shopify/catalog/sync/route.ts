import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { collection, doc, writeBatch } from "firebase/firestore/lite";
import { fetchAllActiveVariants } from "@/lib/shopify";
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

    // Write in batches of 500 (Firestore limit)
    const col = collection(db, "shopifyProducts");
    let batch = writeBatch(db);
    let opCount = 0;

    for (const v of variants) {
      const product: ShopifyProduct = { ...v, syncedAt };
      const docId = v.variantId.split("/").pop()!;
      batch.set(doc(col, docId), product);
      opCount++;
      if (opCount === 499) {
        await batch.commit();
        batch = writeBatch(db);
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
