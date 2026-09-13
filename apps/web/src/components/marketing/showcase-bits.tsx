/** Tiny presentational bits for the marketing showcase mockup. */

export function LandingBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
      {children}
    </span>
  );
}
