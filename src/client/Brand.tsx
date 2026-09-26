type BrandMarkProps = {
  className?: string;
  title?: string;
};

type BrandLockupProps = {
  className?: string;
  compact?: boolean;
  inverse?: boolean;
};

export function BrandMark({ className = "", title }: BrandMarkProps) {
  return <svg
    className={`brand-glyph ${className}`.trim()}
    viewBox="0 0 64 64"
    role={title ? "img" : undefined}
    aria-hidden={title ? undefined : true}
    aria-label={title}
    focusable="false"
  >
    {title && <title>{title}</title>}
    <rect width="64" height="64" rx="17" fill="currentColor" />
    <path d="M13 18.5 32 9l19 9.5L32 28 13 18.5Z" fill="var(--brand-signal, #F25F3A)" />
    <path d="m13 31.8 19 9.5 19-9.5v8.7L32 50 13 40.5v-8.7Z" fill="var(--brand-paper, #FFF9ED)" />
    <path d="m13 45.4 19 9.5 19-9.5v4.8L32 59.7 13 50.2v-4.8Z" fill="var(--brand-live, #D9FF72)" />
    <circle cx="51" cy="18.5" r="3.4" fill="var(--brand-live, #D9FF72)" />
  </svg>;
}

export function BrandLockup({ className = "", compact = false, inverse = false }: BrandLockupProps) {
  return <span className={`brand-lockup ${compact ? "brand-lockup-compact" : ""} ${inverse ? "brand-lockup-inverse" : ""} ${className}`.trim()} translate="no">
    <BrandMark />
    <span className="brand-lockup-copy">
      <strong>Operating Layer</strong>
      {!compact && <small>The system between order and outcome.</small>}
    </span>
  </span>;
}
