import { useState } from "react";
import { BookmarkPlus, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OrganizationSummary } from "../shared/types";
import type { SavedView, SavedViewConfig, SavedViewPage } from "../shared/saved-views";
import { tenantApi } from "./api";
import { ErrorText } from "./ui";

export default function SavedViews<T extends SavedViewConfig>({
  tenant,
  page,
  config,
  onApply,
}: {
  tenant: OrganizationSummary;
  page: SavedViewPage;
  config: T;
  onApply: (config: T) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const views = useQuery({
    queryKey: ["tenant", tenant.id, "saved-views", page],
    queryFn: () => tenantApi<SavedView[]>(tenant.id, `/saved-views?page=${encodeURIComponent(page)}`),
  });
  const save = useMutation({
    mutationFn: () => tenantApi<SavedView>(tenant.id, "/saved-views", {
      method: "POST",
      body: JSON.stringify({ page, name: name.trim(), config }),
    }),
    onSuccess: () => {
      setName("");
      qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "saved-views", page] });
    },
  });
  const remove = useMutation({
    mutationFn: (viewId: string) => tenantApi(tenant.id, `/saved-views/${encodeURIComponent(viewId)}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "saved-views", page] }),
  });

  return <div className="saved-views">
    <div className="saved-view-save">
      <BookmarkPlus size={15} />
      <input aria-label="Saved view name" value={name} onChange={event => setName(event.target.value)} placeholder="Name this view…" maxLength={80} />
      <button type="button" className="secondary" disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>Save view</button>
    </div>
    <div className="saved-view-chips" aria-label="Saved views">
      {views.isLoading && <span className="saved-view-note">Loading saved views…</span>}
      {!views.isLoading && !views.data?.length && <span className="saved-view-note">No saved views yet.</span>}
      {views.data?.map(view => <span className="saved-view-chip" key={view.id}>
        <button type="button" onClick={() => onApply(view.config as T)}>{view.name}</button>
        <button type="button" aria-label={`Delete saved view ${view.name}`} disabled={remove.isPending} onClick={() => remove.mutate(view.id)}><Trash2 size={12} /></button>
      </span>)}
    </div>
    {(views.error || save.error || remove.error) && <ErrorText error={views.error || save.error || remove.error} />}
  </div>;
}
