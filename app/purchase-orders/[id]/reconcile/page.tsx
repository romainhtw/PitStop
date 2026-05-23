"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import BackButton from "@/components/BackButton";
import type { PurchaseOrder, ReconcileLineResult, ReconcileStatus } from "@/lib/types";

const STATUS_CONFIG: Record<ReconcileStatus, { label: string; className: string; description: string }> = {
  EXACT:          { label: "Exact",      className: "bg-emerald-50 text-emerald-700 border-emerald-200", description: "Qty and cost match the PO" },
  COST_DRIFT:     { label: "Cost drift", className: "bg-amber-50 text-amber-700 border-amber-200",   description: "Qty matches but supplier raised the price" },
  QTY_SHORTAGE:   { label: "Short",      className: "bg-red-50 text-red-700 border-red-200",          description: "Fewer units received than ordered" },
  SURPLUS:        { label: "Surplus",    className: "bg-blue-50 text-blue-700 border-blue-200",       description: "More units received than ordered" },
  SKU_MISMATCH:   { label: "New SKU",    className: "bg-purple-50 text-purple-700 border-purple-200", description: "SKU not found on the original PO" },
};

function StatusBadge({ status }: { status: ReconcileStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span className={`inline-flex items-center text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}

function reconcile(po: PurchaseOrder, invoiceItems: Array<{ name: string; sku: string; qty: number; costPrice: number }>): ReconcileLineResult[] {
  const results: ReconcileLineResult[] = [];

  for (let idx = 0; idx < invoiceItems.length; idx++) {
    const inv = invoiceItems[idx];
    const poLine = po.lineItems.find((l) => l.sku && l.sku.trim().toLowerCase() === inv.sku.trim().toLowerCase());

    if (!poLine) {
      results.push({
        poLineId: null, invoiceLineIdx: idx,
        name: inv.name, sku: inv.sku, status: "SKU_MISMATCH",
        expectedQty: 0, actualQty: inv.qty,
        expectedCost: 0, actualCost: inv.costPrice,
        qtyDelta: inv.qty, costDriftPct: 0,
      });
      continue;
    }

    const qtyDelta = inv.qty - poLine.qty;
    const costDriftPct = poLine.costPrice > 0
      ? Math.abs((inv.costPrice - poLine.costPrice) / poLine.costPrice) * 100
      : 0;

    let status: ReconcileStatus = "EXACT";
    if (qtyDelta < 0) status = "QTY_SHORTAGE";
    else if (qtyDelta > 0) status = "SURPLUS";
    else if (costDriftPct >= 1) status = "COST_DRIFT";

    results.push({
      poLineId: poLine.id, invoiceLineIdx: idx,
      name: poLine.name || inv.name, sku: poLine.sku,
      status, expectedQty: poLine.qty, actualQty: inv.qty,
      expectedCost: poLine.costPrice, actualCost: inv.costPrice,
      qtyDelta, costDriftPct,
    });
  }

  // Flag PO lines not present on the invoice
  for (const poLine of po.lineItems.filter((l) => !l.hidden)) {
    const alreadyMatched = results.some((r) => r.poLineId === poLine.id);
    if (!alreadyMatched) {
      results.push({
        poLineId: poLine.id, invoiceLineIdx: -1,
        name: poLine.name, sku: poLine.sku, status: "QTY_SHORTAGE",
        expectedQty: poLine.qty, actualQty: 0,
        expectedCost: poLine.costPrice, actualCost: 0,
        qtyDelta: -poLine.qty, costDriftPct: 0,
      });
    }
  }

  return results;
}

export default function ReconcilePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [dragging, setDragging] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);

  const [results, setResults] = useState<ReconcileLineResult[] | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncDone, setSyncDone] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/purchase-orders/${id}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setPo(data as PurchaseOrder);
      })
      .catch((e) => setLoadError(e.message));
  }, [id]);

  const handleFile = useCallback(async (file: File) => {
    setParseError(null);
    setResults(null);
    setFilename(file.name);
    setParsing(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/parse-invoice/extract", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Parse failed");
      const parsed = data.parsed;
      const invoiceItems = (parsed.lineItems ?? []).map((li: Record<string, unknown>) => ({
        name: String(li.name ?? ""),
        sku: String(li.sku ?? ""),
        qty: Number(li.qty) || 0,
        costPrice: Number(li.costPrice) || 0,
      }));
      if (!po) throw new Error("PO not loaded yet");
      setResults(reconcile(po, invoiceItems));
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setParsing(false);
    }
  }, [po]);

  async function handleSyncToShopify() {
    if (!results || !po) return;
    setSyncing(true);
    setSyncError(null);
    try {
      // Update PO line items with actual received quantities then call existing sync route
      const updatedLineItems = po.lineItems.map((li) => {
        const match = results.find((r) => r.poLineId === li.id);
        if (!match || match.status === "SKU_MISMATCH") return li;
        return { ...li, qty: match.actualQty, costPrice: match.actualCost };
      });

      await fetch(`/api/purchase-orders/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...po, lineItems: updatedLineItems, status: "approved" }),
      });

      const syncRes = await fetch("/api/shopify/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ poId: id }),
      });
      const syncData = await syncRes.json();
      if (!syncRes.ok) throw new Error(syncData.error || "Sync failed");
      setSyncDone(true);
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  if (loadError) return <div className="p-10 text-red-600">{loadError}</div>;
  if (!po) return (
    <div className="p-10 flex items-center gap-3 text-gray-400">
      <div className="w-5 h-5 border-2 border-gray-200 border-t-brand-green rounded-full animate-spin" />
      Loading purchase order…
    </div>
  );

  const exactCount   = results?.filter((r) => r.status === "EXACT").length ?? 0;
  const issueCount   = results?.filter((r) => r.status !== "EXACT").length ?? 0;

  return (
    <div className="p-10 max-w-5xl">
      <div className="mb-4"><BackButton /></div>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="font-display text-4xl leading-none tracking-wide text-brand-green mb-1">Receive Invoice</h1>
          <p className="text-gray-500 text-sm">
            Reconcile against <span className="font-medium text-gray-700">{po.supplier}</span>
            {po.orderNumber && <> · PO {po.orderNumber}</>}
            {po.invoiceNumber && <> · Inv {po.invoiceNumber}</>}
          </p>
        </div>
        {results && !syncDone && (
          <button
            onClick={handleSyncToShopify}
            disabled={syncing}
            className="inline-flex items-center gap-2 bg-brand-green hover:bg-brand-green/90 disabled:opacity-60 text-white text-sm font-semibold px-5 py-2.5 rounded transition-colors"
          >
            {syncing && <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" /></svg>}
            {syncing ? "Syncing…" : "Apply & Sync to Shopify →"}
          </button>
        )}
        {syncDone && (
          <button onClick={() => router.push("/dashboard")} className="inline-flex items-center gap-2 bg-emerald-600 text-white text-sm font-semibold px-5 py-2.5 rounded">
            ✓ Done — Back to Dashboard
          </button>
        )}
      </div>

      {/* Status legend */}
      <div className="flex flex-wrap gap-2 mb-6">
        {(Object.entries(STATUS_CONFIG) as [ReconcileStatus, typeof STATUS_CONFIG[ReconcileStatus]][]).map(([status, cfg]) => (
          <div key={status} className={`inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded border ${cfg.className}`}>
            <span className="font-bold">{cfg.label}</span>
            <span className="opacity-70">— {cfg.description}</span>
          </div>
        ))}
      </div>

      {/* Upload zone */}
      {!results && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }}
          onClick={() => !parsing && inputRef.current?.click()}
          className={`rounded-lg border-2 border-dashed py-16 text-center transition-colors cursor-pointer mb-6 ${
            parsing ? "border-brand-sage bg-brand-sage/10 cursor-default"
              : dragging ? "border-brand-green bg-brand-sage/40"
              : "border-brand-sage bg-white hover:border-brand-green hover:bg-brand-sage/20"
          }`}
        >
          <input ref={inputRef} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          {parsing ? (
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-4 border-brand-sage border-t-brand-green rounded-full animate-spin" />
              <p className="text-brand-green font-medium">Parsing invoice with AI…</p>
              {filename && <p className="text-sm text-gray-400">{filename}</p>}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <svg className="w-10 h-10 text-brand-sage" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m6.75 12l-3 3m0 0l-3-3m3 3V7.5" />
              </svg>
              <p className="text-brand-green font-semibold">Drop the received invoice here</p>
              <p className="text-gray-400 text-sm">PDF, PNG, or JPEG · AI will match each line to the original PO</p>
            </div>
          )}
        </div>
      )}

      {parseError && (
        <div className="mb-5 p-4 rounded bg-red-50 border border-red-200 text-red-700 text-sm">{parseError}</div>
      )}
      {syncError && (
        <div className="mb-5 p-4 rounded bg-red-50 border border-red-200 text-red-700 text-sm">{syncError}</div>
      )}

      {/* Results table */}
      {results && (
        <>
          {/* Summary bar */}
          <div className="flex items-center gap-4 mb-4 text-sm">
            <span className="text-gray-500"><span className="font-semibold text-gray-800">{results.length}</span> lines compared</span>
            <span className="text-emerald-600 font-medium">✓ {exactCount} exact</span>
            {issueCount > 0 && <span className="text-amber-600 font-medium">⚠ {issueCount} need review</span>}
            <button onClick={() => { setResults(null); setFilename(null); }} className="ml-auto text-xs text-gray-400 hover:text-gray-600 underline">Upload different invoice</button>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] text-gray-400 uppercase tracking-widest border-b border-gray-100 bg-gray-50">
                    <th className="px-5 py-3">Product</th>
                    <th className="px-5 py-3 text-center">Status</th>
                    <th className="px-5 py-3 text-right">Exp Qty</th>
                    <th className="px-5 py-3 text-right">Act Qty</th>
                    <th className="px-5 py-3 text-right">Δ Qty</th>
                    <th className="px-5 py-3 text-right">Exp Cost</th>
                    <th className="px-5 py-3 text-right">Act Cost</th>
                    <th className="px-5 py-3 text-right">Cost Δ%</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, i) => (
                    <tr key={i} className={`border-b border-gray-50 last:border-0 hover:bg-gray-50/60 ${r.status !== "EXACT" ? "bg-amber-50/30" : ""}`}>
                      <td className="px-5 py-3">
                        <p className="font-medium text-gray-800">{r.name}</p>
                        <p className="text-[11px] text-gray-400 font-mono">{r.sku || <span className="italic">no SKU</span>}</p>
                      </td>
                      <td className="px-5 py-3 text-center"><StatusBadge status={r.status} /></td>
                      <td className="px-5 py-3 text-right text-gray-600">{r.expectedQty || "—"}</td>
                      <td className="px-5 py-3 text-right font-semibold text-gray-800">{r.actualQty || "—"}</td>
                      <td className="px-5 py-3 text-right font-bold">
                        {r.qtyDelta !== 0 ? (
                          <span className={r.qtyDelta > 0 ? "text-blue-600" : "text-red-600"}>
                            {r.qtyDelta > 0 ? "+" : ""}{r.qtyDelta}
                          </span>
                        ) : <span className="text-emerald-600">—</span>}
                      </td>
                      <td className="px-5 py-3 text-right text-gray-500">{r.expectedCost > 0 ? `$${r.expectedCost.toFixed(2)}` : "—"}</td>
                      <td className="px-5 py-3 text-right text-gray-800">{r.actualCost > 0 ? `$${r.actualCost.toFixed(2)}` : "—"}</td>
                      <td className="px-5 py-3 text-right font-medium">
                        {r.costDriftPct > 0 ? (
                          <span className={r.costDriftPct >= 5 ? "text-red-600" : "text-amber-600"}>
                            +{r.costDriftPct.toFixed(1)}%
                          </span>
                        ) : <span className="text-emerald-600">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
