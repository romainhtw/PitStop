"use client";

import { useEffect, useRef, useState, useCallback } from "react";

export type ScanOutcome = "found" | "duplicate" | "notfound";

export interface ScanResult {
  outcome: ScanOutcome;
  label: string;
  matchedOn?: string;
}

interface BarcodeScannerProps {
  onDetected: (code: string) => void;
  onClose: () => void;
  scanResult?: ScanResult | null;
  totalCounted: number;
}

// ── Audio (created once) ──────────────────────────────────────────────────────
let audioCtx: AudioContext | null = null;
function getAudioCtx() {
  if (!audioCtx || audioCtx.state === "closed") audioCtx = new AudioContext();
  return audioCtx;
}
function playTone(type: ScanOutcome) {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    const cfg = {
      found:     { freq: 1200, dur: 0.10, vol: 0.22 },
      duplicate: { freq: 880,  dur: 0.08, vol: 0.15 },
      notfound:  { freq: 280,  dur: 0.28, vol: 0.18 },
    }[type];
    osc.frequency.value = cfg.freq;
    gain.gain.setValueAtTime(cfg.vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + cfg.dur);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + cfg.dur);
  } catch {}
}
function vibrate(type: ScanOutcome) {
  if (!("vibrate" in navigator)) return;
  const patterns: Record<ScanOutcome, number[]> = {
    found:     [180],
    duplicate: [60],
    notfound:  [100, 60, 100],
  };
  navigator.vibrate(patterns[type]);
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function BarcodeScanner({ onDetected, onClose, scanResult, totalCounted }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<ScanOutcome | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const lastCodeRef = useRef<string>("");
  const cooldownRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  const handleRaw = useCallback((code: string) => {
    if (code === lastCodeRef.current) return;
    lastCodeRef.current = code;
    if (cooldownRef.current) clearTimeout(cooldownRef.current);
    cooldownRef.current = setTimeout(() => { lastCodeRef.current = ""; }, 1600);
    onDetected(code);
  }, [onDetected]);

  // Flash + haptic when parent reports result
  useEffect(() => {
    if (!scanResult) return;
    playTone(scanResult.outcome);
    vibrate(scanResult.outcome);
    setFlash(scanResult.outcome);
    const t = setTimeout(() => setFlash(null), 600);
    return () => clearTimeout(t);
  }, [scanResult]);

  // Start camera — getUserMedia owns the stream, ZXing only decodes
  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    setError(null);

    async function start() {
      try {
        // Open camera ourselves — facingMode:environment = rear camera on mobile
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width:  { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });

        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        if (!videoRef.current) return;

        // Attach stream directly to <video>
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});

        // ZXing decodes from the stream (no camera management by ZXing)
        const { BrowserMultiFormatReader, BarcodeFormat } = await import("@zxing/browser");
        const { DecodeHintType } = await import("@zxing/library");
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.EAN_13, BarcodeFormat.EAN_8,
          BarcodeFormat.CODE_128, BarcodeFormat.CODE_39,
          BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
          BarcodeFormat.QR_CODE, BarcodeFormat.DATA_MATRIX, BarcodeFormat.ITF,
        ]);
        hints.set(DecodeHintType.TRY_HARDER, true);
        hints.set(DecodeHintType.ASSUME_GS1, true);

        const reader = new BrowserMultiFormatReader(hints, {
          delayBetweenScanAttempts: 80,
          delayBetweenScanSuccess: 1600,
        });

        if (!videoRef.current || cancelled) return;
        const controls = await reader.decodeFromStream(stream, videoRef.current, (result) => {
          if (cancelled || !result) return;
          handleRaw(result.getText());
        });

        stopRef.current = () => {
          controls.stop();
          stream?.getTracks().forEach(t => t.stop());
        };
      } catch (e) {
        if (cancelled) return;
        stream?.getTracks().forEach(t => t.stop());
        const name = e instanceof DOMException ? e.name : "";
        if (name === "NotAllowedError" || name === "PermissionDeniedError") {
          setError("permission_denied");
        } else {
          setError("retry");
        }
      }
    }

    start();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach(t => t.stop());
      stopRef.current?.();
    };
  }, [handleRaw, retryKey]);

  const borderCls =
    flash === "found"     ? "border-green-400"  :
    flash === "duplicate" ? "border-yellow-400" :
    flash === "notfound"  ? "border-red-500"    :
    "border-brand-green/50";

  const overlayBg =
    flash === "found"     ? "bg-green-400/10"  :
    flash === "duplicate" ? "bg-yellow-400/10" :
    flash === "notfound"  ? "bg-red-500/10"    :
    "bg-transparent";

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">

      {/* Top bar */}
      <div className="flex items-center justify-between px-5 py-4 shrink-0">
        <div>
          <p className="text-white font-semibold text-sm">Scanning</p>
          <p className="text-gray-400 text-xs mt-0.5">Point at any barcode, QR or label</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Live counter */}
          <div className="bg-brand-green text-white rounded-full w-12 h-12 flex flex-col items-center justify-center shadow-lg">
            <span className="text-lg font-bold leading-none">{totalCounted}</span>
            <span className="text-[8px] opacity-75 uppercase tracking-wide">items</span>
          </div>
          <button onClick={onClose} className="text-white text-2xl leading-none hover:text-gray-300 transition-colors w-9 h-9 flex items-center justify-center">
            &times;
          </button>
        </div>
      </div>

      {/* Viewfinder */}
      <div className={`relative flex-1 border-4 transition-colors duration-150 ${borderCls}`}>
        {error ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900 text-center px-8 gap-4">
            {error === "permission_denied" ? (
              <>
                <svg className="w-10 h-10 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
                </svg>
                <div>
                  <p className="text-white font-semibold text-sm mb-1">Camera access blocked</p>
                  <p className="text-gray-400 text-xs leading-relaxed">
                    Allow camera access in your browser settings.
                  </p>
                </div>
                <div className="bg-gray-800 rounded-lg px-4 py-3 text-left max-w-xs w-full">
                  <p className="text-gray-300 text-xs font-semibold mb-1.5">To enable:</p>
                  <ol className="text-gray-400 text-xs space-y-1 list-decimal list-inside">
                    <li>Tap the <span className="text-white font-medium">lock icon</span> in the address bar</li>
                    <li>Select <span className="text-white font-medium">Camera → Allow</span></li>
                    <li>Come back and tap Retry</li>
                  </ol>
                </div>
                <button
                  onClick={() => setRetryKey((k) => k + 1)}
                  className="mt-1 px-5 py-2 bg-accent text-white text-sm font-semibold rounded-lg"
                >
                  Retry
                </button>
              </>
            ) : (
              <>
                <svg className="w-10 h-10 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
                <p className="text-white font-semibold text-sm">Camera couldn&apos;t start</p>
                <p className="text-gray-400 text-xs">The camera may be in use by another app.</p>
                <button
                  onClick={() => setRetryKey((k) => k + 1)}
                  className="mt-1 px-5 py-2 bg-accent text-white text-sm font-semibold rounded-lg"
                >
                  Try again
                </button>
              </>
            )}
          </div>
        ) : (
          <>
            <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" playsInline muted autoPlay />
            <div className={`absolute inset-0 pointer-events-none transition-colors duration-150 ${overlayBg}`} />
            {/* Target guide */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="relative w-72 h-44">
                {["top-0 left-0 border-t-2 border-l-2", "top-0 right-0 border-t-2 border-r-2",
                  "bottom-0 left-0 border-b-2 border-l-2", "bottom-0 right-0 border-b-2 border-r-2"]
                  .map((cls, i) => <div key={i} className={`absolute w-6 h-6 border-white/60 ${cls}`} />)}
                <div className="absolute left-2 right-2 top-1/2 -translate-y-1/2 h-px bg-brand-green/70 animate-pulse" />
              </div>
            </div>
          </>
        )}
      </div>

      {/* Result bar */}
      <div className="shrink-0 min-h-[60px] flex items-center px-5 py-3 bg-gray-950">
        {scanResult ? (
          <div className="flex items-center gap-3 w-full">
            <span className={`text-xl leading-none font-bold ${
              scanResult.outcome === "found"     ? "text-green-400"  :
              scanResult.outcome === "duplicate" ? "text-yellow-400" : "text-red-400"
            }`}>
              {scanResult.outcome === "found" ? "✓" : scanResult.outcome === "duplicate" ? "↑" : "✗"}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-medium truncate">{scanResult.label}</p>
              <p className="text-[10px] mt-0.5">
                {scanResult.outcome === "found"     && <span className="text-gray-500 uppercase tracking-wide">matched on {scanResult.matchedOn}</span>}
                {scanResult.outcome === "duplicate" && <span className="text-yellow-500/70">Already scanned — qty incremented</span>}
                {scanResult.outcome === "notfound"  && <span className="text-red-400/70">No match — check SKU or add to catalog</span>}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-gray-600 text-xs mx-auto">Waiting for scan…</p>
        )}
      </div>
    </div>
  );
}
