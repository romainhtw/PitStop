"use client";

import { useEffect, useRef, useState } from "react";

interface BarcodeScannerProps {
  onDetected: (code: string) => void;
  onClose: () => void;
}

export default function BarcodeScanner({ onDetected, onClose }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastCode, setLastCode] = useState<string | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      try {
        const { BrowserMultiFormatReader, BarcodeFormat } = await import("@zxing/browser");
        const { DecodeHintType } = await import("@zxing/library");

        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.CODE_128,
          BarcodeFormat.CODE_39,
          BarcodeFormat.UPC_A,
          BarcodeFormat.UPC_E,
          BarcodeFormat.QR_CODE,
        ]);
        hints.set(DecodeHintType.TRY_HARDER, true);

        const reader = new BrowserMultiFormatReader(hints);

        if (!videoRef.current || cancelled) return;

        const controls = await reader.decodeFromVideoDevice(undefined, videoRef.current, (result, err) => {
          if (cancelled) return;
          if (result) {
            const code = result.getText();
            setLastCode(code);
            onDetected(code);
          }
          void err;
        });

        stopRef.current = () => controls.stop();
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : "Camera error";
          if (msg.includes("Permission") || msg.includes("permission")) {
            setError("Camera permission denied. Please allow camera access and try again.");
          } else {
            setError(msg);
          }
        }
      }
    }

    start();

    return () => {
      cancelled = true;
      stopRef.current?.();
    };
  }, [onDetected]);

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center">
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-5 py-4">
        <div>
          <p className="text-white font-semibold text-sm">Barcode Scanner</p>
          <p className="text-gray-400 text-xs mt-0.5">Point camera at a barcode or SKU label</p>
        </div>
        <button
          onClick={onClose}
          className="text-white text-2xl leading-none hover:text-gray-300 transition-colors w-9 h-9 flex items-center justify-center"
          aria-label="Close scanner"
        >
          &times;
        </button>
      </div>

      {/* Viewfinder */}
      <div className="relative w-full max-w-sm aspect-[3/4] rounded-xl overflow-hidden border-2 border-brand-green/60 shadow-2xl">
        {error ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900 text-center px-6">
            <svg className="w-10 h-10 text-red-400 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
            </svg>
            <p className="text-red-300 text-sm font-medium">{error}</p>
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              className="absolute inset-0 w-full h-full object-cover"
              playsInline
              muted
              autoPlay
            />
            {/* Scan line animation */}
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute left-6 right-6 top-1/2 -translate-y-1/2 h-0.5 bg-brand-green/80 animate-pulse" />
              {/* Corner markers */}
              {[
                "top-4 left-4 border-t-2 border-l-2 rounded-tl-sm",
                "top-4 right-4 border-t-2 border-r-2 rounded-tr-sm",
                "bottom-4 left-4 border-b-2 border-l-2 rounded-bl-sm",
                "bottom-4 right-4 border-b-2 border-r-2 rounded-br-sm",
              ].map((cls, i) => (
                <div key={i} className={`absolute w-6 h-6 border-brand-green ${cls}`} />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Last detected */}
      <div className="absolute bottom-0 left-0 right-0 px-5 pb-8 text-center">
        {lastCode ? (
          <div className="bg-brand-green/20 border border-brand-green/40 rounded-xl px-4 py-3 inline-block">
            <p className="text-[10px] text-brand-green/70 uppercase tracking-widest font-semibold mb-0.5">Last scanned</p>
            <p className="text-white font-mono text-sm font-semibold">{lastCode}</p>
          </div>
        ) : (
          !error && (
            <p className="text-gray-500 text-xs">Waiting for barcode…</p>
          )
        )}
      </div>
    </div>
  );
}
