import logoUrl from "@/assets/logo.svg";
import { cn } from "@/lib/utils";

export function BrandLogo({ className, decorative = false }) {
  return (
    <img
      className={cn("brand-logo", className)}
      src={logoUrl}
      alt={decorative ? "" : "Draftly 织巢鸟 Logo"}
      aria-hidden={decorative || undefined}
    />
  );
}

export function BrandLockup({ className, compact = false }) {
  return (
    <span className={cn("brand-lockup-inner", compact && "is-compact", className)}>
      <BrandLogo decorative />
      <span className="brand-lockup-copy">
        <strong>Draftly</strong>
        {!compact ? <small>prototype studio</small> : null}
      </span>
    </span>
  );
}
