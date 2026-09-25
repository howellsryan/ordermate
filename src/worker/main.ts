import type { AuthEnv } from "./auth";
import baseWorker from "./index";
import { operationsApp } from "./operations";
import { TenantStore } from "./tenant-store";

export { TenantStore };

type Env = AuthEnv & {
  TENANT_STORES: DurableObjectNamespace<TenantStore>;
  DOCUMENTS: R2Bucket;
  EVENTS_QUEUE: Queue;
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname === "/api/ops" || url.pathname.startsWith("/api/ops/")) {
      url.pathname = url.pathname.replace(/^\/api\/ops/, "") || "/";
      return operationsApp.fetch(new Request(url, request), env, ctx);
    }
    return baseWorker.fetch(request, env, ctx);
  },

  async queue(batch: MessageBatch, env: Env) {
    return baseWorker.queue(batch, env);
  },
};
