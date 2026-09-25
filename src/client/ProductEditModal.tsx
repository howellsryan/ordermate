import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { OrganizationSummary } from "../shared/types";
import { money, tenantApi } from "./api";
import type { Product } from "./model";
import { ErrorText, Field, Modal, pounds } from "./ui";

type EditableVariant = {
  id: string;
  name: string;
  sku: string;
  barcode: string;
  price: string;
  cost: string;
  tax: string;
  options: Record<string, string>;
};

export default function ProductEditModal({ tenant, product, onClose, onSaved }: { tenant: OrganizationSummary; product: Product; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(product.name);
  const [category, setCategory] = useState(product.category_name || "");
  const [description, setDescription] = useState(product.description || "");
  const [variants, setVariants] = useState<EditableVariant[]>(() => product.variants.map(variant => ({
    id: variant.id,
    name: variant.name,
    sku: variant.sku,
    barcode: variant.barcode || "",
    price: (variant.price_minor / 100).toFixed(2),
    cost: (variant.cost_minor / 100).toFixed(2),
    tax: (variant.tax_rate_bps / 100).toString(),
    options: variant.options,
  })));

  const patchVariant = (variantId: string, patch: Partial<EditableVariant>) => setVariants(current => current.map(variant => variant.id === variantId ? { ...variant, ...patch } : variant));
  const mutation = useMutation({
    mutationFn: () => tenantApi(tenant.id, `/products/${product.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name,
        category,
        description,
        variants: variants.map(variant => ({
          id: variant.id,
          name: variant.name,
          sku: variant.sku,
          barcode: variant.barcode || undefined,
          priceMinor: pounds(variant.price),
          costMinor: pounds(variant.cost),
          taxRateBps: Math.round((Number(variant.tax) || 0) * 100),
        })),
      }),
    }),
    onSuccess: onSaved,
  });

  return <Modal title={`Edit ${product.name}`} subtitle="Update the live catalogue without rewriting historic order or purchase snapshots. Variant option identity is intentionally preserved here." onClose={onClose} wide>
    <form className="form-grid" onSubmit={event => { event.preventDefault(); mutation.mutate(); }}>
      <Field label="Product name"><input required value={name} onChange={event => setName(event.target.value)} /></Field>
      <Field label="Category"><input value={category} onChange={event => setCategory(event.target.value)} /></Field>
      <Field label="Description"><input value={description} onChange={event => setDescription(event.target.value)} /></Field>
      <div />

      <div className="form-section full-span"><div><p className="eyebrow">Live variants</p><h3>Commercial & identifier details</h3><p>Option combinations remain fixed so existing inventory identities cannot be accidentally remapped.</p></div></div>
      <div className="edit-variant-list full-span">{variants.map(variant => <div className="edit-variant-card" key={variant.id}>
        <div className="edit-variant-title"><div><strong>{variant.name}</strong><small>{Object.entries(variant.options).map(([key, value]) => `${key}: ${value}`).join(" · ") || "Default variant"}</small></div><span>{money(pounds(variant.price))}</span></div>
        <div className="edit-variant-fields">
          <Field label="Variant name"><input required value={variant.name} onChange={event => patchVariant(variant.id, { name: event.target.value })} /></Field>
          <Field label="SKU"><input required value={variant.sku} onChange={event => patchVariant(variant.id, { sku: event.target.value })} /></Field>
          <Field label="Barcode"><input value={variant.barcode} onChange={event => patchVariant(variant.id, { barcode: event.target.value })} inputMode="numeric" /></Field>
          <Field label="Sell price (£)"><input required type="number" min="0" step="0.01" value={variant.price} onChange={event => patchVariant(variant.id, { price: event.target.value })} /></Field>
          <Field label="Cost (£)"><input required type="number" min="0" step="0.01" value={variant.cost} onChange={event => patchVariant(variant.id, { cost: event.target.value })} /></Field>
          <Field label="Tax / VAT (%)"><input required type="number" min="0" max="100" step="0.01" value={variant.tax} onChange={event => patchVariant(variant.id, { tax: event.target.value })} /></Field>
        </div>
      </div>)}</div>
      {mutation.error && <ErrorText error={mutation.error} />}
      <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={mutation.isPending || !name.trim() || variants.some(variant => !variant.name.trim() || !variant.sku.trim())}>Save catalogue changes</button></div>
    </form>
  </Modal>;
}
