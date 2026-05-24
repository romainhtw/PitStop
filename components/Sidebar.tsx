"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import PitStopLogo from "@/components/PitStopLogo";

type ViewMode = "auto" | "mobile" | "desktop";

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export default function Sidebar({ open, onClose }: SidebarProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("auto");
  const pathname = usePathname();

  // Load stored preference on mount
  useEffect(() => {
    const stored = localStorage.getItem("pitStop_viewMode") as ViewMode | null;
    if (stored === "mobile" || stored === "desktop") {
      setViewMode(stored);
      applyViewMode(stored);
    }
  }, []);

  function applyViewMode(mode: ViewMode) {
    const html = document.documentElement;
    html.classList.remove("force-mobile", "force-desktop");
    if (mode === "mobile") html.classList.add("force-mobile");
    if (mode === "desktop") html.classList.add("force-desktop");
  }

  function cycleViewMode() {
    const next: Record<ViewMode, ViewMode> = {
      auto: "mobile",
      mobile: "desktop",
      desktop: "auto",
    };
    const nextMode = next[viewMode];
    setViewMode(nextMode);
    applyViewMode(nextMode);
    if (nextMode === "auto") {
      localStorage.removeItem("pitStop_viewMode");
    } else {
      localStorage.setItem("pitStop_viewMode", nextMode);
    }
  }

  const modeLabel: Record<ViewMode, string> = {
    auto: "Auto",
    mobile: "Mobile",
    desktop: "Desktop",
  };

  const modeIcon: Record<ViewMode, string> = {
    auto: "⊞",
    mobile: "📱",
    desktop: "🖥",
  };

  function navClass(href: string) {
    const isActive =
      href === "/purchase-orders/new"
        ? pathname.startsWith("/purchase-orders")
        : pathname === href || (href !== "/purchase-orders/new" && pathname.startsWith(href + "/") && href !== "/");
    return isActive
      ? "flex items-center px-3 py-2 rounded text-sm font-semibold bg-brand-sage/60 text-brand-green"
      : "flex items-center px-3 py-2 rounded text-sm font-medium text-gray-600 hover:bg-brand-sage/30 hover:text-brand-green transition-colors";
  }

  return (
    <>
      {/* Mobile overlay — click to close */}
      {open && (
        <div
          className="fixed inset-0 bg-black/30 z-30 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        data-open={open ? "true" : "false"}
        className={[
          // Base styles
          "fixed left-0 top-0 h-screen w-56 bg-[#eef1ee] border-r border-gray-200 flex flex-col",
          // Desktop: always visible
          "lg:translate-x-0",
          // Mobile: drawer — slide in/out
          "z-40 transition-transform duration-200 ease-in-out",
          open ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        ].join(" ")}
      >
        {/* Mobile close button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 text-xl leading-none lg:hidden"
          aria-label="Close menu"
        >
          &times;
        </button>

        <div className="px-6 py-5 border-b border-gray-200">
          <Link href="/dashboard" className="flex flex-col gap-2.5" onClick={onClose}>
            <PitStopLogo className="text-brand-green" />
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-gray-400 uppercase tracking-widest">by</span>
              <Image
                src="/logo.png"
                alt="Elite Racing Cycles"
                width={120}
                height={60}
                className="w-24 h-auto"
                priority
              />
            </div>
          </Link>
        </div>

        <nav className="flex-1 px-3 py-4 overflow-y-auto">

          {/* ── STOCK ───────────────────────────────────────── */}
          <p className="px-3 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-400">Stock</p>
          <Link href="/purchase-orders/new" className={navClass("/purchase-orders/new")} onClick={onClose}>
            Purchase Orders
          </Link>
          <Link href="/stock-take" className={navClass("/stock-take")} onClick={onClose}>
            Stock Take
          </Link>
          <Link href="/reorder" className={navClass("/reorder")} onClick={onClose}>
            Reorder
          </Link>

          {/* ── CATALOG ─────────────────────────────────────── */}
          <p className="px-3 pt-4 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-400">Catalog</p>
          <Link href="/catalog" className={navClass("/catalog")} onClick={onClose}>
            Catalog
          </Link>
          <Link href="/price-audit" className={navClass("/price-audit")} onClick={onClose}>
            Price Audit
          </Link>
          <Link href="/transfers" className={navClass("/transfers")} onClick={onClose}>
            Transfers
          </Link>

          {/* ── INSIGHTS ────────────────────────────────────── */}
          <p className="px-3 pt-4 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-400">Insights</p>
          <Link href="/dashboard" className={navClass("/dashboard")} onClick={onClose}>
            Dashboard
          </Link>
          <Link href="/audit" className={navClass("/audit")} onClick={onClose}>
            Audit Trail
          </Link>

        </nav>

        <div className="px-4 py-4 border-t border-gray-200 space-y-1">
          {/* Billing as settings-style link */}
          <Link
            href="/billing"
            className={`flex items-center gap-2 px-3 py-2 rounded text-sm transition-colors ${
              pathname === "/billing"
                ? "text-brand-green font-semibold"
                : "text-gray-400 hover:text-gray-600"
            }`}
            onClick={onClose}
          >
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
            </svg>
            Billing
          </Link>
          <button
            onClick={cycleViewMode}
            className="flex items-center gap-2 px-3 py-2 text-[11px] text-gray-400 hover:text-brand-green transition-colors w-full rounded"
            title="Cycle view: auto → mobile → desktop"
          >
            <span className="text-base leading-none">{modeIcon[viewMode]}</span>
            <span>View: {modeLabel[viewMode]}</span>
          </button>
          <p className="px-3 text-[10px] text-gray-300">Perth, WA</p>
        </div>
      </aside>
    </>
  );
}
