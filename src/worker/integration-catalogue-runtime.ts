import { z } from "zod";
import { INTEGRATION_PROVIDERS, type IntegrationProvider } from "../shared/integration-contract";
import { integrationInternalHeaders } from "./integration-runtime";
import { migrateIntegrationSchema } from "./integration-schema";

const entityTypeSchema = z.enum(["variant", "location"]);
const resourceSchema = z.enum(["catalogue", "locations"]);
const matchStatusSchema = z.enum(["mapped", "suggested", "ambiguous", "unmatched"]);

const discoveryEntitySchema = z.object({
  externalId: z.string().trim().min(1).max(255),
  displayName: z.string().trim().min(1).max(500),
  externalUpdatedAt: z.string().datetime().nullable().optional(),
  payload: z.record(z.string(), z.unknown()),
});

const discoveryReplaceSchema = z.object({
  connectionId: z.string().uuid(),
  provider: z.enum(INTEGRATION_PROVIDERS),
  externalAccountId: z.string().trim().min(1).max(255),
  resource: resourceSchema,
  entityType: entityTypeSchema,
  entities: z.array(discoveryEntitySchema).max(25_000),
}).superRefine((value, ctx) => {
  const expected = value.entityType === "variant" ? "catalogue" : "locations";
  if (value.resource !== expected) ctx.addIssue({ code: "custom", message: `${value.entityType} discovery must use the ${expected} checkpoint` });
});

const checkpointSchema = z.object({
  connectionId: z.string().uuid(),
  resource: resourceSchema,
  status: z.enum(["running", "failed"]),
  error: z.string().trim().max(2000).nullable().optional(),
});

const mappingMutationSchema = z.object({
  mappings: z.array(z.object({
    entityType: entityTypeSchema,
    externalId: z.string().trim().min(1).max(255),
    localEntityId: z.string().trim().min(1).max(255).nullable(),
  })).min(1).max(5_000),
});

type ConnectionRow = {
  id: string;
  provider: IntegrationProvider;
  external_account_id: string;
  display_name: string;
  status: string;
  last_event_at: string | null;
  last_success_at: string | null;
  last_error_at: string | null;
  last_error: string | null;
};

type ExternalEntityRow = {
  connection_id: string;
  entity_type: "variant" | "location";
  external_id: string;
  display_name: string;
  payload_json: string;
  external_updated_at: string | null;
  match_status: "mapped" | "suggested" | "ambiguous" | "unmatched";
  suggested_local_entity_type: string | null;
  suggested_local_entity_id: string | null;
  suggestion_reason: string | null;
  discovered_at: string;
  updated_at: string;
};

type LinkRow = {
  provider: IntegrationProvider;
  connection_id: string;
  entity_type: string;
  external_id: string;
  local_entity_type: string;
  local_entity_id: string;
  external_updated_at: string | null;
  last_synced_at: string;
};

type CheckpointRow = {
  resource: "catalogue" | "locations";
  status: "idle" | "running" | "completed" | "failed";
  item_count: number;
  started_at: string | null;
  completed_at: string | null;
  last_error: string | null;
  updated_at: string;
};

type LocalVariant = {
  id: string;
  sku: string;
  barcode: string | null;
  product_name: string;
  variant_name: string;
};

type LocalLocation = { id: string; name: string; code: string };
type MatchResult = {
  status: z.infer<typeof matchStatusSchema>;
  localEntityType: "product_variant" | "location" | null;
  localEntityId: string | null;
  reason: string | null;
};

type MatchIndexes = {
  variants: LocalVariant[];
  locations: LocalLocation[];
  variantBySku: Map<string, Set<string>>;
  variantByBarcode: Map<string, Set<string>>;
  locationByIdentity: Map<string, Set<string>>;
};

const INTERNAL_ENTRIES = Object.entries(integrationInternalHeaders);

function now() {
  return new Date().toISOString();
}

function actor(request: Request) {
  return {
    id: request.headers.get("x-ordermate-actor-id") || "integration-system",
    role: request.headers.get("x-ordermate-actor-role") || "integration",
  };
}

function internalRequest(request: Request) {
  return INTERNAL_ENTRIES.every(([key, value]) => request.headers.get(key) === value);
}

function normalizeIdentity(value: unknown) {
  return typeof value === "string" ? value.trim().normalize("NFKC").toUpperCase() : "";
}

function payloadObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function addIndex(map: Map<string, Set<string>>, key: string, id: string) {
  if (!key) return;
  const ids = map.get(key) || new Set<string>();
  ids.add(id);
  map.set(key, ids);
}

function unionCandidates(...sets: Array<Set<string> | undefined>) {
  const result = new Set<string>();
  for (const set of sets) for (const id of set || []) result.add(id);
  return result;
}

export class IntegrationCatalogueRuntime {
  constructor(private readonly ctx: DurableObjectState) {
    migrateIntegrationSchema(ctx.storage);
  }

  async handle(request: Request): Promise<Response | null> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";

    const publicMappings = path.match(/^\/integrations\/([^/]+)\/mappings$/);
    if (request.method === "GET" && publicMappings) {
      return this.mappingState(decodeURIComponent(publicMappings[1]));
    }
    if ((request.method === "PATCH" || request.method === "POST") && publicMappings) {
      return this.updateMappings(decodeURIComponent(publicMappings[1]), request);
    }

    if (!path.startsWith("/__integrations/discovery/")) return null;
    if (!internalRequest(request)) return Response.json({ error: "Internal integration route" }, { status: 404 });

    if (request.method === "POST" && path === "/__integrations/discovery/replace") {
      return this.replaceDiscovery(request);
    }
    if (request.method === "POST" && path === "/__integrations/discovery/checkpoint") {
      return this.updateCheckpoint(request);
    }
    return Response.json({ error: "Internal integration discovery route not found" }, { status: 404 });
  }

  private connection(connectionId: string) {
    return this.ctx.storage.sql.exec<ConnectionRow>(
      `SELECT id, provider, external_account_id, display_name, status,
              last_event_at, last_success_at, last_error_at, last_error
       FROM integration_connections WHERE id = ?`,
      connectionId,
    ).toArray()[0] || null;
  }

  private localIndexes(): MatchIndexes {
    const variants = this.ctx.storage.sql.exec<LocalVariant>(
      `SELECT pv.id, pv.sku, pv.barcode, p.name AS product_name, pv.name AS variant_name
       FROM product_variants pv
       JOIN products p ON p.id = pv.product_id
       WHERE pv.active = 1 AND p.status = 'active'
       ORDER BY p.name COLLATE NOCASE, pv.name COLLATE NOCASE`,
    ).toArray();
    const locations = this.ctx.storage.sql.exec<LocalLocation>(
      `SELECT id, name, code FROM locations WHERE active = 1 ORDER BY name COLLATE NOCASE`,
    ).toArray();
    const variantBySku = new Map<string, Set<string>>();
    const variantByBarcode = new Map<string, Set<string>>();
    const locationByIdentity = new Map<string, Set<string>>();
    for (const variant of variants) {
      addIndex(variantBySku, normalizeIdentity(variant.sku), variant.id);
      addIndex(variantByBarcode, normalizeIdentity(variant.barcode), variant.id);
    }
    for (const location of locations) {
      addIndex(locationByIdentity, normalizeIdentity(location.name), location.id);
      addIndex(locationByIdentity, normalizeIdentity(location.code), location.id);
    }
    return { variants, locations, variantBySku, variantByBarcode, locationByIdentity };
  }

  private links(connectionId: string, entityType?: "variant" | "location") {
    const params: string[] = entityType ? [connectionId, entityType] : [connectionId];
    return this.ctx.storage.sql.exec<LinkRow>(
      `SELECT provider, connection_id, entity_type, external_id, local_entity_type, local_entity_id,
              external_updated_at, last_synced_at
       FROM integration_entity_links
       WHERE connection_id = ? ${entityType ? "AND entity_type = ?" : ""}
       ORDER BY entity_type, external_id`,
      ...params,
    ).toArray();
  }

  private match(
    entityType: "variant" | "location",
    payload: Record<string, unknown>,
    indexes: MatchIndexes,
    localLinks: Map<string, string>,
    externalId: string,
  ): MatchResult {
    if (entityType === "variant") {
      const sku = normalizeIdentity(payload.sku);
      const barcode = normalizeIdentity(payload.barcode);
      const candidates = unionCandidates(indexes.variantBySku.get(sku), indexes.variantByBarcode.get(barcode));
      if (candidates.size === 0) return { status: "unmatched", localEntityType: null, localEntityId: null, reason: sku || barcode ? "No exact local SKU or barcode match" : "Shopify variant has no SKU or barcode" };
      if (candidates.size > 1) return { status: "ambiguous", localEntityType: null, localEntityId: null, reason: "SKU and barcode evidence point to different local variants" };
      const localEntityId = [...candidates][0];
      const claimedBy = localLinks.get(`product_variant:${localEntityId}`);
      if (claimedBy && claimedBy !== externalId) return { status: "ambiguous", localEntityType: null, localEntityId: null, reason: "Exact match is already mapped to another external variant" };
      const skuMatch = !!sku && indexes.variantBySku.get(sku)?.has(localEntityId);
      const barcodeMatch = !!barcode && indexes.variantByBarcode.get(barcode)?.has(localEntityId);
      const reason = skuMatch && barcodeMatch ? "Exact SKU and barcode match" : barcodeMatch ? "Exact barcode match" : "Exact SKU match";
      return { status: "suggested", localEntityType: "product_variant", localEntityId, reason };
    }

    const identity = normalizeIdentity(payload.name);
    if (!identity) return { status: "unmatched", localEntityType: null, localEntityId: null, reason: "Shopify location has no name" };
    const candidates = indexes.locationByIdentity.get(identity) || new Set<string>();
    if (candidates.size === 0) return { status: "unmatched", localEntityType: null, localEntityId: null, reason: "No exact local location name or code match" };
    if (candidates.size > 1) return { status: "ambiguous", localEntityType: null, localEntityId: null, reason: "Location identity matches more than one local location" };
    const localEntityId = [...candidates][0];
    const claimedBy = localLinks.get(`location:${localEntityId}`);
    if (claimedBy && claimedBy !== externalId) return { status: "ambiguous", localEntityType: null, localEntityId: null, reason: "Exact match is already mapped to another external location" };
    return { status: "suggested", localEntityType: "location", localEntityId, reason: "Exact location name/code match" };
  }

  private mappingState(connectionId: string) {
    const connection = this.connection(connectionId);
    if (!connection) return Response.json({ error: "Integration connection not found" }, { status: 404 });
    const indexes = this.localIndexes();
    const links = this.links(connectionId);
    const linkByExternal = new Map<string, LinkRow>(links.map(link => [`${link.entity_type}:${link.external_id}`, link] as const));
    const entities = this.ctx.storage.sql.exec<ExternalEntityRow>(
      `SELECT connection_id, entity_type, external_id, display_name, payload_json, external_updated_at,
              match_status, suggested_local_entity_type, suggested_local_entity_id, suggestion_reason,
              discovered_at, updated_at
       FROM integration_external_entities WHERE connection_id = ?
       ORDER BY entity_type, display_name COLLATE NOCASE, external_id`,
      connectionId,
    ).toArray().map(row => {
      const link = linkByExternal.get(`${row.entity_type}:${row.external_id}`);
      return {
        entityType: row.entity_type,
        externalId: row.external_id,
        displayName: row.display_name,
        externalUpdatedAt: row.external_updated_at,
        payload: payloadObject(row.payload_json),
        matchStatus: link ? "mapped" : row.match_status,
        mapping: link ? { localEntityType: link.local_entity_type, localEntityId: link.local_entity_id, lastSyncedAt: link.last_synced_at } : null,
        suggestion: !link && row.suggested_local_entity_id ? {
          localEntityType: row.suggested_local_entity_type,
          localEntityId: row.suggested_local_entity_id,
          reason: row.suggestion_reason,
        } : null,
        suggestionReason: !link ? row.suggestion_reason : null,
        discoveredAt: row.discovered_at,
      };
    });
    const entityKeys = new Set<string>(entities.map(entity => `${entity.entityType}:${entity.externalId}`));
    const staleLinks = links.filter(link => !entityKeys.has(`${link.entity_type}:${link.external_id}`)).map(link => ({
      entityType: link.entity_type,
      externalId: link.external_id,
      localEntityType: link.local_entity_type,
      localEntityId: link.local_entity_id,
      lastSyncedAt: link.last_synced_at,
    }));
    const checkpoints = this.ctx.storage.sql.exec<CheckpointRow>(
      `SELECT resource, status, item_count, started_at, completed_at, last_error, updated_at
       FROM integration_sync_checkpoints WHERE connection_id = ? ORDER BY resource`,
      connectionId,
    ).toArray().map(row => ({
      resource: row.resource,
      status: row.status,
      itemCount: row.item_count,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      lastError: row.last_error,
      updatedAt: row.updated_at,
    }));
    const counts = entities.reduce<Record<string, number>>((result, entity) => {
      result[entity.matchStatus] = (result[entity.matchStatus] || 0) + 1;
      return result;
    }, { mapped: 0, suggested: 0, ambiguous: 0, unmatched: 0 });
    return Response.json({
      connection: {
        id: connection.id,
        provider: connection.provider,
        externalAccountId: connection.external_account_id,
        displayName: connection.display_name,
        status: connection.status,
        lastEventAt: connection.last_event_at,
        lastSuccessAt: connection.last_success_at,
        lastErrorAt: connection.last_error_at,
        lastError: connection.last_error,
      },
      checkpoints,
      counts,
      entities,
      staleLinks,
      local: {
        variants: indexes.variants.map(item => ({ id: item.id, sku: item.sku, barcode: item.barcode, productName: item.product_name, variantName: item.variant_name })),
        locations: indexes.locations,
      },
    });
  }

  private async replaceDiscovery(request: Request) {
    let input: z.infer<typeof discoveryReplaceSchema>;
    try {
      input = discoveryReplaceSchema.parse(await request.json());
    } catch (cause) {
      if (cause instanceof z.ZodError) return Response.json({ error: cause.issues[0]?.message || "Invalid integration discovery payload" }, { status: 400 });
      throw cause;
    }
    const connection = this.connection(input.connectionId);
    if (!connection) return Response.json({ error: "Integration connection not found" }, { status: 404 });
    if (connection.provider !== input.provider || connection.external_account_id !== input.externalAccountId) {
      return Response.json({ error: "Integration discovery does not match its connection" }, { status: 409 });
    }

    const indexes = this.localIndexes();
    const links = this.links(input.connectionId, input.entityType);
    const linkByExternal = new Map<string, LinkRow>(links.map(link => [link.external_id, link] as const));
    const localLinks = new Map<string, string>(links.map(link => [`${link.local_entity_type}:${link.local_entity_id}`, link.external_id] as const));
    const timestamp = now();
    const prepared = input.entities.map(entity => {
      const approved = linkByExternal.get(entity.externalId);
      const result: MatchResult = approved
        ? { status: "mapped", localEntityType: approved.local_entity_type as "product_variant" | "location", localEntityId: approved.local_entity_id, reason: "Approved mapping" }
        : this.match(input.entityType, entity.payload, indexes, localLinks, entity.externalId);
      return { entity, result };
    });

    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "DELETE FROM integration_external_entities WHERE connection_id = ? AND entity_type = ?",
        input.connectionId,
        input.entityType,
      );
      for (const { entity, result } of prepared) {
        this.ctx.storage.sql.exec(
          `INSERT INTO integration_external_entities (
             connection_id, entity_type, external_id, display_name, payload_json, external_updated_at,
             match_status, suggested_local_entity_type, suggested_local_entity_id, suggestion_reason,
             discovered_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          input.connectionId,
          input.entityType,
          entity.externalId,
          entity.displayName,
          JSON.stringify(entity.payload),
          entity.externalUpdatedAt ?? null,
          result.status,
          result.status === "suggested" ? result.localEntityType : null,
          result.status === "suggested" ? result.localEntityId : null,
          result.reason,
          timestamp,
          timestamp,
        );
      }
      this.ctx.storage.sql.exec(
        `INSERT INTO integration_sync_checkpoints (
           connection_id, resource, status, item_count, started_at, completed_at, last_error, updated_at
         ) VALUES (?, ?, 'completed', ?, ?, ?, NULL, ?)
         ON CONFLICT(connection_id, resource) DO UPDATE SET
           status = 'completed', item_count = excluded.item_count,
           completed_at = excluded.completed_at, last_error = NULL, updated_at = excluded.updated_at`,
        input.connectionId,
        input.resource,
        input.entities.length,
        timestamp,
        timestamp,
        timestamp,
      );
      const incomplete = this.ctx.storage.sql.exec<{ count: number }>(
        `SELECT COUNT(*) AS count FROM integration_sync_checkpoints
         WHERE connection_id = ? AND resource IN ('catalogue','locations') AND status <> 'completed'`,
        input.connectionId,
      ).toArray()[0]?.count ?? 0;
      const checkpointCount = this.ctx.storage.sql.exec<{ count: number }>(
        `SELECT COUNT(*) AS count FROM integration_sync_checkpoints
         WHERE connection_id = ? AND resource IN ('catalogue','locations')`,
        input.connectionId,
      ).toArray()[0]?.count ?? 0;
      if (incomplete === 0 && checkpointCount === 2) {
        this.ctx.storage.sql.exec(
          `UPDATE integration_connections
           SET last_success_at = ?, last_error_at = NULL, last_error = NULL, updated_at = ?
           WHERE id = ?`,
          timestamp,
          timestamp,
          input.connectionId,
        );
      }
    });

    return Response.json({
      ok: true,
      resource: input.resource,
      itemCount: input.entities.length,
      summary: prepared.reduce<Record<string, number>>((result, item) => {
        result[item.result.status] = (result[item.result.status] || 0) + 1;
        return result;
      }, { mapped: 0, suggested: 0, ambiguous: 0, unmatched: 0 }),
    });
  }

  private async updateCheckpoint(request: Request) {
    let input: z.infer<typeof checkpointSchema>;
    try {
      input = checkpointSchema.parse(await request.json());
    } catch (cause) {
      if (cause instanceof z.ZodError) return Response.json({ error: cause.issues[0]?.message || "Invalid integration checkpoint" }, { status: 400 });
      throw cause;
    }
    if (!this.connection(input.connectionId)) return Response.json({ error: "Integration connection not found" }, { status: 404 });
    const timestamp = now();
    if (input.status === "running") {
      this.ctx.storage.sql.exec(
        `INSERT INTO integration_sync_checkpoints (
           connection_id, resource, status, item_count, started_at, completed_at, last_error, updated_at
         ) VALUES (?, ?, 'running', 0, ?, NULL, NULL, ?)
         ON CONFLICT(connection_id, resource) DO UPDATE SET
           status = 'running', item_count = 0, started_at = excluded.started_at,
           completed_at = NULL, last_error = NULL, updated_at = excluded.updated_at`,
        input.connectionId,
        input.resource,
        timestamp,
        timestamp,
      );
    } else {
      const error = input.error || "Integration discovery failed";
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec(
          `INSERT INTO integration_sync_checkpoints (
             connection_id, resource, status, item_count, started_at, completed_at, last_error, updated_at
           ) VALUES (?, ?, 'failed', 0, NULL, ?, ?, ?)
           ON CONFLICT(connection_id, resource) DO UPDATE SET
             status = 'failed', completed_at = excluded.completed_at,
             last_error = excluded.last_error, updated_at = excluded.updated_at`,
          input.connectionId,
          input.resource,
          timestamp,
          error,
          timestamp,
        );
        this.ctx.storage.sql.exec(
          `UPDATE integration_connections SET last_error_at = ?, last_error = ?, updated_at = ? WHERE id = ?`,
          timestamp,
          error,
          timestamp,
          input.connectionId,
        );
      });
    }
    return Response.json({ ok: true });
  }

  private localEntityExists(entityType: "variant" | "location", localEntityId: string) {
    if (entityType === "variant") {
      return !!this.ctx.storage.sql.exec<{ id: string }>(
        `SELECT pv.id FROM product_variants pv JOIN products p ON p.id = pv.product_id
         WHERE pv.id = ? AND pv.active = 1 AND p.status = 'active'`,
        localEntityId,
      ).toArray()[0];
    }
    return !!this.ctx.storage.sql.exec<{ id: string }>(
      "SELECT id FROM locations WHERE id = ? AND active = 1",
      localEntityId,
    ).toArray()[0];
  }

  private async updateMappings(connectionId: string, request: Request) {
    const connection = this.connection(connectionId);
    if (!connection) return Response.json({ error: "Integration connection not found" }, { status: 404 });
    let input: z.infer<typeof mappingMutationSchema>;
    try {
      input = mappingMutationSchema.parse(await request.json());
    } catch (cause) {
      if (cause instanceof z.ZodError) return Response.json({ error: cause.issues[0]?.message || "Invalid integration mappings" }, { status: 400 });
      throw cause;
    }

    const keys = new Set<string>();
    const targetKeys = new Set<string>();
    const affectedExternalIds = new Set<string>(input.mappings.map(mapping => `${mapping.entityType}:${mapping.externalId}`));
    const externalByKey = new Map<string, ExternalEntityRow>();
    for (const mapping of input.mappings) {
      const key = `${mapping.entityType}:${mapping.externalId}`;
      if (keys.has(key)) return Response.json({ error: "Each external entity can be mapped only once per request" }, { status: 409 });
      keys.add(key);
      const external = this.ctx.storage.sql.exec<ExternalEntityRow>(
        `SELECT connection_id, entity_type, external_id, display_name, payload_json, external_updated_at,
                match_status, suggested_local_entity_type, suggested_local_entity_id, suggestion_reason,
                discovered_at, updated_at
         FROM integration_external_entities WHERE connection_id = ? AND entity_type = ? AND external_id = ?`,
        connectionId,
        mapping.entityType,
        mapping.externalId,
      ).toArray()[0];
      if (!external) return Response.json({ error: `External ${mapping.entityType} is not present in the latest discovery` }, { status: 404 });
      externalByKey.set(key, external);
      if (mapping.localEntityId) {
        if (!this.localEntityExists(mapping.entityType, mapping.localEntityId)) {
          return Response.json({ error: `Selected local ${mapping.entityType} is unavailable` }, { status: 409 });
        }
        const localType = mapping.entityType === "variant" ? "product_variant" : "location";
        const targetKey = `${mapping.entityType}:${localType}:${mapping.localEntityId}`;
        if (targetKeys.has(targetKey)) return Response.json({ error: "A local entity cannot be assigned to two external entities" }, { status: 409 });
        targetKeys.add(targetKey);
        const existing = this.ctx.storage.sql.exec<{ external_id: string }>(
          `SELECT external_id FROM integration_entity_links
           WHERE connection_id = ? AND entity_type = ? AND local_entity_type = ? AND local_entity_id = ?`,
          connectionId,
          mapping.entityType,
          localType,
          mapping.localEntityId,
        ).toArray()[0];
        if (existing && !affectedExternalIds.has(`${mapping.entityType}:${existing.external_id}`)) {
          return Response.json({ error: "Selected local entity is already mapped to another external entity" }, { status: 409 });
        }
      }
    }

    const timestamp = now();
    const requestActor = actor(request);
    this.ctx.storage.transactionSync(() => {
      for (const mapping of input.mappings) {
        this.ctx.storage.sql.exec(
          "DELETE FROM integration_entity_links WHERE provider = ? AND connection_id = ? AND entity_type = ? AND external_id = ?",
          connection.provider,
          connectionId,
          mapping.entityType,
          mapping.externalId,
        );
      }
      for (const mapping of input.mappings) {
        if (!mapping.localEntityId) continue;
        const external = externalByKey.get(`${mapping.entityType}:${mapping.externalId}`)!;
        const localType = mapping.entityType === "variant" ? "product_variant" : "location";
        this.ctx.storage.sql.exec(
          `INSERT INTO integration_entity_links (
             provider, connection_id, entity_type, external_id, local_entity_type, local_entity_id,
             external_updated_at, last_synced_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          connection.provider,
          connectionId,
          mapping.entityType,
          mapping.externalId,
          localType,
          mapping.localEntityId,
          external.external_updated_at,
          timestamp,
        );
      }

      const indexes = this.localIndexes();
      const links = this.links(connectionId);
      const linkByExternal = new Map<string, LinkRow>(links.map(link => [`${link.entity_type}:${link.external_id}`, link] as const));
      const localLinks = new Map<string, string>(links.map(link => [`${link.local_entity_type}:${link.local_entity_id}`, link.external_id] as const));
      for (const mapping of input.mappings) {
        const key = `${mapping.entityType}:${mapping.externalId}`;
        const external = externalByKey.get(key)!;
        const approved = linkByExternal.get(key);
        const result: MatchResult = approved
          ? { status: "mapped", localEntityType: approved.local_entity_type as "product_variant" | "location", localEntityId: approved.local_entity_id, reason: "Approved mapping" }
          : this.match(mapping.entityType, payloadObject(external.payload_json), indexes, localLinks, mapping.externalId);
        this.ctx.storage.sql.exec(
          `UPDATE integration_external_entities
           SET match_status = ?, suggested_local_entity_type = ?, suggested_local_entity_id = ?,
               suggestion_reason = ?, updated_at = ?
           WHERE connection_id = ? AND entity_type = ? AND external_id = ?`,
          result.status,
          result.status === "suggested" ? result.localEntityType : null,
          result.status === "suggested" ? result.localEntityId : null,
          result.reason,
          timestamp,
          connectionId,
          mapping.entityType,
          mapping.externalId,
        );
      }
      this.ctx.storage.sql.exec(
        `INSERT INTO audit_events (id, actor_id, actor_role, action, entity_type, entity_id, metadata_json, created_at)
         VALUES (?, ?, ?, 'integration.mappings_updated', 'integration_connection', ?, ?, ?)`,
        crypto.randomUUID(),
        requestActor.id,
        requestActor.role,
        connectionId,
        JSON.stringify({ mappings: input.mappings.map(mapping => ({ entityType: mapping.entityType, externalId: mapping.externalId, localEntityId: mapping.localEntityId })) }),
        timestamp,
      );
    });

    return this.mappingState(connectionId);
  }
}
