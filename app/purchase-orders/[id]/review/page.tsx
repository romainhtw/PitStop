"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import BackButton from "@/components/BackButton";
import { v4 as uuidv4 } from "uuid";
import type { InvoiceTotals, LineItem, PurchaseOrder, SyncResult, VariantSuggestion } from "@/lib/types";

interface CreateFormFields {
  title: string;
  sku: string;
  barcode: string;
  price: string;
  productType: string;
}

function confidenceTier(score?: number): { label: string; className: string } {
  if (score === undefined) return { label: "Unknown", className: "text-gray-400 bg-gray-100" };
  if (score >= 80) return { label: "Strong", className: "text-emerald-700 bg-emerald-50" };
  if (score >= 60) return { label: "Possible", className: "text-amber-700 bg-amber-100" };
  return { label: "Weak", className: "text-gray-500 bg-gray-100" };
}

function ConfidenceBadge({ score }: { score?: number }) {
  const { label, className } = confidenceTier(score);
  return (
    <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${className}`}>
      {label}
    </span>
  );
}

function CreateProductForm({
  form,
  creating,
  onChange,
  onSubmit,
  onCancel,
}: {
  lineItemId: string;
  form: CreateFormFields;
  creating: boolean;
  onChange: (patch: Partial<CreateFormFields>) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const fieldCls = "w-full rounded border border-amber-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-green/40 focus:border-brand-green";
  return (
    <div className="mt-2 bg-white border border-amber-200 rounded-lg p-3 space-y-2">
      <p className="text-[10px] font-bold text-brand-green uppercase tracking-widest mb-1">New Shopify product</p>
      <div>
        <label className="text-[10px] text-gray-500 mb-0.5 block">Title *</label>
        <input className={fieldCls} value={form?.title ?? ""} onChange={(e) => onChange({ title: e.target.value })} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-gray-500 mb-0.5 block">SKU</label>
          <input className={fieldCls} value={form?.sku ?? ""} onChange={(e) => onChange({ sku: e.target.value })} />
        </div>
        <div>
          <label className="text-[10px] text-gray-500 mb-0.5 block">Barcode</label>
          <input className={fieldCls} value={form?.barcode ?? ""} onChange={(e) => onChange({ barcode: e.target.value })} />
        </div>
        <div>
          <label className="text-[10px] text-gray-500 mb-0.5 block">Retail Price ($)</label>
          <input type="number" step="0.01" min={0} className={fieldCls} value={form?.price ?? ""} onChange={(e) => onChange({ price: e.target.value })} />
        </div>
        <div>
          <label className="text-[10px] text-gray-500 mb-0.5 block">Product Type</label>
          <input className={fieldCls} value={form?.productType ?? ""} onChange={(e) => onChange({ productType: e.target.value })} />
        </div>
      </div>
      <div className="flex items-center justify-between pt-1">
        <button onClick={onCancel} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">Cancel</button>
        <button
          onClick={onSubmit}
          disabled={creating || !form?.title?.trim()}
          className="inline-flex items-center gap-1.5 bg-brand-green hover:bg-brand-green/90 disabled:opacity-50 text-white text-xs font-semibold px-3 py-1.5 rounded transition-colors"
        >
          {creating ? (
            <>
              <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
              </svg>
              Creating…
            </>
          ) : "Create & Match →"}
        </button>
      </div>
    </div>
  );
}

export default function ReviewPurchaseOrderPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [supplier, setSupplier] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [currency, setCurrency] = useState("AUD");
  const [taxVatNumber, setTaxVatNumber] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [location, setLocation] = useState<PurchaseOrder["location"]>("In-Store Fitzgerald St");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [shippingCost, setShippingCost] = useState(0);
  const [invoiceTotals, setInvoiceTotals] = useState<InvoiceTotals | undefined>(undefined);
  const [supplierNotes, setSupplierNotes] = useState("");
  const [notesOpen, setNotesOpen] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [markingOrdered, setMarkingOrdered] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [previewResult, setPreviewResult] = useState<SyncResult | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [poStatus, setPoStatus] = useState<PurchaseOrder["status"]>("draft");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  type ConfirmedMapping = { variantId: string; inventoryItemId: string; productTitle: string };
  const [confirmedMappings, setConfirmedMappings] = useState<Record<string, ConfirmedMapping>>({});

  const [manualSearchQueries, setManualSearchQueries] = useState<Record<string, string>>({});
  const [manualSearchResults, setManualSearchResults] = useState<Record<string, VariantSuggestion[]>>({});
  const [manualSearching, setManualSearching] = useState<Record<string, boolean>>({});
  const [showSearchFor, setShowSearchFor] = useState<Record<string, boolean>>({});
  const [showCreateFor, setShowCreateFor] = useState<Record<string, boolean>>({});
  const [createFormData, setCreateFormData] = useState<Record<string, { title: string; sku: string; barcode: string; price: string; productType: string }>>({});
  const [creating, setCreating] = useState<Record<string, boolean>>({});

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/purchase-orders/${id}`);
        if (!res.ok) throw new Error("Purchase order not found");
        const po = await res.json() as PurchaseOrder;

        setSupplier(po.supplier || "");
        setInvoiceNumber(po.invoiceNumber || "");
        setInvoiceDate(po.invoiceDate || "");
        setCurrency(po.currency || "AUD");
        setTaxVatNumber(po.taxVatNumber || "");
        setOrderNumber(po.orderNumber || "");
        setLocation(po.location || "In-Store Fitzgerald St");
        setPaymentTerms(po.paymentTerms || "");
        setShippingCost(Number(po.shippingCost) || 0);
        if (po.invoiceTotals) setInvoiceTotals(po.invoiceTotals);
        setLineItems(
          (po.lineItems || []).map((li) => ({
            id: li.id || uuidv4(),
            name: li.name || "",
            sku: li.sku || "",
            barcode: li.barcode || "",
            optionValues: li.optionValues || [],
            category: li.category || "",
            qty: Number(li.qty) || 0,
            costPrice: Number(li.costPrice) || 0,
            retailPrice: Number(li.retailPrice) || 0,
            gstApplicable: li.gstApplicable ?? true,
            hidden: li.hidden || false,
          }))
        );

        // Load supplier notes if available
        if (po.supplier) {
          const key = encodeURIComponent(po.supplier.toLowerCase().trim());
          const suppRes = await fetch(`/api/suppliers/${key}`);
          if (suppRes.ok) {
            const supp = await suppRes.json();
            if (supp.parseHints) {
              setSupplierNotes(supp.parseHints);
              setNotesOpen(true);
            }
            if (supp.defaultLocation && !po.location) {
              setLocation(supp.defaultLocation);
            }
          }
        }
        setPoStatus(po.status || "draft");
        if (po.pdfUrl) setPdfUrl(po.pdfUrl);
        if (po.syncResult) setSyncResult(po.syncResult);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load purchase order");
      } finally {
        setLoaded(true);
      }
    }
    load();
  }, [id]);

  const subtotal = useMemo(
    () => lineItems.reduce((s, li) => s + li.qty * li.costPrice, 0),
    [lineItems]
  );
  const gstableItemsTotal = useMemo(
    () =>
      lineItems
        .filter((li) => li.gstApplicable)
        .reduce((s, li) => s + li.qty * li.costPrice, 0),
    [lineItems]
  );
  const shipping = Number(shippingCost) || 0;
  // GST applies to GST-applicable goods + shipping (standard Australian treatment)
  const gst = (gstableItemsTotal + shipping) * 0.1;
  const total = subtotal + shipping + gst;

  const updateItem = (idx: number, patch: Partial<LineItem>) =>
    setLineItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const addRow = () =>
    setLineItems((prev) => [
      ...prev,
      { id: uuidv4(), name: "", sku: "", barcode: "", optionValues: [], category: "", qty: 1, costPrice: 0, retailPrice: 0, gstApplicable: true, hidden: false },
    ]);

  const handleMarkOrdered = async () => {
    setMarkingOrdered(true);
    setError(null);
    try {
      const res = await fetch(`/api/purchase-orders/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...buildPayload(), status: "ordered", orderedAt: new Date().toISOString() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update");
      setPoStatus("ordered");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setMarkingOrdered(false);
    }
  };

  const handleManualSearch = async (lineItemId: string) => {
    const q = manualSearchQueries[lineItemId]?.trim();
    if (!q) return;
    setManualSearching((prev) => ({ ...prev, [lineItemId]: true }));
    try {
      const res = await fetch(`/api/shopify/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setManualSearchResults((prev) => ({ ...prev, [lineItemId]: data.variants ?? [] }));
    } finally {
      setManualSearching((prev) => ({ ...prev, [lineItemId]: false }));
    }
  };

  function openCreateForm(lineItemId: string, name: string, sku: string, retailPrice: number, category: string) {
    setCreateFormData((prev) => ({
      ...prev,
      [lineItemId]: {
        title: name,
        sku: sku || "",
        barcode: "",
        price: retailPrice > 0 ? retailPrice.toFixed(2) : "",
        productType: category || "",
      },
    }));
    setShowCreateFor((prev) => ({ ...prev, [lineItemId]: true }));
  }

  async function handleCreateProduct(lineItemId: string) {
    const form = createFormData[lineItemId];
    if (!form?.title?.trim()) return;
    setCreating((prev) => ({ ...prev, [lineItemId]: true }));
    try {
      const res = await fetch("/api/shopify/create-product", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Creation failed");
      setConfirmedMappings((prev) => ({
        ...prev,
        [lineItemId]: {
          variantId: data.variantId,
          inventoryItemId: data.inventoryItemId,
          productTitle: data.productTitle,
        },
      }));
      setShowCreateFor((prev) => ({ ...prev, [lineItemId]: false }));
      setShowSearchFor((prev) => ({ ...prev, [lineItemId]: false }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Creation failed");
    } finally {
      setCreating((prev) => ({ ...prev, [lineItemId]: false }));
    }
  }

  const removeRow = (idx: number) =>
    setLineItems((prev) => prev.filter((_, i) => i !== idx));

  function buildPayload() {
    return { supplier, invoiceNumber, invoiceDate, currency, taxVatNumber, orderNumber, location, paymentTerms, lineItems, shippingCost: Number(shippingCost) || 0, invoiceTotals };
  }

  async function saveSupplierNotes() {
    if (!supplier) return;
    const key = encodeURIComponent(supplier.toLowerCase().trim());
    await fetch(`/api/suppliers/${key}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: supplier, parseHints: supplierNotes, defaultLocation: location }),
    });
  }

  async function putPO(status: PurchaseOrder["status"]) {
    const res = await fetch(`/api/purchase-orders/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...buildPayload(), status }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to save purchase order");
    return data as PurchaseOrder;
  }

  const handleSave = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await Promise.all([putPO("awaiting_review"), saveSupplierNotes()]);
      router.push("/dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setSubmitting(false);
    }
  };

  const handlePreview = async () => {
    setPreviewing(true);
    setError(null);
    try {
      await Promise.all([putPO("awaiting_review"), saveSupplierNotes()]);
      const res = await fetch("/api/shopify/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ poId: id, dryRun: true, overrides: confirmedMappings }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Preview failed");
      const result = data as SyncResult;
      setPreviewResult(result);

      // Auto-fill retailPrice and category from Shopify for matched items
      setLineItems((prev) =>
        prev.map((li) => {
          const match = result.results.find(
            (r) => r.lineItemId === li.id && r.status === "synced"
          );
          if (!match) return li;
          return {
            ...li,
            ...(li.retailPrice === 0 && match.shopifyPrice != null ? { retailPrice: match.shopifyPrice } : {}),
            ...(li.category === "" && match.shopifyCategory ? { category: match.shopifyCategory } : {}),
          };
        })
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setPreviewing(false);
    }
  };

  const handleConfirmSync = async () => {
    setSyncing(true);
    setError(null);
    try {
      const syncRes = await fetch("/api/shopify/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ poId: id, overrides: confirmedMappings }),
      });
      const syncData = await syncRes.json();
      if (!syncRes.ok) throw new Error(syncData.error || "Shopify sync failed");
      setPreviewResult(null);
      setSyncResult(syncData as SyncResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSyncing(false);
    }
  };

  const inputCls = "w-full rounded border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green/40 focus:border-brand-green";
  const cellCls = "w-full rounded border border-gray-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-green/40 focus:border-brand-green";
  const isBusy = submitting || syncing || previewing;

  if (!loaded) {
    return (
      <div className="p-10 flex items-center gap-3 text-gray-400">
        <div className="w-5 h-5 border-2 border-gray-200 border-t-brand-green rounded-full animate-spin" />
        Loading purchase order…
      </div>
    );
  }

  if (error && !loaded) {
    return <div className="p-10 text-red-600">{error}</div>;
  }

  return (
    <div className="p-10 max-w-6xl">
      <div className="mb-4"><BackButton /></div>
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="font-display text-4xl leading-none tracking-wide text-brand-green mb-1">Review Purchase Order</h1>
          <p className="text-gray-500 text-sm">
            Check the extracted details, fix anything incorrect, then save or sync directly to Shopify.
          </p>
        </div>
        {/* Always-visible actions */}
        <div className="flex items-center gap-3 shrink-0">
          {pdfUrl && (
            <a
              href={pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-brand-green border border-gray-200 hover:border-brand-green px-3 py-2 rounded transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
              View PDF
            </a>
          )}
          {poStatus !== "approved" && (
            <button
              onClick={handleMarkOrdered}
              disabled={markingOrdered || poStatus === "ordered"}
              className={`inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded border transition-colors disabled:opacity-60 ${
                poStatus === "ordered"
                  ? "border-blue-300 text-blue-700 bg-blue-50 cursor-default"
                  : "border-gray-300 text-gray-600 hover:border-brand-green hover:text-brand-green"
              }`}
            >
              {poStatus === "ordered" ? "✓ Ordered" : markingOrdered ? "Marking…" : "Mark as Ordered"}
            </button>
          )}
        </div>
      </div>

      {/* Header */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <h2 className="text-xs font-semibold text-gray-400 mb-4 uppercase tracking-wide">Header</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-gray-600 mb-1 block">Supplier</label>
            <input className={inputCls} value={supplier} onChange={(e) => setSupplier(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-gray-600 mb-1 block">Invoice #</label>
            <input className={inputCls} value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-gray-600 mb-1 block">Invoice Date</label>
            <input type="date" className={inputCls} value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-gray-600 mb-1 block">Order #</label>
            <input className={inputCls} value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-gray-600 mb-1 block">Location</label>
            <select className={inputCls} value={location} onChange={(e) => setLocation(e.target.value as PurchaseOrder["location"])}>
              <option value="In-Store Fitzgerald St">In-Store Fitzgerald St</option>
              <option value="Warehouse">Warehouse</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-600 mb-1 block">Payment Terms</label>
            <input className={inputCls} value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-gray-600 mb-1 block">
              Currency
              <span className="ml-1 text-gray-400 font-normal">(ISO 4217)</span>
            </label>
            <input className={inputCls} value={currency} maxLength={3} placeholder="AUD" onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
          </div>
          <div>
            <label className="text-xs text-gray-600 mb-1 block">
              Tax / VAT Number
              <span className="ml-1 text-gray-400 font-normal">(ABN, GST reg…)</span>
            </label>
            <input className={inputCls} value={taxVatNumber} placeholder="e.g. ABN 12 345 678 901" onChange={(e) => setTaxVatNumber(e.target.value)} />
          </div>
        </div>
      </div>

      {/* Supplier Notes */}
      <div className="bg-white rounded-lg border border-gray-200 mb-6 overflow-hidden">
        <button
          onClick={() => setNotesOpen((o) => !o)}
          className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Supplier Notes</span>
            {supplierNotes && (
              <span className="text-xs bg-brand-sage text-brand-green px-2 py-0.5 rounded-full font-medium">saved</span>
            )}
          </div>
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform ${notesOpen ? "rotate-180" : ""}`}
            viewBox="0 0 20 20" fill="currentColor"
          >
            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
        {notesOpen && (
          <div className="px-6 pb-5">
            <p className="text-xs text-gray-500 mb-2">
              Notes about this supplier&apos;s invoices — saved and injected into every future parse from this supplier.
            </p>
            <textarea
              rows={3}
              placeholder={`e.g. "Use Sales amount column for cost price (38% trade discount). SKU is labelled 'Item number'."`}
              className="w-full rounded border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green/40 focus:border-brand-green resize-none"
              value={supplierNotes}
              onChange={(e) => setSupplierNotes(e.target.value)}
            />
          </div>
        )}
      </div>

      {/* Line Items */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Line Items</h2>
            {lineItems.filter((li) => li.hidden).length > 0 && (
              <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded font-medium">
                {lineItems.filter((li) => li.hidden).length} hidden — won&apos;t sync
              </span>
            )}
          </div>
          <button
            onClick={addRow}
            className="inline-flex items-center gap-1.5 bg-brand-sage hover:bg-brand-sage/80 text-brand-green text-sm font-medium px-3 py-1.5 rounded transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 4a1 1 0 011 1v4h4a1 1 0 110 2h-4v4a1 1 0 11-2 0v-4H5a1 1 0 110-2h4V5a1 1 0 011-1z" clipRule="evenodd" />
            </svg>
            Add Row
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] text-gray-400 uppercase tracking-widest border-b border-gray-100">
                <th className="py-2 pr-2">Item Name</th>
                <th className="py-2 pr-2">SKU · Barcode</th>
                <th className="py-2 pr-2 w-32">Category</th>
                <th className="py-2 pr-2 w-20">Qty</th>
                <th className="py-2 pr-2 w-28">Cost Price</th>
                <th className="py-2 pr-2 w-28">Retail Price</th>
                <th className="py-2 pr-2 w-16 text-center">GST</th>
                <th className="py-2 w-16" />
              </tr>
            </thead>
            <tbody>
              {lineItems.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-gray-400 text-sm">
                    No items yet — click &ldquo;Add Row&rdquo; to start.
                  </td>
                </tr>
              ) : (
                lineItems.map((li, idx) => (
                  <tr key={li.id} className={`border-b border-gray-50 transition-opacity ${li.hidden ? "opacity-40" : ""}`}>
                    {/* Name + option chips */}
                    <td className="py-1.5 pr-2">
                      <input
                        className={`${cellCls} ${li.hidden ? "line-through text-gray-400" : ""}`}
                        value={li.name}
                        onChange={(e) => updateItem(idx, { name: e.target.value })}
                      />
                      {li.optionValues && li.optionValues.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {li.optionValues.map((ov, ovIdx) => (
                            <span key={ovIdx} className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded font-mono leading-none">
                              {ov.optionName}: {ov.optionValue}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    {/* SKU (supplier code) + Barcode (EAN) stacked */}
                    <td className="py-1.5 pr-2">
                      <input
                        className={cellCls}
                        value={li.sku}
                        placeholder="Supplier SKU"
                        onChange={(e) => updateItem(idx, { sku: e.target.value })}
                      />
                      <input
                        className={`${cellCls} mt-1 text-[11px] text-gray-500`}
                        value={li.barcode || ""}
                        placeholder="Barcode / EAN"
                        onChange={(e) => updateItem(idx, { barcode: e.target.value })}
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <input
                        list="category-options"
                        className={cellCls}
                        value={li.category}
                        placeholder="e.g. Helmets"
                        onChange={(e) => updateItem(idx, { category: e.target.value })}
                      />
                    </td>
                    <td className="py-1.5 pr-2"><input type="number" min={0} className={cellCls} value={li.qty} onChange={(e) => updateItem(idx, { qty: Number(e.target.value) || 0 })} /></td>
                    <td className="py-1.5 pr-2"><input type="number" step="0.01" min={0} className={cellCls} value={li.costPrice} onChange={(e) => updateItem(idx, { costPrice: Number(e.target.value) || 0 })} /></td>
                    <td className="py-1.5 pr-2"><input type="number" step="0.01" min={0} className={cellCls} value={li.retailPrice} onChange={(e) => updateItem(idx, { retailPrice: Number(e.target.value) || 0 })} /></td>
                    <td className="py-1.5 pr-2 text-center"><input type="checkbox" checked={li.gstApplicable} onChange={(e) => updateItem(idx, { gstApplicable: e.target.checked })} className="w-4 h-4 accent-brand-green" /></td>
                    {/* Hide + Delete */}
                    <td className="py-1.5">
                      <div className="flex items-center gap-0.5 justify-center">
                        <button
                          onClick={() => updateItem(idx, { hidden: !li.hidden })}
                          title={li.hidden ? "Show — will sync to Shopify" : "Hide — won't sync to Shopify"}
                          className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${li.hidden ? "text-amber-500 hover:text-brand-green bg-amber-50" : "text-gray-300 hover:text-gray-500"}`}
                          aria-label={li.hidden ? "Show item" : "Hide item"}
                        >
                          {li.hidden ? (
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                            </svg>
                          ) : (
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                          )}
                        </button>
                        <button
                          onClick={() => removeRow(idx)}
                          className="w-7 h-7 flex items-center justify-center text-gray-300 hover:text-red-500 text-xl leading-none rounded transition-colors"
                          aria-label="Remove row"
                        >&times;</button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <datalist id="category-options">
        <option value="Helmets" />
        <option value="Components" />
        <option value="Apparel" />
        <option value="Accessories" />
        <option value="Bikes" />
        <option value="Footwear" />
        <option value="Electronics" />
        <option value="Tools" />
        <option value="Nutrition" />
      </datalist>

      {/* Totals */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <div className="flex justify-end">
          <div className="w-80 space-y-2 text-sm">
            <div className="flex justify-between text-gray-600">
              <span>Subtotal (ex GST)</span>
              <span>${subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>GST (10%)</span>
              <span>${gst.toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center text-gray-600">
              <span>Shipping</span>
              <input
                type="number" step="0.01" min={0} value={shippingCost}
                onChange={(e) => setShippingCost(Number(e.target.value) || 0)}
                className="w-28 rounded border border-gray-200 px-2 py-1 text-right text-sm focus:outline-none focus:ring-1 focus:ring-brand-green/40 focus:border-brand-green"
              />
            </div>
            <div className="flex justify-between text-base font-semibold text-brand-green border-t border-gray-100 pt-2">
              <span>Total (calculated)</span>
              <span>${total.toFixed(2)}</span>
            </div>
            {invoiceTotals?.grandTotal && invoiceTotals.grandTotal > 0 && (() => {
              const diff = Math.abs(total - invoiceTotals.grandTotal);
              const isMatch = diff < 1;
              return (
                <div className={`flex justify-between text-sm pt-1 ${isMatch ? "text-emerald-600" : "text-amber-600"}`}>
                  <span className="flex items-center gap-1">
                    {isMatch ? "✓" : "⚠"} Invoice total ({currency})
                  </span>
                  <span className="font-medium">
                    ${invoiceTotals.grandTotal.toFixed(2)}
                    {!isMatch && <span className="ml-1 text-xs">(Δ ${diff.toFixed(2)})</span>}
                  </span>
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-5 p-4 rounded bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>
      )}

      {/* Action Buttons */}
      {!syncResult && !previewResult && (
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={handleSave}
            disabled={isBusy}
            className="border border-brand-green text-brand-green hover:bg-brand-sage/30 disabled:opacity-50 text-sm font-medium px-5 py-2.5 rounded transition-colors"
          >
            {submitting ? "Saving…" : "Save"}
          </button>
          {poStatus === "approved" ? (
            <span className="inline-flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-medium px-6 py-2.5 rounded">
              ✅ Synced to Shopify
            </span>
          ) : (
            <button
              onClick={handlePreview}
              disabled={isBusy}
              className="inline-flex items-center gap-2 bg-brand-green hover:bg-brand-green/90 disabled:opacity-50 text-white text-sm font-medium px-6 py-2.5 rounded transition-colors"
            >
              {previewing ? (
                <>
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
                  </svg>
                  Checking Shopify…
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                    <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
                  </svg>
                  Preview Shopify Sync
                </>
              )}
            </button>
          )}
        </div>
      )}

      {/* Dry-run Preview Panel */}
      {previewResult && !syncResult && (
        <div className="mt-2">
          <div className="mb-4 p-4 rounded-lg bg-amber-50 border border-amber-200">
            <p className="text-sm font-semibold text-amber-800 mb-1">Preview only — nothing has been written to Shopify yet</p>
            <p className="text-xs text-amber-700">Review the matches below. Confirm any suggested items, then click Confirm to apply the changes.</p>
          </div>
          {/* Stats */}
          {(() => {
            const confirmedCount = Object.keys(confirmedMappings).length;
            const resolvedNotFound = previewResult.results.filter(
              (r) => r.status === "not_found" && confirmedMappings[r.lineItemId]
            ).length;
            const remainingNotFound = previewResult.notFoundCount - resolvedNotFound;
            const willSync = previewResult.successCount + resolvedNotFound;
            return (
              <div className="flex items-center gap-4 mb-4 flex-wrap">
                {willSync > 0 && (
                  <div className="flex items-center gap-2 text-sm font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-4 py-2 rounded-lg">
                    ✅ {willSync} will be updated
                  </div>
                )}
                {remainingNotFound > 0 && (
                  <div className="flex items-center gap-2 text-sm font-medium text-amber-700 bg-amber-50 border border-amber-200 px-4 py-2 rounded-lg">
                    ⚠️ {remainingNotFound} not found in Shopify
                  </div>
                )}
                {confirmedCount > 0 && (
                  <div className="flex items-center gap-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 px-4 py-2 rounded-lg">
                    🔗 {confirmedCount} manually matched
                  </div>
                )}
              </div>
            );
          })()}
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden mb-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left bg-white border-b border-gray-200">
                  <th className="px-4 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-widest">Item</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-widest">SKU</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-widest">Shopify Product</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-widest">In Stock</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-widest">Qty to Add</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-widest">Status</th>
                </tr>
              </thead>
              <tbody>
                {previewResult.results.map((r) => {
                  const confirmed = confirmedMappings[r.lineItemId];
                  const isConfirmed = r.status === "not_found" && !!confirmed;
                  const lineItem = lineItems.find((li) => li.id === r.lineItemId);
                  return (
                    <Fragment key={r.lineItemId}>
                      {/* ── NOT FOUND with suggestions: inline side-by-side layout ── */}
                      {r.status === "not_found" && !isConfirmed && r.suggestions && r.suggestions.length > 0 ? (
                        <tr className="border-b border-amber-100">
                          {/* Left: invoice product */}
                          <td colSpan={2} className="px-4 py-3 align-top border-r border-amber-100 bg-amber-50/30 w-64">
                            <p className="text-[10px] font-bold text-amber-600 uppercase tracking-widest mb-1">From invoice</p>
                            <p className="text-sm font-semibold text-gray-800 leading-tight">{r.name}</p>
                            <p className="text-xs text-gray-400 font-mono mt-0.5">{r.sku || "No SKU"}</p>
                          </td>
                          {/* Right: suggestions or manual search */}
                          <td colSpan={3} className="px-4 py-3 align-top bg-amber-50/10">
                            {!showSearchFor[r.lineItemId] ? (
                              <>
                                <p className="text-[10px] font-bold text-amber-600 uppercase tracking-widest mb-2">Select Shopify match</p>
                                <div className="flex flex-col gap-1.5">
                                  {(r.suggestions as VariantSuggestion[]).map((s) => (
                                    <button
                                      key={s.variantId}
                                      onClick={() =>
                                        setConfirmedMappings((prev) => ({
                                          ...prev,
                                          [r.lineItemId]: {
                                            variantId: s.variantId,
                                            inventoryItemId: s.inventoryItemId,
                                            productTitle: s.productTitle,
                                          },
                                        }))
                                      }
                                      className="w-full flex items-center justify-between gap-3 bg-white hover:bg-brand-sage/30 rounded-lg px-3 py-2.5 border border-amber-200 hover:border-brand-green transition-all text-left group"
                                    >
                                      <div className="min-w-0 flex-1">
                                        <p className="text-sm font-semibold text-gray-800 group-hover:text-brand-green transition-colors truncate">{s.productTitle}</p>
                                        {(s.sku || s.barcode) && (
                                          <p className="text-xs text-gray-400 mt-0.5">
                                            {s.sku && `SKU: ${s.sku}`}
                                            {s.sku && s.barcode && " · "}
                                            {s.barcode && `Barcode: ${s.barcode}`}
                                          </p>
                                        )}
                                      </div>
                                      <ConfidenceBadge score={s.score} />
                                      <span className="shrink-0 bg-brand-green group-hover:bg-brand-green/90 text-white text-xs font-bold px-3 py-1.5 rounded transition-colors whitespace-nowrap">
                                        Match →
                                      </span>
                                    </button>
                                  ))}
                                </div>
                                <button
                                  onClick={() => setShowSearchFor((prev) => ({ ...prev, [r.lineItemId]: true }))}
                                  className="mt-2.5 text-xs text-gray-400 hover:text-brand-green underline transition-colors"
                                >
                                  Not the right match? Search instead
                                </button>
                              </>
                            ) : (
                              <>
                                <div className="flex items-center justify-between mb-2">
                                  <p className="text-[10px] font-bold text-amber-600 uppercase tracking-widest">Search Shopify</p>
                                  <button
                                    onClick={() => setShowSearchFor((prev) => ({ ...prev, [r.lineItemId]: false }))}
                                    className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                                  >
                                    ← Back to suggestions
                                  </button>
                                </div>
                                <div className="flex gap-2 mb-2">
                                  <input
                                    type="text"
                                    placeholder="Search by product name…"
                                    value={manualSearchQueries[r.lineItemId] ?? ""}
                                    onChange={(e) => setManualSearchQueries((prev) => ({ ...prev, [r.lineItemId]: e.target.value }))}
                                    onKeyDown={(e) => e.key === "Enter" && handleManualSearch(r.lineItemId)}
                                    className="flex-1 rounded border border-amber-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-green/40 focus:border-brand-green"
                                  />
                                  <button
                                    onClick={() => handleManualSearch(r.lineItemId)}
                                    disabled={manualSearching[r.lineItemId]}
                                    className="inline-flex items-center gap-1 bg-brand-green hover:bg-brand-green/90 disabled:opacity-50 text-white text-xs font-semibold px-3 py-1.5 rounded transition-colors whitespace-nowrap"
                                  >
                                    {manualSearching[r.lineItemId] ? (
                                      <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
                                      </svg>
                                    ) : "Search"}
                                  </button>
                                </div>
                                {manualSearchResults[r.lineItemId] !== undefined && (
                                  <>
                                    {manualSearchResults[r.lineItemId].length === 0 ? (
                                      <p className="text-xs text-amber-700 italic mb-2">No results — try a different term.</p>
                                    ) : (
                                      <div className="flex flex-col gap-1.5 mb-2">
                                        {manualSearchResults[r.lineItemId].map((s) => (
                                          <button
                                            key={s.variantId}
                                            onClick={() => setConfirmedMappings((prev) => ({ ...prev, [r.lineItemId]: { variantId: s.variantId, inventoryItemId: s.inventoryItemId, productTitle: s.productTitle } }))}
                                            className="w-full flex items-center justify-between gap-3 bg-white hover:bg-brand-sage/30 rounded-lg px-3 py-2.5 border border-amber-200 hover:border-brand-green transition-all text-left group"
                                          >
                                            <div className="min-w-0 flex-1">
                                              <p className="text-sm font-semibold text-gray-800 group-hover:text-brand-green transition-colors truncate">{s.productTitle}</p>
                                              {(s.sku || s.barcode) && (
                                                <p className="text-xs text-gray-400 mt-0.5">
                                                  {s.sku && `SKU: ${s.sku}`}{s.sku && s.barcode && " · "}{s.barcode && `Barcode: ${s.barcode}`}
                                                </p>
                                              )}
                                            </div>
                                            <ConfidenceBadge score={s.score} />
                                            <span className="shrink-0 bg-brand-green group-hover:bg-brand-green/90 text-white text-xs font-bold px-3 py-1.5 rounded transition-colors whitespace-nowrap">Match →</span>
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                    {!showCreateFor[r.lineItemId] ? (
                                      <button
                                        onClick={() => openCreateForm(r.lineItemId, r.name, r.sku || "", lineItem?.retailPrice ?? 0, lineItem?.category ?? "")}
                                        className="inline-flex items-center gap-1 text-xs text-brand-green hover:underline font-medium"
                                      >
                                        + Create new product in Shopify
                                      </button>
                                    ) : (
                                      <CreateProductForm
                                        lineItemId={r.lineItemId}
                                        form={createFormData[r.lineItemId]}
                                        creating={!!creating[r.lineItemId]}
                                        onChange={(patch) => setCreateFormData((prev) => ({ ...prev, [r.lineItemId]: { ...prev[r.lineItemId], ...patch } }))}
                                        onSubmit={() => handleCreateProduct(r.lineItemId)}
                                        onCancel={() => setShowCreateFor((prev) => ({ ...prev, [r.lineItemId]: false }))}
                                      />
                                    )}
                                  </>
                                )}
                              </>
                            )}
                          </td>
                          {/* Status */}
                          <td className="px-4 py-3 align-top text-right">
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 px-2 py-1 rounded-full">⚠️ Not found</span>
                          </td>
                        </tr>
                      ) : (
                        /* ── All other rows: standard layout ── */
                        <tr className={`border-b border-gray-50 ${isConfirmed ? "bg-emerald-50/30" : ""}`}>
                          <td className="px-4 py-3 text-gray-700">{r.name}</td>
                          <td className="px-4 py-3 text-gray-500 font-mono text-xs">{r.sku || "—"}</td>
                          <td className="px-4 py-3 text-gray-600">
                            {isConfirmed ? confirmed.productTitle : (r.shopifyProductTitle || "—")}
                          </td>
                          <td className="px-4 py-3 text-gray-500">
                            {r.currentQty != null ? (
                              <span className={r.currentQty <= 0 ? "text-red-500 font-medium" : r.currentQty <= 3 ? "text-amber-600 font-medium" : "text-gray-600"}>
                                {r.currentQty}
                              </span>
                            ) : "—"}
                          </td>
                          <td className="px-4 py-3 text-gray-700">
                            {isConfirmed
                              ? `+${lineItem?.qty ?? r.delta ?? "?"}`
                              : r.delta != null ? `+${r.delta}` : "—"}
                          </td>
                          <td className="px-4 py-3">
                            {(r.status === "synced" || isConfirmed) && (
                              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-1 rounded-full" title={r.matchedFromCache ? "Matched from saved mapping" : undefined}>
                                ✅ {isConfirmed ? "Will sync (matched)" : r.matchedFromCache ? "Will sync · cached" : "Will sync"}
                              </span>
                            )}
                            {r.status === "not_found" && !isConfirmed && (
                              <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 px-2 py-1 rounded-full">⚠️ Not found</span>
                            )}
                            {r.status === "error" && (
                              <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-50 px-2 py-1 rounded-full">❌ Error</span>
                            )}
                          </td>
                        </tr>
                      )}
                      {/* Missing field hint for synced items */}
                      {r.status === "synced" && r.shopifyMissingFields && r.shopifyMissingFields.length > 0 && (
                        <tr className="border-b border-gray-50 bg-blue-50/40">
                          <td colSpan={6} className="px-4 py-2">
                            <p className="text-xs text-blue-700">
                              💡 Matched but Shopify product is missing:{" "}
                              {r.shopifyMissingFields.map((f, i) => (
                                <span key={f.field}>
                                  {i > 0 && ", "}
                                  <strong>{f.field}</strong> (suggested value: <code className="bg-blue-100 px-1 rounded">{f.suggestedValue}</code>)
                                </span>
                              ))}
                              {" "}— add it in Shopify for faster matching next time.
                            </p>
                          </td>
                        </tr>
                      )}
                      {/* No suggestions: manual search */}
                      {r.status === "not_found" && !isConfirmed && (!r.suggestions || r.suggestions.length === 0) && (
                        <tr className="border-b border-amber-100">
                          <td colSpan={2} className="px-4 py-3 align-top border-r border-amber-100 bg-amber-50/30 w-64">
                            <p className="text-[10px] font-bold text-amber-600 uppercase tracking-widest mb-1">From invoice</p>
                            <p className="text-sm font-semibold text-gray-800 leading-tight">{r.name}</p>
                            <p className="text-xs text-gray-400 font-mono mt-0.5">{r.sku || "No SKU"}</p>
                          </td>
                          <td colSpan={3} className="px-4 py-3 align-top bg-amber-50/10">
                            <p className="text-[10px] font-bold text-amber-600 uppercase tracking-widest mb-2">Search Shopify manually</p>
                            <div className="flex gap-2 mb-2">
                              <input
                                type="text"
                                placeholder="Search by product name…"
                                value={manualSearchQueries[r.lineItemId] ?? ""}
                                onChange={(e) => setManualSearchQueries((prev) => ({ ...prev, [r.lineItemId]: e.target.value }))}
                                onKeyDown={(e) => e.key === "Enter" && handleManualSearch(r.lineItemId)}
                                className="flex-1 rounded border border-amber-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-green/40 focus:border-brand-green"
                              />
                              <button
                                onClick={() => handleManualSearch(r.lineItemId)}
                                disabled={manualSearching[r.lineItemId]}
                                className="inline-flex items-center gap-1 bg-brand-green hover:bg-brand-green/90 disabled:opacity-50 text-white text-xs font-semibold px-3 py-1.5 rounded transition-colors whitespace-nowrap"
                              >
                                {manualSearching[r.lineItemId] ? (
                                  <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
                                  </svg>
                                ) : "Search"}
                              </button>
                            </div>
                            {manualSearchResults[r.lineItemId] !== undefined && (
                              <>
                                {manualSearchResults[r.lineItemId].length === 0 ? (
                                  <p className="text-xs text-amber-700 italic mb-2">No results — try a different term.</p>
                                ) : (
                                  <div className="flex flex-col gap-1.5 mb-2">
                                    {manualSearchResults[r.lineItemId].map((s) => (
                                      <button
                                        key={s.variantId}
                                        onClick={() => setConfirmedMappings((prev) => ({ ...prev, [r.lineItemId]: { variantId: s.variantId, inventoryItemId: s.inventoryItemId, productTitle: s.productTitle } }))}
                                        className="w-full flex items-center justify-between gap-3 bg-white hover:bg-brand-sage/30 rounded-lg px-3 py-2.5 border border-amber-200 hover:border-brand-green transition-all text-left group"
                                      >
                                        <div className="min-w-0">
                                          <p className="text-sm font-semibold text-gray-800 group-hover:text-brand-green transition-colors truncate">{s.productTitle}</p>
                                          {(s.sku || s.barcode) && (
                                            <p className="text-xs text-gray-400 mt-0.5">
                                              {s.sku && `SKU: ${s.sku}`}{s.sku && s.barcode && " · "}{s.barcode && `Barcode: ${s.barcode}`}
                                            </p>
                                          )}
                                      </div>
                                      <span className="shrink-0 bg-brand-green group-hover:bg-brand-green/90 text-white text-xs font-bold px-3 py-1.5 rounded transition-colors whitespace-nowrap">Match →</span>
                                    </button>
                                  ))}
                                  </div>
                                )}
                                {!showCreateFor[r.lineItemId] ? (
                                  <button
                                    onClick={() => openCreateForm(r.lineItemId, r.name, r.sku || "", lineItem?.retailPrice ?? 0, lineItem?.category ?? "")}
                                    className="inline-flex items-center gap-1 text-xs text-brand-green hover:underline font-medium"
                                  >
                                    + Create new product in Shopify
                                  </button>
                                ) : (
                                  <CreateProductForm
                                    lineItemId={r.lineItemId}
                                    form={createFormData[r.lineItemId]}
                                    creating={!!creating[r.lineItemId]}
                                    onChange={(patch) => setCreateFormData((prev) => ({ ...prev, [r.lineItemId]: { ...prev[r.lineItemId], ...patch } }))}
                                    onSubmit={() => handleCreateProduct(r.lineItemId)}
                                    onCancel={() => setShowCreateFor((prev) => ({ ...prev, [r.lineItemId]: false }))}
                                  />
                                )}
                              </>
                            )}
                          </td>
                          <td className="px-4 py-3 align-top text-right">
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 px-2 py-1 rounded-full">⚠️ Not found</span>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-end gap-3">
            <button
              onClick={() => { setPreviewResult(null); setConfirmedMappings({}); }}
              disabled={syncing}
              className="border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50 text-sm font-medium px-5 py-2.5 rounded transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmSync}
              disabled={syncing || poStatus === "approved"}
              className="inline-flex items-center gap-2 bg-brand-green hover:bg-brand-green/90 disabled:opacity-50 text-white text-sm font-medium px-6 py-2.5 rounded transition-colors"
            >
              {syncing ? (
                <>
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
                  </svg>
                  Syncing…
                </>
              ) : poStatus === "approved" ? "Already synced" : "Confirm & Sync to Shopify"}
            </button>
          </div>
        </div>
      )}

      {/* Sync Results Panel */}
      {syncResult && (
        <div className="mt-2">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2 text-sm font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-4 py-2 rounded-lg">
                <span>✅</span>{syncResult.successCount} synced
              </div>
              {syncResult.notFoundCount > 0 && (
                <div className="flex items-center gap-2 text-sm font-medium text-amber-700 bg-amber-50 border border-amber-200 px-4 py-2 rounded-lg">
                  <span>⚠️</span>{syncResult.notFoundCount} not found
                </div>
              )}
              {syncResult.errorCount > 0 && (
                <div className="flex items-center gap-2 text-sm font-medium text-red-700 bg-red-50 border border-red-200 px-4 py-2 rounded-lg">
                  <span>❌</span>{syncResult.errorCount} error{syncResult.errorCount !== 1 ? "s" : ""}
                </div>
              )}
            </div>
            <button
              onClick={() => setSyncResult(null)}
              className="text-sm text-gray-500 hover:text-brand-green border border-gray-200 hover:border-brand-green px-3 py-1.5 rounded transition-colors"
            >
              ← Back to edit
            </button>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden mb-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left bg-white border-b border-gray-200">
                  <th className="px-4 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-widest">Item</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-widest">SKU / Barcode</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-widest">Shopify Product</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-widest">In Stock</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-widest">Qty Added</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-widest">Status</th>
                </tr>
              </thead>
              <tbody>
                {syncResult.results.map((r) => (
                  <tr key={r.lineItemId} className="border-b border-gray-50 last:border-0">
                    <td className="px-4 py-3 text-gray-700">{r.name}</td>
                    <td className="px-4 py-3 text-gray-500 font-mono text-xs">{r.sku || "—"}</td>
                    <td className="px-4 py-3 text-gray-600">{r.shopifyProductTitle || "—"}</td>
                    <td className="px-4 py-3">
                      {r.currentQty != null ? (
                        <span className={r.currentQty <= 0 ? "text-red-500 font-medium" : r.currentQty <= 3 ? "text-amber-600 font-medium" : "text-gray-600"}>
                          {r.currentQty}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{r.delta != null ? `+${r.delta}` : "—"}</td>
                    <td className="px-4 py-3">
                      {r.status === "synced" && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-1 rounded-full" title={r.matchedFromCache ? "Matched from saved mapping" : undefined}>
                          ✅ Synced{r.matchedFromCache && <span className="text-emerald-500 ml-0.5">·cached</span>}
                        </span>
                      )}
                      {r.status === "not_found" && <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 px-2 py-1 rounded-full" title={r.errorMessage}>⚠️ Not found</span>}
                      {r.status === "error" && <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-50 px-2 py-1 rounded-full" title={r.errorMessage}>❌ Error</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {syncResult.notFoundCount > 0 && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-4 py-3 mb-5">
              Items marked &ldquo;Not found&rdquo; were not in Shopify.{" "}
              <a
                href="https://admin.shopify.com/products/new"
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-green hover:underline font-medium"
              >
                Create those products in Shopify →
              </a>{" "}
              then click &ldquo;Back to edit&rdquo; and re-sync.
            </p>
          )}
          <div className="flex justify-end">
            <button onClick={() => router.push("/dashboard")} className="bg-brand-green hover:bg-brand-green/90 text-white text-sm font-medium px-6 py-2.5 rounded transition-colors">
              Go to Dashboard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
