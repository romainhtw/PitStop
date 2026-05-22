"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { collection, getDocs, query, orderBy } from "firebase/firestore/lite";
import { db } from "@/lib/firebase";
import type { ShopifyProduct } from "@/lib/types";

const STORAGE_KEY = "pitstop_stocktake_v1";

type Entry = { counted: number; done: boolean };

function loadSaved(): Record<string, Entry> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, Entry>) : {};
  } catch {
    return {};
  }
}

function save(entries: Record<string, Entry>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {}
}

export default function StockTakePage() {
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const categoryRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    setEntries(loadSaved());
    getDocs(query(collection(db, "shopifyProducts"), orderBy("productTitle")))
      .then((snap) => setProducts(snap.docs.map((d) => d.data() as ShopifyProduct)))
      .finally(() => setLoading(false));
  }, []);

  function patchEntry(variantId: string, patch: Partial<Entry>) {
    setEntries((prev) => {
      const updated = {
        ...prev,
        [variantId]: { ...{ counted: 0, done: false }, ...prev[variantId], ...patch },
      };
      save(updated);
      return updated;
    });
  }

  function resetAll() {
    setEntries({});
    localStorage.removeItem(STORAGE_KEY);
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
        updated[p.variantId] = { counted: prev[p.variantId]?.counted ?? 0, done: !allDone };
      }
      save(updated);
      return updated;
    });
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
          {doneCount > 0 && (
            <button onClick={resetAll} className="hidden lg:block text-xs text-gray-400 hover:text-red-500 transition-colors">
              Reset
            </button>
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
                      return (
                        <div
                          key={p.variantId}
                          className={`flex items-center gap-3 px-4 py-3 transition-colors ${
                            entry.done ? "bg-emerald-50/40" : "hover:bg-gray-50/60"
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
