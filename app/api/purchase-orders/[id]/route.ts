import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import type { PurchaseOrder } from "@/lib/types";
import { adjustInventory, toLocationGid } from "@/lib/shopify";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const snap = await adminDb.collection("purchaseOrders").doc(params.id).get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(snap.data() as PurchaseOrder);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = (await req.json()) as Partial<PurchaseOrder>;
    const ref = adminDb.collection("purchaseOrders").doc(params.id);
    const existing = await ref.get();

    const now = new Date().toISOString();
    const merged: PurchaseOrder = {
      ...(existing.exists ? (existing.data() as PurchaseOrder) : ({} as PurchaseOrder)),
      ...body,
      id: params.id,
      updatedAt: now,
    } as PurchaseOrder;

    await ref.set(merged);
    return NextResponse.json(merged);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const ref = adminDb.collection("purchaseOrders").doc(params.id);
    const snap = await ref.get();

    if (snap.exists) {
      const po = snap.data() as PurchaseOrder;
      const syncedItems = (po.syncResult?.results ?? []).filter(
        (r) => r.status === "synced" && r.inventoryItemId && r.delta
      );

      if (syncedItems.length > 0 && process.env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
        const rawLocationId =
          po.location === "In-Store Fitzgerald St"
            ? process.env.SHOPIFY_LOCATION_ID_STORE
            : process.env.SHOPIFY_LOCATION_ID_WAREHOUSE;
        const locationGid = toLocationGid(rawLocationId);

        if (locationGid) {
          const reversals = await Promise.allSettled(
            syncedItems.map((r) =>
              adjustInventory(r.inventoryItemId!, locationGid, -(r.delta!))
            )
          );
          const failed = reversals.filter((r) => r.status === "rejected");
          if (failed.length > 0) {
            return NextResponse.json(
              { error: `Stock reversal failed for ${failed.length} item(s). PO not deleted.` },
              { status: 500 }
            );
          }
        }
      }
    }

    await ref.delete();
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
