import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Link2, RefreshCw, Store, Unlink } from "lucide-react";
import type { OrganizationSummary } from "../shared/types";
import { errorFrom, tenantApi } from "./api";
import { ErrorText, Field } from "./ui";

type Connection = {
  id: string;
  provider: string;
  externalAccountId: string;
  displayName: string;
  status: string;
  capabilities: string[];
  lastEventAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
};

type ConnectionsResponse = { connections: Connection[] };
type MappingEntity = {
  entityType: "variant" | "location";
  externalId: string;
  displayName: string;
  matchStatus: "mapped" | "suggested" | "ambiguous" | "unmatched";
  payload: Record<string, unknown>;
  mapping: { localEntityType: string; localEntityId: string; lastSyncedAt: string } | null;
  suggestion: { localEntityType: string | null; localEntityId: string; reason: string | null } | null;
  suggestionReason: string | null;
};
type MappingState = {
  connection: Connection;
  checkpoints: Array<{ resource: "catalogue" | "locations"; status: string; itemCount: number; completedAt: string | null; lastError: string | null }>;
  counts: Record<string, number>;
  entities: MappingEntity[];
  staleLinks: Array<{ entityType: string; externalId: string; localEntityType: string; localEntityId: string; lastSyncedAt: string }>;
  local: {
    variants: Array<{ id: string; sku: string; barcode: string | null; productName: string; variantName: string }>;
    locations: Array<{ id: string; name: string; code: string }>;
  };
};

type MappingMutation = { entityType: "variant" | "location"; externalId: string; localEntityId: string | null };

async function integrationApi<T>(tenantId: string, path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("x-ordermate-tenant", tenantId);
  if (init?.body) headers.set("content-type", "application/json");
  const response = await fetch(`/api${path}`, { ...init, headers, credentials: "include" });
  if (!response.ok) throw await errorFrom(response);
  return response.json();
}

function checkpointLabel(state: MappingState | undefined, resource: "catalogue" | "locations") {
  const checkpoint = state?.checkpoints.find(item => item.resource === resource);
  if (!checkpoint) return "Not synced";
  if (checkpoint.status === "completed") return `${checkpoint.itemCount} discovered`;
  if (checkpoint.status === "running") return "Syncing…";
  return checkpoint.lastError || "Sync needs attention";
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function MappingRow({
  entity,
  state,
  canManage,
  pending,
  onMap,
}: {
  entity: MappingEntity;
  state: MappingState;
  canManage: boolean;
  pending: boolean;
  onMap: (mapping: MappingMutation) => void;
}) {
  const options = entity.entityType === "variant" ? state.local.variants : state.local.locations;
  const suggestedId = entity.suggestion?.localEntityId || "";
  const mappedId = entity.mapping?.localEntityId || "";
  const [selected, setSelected] = useState(mappedId || suggestedId);
  useEffect(() => setSelected(mappedId || suggestedId), [mappedId, suggestedId]);

  const statusText = entity.matchStatus === "mapped" ? "Mapped"
    : entity.matchStatus === "suggested" ? "Exact match suggested"
      : entity.matchStatus === "ambiguous" ? "Needs review"
        : "Unmatched";
  const detail = entity.entityType === "variant"
    ? [entity.payload.sku ? `SKU ${String(entity.payload.sku)}` : null, entity.payload.barcode ? `Barcode ${String(entity.payload.barcode)}` : null].filter(Boolean).join(" · ")
    : entity.payload.active === false ? "Deactivated in Shopify" : "Active Shopify location";

  return <article className="module-card">
    <div>
      <div className="panel-heading"><div><h4>{entity.displayName}</h4><small>{statusText}</small></div>{entity.matchStatus === "mapped" ? <Check size={18} /> : <Link2 size={18} />}</div>
      {detail && <p>{detail}</p>}
      {(entity.suggestion?.reason || entity.suggestionReason) && <small>{entity.suggestion?.reason || entity.suggestionReason}</small>}
    </div>
    <div className="settings-form">
      <Field label={entity.entityType === "variant" ? "Operating Layer variant" : "Operating Layer location"}>
        <select value={selected} disabled={!canManage || pending} onChange={event => setSelected(event.target.value)}>
          <option value="">Choose mapping…</option>
          {entity.entityType === "variant"
            ? state.local.variants.map(option => <option key={option.id} value={option.id}>{option.productName} · {option.variantName} — {option.sku}{option.barcode ? ` · ${option.barcode}` : ""}</option>)
            : state.local.locations.map(option => <option key={option.id} value={option.id}>{option.name} — {option.code}</option>)}
        </select>
      </Field>
      {canManage && <div className="action-row">
        <button className="primary" type="button" disabled={pending || !selected || selected === mappedId} onClick={() => onMap({ entityType: entity.entityType, externalId: entity.externalId, localEntityId: selected })}>
          <Check size={15} /> {entity.matchStatus === "suggested" && selected === suggestedId ? "Approve suggestion" : mappedId ? "Update mapping" : "Map"}
        </button>
        {mappedId && <button type="button" disabled={pending} onClick={() => onMap({ entityType: entity.entityType, externalId: entity.externalId, localEntityId: null })}><Unlink size={15} /> Unmap</button>}
      </div>}
    </div>
  </article>;
}

export function ShopifyIntegrationSettings({ tenant, demo }: { tenant: OrganizationSummary; demo: boolean }) {
  const qc = useQueryClient();
  const canView = ["owner", "admin", "manager"].includes(tenant.role);
  const canManage = ["owner", "admin"].includes(tenant.role);
  const [shop, setShop] = useState("");
  const [search, setSearch] = useState("");

  const connections = useQuery({
    queryKey: ["tenant", tenant.id, "integrations"],
    queryFn: () => tenantApi<ConnectionsResponse>(tenant.id, "/integrations"),
    enabled: !demo && canView,
  });
  const shopify = connections.data?.connections.find(connection => connection.provider === "shopify");
  const mappings = useQuery({
    queryKey: ["tenant", tenant.id, "integration-mappings", shopify?.id],
    queryFn: () => tenantApi<MappingState>(tenant.id, `/integrations/${shopify!.id}/mappings`),
    enabled: !demo && canView && !!shopify,
  });

  const install = useMutation({
    mutationFn: () => integrationApi<{ authorizationUrl: string }>(tenant.id, "/integrations/shopify/install", {
      method: "POST",
      body: JSON.stringify({ shop }),
    }),
    onSuccess: data => window.location.assign(data.authorizationUrl),
  });
  const sync = useMutation({
    mutationFn: () => integrationApi<{ mapping: MappingState }>(tenant.id, "/integrations/shopify/catalogue/sync", {
      method: "POST",
      body: JSON.stringify({ connectionId: shopify?.id }),
    }),
    onSuccess: data => {
      qc.setQueryData(["tenant", tenant.id, "integration-mappings", shopify?.id], data.mapping);
      qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "integrations"] });
    },
  });
  const map = useMutation({
    mutationFn: (mapping: MappingMutation | MappingMutation[]) => tenantApi<MappingState>(tenant.id, `/integrations/${shopify!.id}/mappings`, {
      method: "PATCH",
      body: JSON.stringify({ mappings: Array.isArray(mapping) ? mapping : [mapping] }),
    }),
    onSuccess: data => {
      qc.setQueryData(["tenant", tenant.id, "integration-mappings", shopify?.id], data);
      qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "audit"] });
    },
  });

  const state = mappings.data;
  const suggestions = state?.entities.filter(entity => entity.matchStatus === "suggested" && entity.suggestion?.localEntityId) || [];
  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    if (!needle) return state?.entities || [];
    return (state?.entities || []).filter(entity => `${entity.displayName} ${String(entity.payload.sku || "")} ${String(entity.payload.barcode || "")}`.toLocaleLowerCase().includes(needle));
  }, [search, state?.entities]);
  const variants = filtered.filter(entity => entity.entityType === "variant");
  const locations = filtered.filter(entity => entity.entityType === "location");

  if (demo) return <section className="panel settings-card">
    <div className="panel-heading"><div><p className="eyebrow">Integrations</p><h3>Shopify</h3></div><Store size={21} /></div>
    <p className="settings-note">Live Shopify connections are disabled in the browser-only guest demo because the demo has no cloud tenant or external credentials.</p>
  </section>;

  if (!canView) return <section className="panel settings-card">
    <div className="panel-heading"><div><p className="eyebrow">Integrations</p><h3>Shopify</h3></div><Store size={21} /></div>
    <p className="settings-note">Integration settings are available to workspace owners, admins and managers. Owners and admins can change mappings.</p>
  </section>;

  return <section className="panel settings-card">
    <div className="panel-heading"><div><p className="eyebrow">Commerce integration</p><h3>Shopify</h3></div><Store size={21} /></div>
    <p className="settings-note">Shopify discovery never changes catalogue or stock automatically. Exact SKU/barcode matches are suggestions until an owner or admin approves them, and location mappings are explicit.</p>

    {connections.isLoading ? <div className="empty-state compact"><div className="loader" /></div> : connections.error ? <ErrorText error={connections.error} /> : !shopify ? <>
      <p className="settings-note">Connect the store's permanent <strong>.myshopify.com</strong> domain. The OAuth callback will return here with a tenant-scoped encrypted connection.</p>
      {canManage ? <form className="settings-form" onSubmit={event => { event.preventDefault(); install.mutate(); }}>
        <Field label="Shopify store"><input value={shop} onChange={event => setShop(event.target.value)} placeholder="your-store.myshopify.com" /></Field>
        {install.error && <ErrorText error={install.error} />}
        <button className="primary" disabled={install.isPending || !shop.trim()}><Link2 size={16} /> Connect Shopify</button>
      </form> : <p className="settings-note">Ask a workspace owner or admin to connect Shopify.</p>}
    </> : <>
      <div className="residency-list">
        <div><span>Store</span><strong>{shopify.displayName}</strong></div>
        <div><span>Connection</span><strong>{shopify.status}</strong></div>
        <div><span>Last complete sync</span><strong>{formatDate(state?.connection.lastSuccessAt || shopify.lastSuccessAt)}</strong></div>
        <div><span>Catalogue</span><strong>{checkpointLabel(state, "catalogue")}</strong></div>
        <div><span>Locations</span><strong>{checkpointLabel(state, "locations")}</strong></div>
      </div>
      {(shopify.lastError || state?.connection.lastError) && <p className="settings-note">Needs attention: {state?.connection.lastError || shopify.lastError}</p>}
      {canManage && <button className="primary" type="button" disabled={sync.isPending} onClick={() => sync.mutate()}><RefreshCw size={16} /> {sync.isPending ? "Syncing Shopify…" : "Sync Shopify catalogue"}</button>}
      {sync.error && <ErrorText error={sync.error} />}

      {mappings.isLoading ? <div className="empty-state compact"><div className="loader" /></div> : mappings.error ? <ErrorText error={mappings.error} /> : state && <>
        <div className="residency-list">
          <div><span>Mapped</span><strong>{state.counts.mapped || 0}</strong></div>
          <div><span>Exact suggestions</span><strong>{state.counts.suggested || 0}</strong></div>
          <div><span>Needs review</span><strong>{state.counts.ambiguous || 0}</strong></div>
          <div><span>Unmatched</span><strong>{state.counts.unmatched || 0}</strong></div>
        </div>
        {canManage && suggestions.length > 0 && <button type="button" disabled={map.isPending} onClick={() => map.mutate(suggestions.map(entity => ({ entityType: entity.entityType, externalId: entity.externalId, localEntityId: entity.suggestion!.localEntityId })))}><Check size={16} /> Approve all {suggestions.length} exact suggestions</button>}
        {map.error && <ErrorText error={map.error} />}
        <div className="settings-form"><Field label="Find Shopify entity"><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Product, SKU or barcode" /></Field></div>

        <div className="feature-group">
          <div className="feature-group-heading"><strong>Product variants</strong><small>{variants.length} shown</small></div>
          {variants.length ? <div className="module-grid">{variants.map(entity => <MappingRow key={entity.externalId} entity={entity} state={state} canManage={canManage} pending={map.isPending} onMap={mapping => map.mutate(mapping)} />)}</div> : <p className="settings-note">No Shopify variants match this filter.</p>}
        </div>
        <div className="feature-group">
          <div className="feature-group-heading"><strong>Locations</strong><small>{locations.length} shown</small></div>
          {locations.length ? <div className="module-grid">{locations.map(entity => <MappingRow key={entity.externalId} entity={entity} state={state} canManage={canManage} pending={map.isPending} onMap={mapping => map.mutate(mapping)} />)}</div> : <p className="settings-note">No Shopify locations match this filter.</p>}
        </div>
        {state.staleLinks.length > 0 && <p className="settings-note">{state.staleLinks.length} approved mapping{state.staleLinks.length === 1 ? " is" : "s are"} retained for historical identity even though Shopify did not return the external entity in the latest discovery.</p>}
      </>}
    </>}
  </section>;
}
