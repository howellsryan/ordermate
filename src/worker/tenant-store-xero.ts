import type { TenantEnv } from "./tenant-store";
import { TenantStore as OperationalTenantStore } from "./tenant-store-order-planning";
import { XeroAccountingRuntime, type XeroAccountingEnv } from "./xero-accounting-runtime";

/**
 * Xero accounting is composed at the outer tenant boundary so canonical service
 * invoice issuance remains authoritative. Provider sync observes successful
 * canonical mutations and can never make an invoice issue succeed or fail.
 */
export class TenantStore extends OperationalTenantStore {
  private readonly xeroAccountingRuntime: XeroAccountingRuntime;

  constructor(ctx: DurableObjectState, env: TenantEnv) {
    super(ctx, env);
    this.xeroAccountingRuntime = new XeroAccountingRuntime(ctx, env as XeroAccountingEnv);
  }

  async fetch(request: Request): Promise<Response> {
    const xeroResponse = await this.xeroAccountingRuntime.handle(request);
    if (xeroResponse) return xeroResponse;
    const response = await super.fetch(request);
    return this.xeroAccountingRuntime.afterCanonicalMutation(request, response);
  }
}
