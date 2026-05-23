import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import type { SupplierProfile } from "@/lib/types";

export const runtime = "nodejs";

function supplierKey(name: string) {
  return decodeURIComponent(name).toLowerCase().trim();
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { name: string } }
) {
  try {
    const snap = await adminDb.collection("suppliers").doc(supplierKey(params.name)).get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(snap.data() as SupplierProfile);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { name: string } }
) {
  try {
    const body = await req.json() as Partial<SupplierProfile>;
    const key = supplierKey(params.name);
    const ref = adminDb.collection("suppliers").doc(key);
    const existing = await ref.get();

    const now = new Date().toISOString();
    const existingData = existing.exists ? (existing.data() as SupplierProfile) : null;
    const merged: SupplierProfile = {
      id: key,
      name: body.name || existingData?.name || key,
      parseHints: body.parseHints ?? existingData?.parseHints ?? "",
      defaultLocation: body.defaultLocation ?? existingData?.defaultLocation ?? "",
      approvedPOCount: existingData?.approvedPOCount ?? 0,
      lastSeen: existingData?.lastSeen ?? now,
      updatedAt: now,
    };

    await ref.set(merged);
    return NextResponse.json(merged);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
