import type { TenantStore } from "../src/worker/tenant-store-final";

declare module "cloudflare:workers" {
  interface ProvidedEnv {
    TENANT_STORES: DurableObjectNamespace<TenantStore>;
  }
}
