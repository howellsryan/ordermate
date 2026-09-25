import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Search, X } from "lucide-react";
import type { OrganizationSummary } from "../shared/types";
import { tenantOpsApi } from "./api";
import type { SearchResult } from "./model";

export default function GlobalSearch({ tenant, onNavigate }: { tenant: OrganizationSummary; onNavigate: (page: SearchResult["page"]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 160);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
        inputRef.current?.focus();
      }
      if (event.key === "Escape" && open) {
        setOpen(false);
        inputRef.current?.blur();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    setQuery("");
    setDebounced("");
    setOpen(false);
  }, [tenant.id]);

  const search = useQuery({
    queryKey: ["tenant", tenant.id, "search", debounced],
    queryFn: () => tenantOpsApi<{ results: SearchResult[] }>(tenant.id, `/search?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length >= 2,
    staleTime: 10_000,
  });

  const choose = (result: SearchResult) => {
    onNavigate(result.page);
    setOpen(false);
    setQuery("");
    setDebounced("");
  };

  return <div className="search-shell">
    <div className={`global-search ${open ? "search-active" : ""}`}>
      <Search size={16} />
      <input
        ref={inputRef}
        aria-label="Search this business"
        aria-expanded={open}
        aria-controls="workspace-search-results"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={event => { setQuery(event.target.value); setOpen(true); }}
        placeholder="Search orders, products, SKU, barcode, people…"
      />
      {query ? <button className="search-clear" aria-label="Clear search" onClick={() => { setQuery(""); setDebounced(""); inputRef.current?.focus(); }}><X size={14} /></button> : <kbd>⌘K</kbd>}
    </div>
    {open && <div className="search-popover" id="workspace-search-results">
      {query.trim().length < 2 ? <div className="search-empty"><Search size={20} /><strong>Search the whole workspace</strong><span>Use an order number, product, SKU, barcode, customer or supplier.</span></div> : search.isLoading ? <div className="search-empty"><div className="loader" /><span>Searching this business…</span></div> : search.error ? <div className="search-empty danger"><strong>Search failed</strong><span>{search.error instanceof Error ? search.error.message : "Try again"}</span></div> : !search.data?.results.length ? <div className="search-empty"><strong>No matches</strong><span>Nothing in this business matched “{query.trim()}”.</span></div> : <div className="search-results">{search.data.results.map(result => <button key={`${result.type}:${result.id}`} onClick={() => choose(result)}><span className="search-kind">{result.type}</span><span className="search-result-copy"><strong>{result.title}</strong><small>{result.subtitle}</small></span>{result.badge && <span className="search-badge">{result.badge}</span>}<ArrowRight size={15} /></button>)}</div>}
    </div>}
    {open && <button className="search-dismiss" aria-label="Close search" onClick={() => setOpen(false)} />}
  </div>;
}
