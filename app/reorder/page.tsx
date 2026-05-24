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
      const msg = err instanceof Error ? err.message : "Sync failed";
      // Surface a clear fix hint for the most common error
      if (msg.toLowerCase().includes("access denied") || msg.toLowerCase().includes("orders")) {
        setSyncError(
          "Access denied: the Shopify API token is missing the read_orders scope. " +
          "In Shopify Admin → Settings → Apps → Develop apps → your app → API credentials, " +
          "enable read_orders and reinstall."
        );
      } else {
        setSyncError(msg);
      }
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
    <div className="p-4 sm:p-6 max-w-7xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-sans font-semibold tracking-tight text-text-primary mb-1">
            Reorder Intelligence
          </h1>
          <p className="text-text-secondary text-sm font-mono">
            {lastSyncedAt
              ? `velocity synced ${fmtDate(lastSyncedAt)}`
              : "no velocity data — sync to get started"}
          </p>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing || loading}
          className="inline-flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent-dim text-white text-sm font-medium border border-accent disabled:opacity-40 transition-colors shrink-0"
        >
          {syncing ? (
            <>
              <span className="w-3.5 h-3.5 border border-white/40 border-t-white rounded-full animate-spin" />
              Syncing…
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Sync Velocity (90d)
            </>
          )}
        </button>
      </div>

      {/* Sync error */}
      {syncError && (
        <div className="mb-6 p-3 border-l-2 border-status-shortage bg-[rgba(239,68,68,0.08)] text-status-shortage text-sm">
          {syncError}
        </div>
      )}

      {/* Settings row */}
      <div className="flex flex-wrap items-center gap-6 mb-6 p-4 bg-surface-2 border border-border-0">
        <div className="flex items-center gap-3">
          <label className="text-xs text-text-tertiary font-mono uppercase tracking-widest whitespace-nowrap">Lead time (days)</label>
          <input
            type="number"
            min={1}
            max={120}
            value={leadTimeDays}
            onChange={(e) => setLeadTimeDays(Math.max(1, parseInt(e.target.value) || 14))}
            className="w-16 bg-surface-3 border border-border-1 text-text-primary px-2 py-1 text-sm text-center font-mono focus:outline-none focus:border-accent"
          />
        </div>
        <div className="flex items-center gap-3">
          <label className="text-xs text-text-tertiary font-mono uppercase tracking-widest whitespace-nowrap">Safety stock (days)</label>
          <input
            type="number"
            min={0}
            max={60}
            value={safetyStockDays}
            onChange={(e) => setSafetyStockDays(Math.max(0, parseInt(e.target.value) || 7))}
            className="w-16 bg-surface-3 border border-border-1 text-text-primary px-2 py-1 text-sm text-center font-mono focus:outline-none focus:border-accent"
          />
        </div>
        <p className="text-xs text-text-tertiary font-mono">
          reorder pt = velocity × (lead + safety)
        </p>
        <div className="ml-auto">
          <label className="flex items-center gap-2 text-xs text-text-tertiary font-mono cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
              className="accent-[#FF5A00] w-3.5 h-3.5"
            />
            Show all tracked SKUs
          </label>
        </div>
      </div>

      {/* Summary cards */}
      {!loading && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-px mb-6 bg-border-0 border border-border-0">
          {[
            { label: "Reorder alerts", value: alertRows.length, alert: alertRows.length > 0 },
            { label: "SKUs tracked", value: velocity.size },
            { label: "Products in catalog", value: products.length },
            { label: "Selected for PO", value: selected.size },
          ].map((card) => (
            <div
              key={card.label}
              className={`p-4 ${card.alert ? "bg-[rgba(234,179,8,0.08)]" : "bg-surface-1"}`}
            >
              <div className={`text-2xl font-mono font-bold tabular-nums ${card.alert ? "text-status-drift" : "text-text-primary"}`}>
                {card.value}
              </div>
              <div className="text-xs text-text-tertiary font-mono mt-0.5 uppercase tracking-widest">{card.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 mb-4 p-3 bg-accent-muted border border-accent/30">
          <span className="text-sm text-accent font-mono">{selected.size} SKU{selected.size > 1 ? "s" : ""} selected</span>
          <button
            onClick={() => setSelected(new Set())}
            className="text-xs text-text-tertiary hover:text-text-secondary transition-colors font-mono"
          >
            Clear
          </button>
          <button
            onClick={handleCreateDraftPO}
            disabled={creating}
            className="ml-auto inline-flex items-center gap-2 px-4 py-1.5 bg-accent hover:bg-accent-dim text-white text-sm font-medium border border-accent disabled:opacity-40 transition-colors"
          >
            {creating ? (
              <>
                <span className="w-3 h-3 border border-white/40 border-t-white rounded-full animate-spin" />
                Creating…
              </>
            ) : (
              "Create Draft PO"
            )}
          </button>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center h-48 text-text-tertiary text-sm font-mono">
          <span className="w-4 h-4 border border-border-2 border-t-accent rounded-full animate-spin mr-2" />
          Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-center border border-border-0 bg-surface-1">
          <p className="text-text-tertiary text-sm font-mono">
            {velocity.size === 0
              ? 'No velocity data. Click "Sync Velocity" to pull 90 days of sales.'
              : "No reorder alerts. All tracked products are above their reorder points."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto border border-border-0 bg-surface-1">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 border-b border-border-0">
              <tr>
                <th className="px-3 py-2.5 text-left w-8">
                  <input
                    type="checkbox"
                    checked={alertRows.length > 0 && alertRows.every((r) => selected.has(r.sku))}
                    onChange={toggleAllAlerts}
                    title="Select all alerts"
                    className="accent-[#FF5A00] w-3.5 h-3.5"
                  />
                </th>
                <th className="px-3 py-2.5 text-left text-xs font-mono text-text-tertiary uppercase tracking-widest">Product / SKU</th>
                <th className="px-3 py-2.5 text-right text-xs font-mono text-text-tertiary uppercase tracking-widest">Sold 90d</th>
                <th className="px-3 py-2.5 text-right text-xs font-mono text-text-tertiary uppercase tracking-widest">vel/day</th>
                <th className="px-3 py-2.5 text-right text-xs font-mono text-text-tertiary uppercase tracking-widest">On Hand</th>
                <th className="px-3 py-2.5 text-right text-xs font-mono text-text-tertiary uppercase tracking-widest">Reorder pt</th>
                <th className="px-3 py-2.5 text-right text-xs font-mono text-text-tertiary uppercase tracking-widest">Suggest</th>
                <th className="px-3 py-2.5 text-left text-xs font-mono text-text-tertiary uppercase tracking-widest">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isSelected = selected.has(row.sku);
                return (
                  <tr
                    key={row.sku}
                    onClick={() => row.belowThreshold && toggleRow(row.sku)}
                    className={[
                      "border-b border-border-0 transition-colors",
                      row.belowThreshold
                        ? isSelected
                          ? "bg-accent-muted cursor-pointer"
                          : "hover:bg-surface-2 cursor-pointer"
                        : "opacity-70",
                    ].join(" ")}
                  >
                    <td className="px-3 py-3">
                      {row.belowThreshold && (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleRow(row.sku)}
                          onClick={(e) => e.stopPropagation()}
                          className="accent-[#FF5A00] w-3.5 h-3.5"
                        />
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-medium text-text-primary leading-tight">{row.productTitle}</div>
                      {row.variantTitle && row.variantTitle !== "Default Title" && (
                        <div className="text-xs text-text-secondary">{row.variantTitle}</div>
                      )}
                      <div className="text-xs text-text-tertiary font-mono">{row.sku}</div>
                    </td>
                    <td className="px-3 py-3 text-right text-text-secondary font-mono tabular-nums">{row.unitsSold90d}</td>
                    <td className="px-3 py-3 text-right text-text-secondary font-mono tabular-nums">
                      {row.velocityPerDay > 0 ? row.velocityPerDay.toFixed(2) : "—"}
                    </td>
                    <td className={`px-3 py-3 text-right font-mono font-semibold tabular-nums ${row.belowThreshold ? "text-status-drift" : "text-text-primary"}`}>
                      {row.currentQty}
                    </td>
                    <td className="px-3 py-3 text-right text-text-tertiary font-mono tabular-nums">
                      {row.velocityPerDay > 0 ? row.reorderPoint : "—"}
                    </td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums">
                      {row.belowThreshold ? (
                        <span className="font-semibold text-accent">{row.suggestedOrderQty}</span>
                      ) : "—"}
                    </td>
                    <td className="px-3 py-3">
                      {row.belowThreshold ? (
                        <span
                          className="inline-flex items-center px-1.5 py-0.5 text-2xs font-mono font-medium tracking-[0.08em] select-none"
                          style={{
                            color: "var(--ps-status-drift)",
                            backgroundColor: "rgba(234,179,8,0.08)",
                            border: "1px solid rgba(234,179,8,0.35)",
                            borderLeftWidth: "2px",
                            borderLeftColor: "var(--ps-status-drift)",
                          }}
                        >
                          REORDER
                        </span>
                      ) : row.velocityPerDay > 0 ? (
                        <span
                          className="inline-flex items-center px-1.5 py-0.5 text-2xs font-mono font-medium tracking-[0.08em] select-none"
                          style={{
                            color: "var(--ps-status-match)",
                            backgroundColor: "rgba(34,197,94,0.08)",
                            border: "1px solid rgba(34,197,94,0.35)",
                            borderLeftWidth: "2px",
                            borderLeftColor: "var(--ps-status-match)",
                          }}
                        >
                          OK
                        </span>
                      ) : (
                        <span className="text-xs text-text-tertiary font-mono">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
