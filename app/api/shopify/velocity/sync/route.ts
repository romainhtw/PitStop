import { NextResponse } from "next/server";
import { shopifyFetch } from "@/lib/shopify";
import { adminDb } from "@/lib/firebaseAdmin";
import type { VelocityEntry } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const ORDERS_QUERY = /* GraphQL */ `
  query GetOrders($cursor: String, $query: String!) {
    orders(first: 250, after: $cursor, query: $query, sortKey: CREATED_AT) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          lineItems(first: 100) {
            edges {
              node {
                variant { id sku }
                quantity
              }
            }
          }
        }
      }
    }
  }
`;

interface OrdersData {
  orders: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{
      node: {
        lineItems: {
          edges: Array<{
            node: {
              variant: { id: string; sku: string } | null;
              quantity: number;
            };
          }>;
        };
      };
    }>;
  };
}

export async function POST() {
  try {
    const windowDays = 90;
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const sinceIso = since.toISOString().slice(0, 10);
    const queryStr = `created_at:>=${sinceIso} financial_status:paid`;

    const unitsBySku = new Map<string, { variantId: string; productTitle: string; units: number }>();

    let cursor: string | null = null;
    let pagesFetched = 0;
    const MAX_PAGES = 8;

    do {
      const result: Awaited<ReturnType<typeof shopifyFetch<OrdersData>>> = await shopifyFetch<OrdersData>(ORDERS_QUERY, {
        cursor: cursor ?? undefined,
        query: queryStr,
      });

      if (result.errors?.length) {
        throw new Error(result.errors[0].message);
      }

      const orders: OrdersData["orders"] | undefined = result.data?.orders;
      if (!orders) break;

      for (const { node: order } of orders.edges) {
        for (const { node: item } of order.lineItems.edges) {
          if (!item.variant?.sku) continue;
          const sku = item.variant.sku.trim();
          if (!sku) continue;
          const existing = unitsBySku.get(sku);
          if (existing) {
            existing.units += item.quantity;
          } else {
            unitsBySku.set(sku, {
              variantId: item.variant.id,
              productTitle: sku,
              units: item.quantity,
            });
          }
        }
      }

      cursor = orders.pageInfo.hasNextPage ? orders.pageInfo.endCursor : null;
      pagesFetched++;
    } while (cursor && pagesFetched < MAX_PAGES);

    // Write velocity docs to Firestore in batches of 499
    const now = new Date().toISOString();
    const entries = Array.from(unitsBySku.entries());
    const BATCH_SIZE = 499;

    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      const batch = adminDb.batch();
      for (const [sku, data] of entries.slice(i, i + BATCH_SIZE)) {
        const entry: VelocityEntry = {
          sku,
          variantId: data.variantId,
          productTitle: data.productTitle,
          unitsSold90d: data.units,
          velocityPerDay: parseFloat((data.units / windowDays).toFixed(4)),
          lastSyncedAt: now,
        };
        batch.set(adminDb.collection("velocityCache").doc(sku), entry);
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
