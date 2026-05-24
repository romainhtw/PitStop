"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import BackButton from "@/components/BackButton";

const STEPS = [
  { label: "Reading document",       pct: 12 },
  { label: "Identifying line items", pct: 32 },
  { label: "Extracting prices & quantities", pct: 54 },
  { label: "Matching SKUs & barcodes", pct: 70 },
  { label: "Calculating totals",     pct: 83 },
  { label: "Almost ready",           pct: 94 },
];

function ParseProgress({ filename }: { filename: string | null }) {
  const [stepIdx, setStepIdx] = useState(0);
  const [pct, setPct] = useState(0);

  // Animate progress toward the current step target
  useEffect(() => {
    const target = STEPS[stepIdx]?.pct ?? 94;
    if (pct >= target) return;
    const id = setInterval(() => {
      setPct((p) => {
        const next = p + 1;
        if (next >= target) { clearInterval(id); return target; }
        return next;
      });
    }, 30);
    return () => clearInterval(id);
  }, [stepIdx, pct]);

  // Advance steps on a timer
  useEffect(() => {
    if (stepIdx >= STEPS.length - 1) return;
    const delay = stepIdx === 0 ? 1800 : 4500;
    const id = setTimeout(() => setStepIdx((i) => i + 1), delay);
    return () => clearTimeout(id);
  }, [stepIdx]);

  const label = STEPS[stepIdx]?.label ?? "Almost ready";

  return (
    <div className="flex flex-col items-center gap-5 w-full max-w-sm mx-auto">
      {/* Percentage */}
      <div className="text-5xl font-display font-bold text-brand-green tabular-nums leading-none">
        {pct}<span className="text-2xl">%</span>
      </div>

      {/* Progress bar */}
      <div className="w-full h-1.5 bg-brand-sage/30 rounded-full overflow-hidden">
        <div
          className="h-full bg-brand-green rounded-full transition-all duration-300 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Step label with pulsing dot */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-green opacity-60" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-green" />
        </span>
        <span className="font-medium text-brand-green">{label}&hellip;</span>
      </div>

      {/* Filename */}
      {filename && (
        <p className="text-xs text-gray-400 truncate max-w-full px-4">{filename}</p>
      )}
    </div>
  );
}

export default function NewPurchaseOrderPage() {
  const router = useRouter();
  const [dragging, setDragging] = useState(false);
  const [filename, setFilename] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      if (file.type !== "application/pdf") {
        setError("Please upload a PDF file.");
        return;
      }
      setFilename(file.name);
      setLoading(true);

      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/parse-invoice", { method: "POST", body: fd });

        let data: Record<string, unknown>;
        try {
          data = await res.json();
        } catch {
          throw new Error(
            `Server error (HTTP ${res.status}). The request may have timed out — try again.`
          );
        }

        if (data.error) throw new Error(data.error as string);
        if (!data.id) throw new Error("Unexpected response from server — please try again.");
        router.push(`/purchase-orders/${data.id}/review`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
        setLoading(false);
      }
    },
    [router]
  );

  return (
    <div className="p-10 max-w-4xl">
      <div className="mb-4"><BackButton /></div>
      <h1 className="font-display text-4xl leading-none tracking-wide text-brand-green mb-2">
        New Purchase Order
      </h1>
      <p className="text-gray-500 mb-8 text-sm">
        Drop a supplier invoice PDF below — we&apos;ll extract the line items for you to review.
      </p>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) handleFile(file);
        }}
        onClick={() => !loading && inputRef.current?.click()}
        className={`rounded-lg border-2 border-dashed py-16 px-12 text-center transition-colors ${
          loading
            ? "border-brand-sage bg-brand-sage/10 cursor-default"
            : dragging
            ? "border-brand-green bg-brand-sage/40 cursor-copy"
            : "border-brand-sage bg-white hover:border-brand-green hover:bg-brand-sage/20 cursor-pointer"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />

        {loading ? (
          <ParseProgress filename={filename} />
        ) : (
          <div className="flex flex-col items-center gap-2">
            <svg className="w-10 h-10 text-brand-sage" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m.75 12l3 3m0 0l3-3m-3 3v-6m-1.5-9H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            <p className="text-brand-green font-semibold">Drop a PDF invoice here</p>
            <p className="text-gray-400 text-sm">or click to choose a file</p>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-6 p-4 rounded bg-red-50 border border-red-200 text-red-700 text-sm">
          {error}
        </div>
      )}
    </div>
  );
}
