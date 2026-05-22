import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { db } from "@/lib/firebase";
import { collection, doc, writeBatch } from "firebase/firestore/lite";
import type { ShopifyProduct } from "@/lib/types";

export const runtime = "nodejs";

function verifyHmac(body: string, hmacHeader: string, secret: string): boolean {
  const computed = createHmac("sha256", secret).update(body, "utf8").digest("base64");
  return computed === hmacHeader;
}

interface WebhookVariant {
  id: number;
  title: string;
  sku: string;
  barcode: string;
  price: string;
  compare_at_price: string | null;
  inventory_item_id: number;
}

interface WebhookProduct {
  id: number;
  title: string;
  product_type: string;
  status: string;
  tags: string;
  updated_at: string;
  variants: WebhookVariant[];
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const hmacHeader = req.headers.get("x-shopify-hmac-sha256") ?? "";
  const topic = req.headers.get("x-shopify-topic") ?? "";

  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (secret) {
    if (!verifyHmac(rawBody, hmacHeader, secret)) {
      return NextResponse.json({ error: "Invalid HMAC" }, { status: 401 });
    }
  }

  let payload: WebhookProduct;
  try {
    payload = JSON.parse(rawBody) as WebhookProduct;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const col = collection(db, "shopifyProducts");
  const syncedAt = new Date().toISOString();

  if (topic === "products/delete") {
    // Delete all variants for this product from the payload
    const batch = writeBatch(db);
    for (const v of payload.variants ?? []) {
      batch.delete(doc(col, String(v.id)));
    }
    await batch.commit();
    return NextResponse.json({ ok: true, action: "deleted", productId: payload.id });
  }

  // PRODUCTS_CREATE or PRODUCTS_UPDATE
  if (payload.status !== "active") {
    const batch = writeBatch(db);
    for (const v of payload.variants ?? []) {
      batch.delete(doc(col, String(v.id)));
    }
    await batch.commit();
    return NextResponse.json({ ok: true, action: "removed_inactive", productId: payload.id });
  }

  const batch = writeBatch(db);
  const tags = payload.tags ? payload.tags.split(",").map((t) => t.trim()).filter(Boolean) : [];

  for (const v of payload.variants ?? []) {
    const variantId = `gid://shopify/ProductVariant/${v.id}`;
    const product: ShopifyProduct = {
      variantId,

      productId: `gid://shopify/Product/${payload.id}`,
      productTitle: payload.title,
      variantTitle: v.title === "Default Title" ? "" : v.title,
      sku: v.sku || "",
      barcode: v.barcode || "",
      price: parseFloat(v.price) || 0,
      compareAtPrice: v.compare_at_price ? parseFloat(v.compare_at_price) : null,
      inventoryItemId: `gid://shopify/InventoryItem/${v.inventory_item_id}`,
      productType: payload.product_type || "",
      status: payload.status.toUpperCase(),
      tags,
      shopifyUpdatedAt: payload.updated_at,
      syncedAt,
    };
    batch.set(doc(col, String(v.id)), product);
  }

  await batch.commit();
  return NextResponse.json({ ok: true, action: "upserted", variants: payload.variants?.length ?? 0 });
}
