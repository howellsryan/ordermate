import type { OperatingIntelligenceResponse, OperatingIntelligenceRow } from "./operating-intelligence";

export type SupplierOrderingTerm = {
  supplier_id: string;
  variant_id: string;
  minimum_order_quantity: number | null;
  order_multiple: number | null;
};

export type OrderingConstraintSummary = {
  supplier_id: string | null;
  supplier_name: string | null;
  minimum_order_quantity: number | null;
  order_multiple: number | null;
  adjusted: boolean;
};

export type OrderReadyIntelligenceRow = OperatingIntelligenceRow & {
  ordering_constraints: OrderingConstraintSummary;
};

function positiveInteger(value: number | null | undefined) {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : null;
}

export function orderableQuantity(quantity: number, minimumOrderQuantity?: number | null, orderMultiple?: number | null) {
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  const minimum = positiveInteger(minimumOrderQuantity) || 1;
  const multiple = positiveInteger(orderMultiple) || 1;
  const floor = Math.max(Math.ceil(quantity), minimum);
  return Math.ceil(floor / multiple) * multiple;
}

export function applySupplierOrderingTerms(
  response: OperatingIntelligenceResponse,
  terms: SupplierOrderingTerm[],
): OperatingIntelligenceResponse & { positions: OrderReadyIntelligenceRow[]; suggestions: OrderReadyIntelligenceRow[] } {
  const byKey = new Map(terms.map(term => [`${term.supplier_id}:${term.variant_id}`, term] as const));

  const adjust = (row: OperatingIntelligenceRow): OrderReadyIntelligenceRow => {
    const supplier = row.suppliers.find(item => item.preferred) || row.suppliers[0] || null;
    const term = supplier ? byKey.get(`${supplier.supplierId}:${row.variant_id}`) : undefined;
    const minimumOrderQuantity = positiveInteger(term?.minimum_order_quantity);
    const orderMultiple = positiveInteger(term?.order_multiple);
    const raw = row.scenarios;
    const scenarios = {
      minimum: orderableQuantity(raw.minimum, minimumOrderQuantity, orderMultiple),
      recommended: orderableQuantity(raw.recommended, minimumOrderQuantity, orderMultiple),
      maximum: orderableQuantity(raw.maximum, minimumOrderQuantity, orderMultiple),
    };
    const adjusted = scenarios.minimum !== raw.minimum || scenarios.recommended !== raw.recommended || scenarios.maximum !== raw.maximum;
    const explanation = [...row.explanation];

    if (adjusted && supplier) {
      const constraints = [
        minimumOrderQuantity ? `minimum order ${minimumOrderQuantity}` : null,
        orderMultiple ? `order multiple ${orderMultiple}` : null,
      ].filter(Boolean).join(" and ");
      explanation.push(`Buying scenarios are rounded to ${supplier.supplierName}'s ${constraints} so the recommendation is order-ready.`);
    }

    return {
      ...row,
      scenarios,
      recommended_quantity: scenarios.recommended,
      explanation,
      ordering_constraints: {
        supplier_id: supplier?.supplierId || null,
        supplier_name: supplier?.supplierName || null,
        minimum_order_quantity: minimumOrderQuantity,
        order_multiple: orderMultiple,
        adjusted,
      },
    };
  };

  const positions = response.positions.map(adjust);
  const positionById = new Map(positions.map(row => [row.id, row]));
  return {
    ...response,
    positions,
    suggestions: response.suggestions.map(row => positionById.get(row.id) || adjust(row)),
  };
}
