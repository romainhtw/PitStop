import { NextRequest, NextResponse } from "next/server";
import { doc, getDoc, setDoc } from "firebase/firestore/lite";
import { db } from "@/lib/firebase";
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
    const ref = doc(db, "suppliers", supplierKey(params.name));
    const snap = await getDoc(ref);
    if (!snap.exists()) {
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
    const ref = doc(db, "suppliers", key);
    const existing = await getDoc(ref);

    const now = new Date().toISOString();
    const merged: SupplierProfile = {
      id: key,
      name: body.name || (existing.exists() ? (existing.data() as SupplierProfile).name : key),
      parseHints: body.parseHints ?? (existing.exists() ? (existing.data() as SupplierProfile).parseHints : ""),
      defaultLocation: body.defaultLocation ?? (existing.exists() ? (existing.data() as SupplierProfile).defaultLocation : ""),
      approvedPOCount: existing.exists() ? (existing.data() as SupplierProfile).approvedPOCount ?? 0 : 0,
      lastSeen: existing.exists() ? (existing.data() as SupplierProfile).lastSeen : now,
      updatedAt: now,
    };

    await setDoc(ref, merged);
    return NextResponse.json(merged);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
