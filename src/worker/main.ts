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

function secureApiResponse(response: Response) {
  const secured = new Response(response.body, response);
  secured.headers.set("Cache-Control", "no-store");
  secured.headers.set("X-Content-Type-Options", "nosniff");
  secured.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  secured.headers.set("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
  return secured;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname === "/api/ops" || url.pathname.startsWith("/api/ops/")) {
      url.pathname = url.pathname.replace(/^\/api\/ops/, "") || "/";
      const response = await operationsApp.fetch(new Request(url, request), env, ctx);
      return secureApiResponse(response);
    }
    return baseWorker.fetch(request, env, ctx);
  },

  async queue(batch: MessageBatch, env: Env) {
    return baseWorker.queue(batch, env);
  },
};
