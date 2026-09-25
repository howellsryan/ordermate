import type { ReactNode } from "react";
import { Boxes, X } from "lucide-react";

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return <div className="page-header">
    <div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>
    {actions && <div className="page-actions">{actions}</div>}
  </div>;
}

export function Modal({ title, subtitle, onClose, children, wide = false }: { title: string; subtitle: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) onClose(); }}>
    <section className={`modal ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-head">
        <div><h2>{title}</h2><p>{subtitle}</p></div>
        <button className="icon-button" onClick={onClose} aria-label="Close"><X size={19} /></button>
      </div>
      {children}
    </section>
  </div>;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

export function ErrorText({ error }: { error: unknown }) {
  return <p className="form-error">{error instanceof Error ? error.message : "Something went wrong"}</p>;
}

export function DataState({ loading, error, empty, emptyText, children }: { loading: boolean; error: unknown; empty: boolean; emptyText: string; children: ReactNode }) {
  if (loading) return <div className="empty-state"><div className="loader" /><span>Loading workspace…</span></div>;
  if (error) return <div className="empty-state danger"><strong>Couldn't load this view</strong><span>{error instanceof Error ? error.message : "Unknown error"}</span></div>;
  if (empty) return <div className="empty-state"><Boxes size={28} /><strong>Nothing here yet</strong><span>{emptyText}</span></div>;
  return <>{children}</>;
}

export function Status({ value }: { value: string }) {
  return <span className={`status status-${value.replaceAll("_", "-")}`}>{value.replaceAll("_", " ")}</span>;
}

export function CardList<T>({ items, loading, empty, render }: { items: T[]; loading: boolean; empty: string; render: (item: T) => ReactNode }) {
  if (loading) return <div className="panel empty-state"><div className="loader" /></div>;
  if (!items.length) return <div className="panel empty-state"><Boxes size={28} /><strong>{empty}</strong></div>;
  return <div className="card-list">{items.map((item, index) => <div className="list-card" key={index}>{render(item)}</div>)}</div>;
}

export function pounds(value: string | number) {
  return Math.round((Number(value) || 0) * 100);
}
