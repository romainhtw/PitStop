import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { v4 as uuidv4 } from "uuid";
import { waitUntil } from "@vercel/functions";
import type { PurchaseOrder } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const ACCEPTED_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/jpg", "image/webp"] as const;
type AcceptedMime = (typeof ACCEPTED_TYPES)[number];

function extForMime(mime: string): string {
  if (mime === "application/pdf") return "pdf";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

async function getDb() {
  try {
    const { db } = await import("@/lib/firebase");
    return db;
  } catch {
    return null;
  }
}

async function uploadFileToStorage(poId: string, buffer: Buffer, mimeType: string): Promise<string | null> {
  try {
    const bucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
    if (!bucket) return null;
    const ext = extForMime(mimeType);
    const objectName = `purchase-orders/${poId}.${ext}`;
    const res = await fetch(
      `https://firebasestorage.googleapis.com/v0/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(objectName)}`,
      {
        method: "POST",
        headers: { "Content-Type": mimeType },
        body: buffer as unknown as BodyInit,
      }
    );
    if (!res.ok) return null;
    const data = await res.json() as { downloadTokens?: string };
    const token = data.downloadTokens;
    if (!token) return null;
    const path = encodeURIComponent(objectName);
    return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${path}?alt=media&token=${token}`;
  } catch {
    return null;
  }
}

async function getSupplierHints(): Promise<string> {
  try {
    const db = await getDb();
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

async function saveDraftPO(id: string, parsed: Record<string, unknown>, pdfUrl?: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Firestore unavailable");
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
    invoiceTotals: totals
      ? {
          subtotal: Number(totals.subtotal) || 0,
          taxTotal: Number(totals.taxTotal) || 0,
          freightShipping: Number(totals.freightShipping) || 0,
          insurance: Number(totals.insurance) || 0,
          customsTariffs: Number(totals.customsTariffs) || 0,
          brokerageFees: Number(totals.brokerageFees) || 0,
          grandTotal: Number(totals.grandTotal) || 0,
        }
      : undefined,
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
}

async function upsertSupplier(name: string): Promise<void> {
  if (!name) return;
  try {
    const db = await getDb();
    if (!db) return;
    const { doc, setDoc } = await import("firebase/firestore/lite");
    const key = name.toLowerCase().trim();
    await setDoc(doc(db, "suppliers", key), { name, lastSeen: new Date().toISOString() }, { merge: true });
  } catch {
    // non-critical
  }
}

async function updateJob(
  jobId: string,
  data: Record<string, unknown>
): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    const { doc, updateDoc } = await import("firebase/firestore/lite");
    await updateDoc(doc(db, "parseJobs", jobId), data);
  } catch {
    // best-effort
  }
}

async function processJob(
  jobId: string,
  poId: string,
  fileBuffer: Buffer,
  mimeType: string,
  pdfUrl: string | null
): Promise<void> {
  try {
    await updateJob(jobId, { status: "parsing" });

    const supplierHints = await getSupplierHints();
    const base64Data = fileBuffer.toString("base64");
    const isPdf = mimeType === "application/pdf";

    const fileContentBlock = isPdf
      ? ({ type: "document", source: { type: "base64", media_type: "application/pdf", data: base64Data } } as const)
      : ({ type: "image", source: { type: "base64", media_type: mimeType as "image/png" | "image/jpeg" | "image/webp", data: base64Data } } as const);

    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            fileContentBlock,
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
      throw new Error("No text response from AI");
    }

    let raw = textBlock.text.trim();
    if (raw.startsWith("```")) {
      raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("AI returned invalid JSON");
    }

    await updateJob(jobId, { status: "saving" });

    await Promise.all([
      saveDraftPO(poId, parsed, pdfUrl ?? undefined),
      upsertSupplier(parsed.supplier as string),
    ]);

    await updateJob(jobId, {
      status: "done",
      poId,
      completedAt: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[parse-invoice] Background job failed:", message);
    await updateJob(jobId, { status: "error", error: message });
  }
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    const mimeType = file.type as AcceptedMime;
    if (!ACCEPTED_TYPES.includes(mimeType)) {
      return NextResponse.json(
        { error: "Only PDF, PNG, JPEG, or WebP files are supported" },
        { status: 400 }
      );
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());

    const jobId = uuidv4();
    const poId = uuidv4();

    // Upload file to Firebase Storage immediately (fast, ~1s)
    const pdfUrl = await uploadFileToStorage(poId, fileBuffer, mimeType);

    // Create the job doc in Firestore so the polling page can read it
    const db = await getDb();
    if (db) {
      const { doc, setDoc } = await import("firebase/firestore/lite");
      await setDoc(doc(db, "parseJobs", jobId), {
        status: "queued",
        poId,
        pdfUrl: pdfUrl ?? null,
        createdAt: new Date().toISOString(),
      });
    }

    // Kick off background processing — response returns immediately
    waitUntil(processJob(jobId, poId, fileBuffer, mimeType, pdfUrl));

    return NextResponse.json({ jobId, poId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[parse-invoice] Setup failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
