import type { TenantStore } from "../src/worker/tenant-store-app";

declare module "cloudflare:workers" {
  interface ProvidedEnv {
    TENANT_STORES: DurableObjectNamespace<TenantStore>;
  }
}
