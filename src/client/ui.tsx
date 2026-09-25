import { useEffect, useId, useRef, type ReactNode } from "react";
import { Boxes, X } from "lucide-react";

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return <div className="page-header">
    <div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>
    {actions && <div className="page-actions">{actions}</div>}
  </div>;
}

export function Modal({ title, subtitle, onClose, children, wide = false }: { title: string; subtitle: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const dialogRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const subtitleId = useId();

  useEffect(() => {
    const previousActive = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const dialog = dialogRef.current;
    const focusable = () => dialog ? Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter(element => !element.hasAttribute("hidden")) : [];

    (focusable()[0] ?? dialog)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;

      const elements = focusable();
      if (!elements.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousActive?.focus();
    };
  }, [onClose]);

  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) onClose(); }}>
    <section ref={dialogRef} tabIndex={-1} className={`modal ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={subtitleId}>
      <div className="modal-head">
        <div><h2 id={titleId}>{title}</h2><p id={subtitleId}>{subtitle}</p></div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={19} /></button>
      </div>
      {children}
    </section>
  </div>;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

export function ErrorText({ error }: { error: unknown }) {
  return <p className="form-error" role="alert">{error instanceof Error ? error.message : "Something went wrong"}</p>;
}

export function DataState({ loading, error, empty, emptyText, children }: { loading: boolean; error: unknown; empty: boolean; emptyText: string; children: ReactNode }) {
  if (loading) return <div className="empty-state" role="status"><div className="loader" /><span>Loading workspace…</span></div>;
  if (error) return <div className="empty-state danger" role="alert"><strong>Couldn't load this view</strong><span>{error instanceof Error ? error.message : "Unknown error"}</span></div>;
  if (empty) return <div className="empty-state"><Boxes size={28} aria-hidden="true" /><strong>Nothing here yet</strong><span>{emptyText}</span></div>;
  return <>{children}</>;
}

export function Status({ value }: { value: string }) {
  return <span className={`status status-${value.replaceAll("_", "-")}`}>{value.replaceAll("_", " ")}</span>;
}

export function CardList<T>({ items, loading, empty, render }: { items: T[]; loading: boolean; empty: string; render: (item: T) => ReactNode }) {
  if (loading) return <div className="panel empty-state" role="status"><div className="loader" /></div>;
  if (!items.length) return <div className="panel empty-state"><Boxes size={28} aria-hidden="true" /><strong>{empty}</strong></div>;
  return <div className="card-list">{items.map((item, index) => <div className="list-card" key={index}>{render(item)}</div>)}</div>;
}

export function pounds(value: string | number) {
  return Math.round((Number(value) || 0) * 100);
}
