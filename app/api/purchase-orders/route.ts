import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import {
  collection,
  getDocs,
  orderBy,
  query,
  doc,
  setDoc,
} from "firebase/firestore/lite";
import { v4 as uuidv4 } from "uuid";
import type { PurchaseOrder } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  try {
    const q = query(collection(db, "purchaseOrders"), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    const orders = snap.docs.map((d) => d.data() as PurchaseOrder);
    return NextResponse.json(orders);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message, orders: [] }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<PurchaseOrder>;
    const now = new Date().toISOString();
    const id = body.id || uuidv4();

    const po: PurchaseOrder = {
      id,
      supplier: body.supplier || "",
      invoiceNumber: body.invoiceNumber || "",
      invoiceDate: body.invoiceDate || "",
      orderNumber: body.orderNumber || "",
      location: body.location || "In-Store Fitzgerald St",
      paymentTerms: body.paymentTerms || "",
      lineItems: body.lineItems || [],
      shippingCost: body.shippingCost ?? 0,
      status: "awaiting_review",
      createdAt: now,
      updatedAt: now,
    };

    await setDoc(doc(db, "purchaseOrders", id), po);
    return NextResponse.json(po);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
