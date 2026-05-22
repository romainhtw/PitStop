"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, orderBy } from "firebase/firestore/lite";
import { db } from "@/lib/firebase";
import type { ShopifyProduct } from "@/lib/types";

export default function CatalogPage() {
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const snap = await getDocs(
        query(collection(db, "shopifyProducts"), orderBy("productTitle"))
      );
      const items = snap.docs.map((d) => d.data() as ShopifyProduct);
      setProducts(items);
      if (items.length > 0) {
        const latest = items.reduce((a, b) =>
          a.syncedAt > b.syncedAt ? a : b
        );
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
      const matchSearch =
        !q ||
        p.productTitle.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.barcode.toLowerCase().includes(q) ||
        p.variantTitle.toLowerCase().includes(q);
      const matchType = !filterType || p.productType === filterType;
      return matchSearch && matchType;
    });
  }, [products, search, filterType]);

  async function handleSync() {
    setSyncing(true);
    setError(null);
    setSyncMsg(null);
    try {
      const res = await fetch("/api/shopify/catalog/sync", { method: "POST" });
      const text = await res.text();
      let data: { count?: number; error?: string };
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(text.slice(0, 300) || `HTTP ${res.status}`);
      }
      if (!res.ok) throw new Error(data.error || "Sync failed");
      setSyncMsg(`${data.count} variants synced`);
      await load();
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
    return new Date(iso).toLocaleString("en-AU", {
      day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
    });
  }

  return (
    <div className="p-6 lg:p-10 max-w-7xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-8 gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-4xl leading-none tracking-wide text-brand-green mb-1">Product Catalog</h1>
          <p className="text-gray-500 text-sm">
            {products.length > 0
              ? `${products.length} variants · last synced ${lastSynced ? formatDate(lastSynced) : "—"}`
              : "Pull your active Shopify products here"}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleRegisterWebhooks}
            disabled={registering || syncing}
            className="inline-flex items-center gap-1.5 text-sm border border-gray-300 text-gray-600 hover:border-brand-green hover:text-brand-green px-3 py-2 rounded transition-colors disabled:opacity-50"
            title="Register Shopify webhooks so the catalog updates automatically when you change products in Shopify"
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
          {(search || filterType) && (
            <span className="text-xs text-gray-400">{filtered.length} result{filtered.length !== 1 ? "s" : ""}</span>
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
          <button
            onClick={handleSync}
            disabled={syncing}
            className="bg-brand-green hover:bg-brand-green/90 text-white text-sm font-medium px-6 py-2.5 rounded transition-colors disabled:opacity-50"
          >
            {syncing ? "Syncing…" : "Sync Now"}
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-gray-400 uppercase tracking-widest border-b border-gray-200 bg-gray-50">
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3">Variant</th>
                  <th className="px-4 py-3">SKU</th>
                  <th className="px-4 py-3">Barcode</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3 text-right">Price</th>
                  <th className="px-4 py-3 text-right">RRP</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-gray-400">
                      No results for &ldquo;{search}&rdquo;
                    </td>
                  </tr>
                ) : (
                  filtered.map((p) => (
                    <tr key={p.variantId} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                      <td className="px-4 py-3 font-medium text-gray-800">{p.productTitle}</td>
                      <td className="px-4 py-3 text-gray-500">{p.variantTitle || <span className="text-gray-300">—</span>}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">{p.sku || <span className="text-gray-300">—</span>}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">{p.barcode || <span className="text-gray-300">—</span>}</td>
                      <td className="px-4 py-3">
                        {p.productType ? (
                          <span className="inline-flex text-xs bg-brand-sage text-brand-green px-2 py-0.5 rounded-full font-medium">
                            {p.productType}
                          </span>
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">${p.price.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right text-gray-400">
                        {p.compareAtPrice ? `$${p.compareAtPrice.toFixed(2)}` : <span className="text-gray-300">—</span>}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
