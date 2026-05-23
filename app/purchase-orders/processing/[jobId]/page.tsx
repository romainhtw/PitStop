"use client";

import { useRouter, useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";

type JobStatus = "queued" | "parsing" | "saving" | "done" | "error";

const STATUS_STEPS: { status: JobStatus; label: string }[] = [
  { status: "queued", label: "Uploading invoice" },
  { status: "parsing", label: "AI is reading the invoice" },
  { status: "saving", label: "Saving purchase order" },
  { status: "done", label: "Done" },
];

function stepIndex(status: JobStatus): number {
  return STATUS_STEPS.findIndex((s) => s.status === status);
}

export default function ProcessingPage() {
  const router = useRouter();
  const params = useParams<{ jobId: string }>();
  const jobId = params.jobId;

  const [status, setStatus] = useState<JobStatus>("queued");
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startRef = useRef(Date.now());

  // Elapsed timer
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  // Polling
  useEffect(() => {
    if (!jobId) return;

    const poll = async () => {
      try {
        const res = await fetch(`/api/parse-invoice/status?jobId=${jobId}`);
        if (!res.ok) return;
        const data = await res.json() as { status: JobStatus; poId?: string; error?: string };

        setStatus(data.status);

        if (data.status === "done" && data.poId) {
          if (pollRef.current) clearInterval(pollRef.current);
          if (intervalRef.current) clearInterval(intervalRef.current);
          router.push(`/purchase-orders/${data.poId}/review`);
        } else if (data.status === "error") {
          if (pollRef.current) clearInterval(pollRef.current);
          if (intervalRef.current) clearInterval(intervalRef.current);
          setError(data.error ?? "Invoice parsing failed. Please try again.");
        }
      } catch {
        // network blip — keep polling
      }
    };

    poll();
    pollRef.current = setInterval(poll, 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [jobId, router]);

  const currentStep = stepIndex(status);
  const isError = status === "error";

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8">
      <div className="w-full max-w-md">

        {/* Icon */}
        <div className="flex justify-center mb-8">
          {isError ? (
            <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center">
              <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
          ) : (
            <div className="w-16 h-16 rounded-full bg-brand-sage/30 flex items-center justify-center">
              <div className="w-8 h-8 border-4 border-brand-sage border-t-brand-green rounded-full animate-spin" />
            </div>
          )}
        </div>

        {/* Title */}
        <h1 className="font-display text-2xl text-brand-green text-center mb-2 tracking-wide">
          {isError ? "Parsing failed" : "Processing invoice"}
        </h1>
        <p className="text-gray-400 text-sm text-center mb-10">
          {isError
            ? "Something went wrong. Please try uploading again."
            : `${elapsed}s — this usually takes 20–40 seconds`}
        </p>

        {/* Step list */}
        {!isError && (
          <ol className="space-y-4 mb-10">
            {STATUS_STEPS.filter((s) => s.status !== "done").map((step, i) => {
              const done = currentStep > i;
              const active = currentStep === i;
              return (
                <li key={step.status} className="flex items-center gap-4">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 border-2 transition-colors ${
                    done
                      ? "bg-brand-green border-brand-green"
                      : active
                      ? "border-brand-green bg-white"
                      : "border-gray-200 bg-white"
                  }`}>
                    {done ? (
                      <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : active ? (
                      <div className="w-2.5 h-2.5 rounded-full bg-brand-green animate-pulse" />
                    ) : (
                      <div className="w-2.5 h-2.5 rounded-full bg-gray-200" />
                    )}
                  </div>
                  <span className={`text-sm font-medium transition-colors ${
                    done ? "text-brand-green" : active ? "text-gray-900" : "text-gray-300"
                  }`}>
                    {step.label}
                  </span>
                </li>
              );
            })}
          </ol>
        )}

        {/* Error state */}
        {isError && (
          <div className="space-y-4">
            {error && (
              <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
                {error}
              </div>
            )}
            <Link
              href="/purchase-orders/new"
              className="block w-full text-center py-3 rounded-lg bg-brand-green text-white text-sm font-medium hover:bg-brand-green/90 transition-colors"
            >
              Try again
            </Link>
            <Link
              href="/purchase-orders/new/manual"
              className="block w-full text-center py-3 rounded-lg border border-gray-200 text-gray-600 text-sm font-medium hover:border-brand-green hover:text-brand-green transition-colors"
            >
              Enter manually instead
            </Link>
          </div>
        )}

        {/* Reassurance */}
        {!isError && (
          <p className="text-center text-xs text-gray-300">
            You can leave this page — the job will keep running.
          </p>
        )}
      </div>
    </div>
  );
}
