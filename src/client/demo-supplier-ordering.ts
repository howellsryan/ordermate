import { z } from "zod";
import type { SupplierVariant } from "./model";
import { demoTenantApi } from "./demo-stocktake";

const DEMO_SUPPLIER_TERMS_KEY = "operating-layer:demo-supplier-ordering:v1";

type DemoSupplierTerms = {
  minimum_order_quantity: number | null;
  order_multiple: number | null;
};

type DemoSupplierTermState = Record<string, DemoSupplierTerms>;

const DEFAULT_TERMS: DemoSupplierTermState = {
  "sup-pack:var-tape": { minimum_order_quantity: 24, order_multiple: 12 },
  "sup-pack:var-labels": { minimum_order_quantity: 10, order_multiple: 5 },
  "sup-work:var-gloves-l": { minimum_order_quantity: 24, order_multiple: 12 },
};

const mappingInput = z.object({
  supplierId: z.string().min(1),
  variantId: z.string().min(1),
  supplierSku: z.string().trim().max(120).optional(),
  lastCostMinor: z.number().int().nonnegative().optional(),
  leadTimeDays: z.number().int().min(0).max(3650).optional(),
  minimumOrderQuantity: z.number().int().min(1).max(1_000_000).nullable().optional(),
  orderMultiple: z.number().int().min(1).max(1_000_000).nullable().optional(),
});

function mappingKey(supplierId: string, variantId: string) {
  return `${supplierId}:${variantId}`;
}

function readTerms(): DemoSupplierTermState {
  const raw = window.localStorage.getItem(DEMO_SUPPLIER_TERMS_KEY);
  if (!raw) return structuredClone(DEFAULT_TERMS);
  try {
    const parsed = JSON.parse(raw) as DemoSupplierTermState;
    return { ...structuredClone(DEFAULT_TERMS), ...parsed };
  } catch {
    return structuredClone(DEFAULT_TERMS);
  }
}

function persistTerms(terms: DemoSupplierTermState) {
  window.localStorage.setItem(DEMO_SUPPLIER_TERMS_KEY, JSON.stringify(terms));
}

function parseBody(init?: RequestInit) {
  if (typeof init?.body !== "string") return mappingInput.parse({});
  return mappingInput.parse(JSON.parse(init.body));
}

function withTerms(mapping: SupplierVariant, terms: DemoSupplierTermState): SupplierVariant {
  const term = terms[mappingKey(mapping.supplier_id, mapping.variant_id)];
  return {
    ...mapping,
    minimum_order_quantity: term?.minimum_order_quantity ?? null,
    order_multiple: term?.order_multiple ?? null,
  };
}

export function resetDemoSupplierOrdering() {
  window.localStorage.removeItem(DEMO_SUPPLIER_TERMS_KEY);
}

export async function demoSupplierVariants(): Promise<SupplierVariant[]> {
  const mappings = await demoTenantApi<SupplierVariant[]>("/supplier-variants");
  const terms = readTerms();
  return mappings.map(mapping => withTerms(mapping, terms));
}

export async function demoSaveSupplierVariant(init?: RequestInit): Promise<SupplierVariant> {
  const input = parseBody(init);
  const result = await demoTenantApi<SupplierVariant>("/supplier-variants", init);
  const terms = readTerms();
  const key = mappingKey(input.supplierId, input.variantId);
  const current = terms[key] || { minimum_order_quantity: null, order_multiple: null };
  terms[key] = {
    minimum_order_quantity: Object.prototype.hasOwnProperty.call(input, "minimumOrderQuantity")
      ? input.minimumOrderQuantity ?? null
      : current.minimum_order_quantity,
    order_multiple: Object.prototype.hasOwnProperty.call(input, "orderMultiple")
      ? input.orderMultiple ?? null
      : current.order_multiple,
  };
  persistTerms(terms);
  return withTerms(result, terms);
}

export async function demoDeleteSupplierVariant(path: string, init?: RequestInit) {
  const result = await demoTenantApi(path, init);
  const parts = new URL(path, "https://demo.local").pathname.split("/");
  const supplierId = decodeURIComponent(parts[2] || "");
  const variantId = decodeURIComponent(parts[3] || "");
  if (supplierId && variantId) {
    const terms = readTerms();
    delete terms[mappingKey(supplierId, variantId)];
    persistTerms(terms);
  }
  return result;
}
