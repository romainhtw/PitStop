import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { v4 as uuidv4 } from "uuid";
import type { PurchaseOrder } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

async function getFirebase() {
  try {
    const { db } = await import("@/lib/firebase");
    return db;
  } catch {
    return null;
  }
}

async function getSupplierHints(): Promise<string> {
  try {
    const db = await getFirebase();
    if (!db) return "";
    const { collection, getDocs } = await import("firebase/firestore/lite");
    const snap = await Promise.race([
      getDocs(collection(db, "suppliers")),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
    ]);
    if (!snap) return "";
    const hints: string[] = [];
    snap.forEach((d: import("firebase/firestore/lite").QueryDocumentSnapshot) => {
      const s = d.data() as { name?: string; parseHints?: string };
      if (s.parseHints?.trim()) hints.push(`  - Supplier "${s.name}": ${s.parseHints.trim()}`);
    });
    return hints.length
      ? `\n\nKNOWN SUPPLIER-SPECIFIC RULES (apply when supplier name matches):\n${hints.join("\n")}`
      : "";
  } catch {
    return "";
  }
}

async function uploadPdfToStorage(poId: string, pdfBuffer: Buffer): Promise<string | null> {
  try {
    const bucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
    if (!bucket) return null;
    const objectName = `purchase-orders/${poId}.pdf`;
    const res = await fetch(
      `https://firebasestorage.googleapis.com/v0/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(objectName)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/pdf" },
        body: pdfBuffer as unknown as BodyInit,
      }
    );
    if (!res.ok) {
      console.error(`[upload-pdf] ${res.status}:`, await res.text());
      return null;
    }
    const data = await res.json() as { downloadTokens?: string };
    const token = data.downloadTokens;
    if (!token) return null;
    const path = encodeURIComponent(objectName);
    return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${path}?alt=media&token=${token}`;
  } catch (err) {
    console.error("[upload-pdf] Exception:", err);
    return null;
  }
}

async function saveDraftPO(id: string, parsed: Record<string, unknown>, pdfUrl?: string): Promise<boolean> {
  try {
    const db = await getFirebase();
    if (!db) return false;
    const { doc, setDoc } = await import("firebase/firestore/lite");
    const now = new Date().toISOString();
    const totals = parsed.totals as Record<string, unknown> | undefined;
    const po: PurchaseOrder = {
      id,
      supplier: (parsed.supplier as string) || "",
      invoiceNumber: (parsed.invoiceNumber as string) || "",
      invoiceDate: (parsed.invoiceDate as string) || "",
      currency: (parsed.currency as string) || "AUD",
      taxVatNumber: (parsed.taxVatNumber as string) || "",
      orderNumber: (parsed.orderNumber as string) || "",
      location: "In-Store Fitzgerald St",
      paymentTerms: (parsed.paymentTerms as string) || "",
      invoiceTotals: totals ? {
        subtotal: Number(totals.subtotal) || 0,
        taxTotal: Number(totals.taxTotal) || 0,
        freightShipping: Number(totals.freightShipping) || 0,
        insurance: Number(totals.insurance) || 0,
        customsTariffs: Number(totals.customsTariffs) || 0,
        brokerageFees: Number(totals.brokerageFees) || 0,
        grandTotal: Number(totals.grandTotal) || 0,
      } : undefined,
      lineItems: ((parsed.lineItems as unknown[]) || []).map((li) => {
        const l = li as Record<string, unknown>;
        return {
          id: uuidv4(),
          name: (l.name as string) || "",
          sku: (l.sku as string) || "",
          barcode: (l.barcode as string) || "",
          optionValues: Array.isArray(l.optionValues)
            ? (l.optionValues as Record<string, unknown>[]).map((ov) => ({
                optionName: (ov.optionName as string) || "",
                optionValue: (ov.optionValue as string) || "",
              }))
            : [],
          category: (l.category as string) || "",
          qty: Number(l.qty) || 0,
          costPrice: Number(l.costPrice) || 0,
          retailPrice: Number(l.retailPrice) || 0,
          gstApplicable: (l.gstApplicable as boolean) ?? true,
          hidden: false,
        };
      }),
      shippingCost: totals ? Number(totals.freightShipping) || 0 : Number(parsed.shippingCost) || 0,
      status: "draft",
      ...(pdfUrl ? { pdfUrl } : {}),
      createdAt: now,
      updatedAt: now,
    };
    await setDoc(doc(db, "purchaseOrders", id), po);
    return true;
  } catch (err) {
    console.error("[parse-invoice] Firestore save failed:", err);
    return false;
  }
}

async function upsertSupplier(name: string): Promise<void> {
  if (!name) return;
  try {
    const db = await getFirebase();
    if (!db) return;
    const { doc, setDoc } = await import("firebase/firestore/lite");
    const key = name.toLowerCase().trim();
    await setDoc(
      doc(db, "suppliers", key),
      { name, lastSeen: new Date().toISOString() },
      { merge: true }
    );
  } catch {
    // non-critical
  }
}

export async function POST(req: NextRequest) {
  const enc = new TextEncoder();
  let ctrl: ReadableStreamDefaultController<Uint8Array> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(c) { ctrl = c; },
  });

  // Stream keepalive newlines so the proxy doesn't 504 while Anthropic processes
  const keepAlive = setInterval(() => {
    try { ctrl?.enqueue(enc.encode("\n")); } catch { /* stream closed */ }
  }, 5000);

  const send = (payload: Record<string, unknown>) => {
    clearInterval(keepAlive);
    try {
      ctrl?.enqueue(enc.encode(JSON.stringify(payload)));
      ctrl?.close();
    } catch { /* already closed */ }
  };

  // Run the real work asynchronously so we can return the stream immediately
  (async () => {
    try {
      const formData = await req.formData();
      const file = formData.get("file");

      if (!file || !(file instanceof File)) {
        return send({ error: "No file provided", __status: 400 });
      }
      if (file.type !== "application/pdf") {
        return send({ error: "Only PDF files are supported", __status: 400 });
      }

      const arrayBuffer = await file.arrayBuffer();
      const pdfBuffer = Buffer.from(arrayBuffer);
      const base64Data = pdfBuffer.toString("base64");

      const supplierHints = await getSupplierHints();

      const client = new Anthropic();
      const response = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: { type: "base64", media_type: "application/pdf", data: base64Data },
              },
              {
                type: "text",
                text: `Extract all purchase order information from this supplier invoice PDF. Return ONLY valid JSON with no markdown, no explanation, no code fences. Use this exact structure:

{
  "supplier": "",
  "invoiceNumber": "",
  "invoiceDate": "YYYY-MM-DD",
  "currency": "AUD",
  "taxVatNumber": "",
  "orderNumber": "",
  "paymentTerms": "",
  "totals": {
    "subtotal": 0,
    "taxTotal": 0,
    "freightShipping": 0,
    "insurance": 0,
    "customsTariffs": 0,
    "brokerageFees": 0,
    "grandTotal": 0
  },
  "lineItems": [
    {
      "name": "",
      "sku": "",
      "barcode": "",
      "optionValues": [{ "optionName": "", "optionValue": "" }],
      "category": "",
      "qty": 0,
      "costPrice": 0,
      "retailPrice": 0,
      "gstApplicable": true
    }
  ]
}

--- SUPPLIER / HEADER ---
- supplier: the company ISSUING the invoice (the buyer is never the supplier)
- invoiceNumber: the invoice number/ID field — NOT a "Ref", "Customer PO", or "Order No" field
- invoiceDate: YYYY-MM-DD
- currency: ISO 4217 code (AUD, USD, EUR, GBP, NZD, CAD, JPY…). Default "AUD" if supplier appears Australian and currency not stated
- taxVatNumber: ABN, GST registration, VAT number, or tax ID shown on the invoice. Empty string if absent
- orderNumber: the buyer's PO or order reference. Leave empty if value is generic ("Stock", "N/A", "None", "General")
- paymentTerms: payment terms stated on invoice (e.g. "30 days EOM", "45NET")

--- TOTALS (extract from invoice footer/summary) ---
- totals.subtotal: total of all goods before tax and before shipping/freight
- totals.taxTotal: total GST / VAT / sales tax amount charged
- totals.freightShipping: freight, shipping, or delivery charge. 0 if not present
- totals.insurance: cargo or shipment insurance fee. 0 if not present
- totals.customsTariffs: customs duties or import tariffs. 0 if not present
- totals.brokerageFees: customs brokerage or handling fees. 0 if not present
- totals.grandTotal: the final total payable on the invoice (all charges included)
- Do NOT include freight/shipping as a line item — it goes into totals.freightShipping only

--- QUANTITY — use the DELIVERED quantity, not the ordered quantity ---
- Column priority: "Ship Qty" > "Supply Qty" > "Shipped" > "Qty" > "Order Qty"
- Always use the column that reflects what was actually dispatched

--- COST PRICE — final unit price paid, ex-GST, after any discounts ---
- Column priority: "Net Price Excl. GST" > "Unit Price ex GST" > "Amount ex GST / Qty" > "Unit Price"
- If the invoice shows a "Discount" column alongside "Unit Price": costPrice = line Subtotal / Qty
- NEVER use "List Price", "RRP", or pre-discount price as costPrice when a net/discounted price exists

--- RETAIL PRICE — extract recommended shelf price if shown ---
- "List Price" column (BikeCorp style) → retailPrice (value as-is, ex-GST)
- "RRP inc GST" column (PSI Cycling style) → retailPrice (store as-is, GST-inclusive)
- No RRP/retail column → retailPrice = 0

--- SKU (supplier product code) ---
- Use the supplier's product/item code: "Item Code", "Part Style No.", "Item #", "Code", "Article", "Style"
- This is the SUPPLIER's code, not a barcode/EAN

--- BARCODE ---
- barcode: EAN-13, UPC-A, or ISBN if shown in a SEPARATE barcode/EAN column alongside the product code
- If only one identifier column exists (no separate barcode column), use it as sku and leave barcode empty
- Never duplicate the sku value into barcode

--- ITEM NAME AND OPTIONS (CRITICAL — Shopify requires structured variant data) ---
- name: the BASE product name ONLY — no size, colour, or variant information in this field
- optionValues: extract all variant attributes as a structured array
  Examples:
  · "Trek FX 3 Disc - Large - Matte Black" → name: "Trek FX 3 Disc", optionValues: [{"optionName":"Size","optionValue":"Large"},{"optionName":"Colour","optionValue":"Matte Black"}]
  · Invoice row has separate "Size" and "Colour" columns → extract directly into optionValues
  · "SMILEY 3.0 ACE LED blue S" → name: "SMILEY 3.0 ACE LED", optionValues: [{"optionName":"Colour","optionValue":"Blue"},{"optionName":"Size","optionValue":"S"}]
- If the product genuinely has no variants (e.g. a single cable, a tool): optionValues: []
- If description repeats itself ("PRODUCT blue S PRODUCT blue S"), use only the first clean occurrence

--- CATEGORY ---
- Extract from department/category/product type column if present
- Infer from description using: Helmets, Apparel, Components, Accessories, Bikes, Footwear, Electronics, Tools, Nutrition
- Leave empty string if genuinely unclear

--- GST ---
- gstApplicable: true for all standard goods/services
- Set false ONLY if invoice explicitly marks item as GST-free (e.g. "*" with note)${supplierHints}`,
              },
            ],
          },
        ],
      });

      const textBlock = response.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        return send({ error: "No text response from AI", __status: 500 });
      }

      let raw = textBlock.text.trim();
      if (raw.startsWith("```")) {
        raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
      }

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return send({ error: "AI returned invalid JSON", raw, __status: 500 });
      }

      const poId = uuidv4();
      const pdfUrl = await uploadPdfToStorage(poId, pdfBuffer);
      const [saved] = await Promise.all([
        saveDraftPO(poId, parsed, pdfUrl ?? undefined),
        upsertSupplier(parsed.supplier as string),
      ]);

      send({ id: poId, savedToFirestore: saved, ...parsed });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("[parse-invoice] Fatal error:", message);
      send({ error: message, __status: 500 });
    }
  })();

  return new Response(stream, {
    headers: { "Content-Type": "application/json" },
  });
}
