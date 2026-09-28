import { z } from "zod";
import { INTEGRATION_PROVIDERS } from "./integration-contract";

export const integrationOrderLineSchema = z.object({
  externalLineId: z.string().trim().min(1).max(255),
  externalVariantId: z.string().trim().min(1).max(255),
  quantity: z.number().int().positive().max(1_000_000),
  productNameSnapshot: z.string().trim().min(1).max(500),
  variantNameSnapshot: z.string().trim().min(1).max(500),
  skuSnapshot: z.string().trim().max(255),
  unitPriceMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  taxRateBps: z.number().int().nonnegative().max(1_000_000),
  netMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  taxMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  grossMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).superRefine((line, ctx) => {
  if (line.grossMinor !== line.netMinor + line.taxMinor) {
    ctx.addIssue({ code: "custom", message: "Integration order line gross must equal net plus tax" });
  }
});

export const integrationOrderProposalSchema = z.object({
  provider: z.enum(INTEGRATION_PROVIDERS),
  connectionId: z.string().uuid(),
  externalOrderId: z.string().trim().min(1).max(255),
  externalOrderName: z.string().trim().min(1).max(255),
  externalUpdatedAt: z.string().datetime(),
  state: z.enum(["active", "cancelled"]),
  currency: z.string().trim().length(3).transform(value => value.toUpperCase()),
  locationExternalId: z.string().trim().min(1).max(255).nullable(),
  subtotalMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  taxMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  totalMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  nonMerchandiseMinor: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
  lines: z.array(integrationOrderLineSchema).max(2_000),
}).superRefine((proposal, ctx) => {
  if (proposal.state === "active") {
    if (!proposal.locationExternalId) ctx.addIssue({ code: "custom", message: "Active integration orders require one external fulfilment location" });
    if (!proposal.lines.length) ctx.addIssue({ code: "custom", message: "Active integration orders require at least one line" });
  }
  if (proposal.lines.length) {
    const externalLineIds = new Set<string>();
    for (const line of proposal.lines) {
      if (externalLineIds.has(line.externalLineId)) {
        ctx.addIssue({ code: "custom", message: `Integration order contains duplicate line ${line.externalLineId}` });
      }
      externalLineIds.add(line.externalLineId);
    }
    const lineSubtotal = proposal.lines.reduce((sum, line) => sum + line.netMinor, 0);
    const lineTax = proposal.lines.reduce((sum, line) => sum + line.taxMinor, 0);
    if (lineSubtotal !== proposal.subtotalMinor) {
      ctx.addIssue({ code: "custom", message: "Integration order line net totals do not match the order subtotal" });
    }
    if (lineTax !== proposal.taxMinor) {
      ctx.addIssue({ code: "custom", message: "Integration order line tax totals do not match the order tax total" });
    }
    if (proposal.totalMinor !== proposal.subtotalMinor + proposal.taxMinor + proposal.nonMerchandiseMinor) {
      ctx.addIssue({ code: "custom", message: "Integration order total does not reconcile" });
    }
  }
});

export type IntegrationOrderLine = z.infer<typeof integrationOrderLineSchema>;
export type IntegrationOrderProposal = z.infer<typeof integrationOrderProposalSchema>;

export type MappedIntegrationOrderLine = Omit<IntegrationOrderLine, "externalVariantId"> & {
  externalVariantId: string;
  variantId: string;
};

export type MappedIntegrationOrder = Omit<IntegrationOrderProposal, "locationExternalId" | "lines"> & {
  locationExternalId: string;
  locationId: string;
  lines: MappedIntegrationOrderLine[];
};

/**
 * The proposal is provider truth, not permission to mutate canonical state.
 * Mapping and canonical-order validation happen after this boundary.
 */
export function canonicalIntegrationOrderJson(proposal: IntegrationOrderProposal) {
  return JSON.stringify(integrationOrderProposalSchema.parse(proposal));
}
