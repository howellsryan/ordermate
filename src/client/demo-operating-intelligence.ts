import { buildOperatingIntelligence, type IntelligenceInput } from "../shared/operating-intelligence";
import type { InventoryPolicy, InventoryRow, Product, PurchaseOrderDetail, ReplenishmentResponse, SupplierVariant } from "./model";
import { demoOpsApi as demoRuntimeOpsApi } from "./demo-runtime";
import { demoTenantApi } from "./demo-stocktake";

type DemoSettings = { low_stock_threshold: number };
type DemoForecastMovement = {
  variant_id: string;
  location_id: string;
  quantity_delta: number;
  movement_type: string;
  created_at: string;
};
const DAY_MS = 86_400_000;

function ageInDays(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS);
}

function daysFromToday(date: string | null | undefined, fallback: number) {
  if (!date) return fallback;
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const expected = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(expected)) return fallback;
  return Math.max(0, Math.round((expected - todayUtc) / DAY_MS));
}

export async function demoOperatingIntelligence(): Promise<ReplenishmentResponse> {
  const [inventory, products, mappings, policies, movements, purchaseOrders, settings] = await Promise.all([
    demoTenantApi<InventoryRow[]>("/inventory"),
    demoTenantApi<Product[]>("/products"),
    demoTenantApi<SupplierVariant[]>("/supplier-variants"),
    demoTenantApi<InventoryPolicy[]>("/inventory-policies"),
    demoRuntimeOpsApi<DemoForecastMovement[]>("/movements"),
    demoTenantApi<PurchaseOrderDetail[]>("/purchase-orders"),
    demoTenantApi<DemoSettings>("/settings"),
  ]);

  const variantIndex = new Map(products.flatMap(product => product.variants.map(variant => [variant.id, { product, variant }] as const)));
  const active = new Set(products
    .filter(product => product.status === "active")
    .flatMap(product => product.variants.filter(variant => variant.active !== 0).map(variant => variant.id)));

  const inputs: IntelligenceInput[] = inventory
    .filter(row => row.tracked !== 0 && active.has(row.variant_id))
    .flatMap(row => {
      const indexed = variantIndex.get(row.variant_id);
      if (!indexed) return [];
      const policy = policies.find(item => item.variant_id === row.variant_id && item.location_id === row.location_id);
      const supplierMappings = mappings.filter(item => item.variant_id === row.variant_id);
      const suppliers = supplierMappings.map(mapping => ({
        supplierId: mapping.supplier_id,
        supplierName: mapping.supplier_name,
        supplierSku: mapping.supplier_sku,
        lastCostMinor: mapping.last_cost_minor,
        leadTimeDays: mapping.lead_time_days,
        preferred: mapping.supplier_id === policy?.preferred_supplier_id,
      })).sort((a, b) => Number(b.preferred) - Number(a.preferred) || a.supplierName.localeCompare(b.supplierName));
      const preferred = suppliers.find(item => item.preferred);
      const knownLeadTimes = suppliers.map(item => item.leadTimeDays).filter((days): days is number => days !== null && days !== undefined && days >= 0);
      const leadTime = preferred ? preferred.leadTimeDays ?? 7 : knownLeadTimes.length ? Math.min(...knownLeadTimes) : 7;

      let fulfilled30 = 0;
      let fulfilledPrevious60 = 0;
      for (const movement of movements) {
        if (movement.movement_type !== "order_fulfilment" || movement.variant_id !== row.variant_id || movement.location_id !== row.location_id) continue;
        const age = ageInDays(movement.created_at);
        if (age < 0 || age >= 90) continue;
        const units = Math.abs(Math.min(0, movement.quantity_delta));
        if (age < 30) fulfilled30 += units;
        else fulfilledPrevious60 += units;
      }

      const incomingSchedule = purchaseOrders
        .filter(po => po.location_id === row.location_id && ["ordered", "partially_received"].includes(po.status))
        .flatMap(po => po.lines
          .filter(line => line.variant_id === row.variant_id && line.quantity_ordered > line.quantity_received)
          .map(line => ({
            daysFromNow: daysFromToday(po.expected_delivery_date, leadTime),
            quantity: line.quantity_ordered - line.quantity_received,
          })));
      const scheduledIncoming = incomingSchedule.reduce((sum, item) => sum + item.quantity, 0);
      const residualIncoming = Math.max(0, row.incoming - scheduledIncoming);
      if (residualIncoming > 0) incomingSchedule.push({ daysFromNow: leadTime, quantity: residualIncoming });
      incomingSchedule.sort((a, b) => a.daysFromNow - b.daysFromNow);

      const recentDaily = fulfilled30 / 30;
      const threshold = policy?.reorder_point ?? settings.low_stock_threshold;
      const target = policy?.target_stock ?? Math.max(threshold * 2, Math.ceil(recentDaily * 14) + threshold);

      return [{
        id: `${row.variant_id}:${row.location_id}`,
        variant_id: row.variant_id,
        product_name: indexed.product.name,
        variant_name: indexed.variant.name,
        sku: indexed.variant.sku,
        location_id: row.location_id,
        location_name: row.location_name,
        on_hand: row.on_hand,
        reserved: row.reserved,
        available: row.available,
        incoming: row.incoming,
        incoming_schedule: incomingSchedule,
        fulfilled_30d: fulfilled30,
        fulfilled_prev_60d: fulfilledPrevious60,
        cost_minor: indexed.variant.cost_minor,
        threshold,
        target_stock: target,
        policy_custom: !!policy,
        preferred_supplier_id: policy?.preferred_supplier_id || null,
        effective_lead_time_days: leadTime,
        suppliers,
      }];
    });

  return buildOperatingIntelligence(inputs, { defaultThreshold: settings.low_stock_threshold });
}
