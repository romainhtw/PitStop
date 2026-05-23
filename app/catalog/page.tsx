"use client";

import { useEffect, useMemo, useState } from "react";
import type { ShopifyProduct } from "@/lib/types";
import { loadCatalog, invalidateCache } from "@/lib/catalogCache";

type SortKey = "productTitle" | "onHand" | "unitCost" | "price" | "margin";
type SortDir = "asc" | "desc";

function StockBadge({ qty }: { qty: number }) {
  if (qty <= 0) return <span className="text-xs font-semibold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">Out</span>;
  if (qty <= 3) return <span className="text-xs font-semibold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">Low · {qty}</span>;
  return <span className="text-sm text-gray-700">{qty}</span>;
}

export default function CatalogPage() {
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterStock, setFilterStock] = useState<"all" | "low" | "out">("all");
  const [sortKey, setSortKey] = useState<SortKey>("productTitle");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [error, setError] = useState<string | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  async function load(force = false) {
    setLoading(true);
    setError(null);
    try {
      const items = await loadCatalog(force);
      setProducts(items);
      if (items.length > 0) {
        const latest = items.reduce((a, b) => (a.syncedAt > b.syncedAt ? a : b));
        setLastSynced(latest.syncedAt);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load catalog");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const productTypes = useMemo(() => {
    const types = new Set(products.map((p) => p.productType).filter(Boolean));
    return Array.from(types).sort();
  }, [products]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return products.filter((p) => {
      const onHand = (p.onHandQtyStore ?? 0) + (p.onHandQtyWarehouse ?? 0);
      const matchSearch =
        !q ||
        p.productTitle.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.barcode.toLowerCase().includes(q) ||
        p.variantTitle.toLowerCase().includes(q);
      const matchType = !filterType || p.productType === filterType;
      const matchStock =
        filterStock === "all" ||
        (filterStock === "out" && onHand <= 0) ||
        (filterStock === "low" && onHand > 0 && onHand <= 3);
      return matchSearch && matchType && matchStock;
    });
  }, [products, search, filterType, filterStock]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let av: number | string = 0;
      let bv: number | string = 0;
      const aOnHand = (a.onHandQtyStore ?? 0) + (a.onHandQtyWarehouse ?? 0);
      const bOnHand = (b.onHandQtyStore ?? 0) + (b.onHandQtyWarehouse ?? 0);
      const aMargin = a.unitCost && a.price ? ((a.price - a.unitCost) / a.price) * 100 : -1;
      const bMargin = b.unitCost && b.price ? ((b.price - b.unitCost) / b.price) * 100 : -1;
      switch (sortKey) {
        case "productTitle": av = a.productTitle; bv = b.productTitle; break;
        case "onHand": av = aOnHand; bv = bOnHand; break;
        case "unitCost": av = a.unitCost ?? -1; bv = b.unitCost ?? -1; break;
        case "price": av = a.price; bv = b.price; break;
        case "margin": av = aMargin; bv = bMargin; break;
      }
      const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "productTitle" ? "asc" : "desc");
    }
  }

  function SortTh({ col, label }: { col: SortKey; label: string }) {
    const active = sortKey === col;
    return (
      <th
        className="px-4 py-3 text-right cursor-pointer select-none hover:text-brand-green transition-colors"
        onClick={() => toggleSort(col)}
      >
        <span className={`text-[11px] font-semibold uppercase tracking-widest ${active ? "text-brand-green" : "text-gray-400"}`}>
          {label} {active ? (sortDir === "asc" ? "↑" : "↓") : ""}
        </span>
      </th>
    );
  }

  const outCount = products.filter((p) => (p.onHandQtyStore ?? 0) + (p.onHandQtyWarehouse ?? 0) <= 0).length;
  const lowCount = products.filter((p) => { const q = (p.onHandQtyStore ?? 0) + (p.onHandQtyWarehouse ?? 0); return q > 0 && q <= 3; }).length;

  async function handleExportXlsx() {
    const XLSX = await import("xlsx");
    const rows = sorted.map((p) => ({
      Product: p.productTitle,
      Variant: p.variantTitle || "",
      SKU: p.sku || "",
      Barcode: p.barcode || "",
      Category: p.productType || "",
      "In Store": p.onHandQtyStore ?? 0,
      Warehouse: p.onHandQtyWarehouse ?? 0,
      "Cost ($)": p.unitCost != null ? p.unitCost : "",
      "Retail ($)": p.price,
      "Margin (%)": p.unitCost && p.price > 0 ? parseFloat((((p.price - p.unitCost) / p.price) * 100).toFixed(1)) : "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    // Column widths
    ws["!cols"] = [{ wch: 40 }, { wch: 20 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 12 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Catalog");
    XLSX.writeFile(wb, `catalog-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  async function handleSync() {
    setSyncing(true);
    setError(null);
    setSyncMsg(null);
    try {
      const res = await fetch("/api/shopify/catalog/sync", { method: "POST" });
      const text = await res.text();
      let data: { count?: number; error?: string };
      try { data = JSON.parse(text); } catch { throw new Error(text.slice(0, 300) || `HTTP ${res.status}`); }
      if (!res.ok) throw new Error(data.error || "Sync failed");
      setSyncMsg(`${data.count} variants synced`);
      invalidateCache();
      await load(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  async function handleRegisterWebhooks() {
    setRegistering(true);
    setError(null);
    try {
      const res = await fetch("/api/shopify/webhooks/register", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Registration failed");
      const allOk = data.results.every((r: { success: boolean }) => r.success);
      setSyncMsg(allOk ? "Webhooks registered — Shopify will now push updates automatically" : `Partial: ${JSON.stringify(data.results)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Registration failed");
    } finally {
      setRegistering(false);
    }
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  return (
    <div className="p-6 lg:p-10 max-w-7xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-4xl leading-none tracking-wide text-brand-green mb-1">Product Catalog</h1>
          <p className="text-gray-500 text-sm">
            {products.length > 0
              ? `${products.length} variants · last synced ${lastSynced ? formatDate(lastSynced) : "—"}`
              : "Pull your active Shopify products here"}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {products.length > 0 && (
            <button
              onClick={handleExportXlsx}
              className="inline-flex items-center gap-1.5 text-sm border border-gray-300 text-gray-600 hover:border-brand-green hover:text-brand-green px-3 py-2 rounded transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Export Excel
            </button>
          )}
          <button
            onClick={handleRegisterWebhooks}
            disabled={registering || syncing}
            className="inline-flex items-center gap-1.5 text-sm border border-gray-300 text-gray-600 hover:border-brand-green hover:text-brand-green px-3 py-2 rounded transition-colors disabled:opacity-50"
          >
            {registering ? "Registering…" : "Enable Auto-Sync"}
          </button>
          <button
            onClick={handleSync}
            disabled={syncing || registering}
            className="inline-flex items-center gap-2 bg-brand-green hover:bg-brand-green/90 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded transition-colors"
          >
            {syncing ? (
              <>
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
                </svg>
                Syncing…
              </>
            ) : (
              <>
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                </svg>
                Sync Now
              </>
            )}
          </button>
        </div>
      </div>

      {/* Stock alert summary */}
      {products.length > 0 && (outCount > 0 || lowCount > 0) && (
        <div className="flex gap-3 mb-5 flex-wrap">
          {outCount > 0 && (
            <button
              onClick={() => setFilterStock(filterStock === "out" ? "all" : "out")}
              className={`inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg border transition-colors ${filterStock === "out" ? "bg-red-600 text-white border-red-600" : "bg-red-50 text-red-700 border-red-200 hover:bg-red-100"}`}
            >
              🔴 {outCount} out of stock
            </button>
          )}
          {lowCount > 0 && (
            <button
              onClick={() => setFilterStock(filterStock === "low" ? "all" : "low")}
              className={`inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg border transition-colors ${filterStock === "low" ? "bg-amber-500 text-white border-amber-500" : "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100"}`}
            >
              🟡 {lowCount} low stock (≤3)
            </button>
          )}
          {filterStock !== "all" && (
            <button onClick={() => setFilterStock("all")} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
              Clear filter
            </button>
          )}
        </div>
      )}

      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded">{error}</div>}
      {syncMsg && <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm rounded">✅ {syncMsg}</div>}

      {/* Filters */}
      {products.length > 0 && (
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <input
            type="text"
            placeholder="Search name, SKU, barcode…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 min-w-48 rounded border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green/40 focus:border-brand-green"
          />
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="rounded border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand-green/40 focus:border-brand-green bg-white"
          >
            <option value="">All categories</option>
            {productTypes.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          {(search || filterType || filterStock !== "all") && (
            <span className="text-xs text-gray-400">{sorted.length} result{sorted.length !== 1 ? "s" : ""}</span>
          )}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex items-center gap-3 text-gray-400 py-20 justify-center">
          <div className="w-5 h-5 border-2 border-gray-200 border-t-brand-green rounded-full animate-spin" />
          Loading catalog…
        </div>
      ) : products.length === 0 ? (
        <div className="text-center py-24 bg-white rounded-lg border border-gray-200">
          <div className="text-4xl mb-3">📦</div>
          <p className="text-gray-600 font-medium mb-1">No products yet</p>
          <p className="text-gray-400 text-sm mb-6">Click &ldquo;Sync Now&rdquo; to pull your active Shopify products</p>
          <button onClick={handleSync} disabled={syncing} className="bg-brand-green hover:bg-brand-green/90 text-white text-sm font-medium px-6 py-2.5 rounded transition-colors disabled:opacity-50">
            {syncing ? "Syncing…" : "Sync Now"}
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-gray-400 uppercase tracking-widest border-b border-gray-200 bg-gray-50">
                  <th
                    className="px-4 py-3 cursor-pointer hover:text-brand-green transition-colors select-none"
                    onClick={() => toggleSort("productTitle")}
                  >
                    <span className={`text-[11px] font-semibold uppercase tracking-widest ${sortKey === "productTitle" ? "text-brand-green" : "text-gray-400"}`}>
                      Product {sortKey === "productTitle" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                    </span>
                  </th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-widest text-gray-400">Variant</th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-widest text-gray-400">SKU</th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-widest text-gray-400">Category</th>
                  <SortTh col="onHand" label="In Store" />
                  <SortTh col="onHand" label="Warehouse" />
                  <SortTh col="unitCost" label="Cost" />
                  <SortTh col="price" label="Retail" />
                  <SortTh col="margin" label="Margin" />
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-12 text-center text-gray-400">
                      No results
                    </td>
                  </tr>
                ) : (
                  sorted.map((p) => {
                    const margin = p.unitCost && p.price > 0
                      ? ((p.price - p.unitCost) / p.price) * 100
                      : null;
                    const storeQty = p.onHandQtyStore ?? 0;
                    const whQty = p.onHandQtyWarehouse ?? 0;
                    return (
                      <tr key={p.variantId} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                        <td className="px-4 py-3 font-medium text-gray-800">{p.productTitle}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{p.variantTitle || <span className="text-gray-300">—</span>}</td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-500">{p.sku || <span className="text-gray-300">—</span>}</td>
                        <td className="px-4 py-3">
                          {p.productType ? (
                            <span className="inline-flex text-xs bg-brand-sage text-brand-green px-2 py-0.5 rounded-full font-medium">{p.productType}</span>
                          ) : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right"><StockBadge qty={storeQty} /></td>
                        <td className="px-4 py-3 text-right"><StockBadge qty={whQty} /></td>
                        <td className="px-4 py-3 text-right text-gray-500 text-xs">
                          {p.unitCost != null ? `$${p.unitCost.toFixed(2)}` : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-700">${p.price.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right">
                          {margin != null ? (
                            <span className={`text-xs font-semibold ${margin >= 40 ? "text-emerald-600" : margin >= 25 ? "text-amber-600" : "text-red-500"}`}>
                              {margin.toFixed(0)}%
                            </span>
                          ) : <span className="text-gray-300">—</span>}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
