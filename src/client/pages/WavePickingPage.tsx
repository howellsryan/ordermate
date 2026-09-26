import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { OrganizationSummary } from "../../shared/types";
import WavePicking from "../WavePicking";
import { tenantApi } from "../api";
import type { Order, Product } from "../model";
import { compareOrderUrgency } from "../order-priority";
import { DataState, ErrorText, PageHeader } from "../ui";

export default function WavePickingPage({ tenant }: { tenant: OrganizationSummary }) {
  const products = useQuery({ queryKey: ["tenant", tenant.id, "products"], queryFn: () => tenantApi<Product[]>(tenant.id, "/products") });
  const orders = useQuery({ queryKey: ["tenant", tenant.id, "orders"], queryFn: () => tenantApi<Order[]>(tenant.id, "/orders") });
  const barcodeByVariant = useMemo(() => new Map(
    (products.data || []).flatMap(product => product.variants.map(variant => [variant.id, variant.barcode || ""] as const)),
  ), [products.data]);
  const openOrders = useMemo(() => (orders.data || [])
    .filter(order => order.status === "confirmed" && order.fulfilment_status !== "fulfilled")
    .sort(compareOrderUrgency), [orders.data]);

  return <>
    <PageHeader eyebrow="Warehouse" title="Wave picking" description="Batch compatible confirmed orders from one location, scan aggregate SKU quantities once, then review the exact per-order allocation before fulfilment." />
    {products.error ? <ErrorText error={products.error} /> : orders.error ? <ErrorText error={orders.error} /> : <DataState loading={products.isLoading || orders.isLoading} error={null} empty={openOrders.length < 2} emptyText="Wave picking becomes available when at least two confirmed orders are awaiting fulfilment.">
      <WavePicking tenant={tenant} orders={openOrders} barcodeByVariant={barcodeByVariant} />
    </DataState>}
  </>;
}
