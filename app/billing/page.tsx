"use client";

import { useEffect, useState } from "react";
import { db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore/lite";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

interface BillingDoc {
  status?: string;
  planName?: string;
  currentPeriodEnd?: string;
  customerId?: string;
  subscriptionId?: string;
}

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  trialing: "Trial",
  past_due: "Past due",
  canceled: "Cancelled",
  unpaid: "Unpaid",
  paused: "Paused",
};

const STATUS_COLOR: Record<string, string> = {
  active: "text-emerald-700 bg-emerald-50",
  trialing: "text-blue-700 bg-blue-50",
  past_due: "text-amber-700 bg-amber-50",
  canceled: "text-red-700 bg-red-50",
  unpaid: "text-red-700 bg-red-50",
  paused: "text-gray-600 bg-gray-100",
};

function BillingContent() {
  const [billing, setBilling] = useState<BillingDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const success = searchParams.get("success");
  const cancelled = searchParams.get("cancelled");

  useEffect(() => {
    async function load() {
      try {
        const snap = await getDoc(doc(db, "settings", "billing"));
        if (snap.exists()) setBilling(snap.data() as BillingDoc);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load billing info");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [success]);

  async function handleSubscribe() {
    setActionLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", { method: "POST" });
      const data = await res.json() as { url?: string; error?: string };
      if (data.error) throw new Error(data.error);
      if (data.url) window.location.href = data.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start checkout");
      setActionLoading(false);
    }
  }

  async function handleManage() {
    setActionLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const data = await res.json() as { url?: string; error?: string };
      if (data.error) throw new Error(data.error);
      if (data.url) window.location.href = data.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to open portal");
      setActionLoading(false);
    }
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString("en-AU", {
      day: "numeric", month: "long", year: "numeric",
    });
  }

  const isActive = billing?.status === "active" || billing?.status === "trialing";
  const status = billing?.status;

  return (
    <div className="p-6 lg:p-10 max-w-2xl">
      <div className="mb-8">
        <h1 className="font-display text-4xl leading-none tracking-wide text-brand-green mb-1">
          Billing
        </h1>
        <p className="text-gray-500 text-sm">Manage your PitStop subscription.</p>
      </div>

      {success === "1" && (
        <div className="mb-6 p-4 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-medium">
          Subscription activated — welcome to PitStop!
        </div>
      )}
      {cancelled === "1" && (
        <div className="mb-6 p-4 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
          Checkout cancelled. Your subscription was not changed.
        </div>
      )}
      {error && (
        <div className="mb-6 p-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-3 text-gray-400 py-20 justify-center">
          <div className="w-5 h-5 border-2 border-gray-200 border-t-brand-green rounded-full animate-spin" />
          Loading…
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {/* Plan header */}
          <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
            <div>
              <p className="text-[11px] text-gray-400 uppercase tracking-widest font-semibold mb-1">Current plan</p>
              <p className="text-lg font-semibold text-gray-900">
                {billing?.planName ?? "PitStop"}
              </p>
            </div>
            {status && (
              <span className={`text-xs font-semibold px-3 py-1 rounded-full ${STATUS_COLOR[status] ?? "text-gray-600 bg-gray-100"}`}>
                {STATUS_LABEL[status] ?? status}
              </span>
            )}
          </div>

          {/* Details */}
          <div className="px-6 py-5 space-y-4">
            {isActive && billing?.currentPeriodEnd && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">Next renewal</span>
                <span className="font-medium text-gray-800">{formatDate(billing.currentPeriodEnd)}</span>
              </div>
            )}
            {!isActive && (
              <div className="rounded-lg bg-gray-50 border border-gray-200 p-4">
                <p className="text-sm font-medium text-gray-700 mb-1">No active subscription</p>
                <p className="text-xs text-gray-500">
                  Subscribe to unlock unlimited invoice parsing, Shopify sync, reorder intelligence, and all PitStop features.
                </p>
              </div>
            )}

            {/* Features list */}
            <ul className="space-y-2 pt-1">
              {[
                "Unlimited invoice parsing (PDF + image)",
                "Shopify inventory sync — all locations",
                "Sales velocity & reorder intelligence",
                "Multi-location transfers",
                "Stock take with barcode scanner",
                "Price audit & catalogue management",
              ].map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm text-gray-600">
                  <svg className="w-4 h-4 text-emerald-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  {f}
                </li>
              ))}
            </ul>
          </div>

          {/* Action footer */}
          <div className="px-6 py-4 border-t border-gray-100 bg-gray-50/60 flex items-center justify-between gap-3">
            <p className="text-xs text-gray-400">
              Powered by Stripe. Cancel anytime.
            </p>
            {isActive ? (
              <button
                onClick={handleManage}
                disabled={actionLoading}
                className="inline-flex items-center gap-2 text-sm font-medium border border-gray-200 text-gray-600 hover:border-brand-green hover:text-brand-green px-4 py-2 rounded transition-colors disabled:opacity-50"
              >
                {actionLoading && <span className="w-4 h-4 border-2 border-gray-300 border-t-brand-green rounded-full animate-spin" />}
                Manage subscription
              </button>
            ) : (
              <button
                onClick={handleSubscribe}
                disabled={actionLoading}
                className="inline-flex items-center gap-2 text-sm font-semibold bg-brand-green text-white hover:bg-brand-green/90 px-5 py-2 rounded transition-colors disabled:opacity-50"
              >
                {actionLoading && <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
                Subscribe now
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function BillingPage() {
  return (
    <Suspense>
      <BillingContent />
    </Suspense>
  );
}
