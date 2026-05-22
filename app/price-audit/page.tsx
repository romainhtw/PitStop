"use client";

import { useState } from "react";
import type { PriceGroup } from "@/app/api/shopify/price-audit/route";
import FeedbackChat from "@/components/FeedbackChat";
import BackButton from "@/components/BackButton";

const AUDIT_CHAT_CONTEXT = `The user is talking about the Price Audit feature in PitStop — an internal ops tool for Elite Racing Cycles, a bike shop in Perth with 10 staff and 5 per shift.

The Price Audit feature currently:
- Scans all Shopify products (paginated, 250 at a time)
- Groups products by normalised title (lowercased, trimmed)
- Finds groups with 2+ listings where prices differ (spread > $0)
- Shows: min price, max price, spread, suggested average
- Handles $0-priced items separately: excludes them from average, offers "Fix price" button to set only the $0 listings to the non-zero average
- Sorts results by spread descending (biggest discrepancies first)
- Applies prices via Shopify productVariantUpdate mutation

The user now wants to define ADDITIONAL things to audit beyond price inconsistencies. Your job is to ask 3-5 questions to understand exactly what other audit checks they want (e.g. missing images, missing SKUs, $0 prices across the whole catalogue, products with no description, duplicate barcodes, etc.), then generate a brief to send to Romain.`;

function fmt(n: number) {
  return `$${n.toFixed(2)}`;
}

function SpreadBadge({ spread }: { spread: number }) {
  const color =
    spread > 20
      ? "text-red-600"
      : spread > 5
      ? "text-amber-600"
      : "text-gray-700";
  return <span className={color}>{fmt(spread)}</span>;
}

function Spinner() {
  return (
    <svg
      className="animate-spin h-4 w-4 text-current"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v8H4z"
      />
    </svg>
  );
}

export default function PriceAuditPage() {
  const [scanning, setScanning] = useState(false);
  const [groups, setGroups] = useState<PriceGroup[] | null>(null);
  const [stats, setStats] = useState<{
    totalProducts: number;
    totalGroups: number;
  } | null>(null);
  const [applying, setApplying] = useState<Set<string>>(new Set());
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const [scanError, setScanError] = useState<string | null>(null);

  async function handleScan() {
    setScanning(true);
    setScanError(null);
    setGroups(null);
    setStats(null);
    setApplying(new Set());
    setApplied(new Set());

    try {
      const res = await fetch("/api/shopify/price-audit");
      const data = await res.json();

      if (!res.ok) {
        setScanError(data.error ?? "Scan failed");
        return;
      }

      setGroups(data.groups);
      setStats({
        totalProducts: data.totalProducts,
        totalGroups: data.totalGroups,
      });
    } catch {
      setScanError("Network error — could not reach the server.");
    } finally {
      setScanning(false);
    }
  }

  async function handleApply(group: PriceGroup, fixZeroOnly = false) {
    const key = group.normalizedTitle;
    setApplying((prev) => new Set(prev).add(key));

    try {
      const targetPrice = fixZeroOnly ? group.nonZeroAvgPrice : group.avgPrice;
      const updates = group.products
        .filter((p) => (fixZeroOnly ? p.price === 0 : true))
        .map((p) => ({ variantId: p.variantId, price: targetPrice }));

      const res = await fetch("/api/shopify/price-audit/normalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      });

      const data = await res.json();

      if (!res.ok || (data.errors && data.errors.length > 0)) {
        const errMsg = data.errors?.join("\n") ?? data.error ?? "Update failed";
        alert(`Some updates failed:\n${errMsg}`);
      }

      setApplied((prev) => new Set(prev).add(key));
    } catch {
      alert("Network error — could not apply prices.");
    } finally {
      setApplying((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  return (
    <div className="p-10 max-w-7xl">
      <div className="mb-4"><BackButton /></div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-brand-green">
            Price Audit
          </h1>
          <p className="text-gray-600 mt-1">
            Find duplicate listings with inconsistent prices.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <FeedbackChat context={AUDIT_CHAT_CONTEXT} buttonLabel="Add audit checks" />
          <button
            onClick={handleScan}
            disabled={scanning}
            className="inline-flex items-center gap-2 bg-brand-green hover:bg-brand-green/90 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded transition-colors"
          >
            {scanning && <Spinner />}
            {scanning ? "Scanning…" : "Scan Catalogue"}
          </button>
        </div>
      </div>

      {/* Scan error */}
      {scanError && (
        <div className="mb-6 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded">
          {scanError}
        </div>
      )}

      {/* Stats bar */}
      {stats !== null && (
        <div className="mb-6 text-sm text-gray-500">
          <span className="font-medium text-gray-700">{stats.totalProducts}</span>{" "}
          products scanned{" "}
          <span className="mx-2 text-gray-300">·</span>
          <span className="font-medium text-gray-700">{stats.totalGroups}</span>{" "}
          groups with price irregularities
        </div>
      )}

      {/* Results */}
      {groups !== null && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          {groups.length === 0 ? (
            <div className="p-12 text-center text-gray-500 text-sm">
              No price irregularities found — catalogue looks consistent.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b border-gray-200">
                    <th className="px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-widest">
                      Product Title
                    </th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-widest">
                      Listings
                    </th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-widest">
                      Min Price
                    </th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-widest">
                      Max Price
                    </th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-widest">
                      Spread
                    </th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-widest">
                      Suggested Avg
                    </th>
                    <th className="px-5 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((group) => {
                    const key = group.normalizedTitle;
                    const isApplying = applying.has(key);
                    const isApplied = applied.has(key);

                    return (
                      <tr
                        key={key}
                        className={`border-t border-gray-100 hover:bg-brand-sage/20 ${
                          isApplied ? "bg-green-50" : ""
                        }`}
                      >
                        <td className="px-5 py-3 max-w-xs truncate font-medium text-gray-800">
                          {group.products[0]?.title ?? group.normalizedTitle}
                        </td>
                        <td className="px-5 py-3 text-gray-600">
                          {group.products.length}
                        </td>
                        <td className="px-5 py-3 text-gray-600">
                          {fmt(group.minPrice)}
                        </td>
                        <td className="px-5 py-3 text-gray-600">
                          {fmt(group.maxPrice)}
                        </td>
                        <td className="px-5 py-3">
                          <SpreadBadge spread={group.spread} />
                        </td>
                        <td className="px-5 py-3 font-bold text-gray-800">
                          {group.hasZeroPrices
                            ? fmt(group.nonZeroAvgPrice)
                            : fmt(group.avgPrice)}
                          {group.hasZeroPrices && (
                            <span className="ml-1.5 text-[10px] font-normal text-amber-500 uppercase tracking-wide">excl. $0</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right">
                          {isApplied ? (
                            <span className="inline-flex items-center gap-1.5 text-emerald-600 text-xs font-semibold">
                              ✓ Applied
                            </span>
                          ) : group.hasZeroPrices ? (
                            <button
                              onClick={() => handleApply(group, true)}
                              disabled={isApplying}
                              className="inline-flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white text-xs font-medium px-3 py-1.5 rounded transition-colors"
                            >
                              {isApplying && <Spinner />}
                              {isApplying ? "Fixing…" : "Fix price"}
                            </button>
                          ) : (
                            <button
                              onClick={() => handleApply(group, false)}
                              disabled={isApplying}
                              className="inline-flex items-center gap-1.5 bg-brand-green hover:bg-brand-green/90 disabled:opacity-60 text-white text-xs font-medium px-3 py-1.5 rounded transition-colors"
                            >
                              {isApplying && <Spinner />}
                              {isApplying ? "Applying…" : "Apply avg"}
                            </button>
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
      )}
    </div>
  );
}
