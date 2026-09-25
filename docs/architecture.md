# OrderMate architecture

## Decision summary

OrderMate is a Cloudflare-native modular monolith. The browser talks to one Worker. Authentication and membership are global; operational business data is physically isolated per tenant.

### Control plane
`CONTROL_DB` is a D1 database restricted to the EU jurisdiction. Better Auth stores Google identities, sessions, organizations, members and invitations here. The Worker derives the user from the session and verifies organization membership before any tenant request is routed.

### Tenant data plane
Each Better Auth organization ID maps deterministically to one `TenantStore` Durable Object via the EU-restricted subnamespace. Its embedded SQLite database stores catalogue, locations, inventory ledger, suppliers, purchase orders, customers, orders, fulfilments, returns and tenant audit history.

This deliberately avoids a shared operational database. A programming mistake cannot accidentally query another tenant's product/order rows because those rows do not exist in the current tenant database.

SQLite-backed Durable Objects also serialize writes for a tenant. That is valuable for stock reservation, purchase receiving and fulfilment because competing mutations have a single consistency boundary.

### Storage and automation
R2 holds product media and source documents. Keys are prefixed by tenant ID and object access is only proxied after membership checks. Queue messages contain a tenant ID plus immutable event ID and are treated as at-least-once delivery; consumers must be idempotent. Workflows will be introduced for multi-step operations such as document extraction/review automation.

## Domain rules

### Catalogue
Products contain arbitrary option dimensions. Sellable variants own SKU, barcode, price, cost and tax classification. Modifiers/add-ons are separate from variant dimensions.

### Inventory
Inventory is per variant and location. `on_hand`, `reserved` and derived `available` are tracked. Incoming stock is derived from submitted purchase orders. Every physical change creates an immutable inventory movement.

### Purchasing
Suppliers own purchase orders. PO lines snapshot supplier references, unit cost and tax. Partial receiving is supported and receiving creates inventory movements.

### Orders
Order lines snapshot product/variant/SKU, price and tax. Confirmation creates reservations. Fulfilment consumes reserved/on-hand quantities. Cancellation releases outstanding reservations. Returns are independent events and may optionally restock.

### Money and tax
All amounts are integer minor units. Each line stores net, tax and gross values plus the applied tax rate basis points. Tenant settings define default currency and whether catalogue prices are tax-inclusive.

## Security model

1. Google authenticates the identity; Better Auth owns the application session.
2. The Worker reads the session from secure cookies.
3. The requested organization ID is treated only as a selector.
4. The Worker verifies `member(user_id, organization_id)` in D1.
5. Static role permissions are checked server-side.
6. The Worker routes to the tenant's EU Durable Object and replaces all internal actor headers.
7. The tenant object records actor ID/role on every mutation.

Tests must cover guessed IDs, changed tenant headers, cross-tenant document keys, unauthorized roles and repeated/idempotent messages.

## Compliance posture

D1, Durable Objects and R2 are created/restricted for EU jurisdiction where supported. PII must not be placed in queue names, object keys, logs or analytics dimensions. Data export/deletion and configurable retention remain first-class roadmap items before public launch.
