import type { TenantStore } from "../src/worker/tenant-store-saved-views";

declare module "cloudflare:workers" {
  interface ProvidedEnv {
    TENANT_STORES: DurableObjectNamespace<TenantStore>;
  }
}
