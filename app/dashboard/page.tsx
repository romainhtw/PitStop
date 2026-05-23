"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, getDocs, query, orderBy } from "firebase/firestore/lite";
import { db } from "@/lib/firebase";
import type { PurchaseOrder, POStatus, ShopifyProduct } from "@/lib/types";
import FeedbackChat from "@/components/FeedbackChat";

const PO_CHAT_CONTEXT = `The user is talking about the Purchase Orders feature in PitStop — an internal ops tool for Elite Racing Cycles, a bike shop in Perth with 10 staff and 5 per shift.

The Purchase Orders feature currently allows:
- Creating POs by uploading a supplier invoice PDF (auto-parsed)
- Adding line items manually with cost price, retail price, quantity, SKU, barcode
- Shopify smart sync: matches products by SKU → barcode → product name search with "Did you mean?" confirmation
- Review page with dry-run preview before live sync
- Supplier and invoice metadata (supplier name, invoice number, date, location)
- Status tracking: draft → awaiting review → approved
- Delete POs

Your job is to ask 3-5 targeted questions to understand exactly what modification or improvement they want, then generate a brief to send to Romain.`;

function fmt(n: number) {
  return `$${n.toFixed(2)}`;
}

function statusBadge(status: POStatus) {
  const map: Record<POStatus, string> = {
    draft: "bg-gray-100 text-gray-500",
    awaiting_review: "bg-amber-50 text-amber-700",
    ordered: "bg-blue-50 text-blue-700",
    approved: "bg-brand-sage/60 text-brand-green",
  };
  const label: Record<POStatus, string> = {
    draft: "Draft",
    awaiting_review: "Awaiting Review",
    ordered: "Ordered",
    approved: "Approved",
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded-sm text-[10px] font-semibold tracking-wide ${map[status]}`}>
      {label[status]}
    </span>
  );
}

function DeleteButton({ po, onDelete }: { po: PurchaseOrder; onDelete: (id: string) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const syncedCount = po.syncResult?.results.filter(
    (r) => r.status === "synced" && r.delta
  ).length ?? 0;

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    const res = await fetch(`/api/purchase-orders/${po.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setDeleteError(data.error || "Delete failed");
      setDeleting(false);
      return;
    }
    onDelete(po.id);
  }

  if (deleteError) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="text-xs text-red-600">{deleteError}</span>
        <button onClick={() => { setDeleteError(null); setConfirming(false); }} className="text-xs text-gray-400 hover:underline">Dismiss</button>
      </span>
    );
  }

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-1.5 flex-wrap">
        {syncedCount > 0 && (
          <span className="text-xs text-amber-700 font-medium">
            ⚠️ {syncedCount} item{syncedCount !== 1 ? "s" : ""} will be deducted from Shopify stock
          </span>
        )}
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="text-xs text-red-600 font-medium hover:underline disabled:opacity-50"
        >
          {deleting ? "Reversing…" : "Confirm delete"}
        </button>
        <span className="text-gray-300">|</span>
        <button onClick={() => setConfirming(false)} className="text-xs text-gray-400 hover:underline">
          Cancel
        </button>
      </span>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="text-gray-300 hover:text-red-500 transition-colors text-lg leading-none"
      aria-label="Delete"
    >
      &times;
    </button>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [stockAlerts, setStockAlerts] = useState<{ out: number; low: number } | null>(null);
  const [reusing, setReusing] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/purchase-orders")
      .then((r) => r.json())
      .then((data) => setOrders(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false));

    // Fetch stock alert counts from Firestore catalog
    getDocs(query(collection(db, "shopifyProducts"), orderBy("productTitle")))
      .then((snap) => {
        const products = snap.docs.map((d) => d.data() as ShopifyProduct);
        const out = products.filter((p) => (p.onHandQtyStore ?? 0) + (p.onHandQtyWarehouse ?? 0) <= 0).length;
        const low = products.filter((p) => { const q = (p.onHandQtyStore ?? 0) + (p.onHandQtyWarehouse ?? 0); return q > 0 && q <= 3; }).length;
        setStockAlerts({ out, low });
      })
      .catch(() => {});
  }, []);

  async function handleReuse(po: PurchaseOrder) {
    setReusing(po.id);
    try {
      const res = await fetch("/api/purchase-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplier: po.supplier,
          location: po.location,
          paymentTerms: po.paymentTerms,
          currency: po.currency,
          lineItems: po.lineItems.map((li) => ({ ...li, hidden: false })),
          shippingCost: po.shippingCost,
          invoiceTotals: po.invoiceTotals,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      router.push(`/purchase-orders/${data.id}/review`);
    } catch {
      setReusing(null);
    }
  }

  function handleDelete(id: string) {
    setOrders((prev) => prev.filter((po) => po.id !== id));
  }

  const q = search.toLowerCase().trim();
  const filtered = q
    ? orders.filter(
        (po) =>
          po.supplier?.toLowerCase().includes(q) ||
          po.invoiceNumber?.toLowerCase().includes(q) ||
          po.invoiceDate?.toLowerCase().includes(q) ||
          po.location?.toLowerCase().includes(q)
      )
    : orders;

  const totalCost = orders.reduce(
    (s, po) => s + po.lineItems.reduce((a, li) => a + li.qty * li.costPrice, 0),
    0
  );
  const totalRetail = orders.reduce(
    (s, po) => s + po.lineItems.reduce((a, li) => a + li.qty * li.retailPrice, 0),
    0
  );
  const totalItems = orders.reduce(
    (s, po) => s + po.lineItems.reduce((a, li) => a + li.qty, 0),
    0
  );

  // Supplier spend analytics — computed from approved POs only
  const supplierSpend = orders
    .filter((po) => po.status === "approved")
    .reduce<Record<string, { spend: number; poCount: number; items: number }>>((acc, po) => {
      const key = po.supplier || "Unknown";
      const cost = po.lineItems.reduce((s, li) => s + li.qty * li.costPrice, 0);
      const items = po.lineItems.reduce((s, li) => s + li.qty, 0);
      if (!acc[key]) acc[key] = { spend: 0, poCount: 0, items: 0 };
      acc[key].spend += cost;
      acc[key].poCount += 1;
      acc[key].items += items;
      return acc;
    }, {});
  const supplierRows = Object.entries(supplierSpend)
    .sort((a, b) => b[1].spend - a[1].spend)
    .slice(0, 10);

  return (
    <div className="p-4 lg:p-10 max-w-7xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-display text-4xl leading-none tracking-wide text-brand-green">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">Inventory at a glance.</p>
        </div>
        <div className="flex items-center gap-2">
          <FeedbackChat context={PO_CHAT_CONTEXT} buttonLabel="Request a change" />
          <Link
            href="/purchase-orders/new"
            className="bg-brand-green hover:bg-brand-green/90 text-white text-sm font-medium px-4 py-2 rounded transition-colors"
          >
            + New Purchase Order
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded border border-gray-200 p-5">
          <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Total Cost Value</div>
          <div className="font-display text-5xl leading-none text-brand-green mt-2">
            {loading ? <span className="text-gray-200 animate-pulse">—</span> : fmt(totalCost)}
          </div>
        </div>
        <div className="bg-white rounded border border-gray-200 p-5">
          <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Total Retail Value</div>
          <div className="font-display text-5xl leading-none text-brand-green mt-2">
            {loading ? <span className="text-gray-200 animate-pulse">—</span> : fmt(totalRetail)}
          </div>
        </div>
        <div className="bg-white rounded border border-gray-200 p-5">
          <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Total Items</div>
          <div className="font-display text-5xl leading-none text-brand-green mt-2">
            {loading ? <span className="text-gray-200 animate-pulse">—</span> : totalItems}
          </div>
        </div>
        <Link href="/catalog?filter=out" className="block bg-white rounded border border-gray-200 p-5 hover:border-brand-green transition-colors group">
          <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Stock Alerts</div>
          {stockAlerts === null ? (
            <div className="font-display text-5xl leading-none text-gray-200 animate-pulse mt-2">—</div>
          ) : stockAlerts.out === 0 && stockAlerts.low === 0 ? (
            <div className="font-display text-5xl leading-none text-emerald-500 mt-2">✓</div>
          ) : (
            <div className="mt-2 space-y-1">
              {stockAlerts.out > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                  <span className="text-sm font-semibold text-red-600">{stockAlerts.out} out of stock</span>
                </div>
              )}
              {stockAlerts.low > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
                  <span className="text-sm font-semibold text-amber-600">{stockAlerts.low} low stock</span>
                </div>
              )}
            </div>
          )}
        </Link>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200 flex items-center gap-3">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide shrink-0">Purchase Orders</h2>
          <div className="relative flex-1 max-w-xs">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search supplier, invoice, date…"
              className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded focus:outline-none focus:border-brand-green transition-colors"
            />
          </div>
          {search && (
            <button onClick={() => setSearch("")} className="text-xs text-gray-400 hover:text-gray-600 shrink-0">
              Clear
            </button>
          )}
        </div>

        {loading ? (
          <div className="p-12 text-center text-gray-400 text-sm">Loading…</div>
        ) : orders.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <p className="mb-4">No purchase orders yet.</p>
            <Link href="/purchase-orders/new" className="text-brand-green underline hover:no-underline">
              Create your first one
            </Link>
          </div>
        ) : (
          <>
            {/* Mobile cards — hidden on lg+ */}
            <div className="lg:hidden divide-y divide-gray-100">
              {filtered.length === 0 && (
                <div className="p-8 text-center text-gray-400 text-sm">No results for &ldquo;{search}&rdquo;</div>
              )}
              {filtered.map((po) => {
                const cost = po.lineItems.reduce((a, li) => a + li.qty * li.costPrice, 0);
                return (
                  <div key={po.id} className="px-5 py-4 hover:bg-brand-sage/20">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-gray-900 text-sm">{po.supplier || "—"}</p>
                        <p className="text-xs text-gray-500 mt-0.5">#{po.invoiceNumber || "—"} · {po.invoiceDate || "—"}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{po.location}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-semibold text-brand-green text-sm">{fmt(cost)}</p>
                        <div className="mt-1">{statusBadge(po.status)}</div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-3">
                      <Link href={`/purchase-orders/${po.id}/review`} className="text-xs font-medium text-brand-green hover:underline">View →</Link>
                      <div className="flex items-center gap-3">
                        {po.status === "ordered" && (
                          <Link
                            href={`/purchase-orders/${po.id}/reconcile`}
                            className="text-xs font-medium text-blue-600 hover:underline"
                          >
                            Receive Invoice
                          </Link>
                        )}
                        <button
                          onClick={() => handleReuse(po)}
                          disabled={reusing === po.id}
                          className="text-xs text-gray-400 hover:text-brand-green transition-colors disabled:opacity-50"
                        >
                          {reusing === po.id ? "Creating…" : "Reuse"}
                        </button>
                        <DeleteButton po={po} onDelete={handleDelete} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop table — hidden on mobile */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left bg-white border-b border-gray-200">
                    <th className="px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-widest">Invoice #</th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-widest">Supplier</th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-widest">Date</th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-widest">Location</th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-widest">Items</th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-widest">Total Cost</th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-widest">Status</th>
                    <th className="px-5 py-3"></th>
                    <th className="px-5 py-3 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-5 py-8 text-center text-gray-400 text-sm">No results for &ldquo;{search}&rdquo;</td>
                    </tr>
                  )}
                  {filtered.map((po) => {
                    const itemsCount = po.lineItems.reduce((a, li) => a + li.qty, 0);
                    const cost = po.lineItems.reduce((a, li) => a + li.qty * li.costPrice, 0);
                    return (
                      <tr key={po.id} className="border-t border-gray-100 hover:bg-brand-sage/20">
                        <td className="px-5 py-3 font-medium">{po.invoiceNumber || "—"}</td>
                        <td className="px-5 py-3">{po.supplier || "—"}</td>
                        <td className="px-5 py-3">{po.invoiceDate || "—"}</td>
                        <td className="px-5 py-3">{po.location}</td>
                        <td className="px-5 py-3">{itemsCount}</td>
                        <td className="px-5 py-3">{fmt(cost)}</td>
                        <td className="px-5 py-3">{statusBadge(po.status)}</td>
                        <td className="px-5 py-3 text-right">
                          <div className="flex items-center justify-end gap-4">
                            {po.status === "ordered" && (
                              <Link
                                href={`/purchase-orders/${po.id}/reconcile`}
                                className="text-sm font-medium text-blue-600 hover:underline"
                              >
                                Receive Invoice
                              </Link>
                            )}
                            <button
                              onClick={() => handleReuse(po)}
                              disabled={reusing === po.id}
                              className="text-sm text-gray-400 hover:text-brand-green transition-colors disabled:opacity-50"
                            >
                              {reusing === po.id ? "Creating…" : "Reuse"}
                            </button>
                            <Link href={`/purchase-orders/${po.id}/review`} className="text-sm font-medium text-brand-green hover:underline">
                              View
                            </Link>
                          </div>
                        </td>
                        <td className="px-5 py-3 text-center">
                          <DeleteButton po={po} onDelete={handleDelete} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Supplier Spend Analytics */}
      {supplierRows.length > 0 && (
        <div className="mt-8 bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-200">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Supplier Spend — Approved POs</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-gray-100">
                  <th className="px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-widest">Supplier</th>
                  <th className="px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-widest text-right">Total Spend</th>
                  <th className="px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-widest text-right">POs</th>
                  <th className="px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-widest text-right">Items</th>
                  <th className="px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-widest">Share</th>
                </tr>
              </thead>
              <tbody>
                {supplierRows.map(([supplier, data]) => {
                  const share = totalCost > 0 ? (data.spend / totalCost) * 100 : 0;
                  return (
                    <tr key={supplier} className="border-b border-gray-50 last:border-0 hover:bg-brand-sage/10">
                      <td className="px-5 py-3 font-medium text-gray-800">{supplier}</td>
                      <td className="px-5 py-3 text-right font-semibold text-brand-green">{fmt(data.spend)}</td>
                      <td className="px-5 py-3 text-right text-gray-500">{data.poCount}</td>
                      <td className="px-5 py-3 text-right text-gray-500">{data.items}</td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-brand-green rounded-full"
                              style={{ width: `${Math.min(share, 100)}%` }}
                            />
                          </div>
                          <span className="text-xs text-gray-400 w-10 text-right">{share.toFixed(0)}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
