"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { db } from "@/lib/firebase";
import { collection, getDocs } from "firebase/firestore/lite";
import { loadCatalog } from "@/lib/catalogCache";
import type { ShopifyProduct, VelocityEntry } from "@/lib/types";

interface ReorderRow {
  sku: string;
  variantId: string;
  productTitle: string;
  variantTitle: string;
  currentQty: number;
  velocityPerDay: number;
  unitsSold90d: number;
  reorderPoint: number;
  suggestedOrderQty: number;
  belowThreshold: boolean;
}

export default function ReorderPage() {
  const router = useRouter();

  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [velocity, setVelocity] = useState<Map<string, VelocityEntry>>(new Map());
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const [leadTimeDays, setLeadTimeDays] = useState(14);
  const [safetyStockDays, setSafetyStockDays] = useState(7);
  const [showAll, setShowAll] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [prods, velSnap, metaSnap] = await Promise.all([
        loadCatalog(),
        getDocs(collection(db, "velocityCache")),
        getDocs(collection(db, "velocityMeta")),
      ]);
      setProducts(prods);

      const velMap = new Map<string, VelocityEntry>();
      velSnap.forEach((d) => velMap.set(d.id, d.data() as VelocityEntry));
      setVelocity(velMap);

      const meta = metaSnap.docs.find((d) => d.id === "latest");
      if (meta) setLastSyncedAt((meta.data() as { syncedAt: string }).syncedAt);
    } catch (err) {
      console.error("[reorder] load failed", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const rows = useMemo<ReorderRow[]>(() => {
    return products
      .filter((p) => p.sku)
      .map((p) => {
        const vel = velocity.get(p.sku);
        const vpd = vel?.velocityPerDay ?? 0;
        const reorderPoint = parseFloat((vpd * (leadTimeDays + safetyStockDays)).toFixed(1));
        const currentQty = (p.onHandQtyStore ?? 0) + (p.onHandQtyWarehouse ?? 0);
        const belowThreshold = vpd > 0 && currentQty <= reorderPoint;
        // How many units to bring stock back up to reorderPoint + safetyStockDays of buffer
        const suggestedOrderQty = belowThreshold
          ? Math.max(Math.ceil(vpd * (leadTimeDays + safetyStockDays * 2) - currentQty), 1)
          : 0;
        return {
          sku: p.sku,
          variantId: p.variantId,
          productTitle: p.productTitle,
          variantTitle: p.variantTitle,
          currentQty,
          velocityPerDay: vpd,
          unitsSold90d: vel?.unitsSold90d ?? 0,
          reorderPoint,
          suggestedOrderQty,
          belowThreshold,
        };
      })
      .filter((r) => showAll || r.belowThreshold || r.velocityPerDay > 0)
      .sort((a, b) => {
        // Reorder needed first, then by velocity desc
        if (a.belowThreshold !== b.belowThreshold) return a.belowThreshold ? -1 : 1;
        return b.velocityPerDay - a.velocityPerDay;
      });
  }, [products, velocity, leadTimeDays, safetyStockDays, showAll]);

  const alertRows = useMemo(() => rows.filter((r) => r.belowThreshold), [rows]);

  const toggleRow = (sku: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sku)) next.delete(sku);
      else next.add(sku);
      return next;
    });
  };

  const toggleAllAlerts = () => {
    if (alertRows.every((r) => selected.has(r.sku))) {
      setSelected(new Set());
    } else {
      setSelected(new Set(alertRows.map((r) => r.sku)));
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      const res = await fetch("/api/shopify/velocity/sync", { method: "POST" });
      const data = await res.json() as { error?: string; skuCount?: number };
      if (!res.ok || data.error) throw new Error(data.error ?? "Sync failed");
      await loadData();
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const handleCreateDraftPO = async () => {
    const selectedRows = rows.filter((r) => selected.has(r.sku));
    if (!selectedRows.length) return;
    setCreating(true);
    try {
      const lineItems = selectedRows.map((r) => ({
        id: crypto.randomUUID(),
        name: r.productTitle,
        sku: r.sku,
        barcode: "",
        optionValues: [],
        category: "",
        qty: r.suggestedOrderQty,
        costPrice: 0,
        retailPrice: 0,
        gstApplicable: true,
        hidden: false,
      }));
      const res = await fetch("/api/purchase-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplier: "",
          invoiceDate: new Date().toISOString().slice(0, 10),
          status: "draft",
          lineItems,
        }),
      });
      const data = await res.json() as { id?: string; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? "Failed to create PO");
      router.push(`/purchase-orders/${data.id}/review`);
    } catch (err) {
      console.error("[reorder] create PO failed", err);
      setCreating(false);
    }
  };

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="p-6 max-w-7xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="font-display text-4xl leading-none tracking-wide text-brand-green mb-1">
            Reorder Intelligence
          </h1>
          <p className="text-gray-400 text-sm">
            {lastSyncedAt
              ? `Velocity synced ${fmtDate(lastSyncedAt)}`
              : "No velocity data yet — sync to get started"}
          </p>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing || loading}
          className="inline-flex items-center gap-2 px-4 py-2 rounded bg-brand-green text-white text-sm font-medium disabled:opacity-50 hover:bg-brand-green/90 transition-colors shrink-0"
        >
          {syncing ? (
            <>
              <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              Syncing…
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Sync Velocity (90d)
            </>
          )}
        </button>
      </div>

      {syncError && (
        <div className="mb-6 p-3 rounded bg-red-50 border border-red-200 text-red-700 text-sm">
          {syncError}
        </div>
      )}

      {/* Settings row */}
      <div className="flex flex-wrap items-center gap-6 mb-6 p-4 bg-white rounded-lg border border-gray-100">
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500 font-medium whitespace-nowrap">Lead time (days)</label>
          <input
            type="number"
            min={1}
            max={120}
            value={leadTimeDays}
            onChange={(e) => setLeadTimeDays(Math.max(1, parseInt(e.target.value) || 14))}
            className="w-16 border border-gray-200 rounded px-2 py-1 text-sm text-center focus:outline-none focus:border-brand-green"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500 font-medium whitespace-nowrap">Safety stock (days)</label>
          <input
            type="number"
            min={0}
            max={60}
            value={safetyStockDays}
            onChange={(e) => setSafetyStockDays(Math.max(0, parseInt(e.target.value) || 7))}
            className="w-16 border border-gray-200 rounded px-2 py-1 text-sm text-center focus:outline-none focus:border-brand-green"
          />
        </div>
        <div className="text-xs text-gray-400">
          Reorder point = velocity × (lead time + safety stock)
        </div>
        <div className="ml-auto">
          <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
              className="accent-brand-green"
            />
            Show all tracked SKUs
          </label>
        </div>
      </div>

      {/* Summary cards */}
      {!loading && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          {[
            { label: "Reorder alerts", value: alertRows.length, alert: alertRows.length > 0 },
            { label: "SKUs tracked", value: velocity.size },
            { label: "Products in catalog", value: products.length },
            { label: "Selected for PO", value: selected.size },
          ].map((card) => (
            <div
              key={card.label}
              className={`p-4 rounded-lg border ${card.alert ? "bg-amber-50 border-amber-200" : "bg-white border-gray-100"}`}
            >
              <div className={`text-2xl font-bold ${card.alert ? "text-amber-600" : "text-gray-900"}`}>
                {card.value}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">{card.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 mb-4 p-3 bg-brand-sage/20 rounded-lg border border-brand-sage">
          <span className="text-sm text-brand-green font-medium">{selected.size} SKU{selected.size > 1 ? "s" : ""} selected</span>
          <button
            onClick={handleCreateDraftPO}
            disabled={creating}
            className="ml-auto inline-flex items-center gap-2 px-4 py-1.5 rounded bg-brand-green text-white text-sm font-medium disabled:opacity-50 hover:bg-brand-green/90 transition-colors"
          >
            {creating ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                Creating…
              </>
            ) : (
              "Create Draft PO"
            )}
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            Clear
          </button>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
          <span className="w-5 h-5 border-2 border-gray-200 border-t-brand-green rounded-full animate-spin mr-2" />
          Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-center">
          <p className="text-gray-400 text-sm">
            {velocity.size === 0
              ? "No velocity data yet. Click \"Sync Velocity\" to pull 90 days of sales."
              : "No reorder alerts. All stocked products are above their reorder points."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-100 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-3 py-3 text-left w-8">
                  <input
                    type="checkbox"
                    checked={alertRows.length > 0 && alertRows.every((r) => selected.has(r.sku))}
                    onChange={toggleAllAlerts}
                    title="Select all alerts"
                    className="accent-brand-green"
                  />
                </th>
                <th className="px-3 py-3 text-left font-medium text-gray-500">Product / SKU</th>
                <th className="px-3 py-3 text-right font-medium text-gray-500">Sold 90d</th>
                <th className="px-3 py-3 text-right font-medium text-gray-500">vel/day</th>
                <th className="px-3 py-3 text-right font-medium text-gray-500">On Hand</th>
                <th className="px-3 py-3 text-right font-medium text-gray-500">Reorder pt</th>
                <th className="px-3 py-3 text-right font-medium text-gray-500">Suggest</th>
                <th className="px-3 py-3 text-left font-medium text-gray-500">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map((row) => (
                <tr
                  key={row.sku}
                  onClick={() => row.belowThreshold && toggleRow(row.sku)}
                  className={`transition-colors ${
                    row.belowThreshold
                      ? selected.has(row.sku)
                        ? "bg-brand-sage/20 cursor-pointer"
                        : "hover:bg-amber-50/50 cursor-pointer"
                      : ""
                  }`}
                >
                  <td className="px-3 py-3">
                    {row.belowThreshold && (
                      <input
                        type="checkbox"
                        checked={selected.has(row.sku)}
                        onChange={() => toggleRow(row.sku)}
                        onClick={(e) => e.stopPropagation()}
                        className="accent-brand-green"
                      />
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <div className="font-medium text-gray-900 leading-tight">{row.productTitle}</div>
                    {row.variantTitle && row.variantTitle !== "Default Title" && (
                      <div className="text-xs text-gray-400">{row.variantTitle}</div>
                    )}
                    <div className="text-xs text-gray-400 font-mono">{row.sku}</div>
                  </td>
                  <td className="px-3 py-3 text-right text-gray-700">{row.unitsSold90d}</td>
                  <td className="px-3 py-3 text-right text-gray-700">
                    {row.velocityPerDay > 0 ? row.velocityPerDay.toFixed(2) : "—"}
                  </td>
                  <td className={`px-3 py-3 text-right font-semibold ${row.belowThreshold ? "text-amber-600" : "text-gray-900"}`}>
                    {row.currentQty}
                  </td>
                  <td className="px-3 py-3 text-right text-gray-500">
                    {row.velocityPerDay > 0 ? row.reorderPoint : "—"}
                  </td>
                  <td className="px-3 py-3 text-right text-gray-700">
                    {row.belowThreshold ? (
                      <span className="font-semibold text-brand-green">{row.suggestedOrderQty}</span>
                    ) : "—"}
                  </td>
                  <td className="px-3 py-3">
                    {row.belowThreshold ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                        Reorder
                      </span>
                    ) : row.velocityPerDay > 0 ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                        OK
                      </span>
                    ) : (
                      <span className="text-xs text-gray-300">No sales</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
