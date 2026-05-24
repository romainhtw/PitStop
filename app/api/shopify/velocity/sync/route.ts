import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import type { VelocityEntry } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const API_VERSION = "2025-04";

interface RestLineItem {
  variant_id: number | null;
  sku: string | null;
  quantity: number;
  name: string;
}

interface RestOrder {
  id: number;
  line_items: RestLineItem[];
}

async function fetchOrdersPage(sinceIso: string, pageInfo?: string): Promise<{
  orders: RestOrder[];
  nextPageInfo: string | null;
}> {
  const domain = process.env.SHOPIFY_STORE_DOMAIN!;
  const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN!;

  let url: string;
  if (pageInfo) {
    // Cursor-based pagination
    url = `https://${domain}/admin/api/${API_VERSION}/orders.json?limit=250&page_info=${pageInfo}&fields=id,line_items`;
  } else {
    // First page — filter by date and financial status
    const params = new URLSearchParams({
      status: "any",
      financial_status: "paid",
      created_at_min: sinceIso,
      limit: "250",
      fields: "id,line_items",
    });
    url = `https://${domain}/admin/api/${API_VERSION}/orders.json?${params}`;
  }

  const res = await fetch(url, {
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Shopify REST error ${res.status}: ${body.slice(0, 300)}`);
  }

  // Extract next page cursor from Link header
  const linkHeader = res.headers.get("link") ?? "";
  let nextPageInfo: string | null = null;
  const nextMatch = linkHeader.match(/<[^>]*[?&]page_info=([^&>]+)[^>]*>;\s*rel="next"/);
  if (nextMatch) nextPageInfo = nextMatch[1];

  const data = await res.json() as { orders: RestOrder[] };
  return { orders: data.orders ?? [], nextPageInfo };
}

export async function POST() {
  try {
    const windowDays = 60;
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const sinceIso = since.toISOString();

    const unitsBySku = new Map<string, { variantId: string; productTitle: string; units: number }>();

    let pageInfo: string | undefined;
    let pagesFetched = 0;
    const MAX_PAGES = 8;

    do {
      const { orders, nextPageInfo } = await fetchOrdersPage(sinceIso, pageInfo);

      for (const order of orders) {
        for (const item of order.line_items) {
          const sku = item.sku?.trim();
          if (!sku) continue;
          const variantId = item.variant_id ? String(item.variant_id) : sku;
          const existing = unitsBySku.get(sku);
          if (existing) {
            existing.units += item.quantity;
          } else {
            unitsBySku.set(sku, {
              variantId,
              productTitle: item.name ?? sku,
              units: item.quantity,
            });
          }
        }
      }

      pageInfo = nextPageInfo ?? undefined;
      pagesFetched++;

      // Stop if no more pages or fewer than 250 orders (last page)
      if (orders.length < 250) break;

    } while (pageInfo && pagesFetched < MAX_PAGES);

    // Write velocity docs to Firestore in batches of 499
    const now = new Date().toISOString();
    const entries = Array.from(unitsBySku.entries());
    const BATCH_SIZE = 499;

    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      const batch = adminDb.batch();
      for (const [sku, data] of entries.slice(i, i + BATCH_SIZE)) {
        // Firestore doc IDs cannot contain '/' — replace with '__'
        const docId = sku.replace(/\//g, "__");
        const entry: VelocityEntry = {
          sku,
          variantId: data.variantId,
          productTitle: data.productTitle,
          unitsSold90d: data.units,
          velocityPerDay: parseFloat((data.units / windowDays).toFixed(4)),
          lastSyncedAt: now,
        };
        batch.set(adminDb.collection("velocityCache").doc(docId), entry);
      }
      await batch.commit();
    }

    // Store sync metadata
    await adminDb.collection("velocityMeta").doc("latest").set({
      syncedAt: now,
      skuCount: unitsBySku.size,
      pagesFetched,
      windowDays,
    });

    return NextResponse.json({
      ok: true,
      skuCount: unitsBySku.size,
      pagesFetched,
      windowDays,
      syncedAt: now,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[velocity/sync]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
