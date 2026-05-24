"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, orderBy, query, limit } from "firebase/firestore/lite";
import { db } from "@/lib/firebase";
import Link from "next/link";
import type { AuditLog } from "@/lib/types";

export default function AuditPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const snap = await getDocs(
          query(collection(db, "auditLogs"), orderBy("syncedAt", "desc"), limit(100))
        );
        setLogs(snap.docs.map((d) => d.data() as AuditLog));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  function formatDate(iso: string) {
    return new Date(iso).toLocaleString("en-AU", {
      day: "numeric", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  }

  return (
    <div className="p-6 lg:p-10 max-w-5xl">
      <div className="mb-8">
        <h1 className="font-display text-4xl leading-none tracking-wide text-brand-green mb-1">Sync Audit Trail</h1>
        <p className="text-gray-500 text-sm">Every inventory sync event, newest first. Last 100 entries.</p>
      </div>

      {loading ? (
        <div className="flex items-center gap-3 text-gray-400 py-20 justify-center">
          <div className="w-5 h-5 border-2 border-gray-200 border-t-brand-green rounded-full animate-spin" />
          Loading audit log…
        </div>
      ) : logs.length === 0 ? (
        <div className="text-center py-24 bg-white rounded-lg border border-gray-200">
          <div className="text-4xl mb-3">📋</div>
          <p className="text-gray-600 font-medium mb-1">No sync events yet</p>
          <p className="text-gray-400 text-sm">Audit entries are created every time you sync a PO to Shopify.</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-gray-200 bg-gray-50">
                <th className="px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-widest">Synced</th>
                <th className="px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-widest">Supplier</th>
                <th className="px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-widest">Invoice</th>
                <th className="px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-widest">Location</th>
                <th className="px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-widest text-center">Synced</th>
                <th className="px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-widest text-center">Missed</th>
                <th className="px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-widest"></th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <>
                  <tr
                    key={log.id}
                    className="border-b border-gray-50 hover:bg-gray-50/60 cursor-pointer"
                    onClick={() => setExpanded(expanded === log.id ? null : log.id)}
                  >
                    <td className="px-5 py-3 text-gray-500 text-xs whitespace-nowrap">{formatDate(log.syncedAt)}</td>
                    <td className="px-5 py-3 font-medium text-gray-800">{log.supplier || "—"}</td>
                    <td className="px-5 py-3 font-mono text-xs text-gray-500">{log.invoiceNumber || "—"}</td>
                    <td className="px-5 py-3 text-gray-500 text-xs">{log.location}</td>
                    <td className="px-5 py-3 text-center">
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                        ✅ {log.successCount}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-center">
                      {log.notFoundCount > 0 ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                          ⚠️ {log.notFoundCount}
                        </span>
                      ) : <span className="text-gray-300 text-xs">—</span>}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <Link
                          href={`/purchase-orders/${log.poId}/review`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs text-brand-green hover:underline font-medium"
                        >
                          View PO
                        </Link>
                        <span className="text-gray-300 text-xs">{expanded === log.id ? "▲" : "▼"}</span>
                      </div>
                    </td>
                  </tr>
                  {expanded === log.id && (
                    <tr key={`${log.id}-detail`} className="border-b border-gray-100 bg-gray-50/40">
                      <td colSpan={7} className="px-5 py-3">
                        <p className="text-[10px] text-gray-400 mb-2 uppercase tracking-widest font-semibold">Line items</p>
                        <div className="grid grid-cols-1 gap-1">
                          {log.items.map((item, i) => (
                            <div key={i} className="flex items-center gap-3 text-xs">
                              <span className={`w-4 shrink-0 ${item.status === "synced" ? "text-emerald-500" : item.status === "not_found" ? "text-amber-500" : "text-red-500"}`}>
                                {item.status === "synced" ? "✓" : item.status === "not_found" ? "⚠" : "✗"}
                              </span>
                              <span className="font-medium text-gray-700 truncate max-w-xs">{item.name}</span>
                              {item.sku && <span className="font-mono text-gray-400">{item.sku}</span>}
                              {item.delta != null && <span className="text-gray-500">+{item.delta} units</span>}
                              {item.landedCost != null && <span className="text-gray-400">cost: ${item.landedCost.toFixed(2)}</span>}
                            </div>
                          ))}
                        </div>
                        <p className="text-[10px] text-gray-300 mt-3 font-mono">{log.referenceDocumentUri}</p>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
