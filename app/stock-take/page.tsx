"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ShopifyProduct } from "@/lib/types";
import { loadCatalog } from "@/lib/catalogCache";
import { loadEntries, saveEntry, clearAllEntries } from "@/lib/stockTakeDb";
import BarcodeScanner from "@/components/BarcodeScanner";

type Entry = { counted: number; done: boolean };

export default function StockTakePage() {
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [scannerOpen, setScannerOpen] = useState(false);
  const [flashVariantId, setFlashVariantId] = useState<string | null>(null);
  const [scanFeedback, setScanFeedback] = useState<{ code: string; found: boolean } | null>(null);
  const [commitModalOpen, setCommitModalOpen] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState<{ success: boolean; adjustedCount: number; message?: string } | null>(null);
  const categoryRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const variantRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    Promise.all([loadEntries(), loadCatalog()]).then(([saved, items]) => {
      setEntries(saved);
      setProducts(items);
      setLoading(false);
    });
  }, []);

  function patchEntry(variantId: string, patch: Partial<Entry>) {
    setEntries((prev) => {
      const next = { ...{ counted: 0, done: false }, ...prev[variantId], ...patch };
      saveEntry(variantId, next.counted, next.done);
      return { ...prev, [variantId]: next };
    });
  }

  function resetAll() {
    setEntries({});
    clearAllEntries();
  }

  const handleScan = useCallback((code: string) => {
    const match = products.find(
      (p) =>
        p.barcode?.trim() === code.trim() ||
        p.sku?.trim() === code.trim()
    );
    if (!match) {
      setScanFeedback({ code, found: false });
      setTimeout(() => setScanFeedback(null), 2000);
      return;
    }
    // Increment count and mark done
    patchEntry(match.variantId, {
      counted: (entries[match.variantId]?.counted ?? 0) + 1,
      done: true,
    });
    // Flash and scroll
    setFlashVariantId(match.variantId);
    setScanFeedback({ code, found: true });
    setTimeout(() => setFlashVariantId(null), 1500);
    setTimeout(() => setScanFeedback(null), 2000);
    // Expand the category if collapsed
    const cat = match.productType || "Uncategorised";
    setCollapsed((prev) => ({ ...prev, [cat]: false }));
    // Scroll to product row
    setTimeout(() => {
      variantRefs.current[match.variantId]?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
  }, [products, entries, patchEntry]);

  async function exportVariances() {
    const varRows: Array<{
      Product: string; Variant: string; SKU: string; Barcode: string;
      "Expected (Store)": number; "Expected (Warehouse)": number;
      Counted: number; Variance: number;
    }> = [];
    for (const p of products) {
      const entry = entries[p.variantId];
      if (!entry?.done) continue;
      const expected = (p.onHandQtyStore ?? 0) + (p.onHandQtyWarehouse ?? 0);
      const variance = entry.counted - expected;
      if (variance === 0) continue;
      varRows.push({
        Product: p.productTitle, Variant: p.variantTitle || "",
        SKU: p.sku || "", Barcode: p.barcode || "",
        "Expected (Store)": p.onHandQtyStore ?? 0,
        "Expected (Warehouse)": p.onHandQtyWarehouse ?? 0,
        Counted: entry.counted, Variance: variance,
      });
    }
    if (varRows.length === 0) { alert("No variances — all counted items match expected quantities."); return; }
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.json_to_sheet(varRows);
    ws["!cols"] = [{ wch: 40 }, { wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 20 }, { wch: 10 }, { wch: 10 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Variances");
    XLSX.writeFile(wb, `stock-variances-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  // Group by category, sorted
  const grouped = useMemo(() => {
    const q = search.toLowerCase();
    const filtered = q
      ? products.filter(
          (p) =>
            p.productTitle.toLowerCase().includes(q) ||
            p.variantTitle?.toLowerCase().includes(q) ||
            p.sku?.toLowerCase().includes(q) ||
            p.barcode?.toLowerCase().includes(q)
        )
      : products;

    const map = new Map<string, ShopifyProduct[]>();
    for (const p of filtered) {
      const cat = p.productType || "Uncategorised";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(p);
    }
    // Sort categories alphabetically, Uncategorised last
    return Array.from(map.entries()).sort(([a], [b]) => {
      if (a === "Uncategorised") return 1;
      if (b === "Uncategorised") return -1;
      return a.localeCompare(b);
    });
  }, [products, search]);

  // Overall progress
  const { totalVariants, doneCount } = useMemo(() => {
    const total = products.length;
    const done = Object.values(entries).filter((e) => e.done).length;
    return { totalVariants: total, doneCount: done };
  }, [products, entries]);

  const progressPct = totalVariants > 0 ? Math.round((doneCount / totalVariants) * 100) : 0;

  function scrollToCategory(cat: string) {
    setActiveCategory(cat);
    // Expand if collapsed
    setCollapsed((prev) => ({ ...prev, [cat]: false }));
    categoryRefs.current[cat]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function toggleCategory(cat: string) {
    setCollapsed((prev) => ({ ...prev, [cat]: !prev[cat] }));
  }

  function markAllDone(cat: string, items: ShopifyProduct[]) {
    const allDone = items.every((p) => entries[p.variantId]?.done);
    setEntries((prev) => {
      const updated = { ...prev };
      for (const p of items) {
        const counted = prev[p.variantId]?.counted ?? 0;
        updated[p.variantId] = { counted, done: !allDone };
        saveEntry(p.variantId, counted, !allDone);
      }
      return updated;
    });
  }

  // Items with variances — only counted+done rows where counted ≠ onHandQtyStore
  const variantItems = useMemo(() =>
    products
      .filter((p) => entries[p.variantId]?.done)
      .map((p) => ({
        product: p,
        counted: entries[p.variantId].counted,
        expected: p.onHandQtyStore ?? 0,
        delta: entries[p.variantId].counted - (p.onHandQtyStore ?? 0),
      }))
      .filter((r) => r.delta !== 0),
  [products, entries]);

  const doneItemCount = useMemo(() => Object.values(entries).filter((e) => e.done).length, [entries]);

  async function handleCommit() {
    setCommitting(true);
    try {
      const locationId = process.env.NEXT_PUBLIC_SHOPIFY_LOCATION_ID_STORE ?? "";
      const items = products
        .filter((p) => entries[p.variantId]?.done)
        .map((p) => ({ inventoryItemId: p.inventoryItemId, counted: entries[p.variantId].counted }));

      const res = await fetch("/api/shopify/stocktake/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, locationId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Commit failed");
      setCommitResult({
        success: true,
        adjustedCount: data.adjustedCount ?? 0,
        message: data.skipped ? data.message : undefined,
      });
      setCommitModalOpen(false);
    } catch (e) {
      setCommitResult({ success: false, adjustedCount: 0, message: e instanceof Error ? e.message : "Unknown error" });
      setCommitModalOpen(false);
    } finally {
      setCommitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-3 text-gray-400 p-10 justify-center">
        <div className="w-5 h-5 border-2 border-gray-200 border-t-brand-green rounded-full animate-spin" />
        Loading stock take…
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="p-10 text-center text-gray-500">
        <p className="text-4xl mb-3">📦</p>
        <p className="font-medium mb-2">No products in catalog</p>
        <p className="text-sm text-gray-400">Go to <a href="/catalog" className="text-brand-green underline">Catalog</a> and click Sync Now first.</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {scannerOpen && (
        <BarcodeScanner
          onDetected={handleScan}
          onClose={() => setScannerOpen(false)}
        />
      )}

      {/* ── Commit confirm modal ── */}
      {commitModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-gray-800">Commit Stock Take to Shopify</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  {variantItems.length === 0
                    ? "All counted items match current Shopify levels."
                    : `${variantItems.length} variant${variantItems.length !== 1 ? "s" : ""} will be adjusted. Shopify levels are fetched live before applying.`}
                </p>
              </div>
              <button onClick={() => setCommitModalOpen(false)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
            </div>

            {variantItems.length > 0 ? (
              <div className="overflow-y-auto flex-1">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-gray-50">
                    <tr className="text-left text-[11px] text-gray-400 uppercase tracking-widest border-b border-gray-100">
                      <th className="px-5 py-3">Product</th>
                      <th className="px-5 py-3 text-right">Expected</th>
                      <th className="px-5 py-3 text-right">Counted</th>
                      <th className="px-5 py-3 text-right">Delta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {variantItems.map(({ product: p, counted, expected, delta }) => (
                      <tr key={p.variantId} className="border-b border-gray-50 hover:bg-gray-50/60">
                        <td className="px-5 py-2.5">
                          <p className="font-medium text-gray-800 text-xs">{p.productTitle}</p>
                          {p.variantTitle && <p className="text-[11px] text-gray-400">{p.variantTitle}</p>}
                          <p className="text-[10px] text-gray-400 font-mono mt-0.5">{p.sku}</p>
                        </td>
                        <td className="px-5 py-2.5 text-right text-gray-600 text-xs">{expected}</td>
                        <td className="px-5 py-2.5 text-right text-gray-800 font-semibold text-xs">{counted}</td>
                        <td className="px-5 py-2.5 text-right text-xs font-bold">
                          <span className={delta > 0 ? "text-emerald-600" : "text-red-600"}>
                            {delta > 0 ? "+" : ""}{delta}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center py-12 text-gray-400 text-sm">
                Nothing to commit — all counts match Shopify.
              </div>
            )}

            <div className="px-6 py-4 border-t border-gray-100 bg-gray-50/50 flex items-center justify-between gap-3">
              <p className="text-[11px] text-amber-600">
                Live Shopify quantities are fetched right before applying to prevent order race conditions.
              </p>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => setCommitModalOpen(false)} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded transition-colors">
                  Cancel
                </button>
                <button
                  onClick={handleCommit}
                  disabled={committing || variantItems.length === 0}
                  className="inline-flex items-center gap-2 bg-brand-green hover:bg-brand-green/90 disabled:opacity-60 text-white text-sm font-semibold px-4 py-2 rounded transition-colors"
                >
                  {committing && <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" /></svg>}
                  {committing ? "Committing…" : "Confirm & Push to Shopify"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Commit result banner */}
      {commitResult && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl shadow-xl text-sm font-semibold flex items-center gap-3 ${commitResult.success ? "bg-emerald-600 text-white" : "bg-red-600 text-white"}`}>
          {commitResult.success
            ? commitResult.message
              ? `✓ ${commitResult.message}`
              : `✓ ${commitResult.adjustedCount} variant${commitResult.adjustedCount !== 1 ? "s" : ""} updated in Shopify`
            : `✗ ${commitResult.message}`}
          <button onClick={() => setCommitResult(null)} className="ml-2 opacity-70 hover:opacity-100">×</button>
        </div>
      )}

      {/* Scan feedback toast */}
      {scanFeedback && (
        <div className={`fixed top-20 left-1/2 -translate-x-1/2 z-40 px-5 py-3 rounded-xl shadow-xl text-sm font-semibold transition-all ${scanFeedback.found ? "bg-emerald-600 text-white" : "bg-red-600 text-white"}`}>
          {scanFeedback.found ? `✓ Found: ${scanFeedback.code}` : `✗ Not found: ${scanFeedback.code}`}
        </div>
      )}
      {/* ── Left sidebar: category nav ── */}
      <aside className="hidden lg:flex flex-col w-52 shrink-0 border-r border-gray-200 bg-[#eef1ee] overflow-y-auto">
        <div className="px-4 py-4 border-b border-gray-200">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Categories</p>
          <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-brand-green rounded-full transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <p className="text-[11px] text-gray-500 mt-1.5">{doneCount} / {totalVariants} counted</p>
        </div>
        <nav className="flex-1 py-2">
          {grouped.map(([cat, items]) => {
            const catDone = items.filter((p) => entries[p.variantId]?.done).length;
            const allDone = catDone === items.length;
            return (
              <button
                key={cat}
                onClick={() => scrollToCategory(cat)}
                className={`w-full text-left px-4 py-2 text-sm transition-colors flex items-center justify-between gap-2 ${
                  activeCategory === cat
                    ? "bg-brand-sage/60 text-brand-green font-medium"
                    : "text-gray-600 hover:bg-brand-sage/30 hover:text-brand-green"
                }`}
              >
                <span className="truncate">{cat}</span>
                <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                  allDone ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"
                }`}>
                  {catDone}/{items.length}
                </span>
              </button>
            );
          })}
        </nav>
        {doneCount > 0 && (
          <div className="px-4 py-3 border-t border-gray-200">
            <button
              onClick={resetAll}
              className="w-full text-xs text-gray-400 hover:text-red-500 transition-colors text-left"
            >
              Reset all counts
            </button>
          </div>
        )}
      </aside>

      {/* ── Main content ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <div className="px-5 py-4 border-b border-gray-200 bg-white flex items-center gap-4 flex-wrap shrink-0">
          <div className="flex-1">
            <h1 className="font-display text-2xl leading-none tracking-wide text-brand-green">Stock Take</h1>
            <p className="text-xs text-gray-400 mt-0.5">{doneCount} of {totalVariants} variants counted · {progressPct}%</p>
          </div>
          {/* Mobile progress */}
          <div className="flex items-center gap-2 lg:hidden">
            <div className="w-32 h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full bg-brand-green rounded-full transition-all" style={{ width: `${progressPct}%` }} />
            </div>
            <span className="text-xs text-gray-500">{progressPct}%</span>
          </div>
          {/* Search */}
          <div className="relative w-64">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search product, SKU, barcode…"
              className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded focus:outline-none focus:border-brand-green transition-colors"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm leading-none">&times;</button>
            )}
          </div>
          {/* Camera scan button */}
          <button
            onClick={() => setScannerOpen(true)}
            className="inline-flex items-center gap-1.5 bg-brand-green hover:bg-brand-green/90 text-white text-xs font-semibold px-3 py-1.5 rounded transition-colors"
            title="Scan barcode with camera"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 9V6a3 3 0 013-3h3M3 15v3a3 3 0 003 3h3m9-18h3a3 3 0 013 3v3m0 6v3a3 3 0 01-3 3h-3M9 9h1M14 9h1M9 12h1M14 12h1M9 15h1M14 15h1" />
            </svg>
            Scan
          </button>
          {doneItemCount > 0 && (
            <div className="hidden lg:flex items-center gap-3">
              <button
                onClick={exportVariances}
                className="inline-flex items-center gap-1.5 text-xs border border-gray-200 text-gray-500 hover:border-brand-green hover:text-brand-green px-3 py-1.5 rounded transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Export variances
              </button>
              <button
                onClick={() => { setCommitResult(null); setCommitModalOpen(true); }}
                className="inline-flex items-center gap-1.5 bg-brand-green hover:bg-brand-green/90 text-white text-xs font-semibold px-3 py-1.5 rounded transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                </svg>
                Commit to Shopify
              </button>
              <button onClick={resetAll} className="text-xs text-gray-400 hover:text-red-500 transition-colors">
                Reset
              </button>
            </div>
          )}
        </div>

        {/* Product list */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {grouped.length === 0 && (
            <div className="text-center py-16 text-gray-400 text-sm">No results for &ldquo;{search}&rdquo;</div>
          )}

          {grouped.map(([cat, items]) => {
            const catDone = items.filter((p) => entries[p.variantId]?.done).length;
            const allDone = catDone === items.length;
            const isCollapsed = collapsed[cat];

            return (
              <div
                key={cat}
                ref={(el) => { categoryRefs.current[cat] = el; }}
                className="bg-white rounded-lg border border-gray-200 overflow-hidden"
              >
                {/* Category header */}
                <div
                  className={`flex items-center justify-between px-4 py-3 cursor-pointer select-none border-b transition-colors ${
                    allDone ? "bg-emerald-50 border-emerald-100" : "bg-gray-50 border-gray-100 hover:bg-brand-sage/20"
                  }`}
                  onClick={() => toggleCategory(cat)}
                >
                  <div className="flex items-center gap-3">
                    <svg
                      className={`w-4 h-4 text-gray-400 transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
                      viewBox="0 0 20 20" fill="currentColor"
                    >
                      <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                    <span className={`font-semibold text-sm ${allDone ? "text-emerald-700" : "text-gray-700"}`}>
                      {cat}
                    </span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      allDone ? "bg-emerald-100 text-emerald-700" : "bg-gray-200 text-gray-500"
                    }`}>
                      {catDone}/{items.length}
                    </span>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); markAllDone(cat, items); }}
                    className={`text-xs font-medium px-3 py-1 rounded transition-colors ${
                      allDone
                        ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                        : "bg-brand-sage/60 text-brand-green hover:bg-brand-sage"
                    }`}
                  >
                    {allDone ? "Unmark all" : "Mark all ✓"}
                  </button>
                </div>

                {/* Rows */}
                {!isCollapsed && (
                  <div className="divide-y divide-gray-50">
                    {items.map((p) => {
                      const entry = entries[p.variantId] ?? { counted: 0, done: false };
                      const isFlashing = flashVariantId === p.variantId;
                      return (
                        <div
                          key={p.variantId}
                          ref={(el) => { variantRefs.current[p.variantId] = el; }}
                          className={`flex items-center gap-3 px-4 py-3 transition-colors ${
                            isFlashing ? "bg-brand-green/20 ring-2 ring-brand-green/40" : entry.done ? "bg-emerald-50/40" : "hover:bg-gray-50/60"
                          }`}
                        >
                          {/* Checkbox */}
                          <button
                            onClick={() => patchEntry(p.variantId, { done: !entry.done })}
                            className={`shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                              entry.done
                                ? "bg-brand-green border-brand-green"
                                : "border-gray-300 hover:border-brand-green"
                            }`}
                            aria-label="Mark as counted"
                          >
                            {entry.done && (
                              <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
                                <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )}
                          </button>

                          {/* Product info */}
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-medium truncate ${entry.done ? "text-gray-400 line-through" : "text-gray-800"}`}>
                              {p.productTitle}
                              {p.variantTitle && (
                                <span className="ml-1.5 font-normal text-gray-500">— {p.variantTitle}</span>
                              )}
                            </p>
                            <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                              {p.sku && (
                                <span className="text-[11px] text-gray-400 font-mono">SKU: {p.sku}</span>
                              )}
                              {p.barcode && (
                                <span className="text-[11px] text-gray-400 font-mono">Barcode: {p.barcode}</span>
                              )}
                              {(p.onHandQtyStore != null || p.onHandQtyWarehouse != null) && (
                                <span className="text-[11px] text-gray-400">
                                  Expected: {(p.onHandQtyStore ?? 0) + (p.onHandQtyWarehouse ?? 0)}
                                  {entry.done && entry.counted !== (p.onHandQtyStore ?? 0) + (p.onHandQtyWarehouse ?? 0) && (
                                    <span className={`ml-1 font-semibold ${entry.counted > (p.onHandQtyStore ?? 0) + (p.onHandQtyWarehouse ?? 0) ? "text-emerald-600" : "text-red-500"}`}>
                                      ({entry.counted > (p.onHandQtyStore ?? 0) + (p.onHandQtyWarehouse ?? 0) ? "+" : ""}{entry.counted - ((p.onHandQtyStore ?? 0) + (p.onHandQtyWarehouse ?? 0))})
                                    </span>
                                  )}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Counter */}
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => patchEntry(p.variantId, { counted: Math.max(0, entry.counted - 1) })}
                              className="w-7 h-7 rounded border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-100 hover:border-gray-300 transition-colors text-base leading-none font-medium"
                              aria-label="Decrease"
                            >
                              −
                            </button>
                            <input
                              type="number"
                              min={0}
                              value={entry.counted}
                              onChange={(e) => patchEntry(p.variantId, { counted: Math.max(0, parseInt(e.target.value) || 0) })}
                              className="w-12 text-center text-sm font-semibold border border-gray-200 rounded py-1 focus:outline-none focus:border-brand-green focus:ring-1 focus:ring-brand-green/30"
                            />
                            <button
                              onClick={() => patchEntry(p.variantId, { counted: entry.counted + 1 })}
                              className="w-7 h-7 rounded border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-brand-sage/60 hover:border-brand-green hover:text-brand-green transition-colors text-base leading-none font-medium"
                              aria-label="Increase"
                            >
                              +
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
