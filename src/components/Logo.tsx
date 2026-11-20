/** The FORGE mark: a half-round and a block, split by one orange line. */
export function LogoMark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="110 136 795 750" className={className} aria-hidden="true">
      <path fill="#0B0B0B" d="M486 136A375 375 0 0 0 486 886Z" />
      <rect fill="#F97316" x="486" y="136" width="39" height="750" />
      <path fill="#0B0B0B" d="M525 136H860Q905 136 905 181V841Q905 886 860 886H525Z" />
    </svg>
  );
}

/** Mark plus the FORGE wordmark, as on the landing page. */
export function Logo({ size = "md" }: { size?: "sm" | "md" }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark className={size === "sm" ? "h-5 w-[21px]" : "h-[26px] w-[28px]"} />
      <span
        className={`font-display leading-none tracking-[0.06em] text-[#0B0B0B] ${
          size === "sm" ? "text-[17px]" : "text-[22px]"
        }`}
      >
        FORGE
      </span>
    </span>
  );
}
