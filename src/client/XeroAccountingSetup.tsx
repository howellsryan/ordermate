import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Link2, ShieldAlert } from "lucide-react";
import type { OrganizationSummary } from "../shared/types";
import { tenantApi } from "./api";
import { ErrorText, Field } from "./ui";

type XeroSetup = {
  connection: { id: string; displayName: string; status: string };
  salesAccountCode: string | null;
  taxMappings: Record<string, string>;
  accounts: Array<{ code: string; name: string; type: string | null; taxType: string | null }>;
  taxRates: Array<{ taxType: string; name: string; effectiveRate: number | null }>;
  observedTaxRates: Array<{ bps: number; mappedTaxType: string | null; suggestedTaxType: string | null }>;
  ready: boolean;
};

export default function XeroAccountingSetup({ tenant, connectionId }: { tenant: OrganizationSummary; connectionId: string }) {
  const qc = useQueryClient();
  const canManage = tenant.role === "owner" || tenant.role === "admin";
  const setup = useQuery({
    queryKey: ["tenant", tenant.id, "xero-accounting-setup", connectionId],
    queryFn: () => tenantApi<XeroSetup>(tenant.id, `/integrations/${connectionId}/xero/accounting/setup`),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const [salesAccountCode, setSalesAccountCode] = useState("");
  const [taxMappings, setTaxMappings] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!setup.data) return;
    setSalesAccountCode(setup.data.salesAccountCode || "");
    setTaxMappings(Object.fromEntries(setup.data.observedTaxRates.map(rate => [
      String(rate.bps),
      rate.mappedTaxType || rate.suggestedTaxType || "",
    ])));
  }, [setup.data]);

  const save = useMutation({
    mutationFn: () => tenantApi<XeroSetup>(tenant.id, `/integrations/${connectionId}/xero/accounting/setup`, {
      method: "POST",
      body: JSON.stringify({ salesAccountCode, taxMappings }),
    }),
    onSuccess: data => {
      qc.setQueryData(["tenant", tenant.id, "xero-accounting-setup", connectionId], data);
      qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "onboarding-health"] });
      qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "work-queue"] });
    },
  });

  const dirty = useMemo(() => {
    if (!setup.data) return false;
    if (salesAccountCode !== (setup.data.salesAccountCode || "")) return true;
    return setup.data.observedTaxRates.some(rate => (taxMappings[String(rate.bps)] || "") !== (rate.mappedTaxType || ""));
  }, [salesAccountCode, setup.data, taxMappings]);

  if (setup.isLoading) return <div className="empty-state compact"><div className="loader" /><span>Loading Xero chart of accounts…</span></div>;
  if (setup.error) return <div className="automation-callout"><ShieldAlert size={18} /><div><strong>Xero accounting setup needs attention</strong><ErrorText error={setup.error} /><span>If permissions changed, reconnect Xero so the organisation can grant read-only accounting settings access.</span></div></div>;
  if (!setup.data) return null;

  const complete = !!salesAccountCode && setup.data.observedTaxRates.every(rate => !!taxMappings[String(rate.bps)]);
  return <div className="feature-group">
    <div className="feature-group-heading">
      <strong>Xero accounting mapping</strong>
      <small>{complete ? "Ready to export issued invoices" : "Choose where revenue and tax should land"}</small>
    </div>
    <p className="settings-note">Operating Layer never guesses financial coding. Issued service invoices sync only after the Xero revenue account and every tax rate used by those invoices are mapped explicitly.</p>
    <div className="settings-form">
      <Field label="Sales / revenue account">
        <select value={salesAccountCode} disabled={!canManage || save.isPending} onChange={event => setSalesAccountCode(event.target.value)}>
          <option value="">Choose Xero revenue account…</option>
          {setup.data.accounts.map(account => <option value={account.code} key={account.code}>{account.code} · {account.name}{account.type ? ` · ${account.type}` : ""}</option>)}
        </select>
      </Field>
      {setup.data.observedTaxRates.map(rate => {
        const exact = setup.data.taxRates.filter(candidate => candidate.effectiveRate !== null && Math.round(candidate.effectiveRate * 100) === rate.bps);
        return <Field key={rate.bps} label={`${rate.bps / 100}% tax`} hint={exact.length ? "Only Xero tax rates with the exact same effective rate are shown." : "No revenue tax rate in Xero currently matches this Operating Layer rate."}>
          <select value={taxMappings[String(rate.bps)] || ""} disabled={!canManage || save.isPending} onChange={event => setTaxMappings(current => ({ ...current, [String(rate.bps)]: event.target.value }))}>
            <option value="">Choose Xero tax rate…</option>
            {exact.map(candidate => <option key={candidate.taxType} value={candidate.taxType}>{candidate.name} · {candidate.taxType}</option>)}
          </select>
        </Field>;
      })}
      {setup.data.observedTaxRates.length === 0 && <p className="settings-note">No issued service invoice tax rates exist yet. Choose the revenue account now; tax mappings will appear as invoice rates are introduced.</p>}
      {save.error && <ErrorText error={save.error} />}
      {canManage && <button type="button" className="primary" disabled={save.isPending || !dirty || !salesAccountCode} onClick={() => save.mutate()}>
        <Link2 size={15} /> {save.isPending ? "Saving Xero mapping…" : "Save Xero mapping"}
      </button>}
      {complete && !dirty && <span><CheckCircle2 size={15} /> Xero mapping is ready for the current invoice tax rates.</span>}
    </div>
  </div>;
}
