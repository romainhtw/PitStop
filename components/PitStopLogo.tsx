export default function PitStopLogo({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      {/* Mark: stylised pit-stop flag corner */}
      <svg
        width="28"
        height="28"
        viewBox="0 0 28 28"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="shrink-0"
      >
        {/* Checkered 2×2 grid, top-left */}
        <rect x="0" y="0" width="13" height="13" fill="currentColor" />
        <rect x="15" y="0" width="13" height="13" fill="currentColor" opacity="0.18" />
        <rect x="0" y="15" width="13" height="13" fill="currentColor" opacity="0.18" />
        <rect x="15" y="15" width="13" height="13" fill="currentColor" />
        {/* Speed slash across the middle */}
        <line x1="0" y1="28" x2="28" y2="0" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
      </svg>

      {/* Wordmark */}
      <div className="font-display leading-none tracking-widest select-none">
        <span className="text-[26px] text-current">PIT</span>
        <span className="text-[26px] text-current opacity-40">STOP</span>
      </div>
    </div>
  );
}
