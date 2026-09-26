import type { TenantStore } from "../src/worker/tenant-store-order-planning";

declare module "cloudflare:workers" {
  interface ProvidedEnv {
    TENANT_STORES: DurableObjectNamespace<TenantStore>;
  }
}
