"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import BackButton from "@/components/BackButton";

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
      const accepted = ["application/pdf", "image/png", "image/jpeg", "image/jpg", "image/webp"];
      if (!accepted.includes(file.type)) {
        setError("Please upload a PDF, PNG, or JPEG file.");
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
            `Server error (HTTP ${res.status}). Please try again.`
          );
        }

        if (data.error) throw new Error(data.error as string);
        if (!data.jobId) throw new Error("Unexpected response from server — please try again.");
        router.push(`/purchase-orders/processing/${data.jobId}`);
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
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="font-display text-4xl leading-none tracking-wide text-brand-green mb-2">
            New Purchase Order
          </h1>
          <p className="text-gray-500 text-sm">
            Upload an invoice to parse automatically, or enter line items manually.
          </p>
        </div>
        <Link
          href="/purchase-orders/new/manual"
          className="inline-flex items-center gap-2 border border-gray-200 text-gray-600 hover:border-brand-green hover:text-brand-green text-sm font-medium px-4 py-2 rounded transition-colors shrink-0"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
          Enter manually
        </Link>
      </div>

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
        className={`rounded-lg border-2 border-dashed py-20 px-12 text-center transition-colors ${
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
          accept="application/pdf,image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />

        {loading ? (
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-4 border-brand-sage border-t-brand-green rounded-full animate-spin" />
            <p className="text-brand-green font-medium">Uploading invoice&hellip;</p>
            {filename && <p className="text-sm text-gray-400">{filename}</p>}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <svg className="w-10 h-10 text-brand-sage" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m.75 12l3 3m0 0l3-3m-3 3v-6m-1.5-9H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            <p className="text-brand-green font-semibold">Drop an invoice here</p>
            <p className="text-gray-400 text-sm">PDF, PNG, or JPEG — or click to choose</p>
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
