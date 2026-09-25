import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import type { OrganizationSummary } from "../../shared/types";
import ProductEditModal from "../ProductEditModal";
import { money, tenantApi } from "../api";
import type { Product, ProductModifier } from "../model";
import { DataState, ErrorText, Field, Modal, PageHeader, Status, pounds } from "../ui";

type OptionDefinition = { id: string; name: string; values: string };
type VariantMeta = { sku: string; barcode: string; price: string; cost: string };

export default function Products({ tenant }: { tenant: OrganizationSummary }) {
  const qc = useQueryClient();
  const [productOpen, setProductOpen] = useState(false);
  const [modifierOpen, setModifierOpen] = useState(false);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const canWrite = ["owner", "admin", "manager"].includes(tenant.role);
  const products = useQuery({ queryKey: ["tenant", tenant.id, "products"], queryFn: () => tenantApi<Product[]>(tenant.id, "/products") });
  const modifiers = useQuery({ queryKey: ["tenant", tenant.id, "modifiers"], queryFn: () => tenantApi<ProductModifier[]>(tenant.id, "/modifiers") });
  const refresh = () => qc.invalidateQueries({ queryKey: ["tenant", tenant.id] });

  return <>
    <PageHeader eyebrow="Catalogue" title="Products" description="Model arbitrary option dimensions, sellable variants, SKUs, barcodes and reusable add-ons without mixing catalogue data with inventory." actions={canWrite ? <><button className="secondary" onClick={() => setModifierOpen(true)}><SlidersHorizontal size={17} /> New modifier</button><button className="primary" onClick={() => setProductOpen(true)}><Plus size={17} /> Add product</button></> : undefined} />
    <div className="panel table-panel">
      <DataState loading={products.isLoading} error={products.error} empty={!products.data?.length} emptyText="Add your first product, then receive or adjust stock against its variants.">
        <table><thead><tr><th>Product</th><th>Variants</th><th>SKUs</th><th>Price range</th><th>Add-ons</th><th>Status</th><th /></tr></thead><tbody>
          {products.data?.map(product => <tr key={product.id}><td><strong>{product.name}</strong><small>{product.category_name || "Uncategorised"}</small></td><td>{product.variants.length}</td><td className="mono">{product.variants.slice(0, 2).map(variant => variant.sku).join(", ")}{product.variants.length > 2 ? "…" : ""}</td><td>{priceRange(product)}</td><td>{product.modifiers.length ? product.modifiers.map(modifier => modifier.name).join(", ") : "—"}</td><td><Status value={product.status} /></td><td className="row-actions">{canWrite && <button className="table-action" onClick={() => setEditProduct(product)}><Pencil size={14} /> Edit</button>}</td></tr>)}
        </tbody></table>
      </DataState>
    </div>
    {editProduct && canWrite && <ProductEditModal tenant={tenant} product={editProduct} onClose={() => setEditProduct(null)} onSaved={() => { setEditProduct(null); refresh(); }} />}
    {productOpen && canWrite && <ProductModal tenant={tenant} modifiers={modifiers.data || []} onClose={() => setProductOpen(false)} onCreated={() => { setProductOpen(false); refresh(); }} />}
    {modifierOpen && canWrite && <ModifierModal tenant={tenant} onClose={() => setModifierOpen(false)} onCreated={() => { setModifierOpen(false); refresh(); }} />}
  </>;
}

function ProductModal({ tenant, modifiers, onClose, onCreated }: { tenant: OrganizationSummary; modifiers: ProductModifier[]; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [basePrice, setBasePrice] = useState("");
  const [baseCost, setBaseCost] = useState("");
  const [tax, setTax] = useState("20");
  const [options, setOptions] = useState<OptionDefinition[]>([]);
  const [meta, setMeta] = useState<Record<string, VariantMeta>>({});
  const [modifierIds, setModifierIds] = useState<string[]>([]);

  const combinations = useMemo(() => buildCombinations(options), [options]);
  const mutation = useMutation({
    mutationFn: () => tenantApi(tenant.id, "/products", {
      method: "POST",
      body: JSON.stringify({
        name,
        category: category || undefined,
        description: description || undefined,
        modifierIds,
        variants: combinations.map(combo => {
          const key = comboKey(combo);
          const values = meta[key] || defaultMeta(name, combo, basePrice, baseCost);
          return {
            name: Object.values(combo).join(" / ") || "Default",
            sku: values.sku,
            barcode: values.barcode || undefined,
            priceMinor: pounds(values.price || basePrice),
            costMinor: pounds(values.cost || baseCost),
            taxRateBps: Math.round((Number(tax) || 0) * 100),
            options: combo,
          };
        }),
      }),
    }),
    onSuccess: onCreated,
  });

  const addOption = () => setOptions(current => [...current, { id: crypto.randomUUID(), name: "", values: "" }]);
  const updateOption = (optionId: string, patch: Partial<OptionDefinition>) => setOptions(current => current.map(option => option.id === optionId ? { ...option, ...patch } : option));
  const removeOption = (optionId: string) => setOptions(current => current.filter(option => option.id !== optionId));

  return <Modal title="Add product" subtitle="Define option dimensions once; OrderMate generates the sellable combinations. Every variant gets its own SKU, barcode, price, cost and inventory identity." onClose={onClose} wide>
    <form className="form-grid" onSubmit={event => { event.preventDefault(); mutation.mutate(); }}>
      <Field label="Product name"><input required value={name} onChange={event => setName(event.target.value)} placeholder="Classic T-shirt" /></Field>
      <Field label="Category"><input value={category} onChange={event => setCategory(event.target.value)} placeholder="Apparel" /></Field>
      <Field label="Description"><input value={description} onChange={event => setDescription(event.target.value)} placeholder="Optional internal/customer-facing description" /></Field>
      <div />
      <Field label="Default sell price (£)"><input required type="number" min="0" step="0.01" value={basePrice} onChange={event => setBasePrice(event.target.value)} /></Field>
      <Field label="Default cost (£)"><input type="number" min="0" step="0.01" value={baseCost} onChange={event => setBaseCost(event.target.value)} /></Field>
      <Field label="Tax / VAT rate (%)"><input type="number" min="0" step="0.01" value={tax} onChange={event => setTax(event.target.value)} /></Field>
      <div />

      <div className="form-section full-span"><div><p className="eyebrow">Options</p><h3>Variant dimensions</h3><p>No dimensions means one Default variant. Add as many dimensions as the product needs.</p></div><button type="button" className="secondary" onClick={addOption}><Plus size={15} /> Add option</button></div>
      {options.map((option, index) => <div className="option-row full-span" key={option.id}><span>{index + 1}</span><input aria-label="Option name" value={option.name} onChange={event => updateOption(option.id, { name: event.target.value })} placeholder="Size" /><input aria-label="Option values" value={option.values} onChange={event => updateOption(option.id, { values: event.target.value })} placeholder="Small, Medium, Large" /><button type="button" className="icon-button" onClick={() => removeOption(option.id)} aria-label="Remove option"><Trash2 size={16} /></button></div>)}

      <div className="form-section full-span"><div><p className="eyebrow">Sellable variants</p><h3>{combinations.length} combination{combinations.length === 1 ? "" : "s"}</h3><p>Override the defaults only where a variant differs.</p></div></div>
      <div className="variant-editor full-span">
        <div className="variant-editor-head"><span>Variant</span><span>SKU</span><span>Barcode</span><span>Price</span><span>Cost</span></div>
        {combinations.map(combo => {
          const key = comboKey(combo);
          const values = meta[key] || defaultMeta(name, combo, basePrice, baseCost);
          const patch = (next: Partial<VariantMeta>) => setMeta(current => ({ ...current, [key]: { ...values, ...next } }));
          return <div className="variant-editor-row" key={key}><strong>{Object.values(combo).join(" / ") || "Default"}</strong><input required value={values.sku} onChange={event => patch({ sku: event.target.value })} /><input value={values.barcode} onChange={event => patch({ barcode: event.target.value })} inputMode="numeric" /><input type="number" min="0" step="0.01" value={values.price} onChange={event => patch({ price: event.target.value })} /><input type="number" min="0" step="0.01" value={values.cost} onChange={event => patch({ cost: event.target.value })} /></div>;
        })}
      </div>

      {modifiers.length > 0 && <div className="full-span"><p className="eyebrow">Available add-ons</p><div className="choice-grid">{modifiers.map(modifier => <label className="choice-card" key={modifier.id}><input type="checkbox" checked={modifierIds.includes(modifier.id)} onChange={event => setModifierIds(current => event.target.checked ? [...current, modifier.id] : current.filter(value => value !== modifier.id))} /><span><strong>{modifier.name}</strong><small>{modifier.price_delta_minor === 0 ? "No price change" : `${modifier.price_delta_minor > 0 ? "+" : ""}${money(modifier.price_delta_minor)}`}</small></span></label>)}</div></div>}
      {mutation.error && <ErrorText error={mutation.error} />}
      <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={mutation.isPending || !name.trim() || combinations.some(combo => !(meta[comboKey(combo)] || defaultMeta(name, combo, basePrice, baseCost)).sku.trim())}>Create {combinations.length} variant{combinations.length === 1 ? "" : "s"}</button></div>
    </form>
  </Modal>;
}

function ModifierModal({ tenant, onClose, onCreated }: { tenant: OrganizationSummary; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const mutation = useMutation({ mutationFn: () => tenantApi(tenant.id, "/modifiers", { method: "POST", body: JSON.stringify({ name, priceDeltaMinor: pounds(price) }) }), onSuccess: onCreated });
  return <Modal title="New modifier" subtitle="Reusable optional add-ons are kept separate from stock-tracked variants." onClose={onClose}><form className="form-grid" onSubmit={event => { event.preventDefault(); mutation.mutate(); }}><Field label="Name"><input required value={name} onChange={event => setName(event.target.value)} placeholder="Gift wrap" /></Field><Field label="Price adjustment (£)" hint="Use a negative value for a discount."><input type="number" step="0.01" value={price} onChange={event => setPrice(event.target.value)} /></Field>{mutation.error && <ErrorText error={mutation.error} />}<div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={mutation.isPending}>Create modifier</button></div></form></Modal>;
}

function buildCombinations(options: OptionDefinition[]) {
  const usable = options.map(option => ({ name: option.name.trim(), values: option.values.split(",").map(value => value.trim()).filter(Boolean) })).filter(option => option.name && option.values.length);
  if (!usable.length) return [{}] as Array<Record<string, string>>;
  return usable.reduce<Array<Record<string, string>>>((combinations, option) => combinations.flatMap(combo => option.values.map(value => ({ ...combo, [option.name]: value }))), [{}]);
}

function comboKey(combo: Record<string, string>) {
  return JSON.stringify(combo);
}

function defaultMeta(productName: string, combo: Record<string, string>, price: string, cost: string): VariantMeta {
  const slug = [productName, ...Object.values(combo)].filter(Boolean).join("-").toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "SKU";
  return { sku: slug, barcode: "", price, cost };
}

function priceRange(product: Product) {
  if (!product.variants.length) return "—";
  const prices = product.variants.map(variant => variant.price_minor);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return min === max ? money(min) : `${money(min)} – ${money(max)}`;
}
