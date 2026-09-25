import type { TenantStore } from "../src/worker/tenant-store-bulk";

declare module "cloudflare:workers" {
  interface ProvidedEnv {
    TENANT_STORES: DurableObjectNamespace<TenantStore>;
  }
}
