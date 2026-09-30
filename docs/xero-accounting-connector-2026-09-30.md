# Xero accounting connector — production contract

Date: 30 September 2026

## Decision

Xero is an accounting destination/reconciliation provider on the same provider-neutral integration spine as Shopify. Operating Layer remains the operational source of truth; Xero remains the accounting source of truth for the financial records accepted into Xero.

The first production accounting slice deliberately supports:

- secure OAuth 2.0 connection and rotating refresh tokens;
- safe identification of the organisation authorised in the current OAuth event;
- customer/contact synchronisation;
- issued **service invoice** synchronisation as Xero `ACCREC` invoices;
- explicit revenue-account and tax-rate mapping from live Xero settings;
- stable provider/local entity links;
- reconciliation status and integration exceptions;
- manual retry of a specific issued invoice;
- Work Queue visibility when reconciliation fails.

It deliberately does **not** translate an Operating Layer purchase order into a Xero bill. A purchase order is a supplier commitment, not proof that an accounts-payable liability exists. Supplier bills should be added only after Operating Layer has a canonical supplier-invoice/AP document with the appropriate review and matching semantics.

## OAuth and scope boundary

Configured scopes:

`openid profile email offline_access accounting.contacts accounting.invoices accounting.settings.read`

The connector requests only what this slice needs:

- `accounting.contacts` to create/update customer contacts;
- `accounting.invoices` to create/reconcile accounts-receivable invoices;
- `accounting.settings.read` to read the organisation's Accounts and TaxRates so an operator can choose the actual accounting destinations;
- `offline_access` for background-capable token refresh.

Changing scopes requires Xero re-authorisation. Existing tokens are never assumed to gain new permissions automatically.

## Financial coding rule

Operating Layer never guesses Xero financial coding.

Before issued invoices can sync, Owner/Admin must select:

1. the Xero sales/revenue account code; and
2. the Xero tax type for every tax rate currently used by issued Operating Layer service invoices.

Tax mappings are accepted only when Xero's effective tax rate exactly matches the Operating Layer basis-point rate. Multiple Xero tax types can legitimately share a percentage but represent different VAT/tax treatments, so percentage equality can suggest candidates but cannot choose one on the operator's behalf.

Mappings are stored through the existing provider-neutral `integration_entity_links` spine:

- Xero account code → `accounting_sales/default`;
- Xero tax type → canonical `tax_rate_bps/<rate>`;
- Xero ContactID → canonical `crm_contact`;
- Xero InvoiceID → canonical `service_invoice`.

No provider-specific business-domain columns are added to CRM or service invoice tables.

## Invoice round-trip

Canonical trigger:

`POST /service/invoices/:id/issue`

Only a successful canonical issue can initiate Xero sync. A Xero outage or validation error cannot roll back or invalidate the already-issued Operating Layer invoice.

Sync sequence:

1. load the immutable issued invoice/customer snapshot;
2. require complete Xero account/tax mapping;
3. reconcile/update the Xero contact, using a stable Operating Layer contact number and stored entity link;
4. look for an existing Xero invoice by stored entity link or stable invoice number before attempting create;
5. create an `AUTHORISED` `ACCREC` invoice when no existing record is found;
6. preserve Operating Layer exclusive/inclusive pricing semantics and explicit tax type per line;
7. compare Xero total and total tax back to the canonical invoice;
8. mark reconciliation `in_sync` or `drift`;
9. surface validation/network/permission failures as integration exceptions and therefore Operations Work Queue items.

Provider mutation requests use Xero idempotency keys. Stable lookup before create is still required because provider idempotency windows are intentionally short-lived and cannot replace durable reconciliation identity.

## Failure rules

- Never create a second Xero invoice merely because a previous response was lost; reconcile by entity link/invoice number first.
- A 429 is an operator-visible provider condition; respect Xero's `Retry-After` guidance rather than hammering the tenant.
- Missing Xero scopes are treated as a reconnect/permission requirement.
- If Xero accepts the invoice but its total or tax total differs from Operating Layer, keep the external identity, mark reconciliation as drift and require review. Do not create another invoice.
- Xero validation failure never changes the canonical Operating Layer invoice.
- Credentials remain encrypted in tenant integration storage and are never returned by normal integration reads.

## First-value onboarding

The Overview first-value panel owns the guided accounting setup for this slice:

- connect Xero;
- load the organisation's live revenue accounts and revenue-applicable tax rates;
- configure the revenue account;
- configure exact tax mappings as invoice tax rates appear;
- expose mapping/permission/reconciliation blockers alongside the rest of migration health.

This keeps “connected” separate from “operationally ready”.

## Deployment gate

Source-ready does not mean a live Xero organisation has been exercised.

Before production enablement:

1. apply control-plane migration `0004_integration_oauth_providers.sql`;
2. configure `XERO_CLIENT_ID` and `XERO_CLIENT_SECRET` as Worker secrets for production/staging;
3. keep `INTEGRATION_TOKEN_ENCRYPTION_KEY` and key version configured;
4. register the exact callback URLs for each environment in the Xero developer app;
5. re-authorise any connection created before `accounting.settings.read` was added;
6. use a Xero Demo Company to connect, select account/tax mappings and issue a representative service invoice;
7. verify ContactID/InvoiceID links, totals/tax totals and reconciliation status;
8. exercise a validation failure and permission failure and confirm they appear in the Operations Work Queue;
9. verify production and staging builds plus the full automated suite remain green.

Do not enable supplier bill export until a canonical supplier-invoice/AP workflow exists.
