import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { WorkspaceFeatureKey } from "../src/shared/features";
import { WORKSPACE_FEATURE_KEYS } from "../src/shared/features";
import { WORKSPACE_MODULE_KEYS } from "../src/shared/modules";
import type { TenantStore } from "../src/worker/tenant-store-runtime";

type Stub = DurableObjectStub<TenantStore>;
type FeatureState = { key: WorkspaceFeatureKey; enabled: boolean; updated_by: string | null };
type FeaturesResponse = { features: FeatureState[] };
type ModulesResponse = { modules: Array<{ key: string; enabled: boolean }> };

function tenant(): Stub {
  return env.TENANT_STORES.getByName(`feature-test-${crypto.randomUUID()}`);
}

async function request(stub: Stub, path: string, method = "GET", body?: unknown) {
  const headers = new Headers({
    "x-ordermate-actor-id": "feature-reviewer",
    "x-ordermate-actor-role": "owner",
  });
  if (body !== undefined) headers.set("content-type", "application/json");
  return stub.fetch(new Request(`https://tenant.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
}

async function json<T>(response: Response): Promise<T> {
  return response.json<T>();
}

describe("workspace feature runtime", () => {
  it("defaults every declared feature on without leaking feature rows into modules", async () => {
    const stub = tenant();
    const featuresResponse = await request(stub, "/features");
    expect(featuresResponse.status).toBe(200);
    const features = await json<FeaturesResponse>(featuresResponse);
    expect(features.features.map(feature => feature.key).sort()).toEqual([...WORKSPACE_FEATURE_KEYS].sort());
    expect(features.features.every(feature => feature.enabled)).toBe(true);

    const modulesResponse = await request(stub, "/modules");
    expect(modulesResponse.status).toBe(200);
    const modules = await json<ModulesResponse>(modulesResponse);
    expect(modules.modules.map(module => module.key).sort()).toEqual([...WORKSPACE_MODULE_KEYS].sort());
  });

  it("persists a feature override, audits it and blocks its dedicated route", async () => {
    const stub = tenant();
    const update = await request(stub, "/features/operating_intelligence", "PATCH", { enabled: false });
    expect(update.status).toBe(200);

    const reread = await json<FeaturesResponse>(await request(stub, "/features"));
    const intelligence = reread.features.find(feature => feature.key === "operating_intelligence");
    expect(intelligence).toMatchObject({ enabled: false, updated_by: "feature-reviewer" });

    const blocked = await request(stub, "/replenishment");
    expect(blocked.status).toBe(404);
    expect(await blocked.json<{ error: string }>()).toEqual({ error: "Operating Intelligence is disabled or unavailable for this workspace." });

    const audit = await json<Array<{ action: string; entity_id: string; actor_id: string }>>(await request(stub, "/audit"));
    expect(audit.some(event => event.action === "workspace_feature.updated" && event.entity_id === "operating_intelligence" && event.actor_id === "feature-reviewer")).toBe(true);
  });

  it("blocks a configured feature when one of its required modules is unavailable", async () => {
    const stub = tenant();
    const disablePurchasing = await request(stub, "/modules/purchasing", "PATCH", { enabled: false });
    expect(disablePurchasing.status).toBe(200);

    const features = await json<FeaturesResponse>(await request(stub, "/features"));
    expect(features.features.find(feature => feature.key === "operating_intelligence")?.enabled).toBe(true);

    const blocked = await request(stub, "/replenishment");
    expect(blocked.status).toBe(404);
    expect(await blocked.json<{ error: string }>()).toEqual({ error: "Operating Intelligence is disabled or unavailable for this workspace." });
  });

  it("returns an empty discrepancy queue when disabled so shared attention reads stay healthy", async () => {
    const stub = tenant();
    const update = await request(stub, "/features/delivery_discrepancies", "PATCH", { enabled: false });
    expect(update.status).toBe(200);

    const list = await request(stub, "/delivery-discrepancies?status=open");
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual([]);

    const mutation = await request(stub, "/delivery-discrepancies/not-real", "PATCH", {
      resolutionCode: "other",
      resolutionNote: "Should be blocked by the feature flag",
    });
    expect(mutation.status).toBe(404);
  });

  it("returns client errors for malformed feature updates instead of internal errors", async () => {
    const stub = tenant();
    const wrongType = await request(stub, "/features/flow_plan", "PATCH", { enabled: "yes" });
    expect(wrongType.status).toBe(400);

    const invalidJson = await stub.fetch(new Request("https://tenant.test/features/flow_plan", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-ordermate-actor-id": "feature-reviewer",
        "x-ordermate-actor-role": "owner",
      },
      body: "{",
    }));
    expect(invalidJson.status).toBe(400);
  });
});
