"use client";

import Link from "next/link";
import PitStopLogo from "@/components/PitStopLogo";

interface TopBarProps {
  onOpenSidebar: () => void;
}

export default function TopBar({ onOpenSidebar }: TopBarProps) {
  return (
    <header className="bg-white border-b border-gray-200 px-4 py-2.5 flex items-center justify-between sticky top-0 z-20 lg:hidden">
      <button
        onClick={onOpenSidebar}
        className="flex flex-col gap-1 p-1 text-gray-600 hover:text-brand-green transition-colors"
        aria-label="Open menu"
      >
        <span className="block w-5 h-0.5 bg-current" />
        <span className="block w-5 h-0.5 bg-current" />
        <span className="block w-5 h-0.5 bg-current" />
      </button>
      <Link href="/dashboard"><PitStopLogo className="text-brand-green" /></Link>
      <span className="w-7" aria-hidden="true" />
    </header>
  );
}
