import { z } from "zod";
import { decryptCredentialPayload, encryptCredentialPayload, type EncryptedCredentialEnvelope } from "./integration-crypto";
import { migrateIntegrationSchema } from "./integration-schema";
import { refreshTokenExpiryIso, refreshXeroToken, tokenExpiryIso } from "./xero-auth";

export type XeroAccountingEnv = {
  XERO_CLIENT_ID?: string;
  XERO_CLIENT_SECRET?: string;
  INTEGRATION_TOKEN_ENCRYPTION_KEY?: string;
  INTEGRATION_TOKEN_KEY_VERSION?: string;
};

type Actor = { id: string; role: string; name: string };
type ConnectionRow = {
  id: string;
  provider: "shopify" | "xero" | "quickbooks";
  external_account_id: string;
  display_name: string;
  status: string;
  capabilities_json: string;
};
type CredentialRow = {
  encrypted_payload_json: string;
  scopes_json: string;
  access_token_expires_at: string;
  refresh_token_expires_at: string;
};
type StoredXeroCredential = { accessToken: string; refreshToken: string };
type MappingRow = {
  entity_type: string;
  external_id: string;
  local_entity_type: string;
  local_entity_id: string;
};
type ContactRow = {
  id: string;
  name: string;
  email: string | null;
  mobile: string | null;
  address_json: string | null;
};
type InvoiceRow = {
  id: string;
  number: string;
  status: string;
  currency: string;
  issue_date: string | null;
  due_date: string | null;
  total_minor: number;
  tax_minor: number;
  contact_id: string;
};
type InvoiceLineRow = {
  id: string;
  description_snapshot: string;
  quantity_milli: number;
  unit_price_minor: number;
  tax_rate_bps: number;
  net_minor: number;
  tax_minor: number;
  gross_minor: number;
};
type XeroAccount = {
  AccountID?: string;
  Code?: string;
  Name?: string;
  Type?: string;
  Class?: string;
  Status?: string;
  TaxType?: string;
};
type XeroTaxRate = {
  Name?: string;
  TaxType?: string;
  Status?: string;
  EffectiveRate?: number;
  DisplayTaxRate?: number;
  CanApplyToRevenue?: boolean;
};
type XeroContact = {
  ContactID?: string;
  ContactNumber?: string;
  HasValidationErrors?: boolean;
  ValidationErrors?: Array<{ Message?: string }>;
};
type XeroInvoice = {
  InvoiceID?: string;
  InvoiceNumber?: string;
  Total?: number;
  TotalTax?: number;
  HasValidationErrors?: boolean;
  ValidationErrors?: Array<{ Message?: string }>;
};

const setupSchema = z.object({
  salesAccountCode: z.string().trim().min(1).max(20),
  taxMappings: z.record(z.string().regex(/^\d{1,5}$/), z.string().trim().min(1).max(100)).default({}),
});

class XeroSyncError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}

function now() {
  return new Date().toISOString();
}

function actorFrom(request: Request): Actor {
  return {
    id: request.headers.get("x-ordermate-actor-id")?.trim() || "xero-accounting",
    role: request.headers.get("x-ordermate-actor-role")?.trim() || "integration",
    name: request.headers.get("x-ordermate-actor-name")?.trim() || "Xero accounting",
  };
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function addressPayload(value: string | null) {
  const address = parseJson<Record<string, unknown>>(value, {});
  const line1 = String(address.line1 || "").trim();
  const line2 = String(address.line2 || "").trim();
  const city = String(address.city || address.locality || "").trim();
  const region = String(address.county || address.region || "").trim();
  const postcode = String(address.postcode || "").trim();
  const country = String(address.country || "").trim();
  if (!line1 && !line2 && !city && !region && !postcode && !country) return [];
  return [{
    AddressType: "STREET",
    ...(line1 ? { AddressLine1: line1 } : {}),
    ...(line2 ? { AddressLine2: line2 } : {}),
    ...(city ? { City: city } : {}),
    ...(region ? { Region: region } : {}),
    ...(postcode ? { PostalCode: postcode } : {}),
    ...(country ? { Country: country } : {}),
  }];
}

function validationMessage(record: { HasValidationErrors?: boolean; ValidationErrors?: Array<{ Message?: string }> } | null | undefined) {
  if (!record?.HasValidationErrors && !record?.ValidationErrors?.length) return null;
  return record?.ValidationErrors?.map(error => error.Message).filter(Boolean).join("; ") || "Xero rejected the record";
}

function isRevenueAccount(account: XeroAccount) {
  if (account.Status && account.Status !== "ACTIVE") return false;
  if (!account.Code) return false;
  return account.Class === "REVENUE" || ["SALES", "REVENUE", "OTHERINCOME"].includes(account.Type || "");
}

function isRevenueTaxRate(rate: XeroTaxRate) {
  return (!rate.Status || rate.Status === "ACTIVE") && !!rate.TaxType && rate.CanApplyToRevenue !== false;
}

function bpsForTaxRate(rate: XeroTaxRate) {
  const value = rate.EffectiveRate ?? rate.DisplayTaxRate;
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value * 100) : null;
}

function externalContactNumber(contactId: string) {
  return `OL-${contactId}`.slice(0, 50);
}

function escapeXeroWhere(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export class XeroAccountingRuntime {
  constructor(private readonly ctx: DurableObjectState, private readonly env: XeroAccountingEnv) {
    migrateIntegrationSchema(ctx.storage);
  }

  async handle(request: Request): Promise<Response | null> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";

    const setup = path.match(/^\/integrations\/([^/]+)\/xero\/accounting\/setup$/);
    if (setup && request.method === "GET") return this.accountingSetup(decodeURIComponent(setup[1]));
    if (setup && request.method === "POST") return this.saveAccountingSetup(decodeURIComponent(setup[1]), request);

    const syncInvoice = path.match(/^\/integrations\/([^/]+)\/xero\/accounting\/invoices\/([^/]+)\/sync$/);
    if (syncInvoice && request.method === "POST") {
      const connection = this.xeroConnection(decodeURIComponent(syncInvoice[1]));
      if (!connection) return Response.json({ error: "Active Xero connection not found" }, { status: 404 });
      const invoiceId = decodeURIComponent(syncInvoice[2]);
      try {
        const result = await this.syncIssuedInvoice(connection, invoiceId, actorFrom(request));
        return Response.json({ ok: true, ...result });
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "Unable to sync invoice to Xero";
        this.recordFailure(connection.id, "service_invoice", invoiceId, message, actorFrom(request));
        return Response.json({ error: message }, { status: cause instanceof XeroSyncError ? cause.status : 502 });
      }
    }

    return null;
  }

  afterCanonicalMutation(request: Request, response: Response) {
    if (!response.ok || !["POST", "PATCH", "PUT"].includes(request.method.toUpperCase())) return response;
    const path = new URL(request.url).pathname.replace(/\/$/, "") || "/";
    const issued = path.match(/^\/service\/invoices\/([^/]+)\/issue$/);
    if (issued) {
      const invoiceId = decodeURIComponent(issued[1]);
      const actor = actorFrom(request);
      const connections = this.activeXeroConnections();
      if (connections.length) {
        this.ctx.waitUntil(Promise.all(connections.map(connection => this.syncAndRecord(connection, invoiceId, actor))).then(() => undefined));
      }
    }
    return response;
  }

  private one<T>(query: string, ...bindings: unknown[]): T | undefined {
    return this.ctx.storage.sql.exec<T & Record<string, string | number | null>>(query, ...bindings).toArray()[0] as T | undefined;
  }

  private rows<T>(query: string, ...bindings: unknown[]): T[] {
    return this.ctx.storage.sql.exec<T & Record<string, string | number | null>>(query, ...bindings).toArray() as T[];
  }

  private activeXeroConnections() {
    return this.rows<ConnectionRow>(
      "SELECT id, provider, external_account_id, display_name, status, capabilities_json FROM integration_connections WHERE provider = 'xero' AND status = 'active' ORDER BY created_at",
    );
  }

  private xeroConnection(connectionId: string) {
    const row = this.one<ConnectionRow>(
      "SELECT id, provider, external_account_id, display_name, status, capabilities_json FROM integration_connections WHERE id = ? AND provider = 'xero'",
      connectionId,
    );
    return row && row.status === "active" ? row : null;
  }

  private mappings(connectionId: string) {
    return this.rows<MappingRow>(
      `SELECT entity_type, external_id, local_entity_type, local_entity_id
       FROM integration_entity_links
       WHERE provider = 'xero' AND connection_id = ? AND entity_type IN ('account_code','tax_rate')`,
      connectionId,
    );
  }

  private accountingMapping(connectionId: string) {
    const mappings = this.mappings(connectionId);
    const salesAccountCode = mappings.find(row => row.entity_type === "account_code" && row.local_entity_type === "accounting_sales" && row.local_entity_id === "default")?.external_id || null;
    const taxMappings: Record<string, string> = {};
    for (const row of mappings) {
      if (row.entity_type === "tax_rate" && row.local_entity_type === "tax_rate_bps") taxMappings[row.local_entity_id] = row.external_id;
    }
    return { salesAccountCode, taxMappings };
  }

  private observedTaxRates() {
    return this.rows<{ tax_rate_bps: number }>(
      `SELECT DISTINCT sil.tax_rate_bps
       FROM service_invoice_lines sil
       JOIN service_invoices si ON si.id = sil.invoice_id
       WHERE si.status IN ('issued','partially_paid','paid')
       ORDER BY sil.tax_rate_bps`,
    ).map(row => row.tax_rate_bps);
  }

  private configured() {
    if (!this.env.XERO_CLIENT_ID?.trim() || !this.env.XERO_CLIENT_SECRET?.trim()) throw new XeroSyncError("Xero application credentials are not configured", 503);
    if (!this.env.INTEGRATION_TOKEN_ENCRYPTION_KEY?.trim() || !this.env.INTEGRATION_TOKEN_KEY_VERSION?.trim()) throw new XeroSyncError("Integration token encryption is not configured", 503);
  }

  private async usableXero(connection: ConnectionRow) {
    this.configured();
    const credential = this.one<CredentialRow>(
      `SELECT encrypted_payload_json, scopes_json, access_token_expires_at, refresh_token_expires_at
       FROM integration_credentials WHERE connection_id = ?`,
      connection.id,
    );
    if (!credential) throw new XeroSyncError("Xero credentials are unavailable; reconnect Xero", 409);
    const envelope = parseJson<EncryptedCredentialEnvelope | null>(credential.encrypted_payload_json, null);
    if (!envelope) throw new XeroSyncError("Xero credential envelope is invalid", 409);
    let secrets = await decryptCredentialPayload<StoredXeroCredential>(
      envelope,
      this.env.INTEGRATION_TOKEN_ENCRYPTION_KEY!,
      this.env.INTEGRATION_TOKEN_KEY_VERSION!,
    );
    let scopes = parseJson<string[]>(credential.scopes_json, []);
    const expiresAt = new Date(credential.access_token_expires_at).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() + 60_000) {
      const tokens = await refreshXeroToken({
        clientId: this.env.XERO_CLIENT_ID!,
        clientSecret: this.env.XERO_CLIENT_SECRET!,
        refreshToken: secrets.refreshToken,
      });
      if (tokens.scope.length) scopes = tokens.scope;
      const rotated = await encryptCredentialPayload(
        { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken },
        this.env.INTEGRATION_TOKEN_ENCRYPTION_KEY!,
        this.env.INTEGRATION_TOKEN_KEY_VERSION!,
      );
      const issuedAt = Date.now();
      this.ctx.storage.sql.exec(
        `UPDATE integration_credentials SET encrypted_payload_json = ?, key_version = ?, scopes_json = ?,
         access_token_expires_at = ?, refresh_token_expires_at = ?, updated_at = ? WHERE connection_id = ?`,
        JSON.stringify(rotated), rotated.keyVersion, JSON.stringify(scopes), tokenExpiryIso(tokens.expiresIn, issuedAt),
        refreshTokenExpiryIso(issuedAt), now(), connection.id,
      );
      secrets = { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
    }
    return { accessToken: secrets.accessToken, tenantId: connection.external_account_id, scopes };
  }

  private async xeroJson<T>(connection: ConnectionRow, path: string, init: RequestInit = {}) {
    const auth = await this.usableXero(connection);
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${auth.accessToken}`);
    headers.set("xero-tenant-id", auth.tenantId);
    headers.set("Accept", "application/json");
    if (init.body) headers.set("Content-Type", "application/json");
    let response: Response;
    try {
      response = await fetch(`https://api.xero.com/api.xro/2.0${path}`, { ...init, headers });
    } catch {
      throw new XeroSyncError("Xero request outcome is unknown after a network failure; review before retrying", 502);
    }
    if (response.status === 429) {
      const retryAfter = response.headers.get("retry-after");
      throw new XeroSyncError(`Xero rate limit reached${retryAfter ? `; retry after ${retryAfter}s` : ""}`, 429);
    }
    if (!response.ok) {
      const text = (await response.text()).replace(/\s+/g, " ").slice(0, 1200);
      const insufficientScope = response.status === 401 && /insufficient_scope/i.test(response.headers.get("www-authenticate") || "");
      throw new XeroSyncError(insufficientScope ? "Xero permissions are incomplete; reconnect Xero to grant the required scopes" : `Xero API request failed (${response.status})${text ? `: ${text}` : ""}`, response.status === 401 || response.status === 403 ? 409 : response.status);
    }
    return response.json<T>();
  }

  private async xeroSettings(connection: ConnectionRow) {
    const [accountResponse, taxResponse] = await Promise.all([
      this.xeroJson<{ Accounts?: XeroAccount[] }>(connection, "/Accounts"),
      this.xeroJson<{ TaxRates?: XeroTaxRate[] }>(connection, "/TaxRates"),
    ]);
    return {
      accounts: (accountResponse.Accounts || []).filter(isRevenueAccount),
      taxRates: (taxResponse.TaxRates || []).filter(isRevenueTaxRate),
    };
  }

  private async accountingSetup(connectionId: string) {
    const connection = this.xeroConnection(connectionId);
    if (!connection) return Response.json({ error: "Active Xero connection not found" }, { status: 404 });
    try {
      const live = await this.xeroSettings(connection);
      const configured = this.accountingMapping(connection.id);
      const observed = this.observedTaxRates().map(bps => {
        const candidates = live.taxRates.filter(rate => bpsForTaxRate(rate) === bps);
        return {
          bps,
          mappedTaxType: configured.taxMappings[String(bps)] || null,
          suggestedTaxType: candidates.length === 1 ? candidates[0]?.TaxType || null : null,
        };
      });
      const ready = !!configured.salesAccountCode && observed.every(rate => !!rate.mappedTaxType);
      return Response.json({
        connection: { id: connection.id, displayName: connection.display_name, status: connection.status },
        salesAccountCode: configured.salesAccountCode,
        taxMappings: configured.taxMappings,
        accounts: live.accounts.map(account => ({ code: account.Code!, name: account.Name || account.Code!, type: account.Type || null, taxType: account.TaxType || null })),
        taxRates: live.taxRates.map(rate => ({ taxType: rate.TaxType!, name: rate.Name || rate.TaxType!, effectiveRate: rate.EffectiveRate ?? rate.DisplayTaxRate ?? null })),
        observedTaxRates: observed,
        ready,
      });
    } catch (cause) {
      return Response.json({ error: cause instanceof Error ? cause.message : "Unable to load Xero accounting setup" }, { status: cause instanceof XeroSyncError ? cause.status : 502 });
    }
  }

  private async saveAccountingSetup(connectionId: string, request: Request) {
    const connection = this.xeroConnection(connectionId);
    if (!connection) return Response.json({ error: "Active Xero connection not found" }, { status: 404 });
    try {
      const input = setupSchema.parse(await request.json());
      const live = await this.xeroSettings(connection);
      if (!live.accounts.some(account => account.Code === input.salesAccountCode)) {
        return Response.json({ error: "Choose an active Xero revenue account" }, { status: 400 });
      }
      const byTaxType = new Map(live.taxRates.map(rate => [rate.TaxType!, rate] as const));
      for (const [bpsText, taxType] of Object.entries(input.taxMappings)) {
        const bps = Number(bpsText);
        const rate = byTaxType.get(taxType);
        if (!rate || bpsForTaxRate(rate) !== bps) {
          return Response.json({ error: `Xero tax type ${taxType} does not exactly match the Operating Layer rate ${bps / 100}%` }, { status: 400 });
        }
      }
      const actor = actorFrom(request);
      const timestamp = now();
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec(
          `DELETE FROM integration_entity_links
           WHERE provider = 'xero' AND connection_id = ? AND entity_type IN ('account_code','tax_rate')`,
          connection.id,
        );
        this.ctx.storage.sql.exec(
          `INSERT INTO integration_entity_links (
             provider, connection_id, entity_type, external_id, local_entity_type, local_entity_id, external_updated_at, last_synced_at
           ) VALUES ('xero', ?, 'account_code', ?, 'accounting_sales', 'default', NULL, ?)`,
          connection.id, input.salesAccountCode, timestamp,
        );
        for (const [bps, taxType] of Object.entries(input.taxMappings)) {
          this.ctx.storage.sql.exec(
            `INSERT INTO integration_entity_links (
               provider, connection_id, entity_type, external_id, local_entity_type, local_entity_id, external_updated_at, last_synced_at
             ) VALUES ('xero', ?, 'tax_rate', ?, 'tax_rate_bps', ?, NULL, ?)`,
            connection.id, taxType, bps, timestamp,
          );
        }
        this.audit(actor, "integration.xero_accounting_configured", "integration_connection", connection.id, {
          salesAccountCode: input.salesAccountCode,
          taxRates: Object.keys(input.taxMappings).map(Number),
        });
      });
      return this.accountingSetup(connection.id);
    } catch (cause) {
      if (cause instanceof z.ZodError) return Response.json({ error: cause.issues[0]?.message || "Invalid Xero accounting setup" }, { status: 400 });
      return Response.json({ error: cause instanceof Error ? cause.message : "Unable to save Xero accounting setup" }, { status: cause instanceof XeroSyncError ? cause.status : 502 });
    }
  }

  private audit(actor: Actor, action: string, entityType: string, entityId: string | null, metadata: Record<string, unknown> = {}) {
    this.ctx.storage.sql.exec(
      `INSERT INTO audit_events (id, actor_id, actor_role, action, entity_type, entity_id, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      crypto.randomUUID(), actor.id, actor.role, action, entityType, entityId, JSON.stringify(metadata), now(),
    );
  }

  private upsertLink(connectionId: string, entityType: string, externalId: string, localEntityType: string, localEntityId: string) {
    const timestamp = now();
    this.ctx.storage.sql.exec(
      "DELETE FROM integration_entity_links WHERE provider = 'xero' AND connection_id = ? AND entity_type = ? AND local_entity_type = ? AND local_entity_id = ? AND external_id != ?",
      connectionId, entityType, localEntityType, localEntityId, externalId,
    );
    this.ctx.storage.sql.exec(
      `INSERT INTO integration_entity_links (
         provider, connection_id, entity_type, external_id, local_entity_type, local_entity_id, external_updated_at, last_synced_at
       ) VALUES ('xero', ?, ?, ?, ?, ?, NULL, ?)
       ON CONFLICT(provider, connection_id, entity_type, external_id) DO UPDATE SET
         local_entity_type = excluded.local_entity_type,
         local_entity_id = excluded.local_entity_id,
         last_synced_at = excluded.last_synced_at`,
      connectionId, entityType, externalId, localEntityType, localEntityId, timestamp,
    );
  }

  private upsertReconciliation(connectionId: string, entityType: string, entityId: string, status: "pending" | "in_sync" | "drift" | "error", desiredHash: string | null, observedHash: string | null, error: string | null) {
    const timestamp = now();
    this.ctx.storage.sql.exec(
      `INSERT INTO integration_reconciliation (
         connection_id, entity_type, entity_id, direction, desired_hash, observed_hash, status,
         last_checked_at, last_success_at, last_error, updated_at
       ) VALUES (?, ?, ?, 'outbound', ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(connection_id, entity_type, entity_id, direction) DO UPDATE SET
         desired_hash = COALESCE(excluded.desired_hash, integration_reconciliation.desired_hash),
         observed_hash = COALESCE(excluded.observed_hash, integration_reconciliation.observed_hash),
         status = excluded.status,
         last_checked_at = excluded.last_checked_at,
         last_success_at = CASE WHEN excluded.status = 'in_sync' THEN excluded.last_success_at ELSE integration_reconciliation.last_success_at END,
         last_error = excluded.last_error,
         updated_at = excluded.updated_at`,
      connectionId, entityType, entityId, desiredHash, observedHash, status, timestamp,
      status === "in_sync" ? timestamp : null, error, timestamp,
    );
  }

  private exception(connectionId: string, code: string, message: string, entityType: string, externalId: string, retryable: boolean) {
    const id = `xero:${connectionId}:${code}:${entityType}:${externalId}`;
    this.ctx.storage.sql.exec(
      `INSERT INTO integration_exceptions (
         id, connection_id, code, message, retryable, status, entity_type, external_id, created_at
       ) VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET message = excluded.message, retryable = excluded.retryable,
         status = 'open', resolved_at = NULL, resolved_by = NULL`,
      id, connectionId, code, message.slice(0, 1800), retryable ? 1 : 0, entityType, externalId, now(),
    );
  }

  private resolveExceptions(connectionId: string, entityType: string, externalId: string) {
    this.ctx.storage.sql.exec(
      `UPDATE integration_exceptions SET status = 'resolved', resolved_at = ?, resolved_by = 'xero-accounting'
       WHERE connection_id = ? AND entity_type = ? AND external_id = ? AND status = 'open' AND id LIKE 'xero:%'`,
      now(), connectionId, entityType, externalId,
    );
  }

  private recordFailure(connectionId: string, entityType: string, entityId: string, message: string, actor: Actor) {
    this.upsertReconciliation(connectionId, entityType, entityId, "error", null, null, message.slice(0, 1000));
    this.exception(connectionId, "xero_accounting_sync_failed", message, entityType, entityId, true);
    this.audit(actor, "integration.xero_sync_failed", entityType, entityId, { connectionId, message: message.slice(0, 1000) });
    this.ctx.storage.sql.exec(
      "UPDATE integration_connections SET last_error_at = ?, last_error = ?, updated_at = ? WHERE id = ?",
      now(), message.slice(0, 1000), now(), connectionId,
    );
  }

  private async syncAndRecord(connection: ConnectionRow, invoiceId: string, actor: Actor) {
    try {
      await this.syncIssuedInvoice(connection, invoiceId, actor);
    } catch (cause) {
      this.recordFailure(connection.id, "service_invoice", invoiceId, cause instanceof Error ? cause.message : "Unable to sync invoice to Xero", actor);
    }
  }

  private invoice(invoiceId: string) {
    return this.one<InvoiceRow>(
      `SELECT i.id, i.number, i.status, i.currency, i.issue_date, i.due_date, i.total_minor, i.tax_minor, sc.contact_id
       FROM service_invoices i JOIN service_cases sc ON sc.id = i.case_id WHERE i.id = ?`,
      invoiceId,
    );
  }

  private invoiceLines(invoiceId: string) {
    return this.rows<InvoiceLineRow>(
      `SELECT id, description_snapshot, quantity_milli, unit_price_minor, tax_rate_bps, net_minor, tax_minor, gross_minor
       FROM service_invoice_lines WHERE invoice_id = ? ORDER BY rowid`,
      invoiceId,
    );
  }

  private contact(contactId: string) {
    return this.one<ContactRow>("SELECT id, name, email, mobile, address_json FROM crm_contacts WHERE id = ?", contactId);
  }

  private link(connectionId: string, entityType: string, localEntityType: string, localEntityId: string) {
    return this.one<{ external_id: string }>(
      `SELECT external_id FROM integration_entity_links
       WHERE provider = 'xero' AND connection_id = ? AND entity_type = ? AND local_entity_type = ? AND local_entity_id = ?`,
      connectionId, entityType, localEntityType, localEntityId,
    )?.external_id || null;
  }

  private async findContact(connection: ConnectionRow, contactNumber: string) {
    const where = encodeURIComponent(`ContactNumber==\"${escapeXeroWhere(contactNumber)}\"`);
    const result = await this.xeroJson<{ Contacts?: XeroContact[] }>(connection, `/Contacts?where=${where}`);
    return result.Contacts?.[0]?.ContactID || null;
  }

  private async syncContact(connection: ConnectionRow, contactId: string, actor: Actor) {
    const contact = this.contact(contactId);
    if (!contact) throw new XeroSyncError("Invoice customer is unavailable", 409);
    const contactNumber = externalContactNumber(contact.id);
    let externalId = this.link(connection.id, "contact", "crm_contact", contact.id);
    if (!externalId) externalId = await this.findContact(connection, contactNumber);
    const record = {
      ...(externalId ? { ContactID: externalId } : {}),
      Name: contact.name,
      ContactNumber: contactNumber,
      ...(contact.email ? { EmailAddress: contact.email } : {}),
      ...(contact.mobile ? { Phones: [{ PhoneType: "DEFAULT", PhoneNumber: contact.mobile }] } : {}),
      ...(contact.address_json ? { Addresses: addressPayload(contact.address_json) } : {}),
    };
    const desiredHash = await sha256(JSON.stringify(record));
    this.upsertReconciliation(connection.id, "crm_contact", contact.id, "pending", desiredHash, null, null);
    const response = await this.xeroJson<{ Contacts?: XeroContact[] }>(connection, "/Contacts?summarizeErrors=false", {
      method: "POST",
      headers: { "Idempotency-Key": `contact-${contact.id}-${crypto.randomUUID()}`.slice(0, 128) },
      body: JSON.stringify({ Contacts: [record] }),
    });
    const returned = response.Contacts?.[0];
    const validation = validationMessage(returned);
    if (validation) throw new XeroSyncError(validation, 400);
    externalId = returned?.ContactID || externalId;
    if (!externalId) throw new XeroSyncError("Xero did not return the contact identity", 502);
    this.upsertLink(connection.id, "contact", externalId, "crm_contact", contact.id);
    this.upsertReconciliation(connection.id, "crm_contact", contact.id, "in_sync", desiredHash, desiredHash, null);
    this.resolveExceptions(connection.id, "crm_contact", contact.id);
    this.audit(actor, "integration.xero_contact_synced", "crm_contact", contact.id, { connectionId: connection.id, xeroContactId: externalId });
    return externalId;
  }

  private async findInvoice(connection: ConnectionRow, invoiceNumber: string) {
    const where = encodeURIComponent(`InvoiceNumber==\"${escapeXeroWhere(invoiceNumber)}\"`);
    const result = await this.xeroJson<{ Invoices?: XeroInvoice[] }>(connection, `/Invoices?where=${where}`);
    return result.Invoices?.[0] || null;
  }

  private async syncIssuedInvoice(connection: ConnectionRow, invoiceId: string, actor: Actor) {
    const invoice = this.invoice(invoiceId);
    if (!invoice) throw new XeroSyncError("Service invoice not found", 404);
    if (!["issued", "partially_paid", "paid"].includes(invoice.status)) throw new XeroSyncError(`Only issued invoices can sync to Xero; current status is ${invoice.status}`, 409);
    if (!invoice.issue_date) throw new XeroSyncError("Issued invoice is missing its issue date", 409);
    const lines = this.invoiceLines(invoice.id);
    if (!lines.length) throw new XeroSyncError("Issued invoice has no lines", 409);
    const configuration = this.accountingMapping(connection.id);
    if (!configuration.salesAccountCode) throw new XeroSyncError("Choose a Xero sales account before issued invoices can sync", 409);
    const missingTaxRates = [...new Set(lines.map(line => line.tax_rate_bps))].filter(bps => !configuration.taxMappings[String(bps)]);
    if (missingTaxRates.length) throw new XeroSyncError(`Map these Operating Layer tax rates in Xero setup before syncing: ${missingTaxRates.map(bps => `${bps / 100}%`).join(", ")}`, 409);

    const contactId = await this.syncContact(connection, invoice.contact_id, actor);
    const taxable = lines.find(line => line.tax_rate_bps > 0);
    const grossOrNet = taxable ? Math.round(taxable.unit_price_minor * taxable.quantity_milli / 1000) : null;
    const lineAmountTypes = taxable && grossOrNet === taxable.gross_minor && taxable.gross_minor !== taxable.net_minor ? "Inclusive" : "Exclusive";
    const record = {
      Type: "ACCREC",
      Contact: { ContactID: contactId },
      InvoiceNumber: invoice.number,
      Date: invoice.issue_date,
      ...(invoice.due_date ? { DueDate: invoice.due_date } : {}),
      CurrencyCode: invoice.currency,
      LineAmountTypes: lineAmountTypes,
      Status: "AUTHORISED",
      Reference: `Operating Layer ${invoice.number}`,
      LineItems: lines.map(line => ({
        Description: line.description_snapshot,
        Quantity: line.quantity_milli / 1000,
        UnitAmount: line.unit_price_minor / 100,
        AccountCode: configuration.salesAccountCode,
        TaxType: configuration.taxMappings[String(line.tax_rate_bps)],
      })),
    };
    const desiredHash = await sha256(JSON.stringify(record));
    this.upsertReconciliation(connection.id, "service_invoice", invoice.id, "pending", desiredHash, null, null);

    let returned: XeroInvoice | null = null;
    const linkedInvoiceId = this.link(connection.id, "invoice", "service_invoice", invoice.id);
    if (linkedInvoiceId) {
      const response = await this.xeroJson<{ Invoices?: XeroInvoice[] }>(connection, `/Invoices/${encodeURIComponent(linkedInvoiceId)}`);
      returned = response.Invoices?.[0] || null;
    } else {
      returned = await this.findInvoice(connection, invoice.number);
      if (!returned?.InvoiceID) {
        const response = await this.xeroJson<{ Invoices?: XeroInvoice[] }>(connection, "/Invoices?unitdp=4&summarizeErrors=false", {
          method: "POST",
          headers: { "Idempotency-Key": `invoice-${invoice.id}-${crypto.randomUUID()}`.slice(0, 128) },
          body: JSON.stringify({ Invoices: [record] }),
        });
        returned = response.Invoices?.[0] || null;
      }
    }

    const validation = validationMessage(returned);
    if (validation) throw new XeroSyncError(validation, 400);
    if (!returned) throw new XeroSyncError("Xero did not return the reconciled invoice", 502);
    const externalInvoiceId = returned.InvoiceID;
    if (!externalInvoiceId) throw new XeroSyncError("Xero did not return the invoice identity", 502);
    this.upsertLink(connection.id, "invoice", externalInvoiceId, "service_invoice", invoice.id);

    const xeroTotalMinor = Math.round(Number(returned.Total || 0) * 100);
    const xeroTaxMinor = Math.round(Number(returned.TotalTax || 0) * 100);
    const observedHash = await sha256(JSON.stringify({ invoiceId: externalInvoiceId, totalMinor: xeroTotalMinor, taxMinor: xeroTaxMinor }));
    if (xeroTotalMinor !== invoice.total_minor || xeroTaxMinor !== invoice.tax_minor) {
      const message = `Xero accepted ${invoice.number}, but totals differ (Operating Layer ${invoice.total_minor}/${invoice.tax_minor} minor units; Xero ${xeroTotalMinor}/${xeroTaxMinor}). Review the tax/account mapping before further exports.`;
      this.upsertReconciliation(connection.id, "service_invoice", invoice.id, "drift", desiredHash, observedHash, message);
      this.exception(connection.id, "xero_invoice_total_mismatch", message, "service_invoice", invoice.id, false);
    } else {
      this.upsertReconciliation(connection.id, "service_invoice", invoice.id, "in_sync", desiredHash, observedHash, null);
      this.resolveExceptions(connection.id, "service_invoice", invoice.id);
    }
    this.ctx.storage.sql.exec(
      "UPDATE integration_connections SET last_success_at = ?, last_error_at = NULL, last_error = NULL, updated_at = ? WHERE id = ?",
      now(), now(), connection.id,
    );
    this.audit(actor, "integration.xero_invoice_synced", "service_invoice", invoice.id, { connectionId: connection.id, xeroInvoiceId: externalInvoiceId });
    return { xeroInvoiceId: externalInvoiceId, reconciliation: xeroTotalMinor === invoice.total_minor && xeroTaxMinor === invoice.tax_minor ? "in_sync" : "drift" };
  }
}
