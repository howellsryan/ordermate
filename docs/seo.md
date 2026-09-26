# Operating Layer SEO strategy

Status: foundation implemented in Draft PR #3 · 26 September 2026

## Objective

Build search visibility around the problems Operating Layer genuinely solves, rather than trying to rank the brand name through repetition.

The first search territory is the overlap of:
- inventory management software;
- order management software;
- purchase order / purchasing software;
- stock control software;
- warehouse picking / barcode inventory workflows;
- inventory replenishment software;
- multi-location inventory management;
- operations software for growing product businesses.

## Search principle

Write for operators first and search engines second. Every indexable page should answer a real operational question better than a generic feature page, show how the product addresses it, and use the language a buyer would naturally search for.

Do not create thin keyword-variant pages, duplicate city pages, AI-generated content farms or fabricated comparison claims.

## Homepage search intent

Primary intent: a growing business looking for connected inventory, order, purchasing and warehouse operations software.

Current document title:

`Operating Layer | Inventory, Orders & Purchasing Software`

Current description:

`Operating Layer is inventory, order, purchasing and warehouse operations software for growing businesses. Control stock, fulfilment and replenishment in one workspace.`

The H1 deliberately carries category language while still functioning as a brand statement:

`Inventory, orders & purchasing. One operating layer.`

The page also contains natural-language sections for multi-location inventory, order management, purchase orders, replenishment, warehouse/barcode workflows, inventory reporting and reviewed automation.

## Technical foundation implemented

- semantic, crawlable HTML fallback before React hydration;
- descriptive `<title>` and meta description;
- consistent Open Graph / Twitter brand metadata;
- canonical homepage declaration;
- Organisation + WebApplication JSON-LD containing only factual claims;
- descriptive product-image alt text;
- one H1 and a structured heading hierarchy;
- native `<details>` FAQ content that is useful even without a search enhancement;
- `llms.txt` and machine-readable agent discovery metadata;
- accessible landmarks, skip navigation and reduced-motion treatment from the existing landing implementation;
- public landing remains split from authenticated operational code to protect load performance.

Do not add SoftwareApplication rich-result `offers`, `review` or `aggregateRating` values until they represent real public pricing/reviews. Structured data must describe visible, truthful content.

## Staging indexing rule

The current `ordermate-staging.rlh.workers.dev` hostname is a test environment, not the canonical public brand domain. It should not compete with the future production domain in search.

The Worker therefore needs an explicit environment-aware crawler policy before the public domain launches:
- staging: `X-Robots-Tag: noindex, nofollow` on the landing response and `Disallow: /` in robots;
- production: allow crawling and advertise an absolute sitemap URL.

Do not hard-code an unconfirmed Operating Layer domain into sitemap/canonical metadata. Complete the domain decision first.

## Production-domain launch gate

Before public indexing:

1. Complete trademark/domain/company-name clearance for Operating Layer.
2. Select the canonical production HTTPS origin.
3. Set the absolute canonical URL and `WebSite` structured-data URL to that origin.
4. Generate an XML sitemap with absolute canonical URLs and accurate `lastmod` dates.
5. Serve a production robots file pointing to the sitemap.
6. Add an Open Graph image in a broadly supported raster format (1200×630 recommended); the SVG design source is already in `/public/brand/social-card.svg`.
7. Verify Organization / WebSite / app structured data in Google’s Rich Results Test and Schema Markup Validator.
8. Add the production property to Google Search Console and Bing Webmaster Tools; submit the sitemap.
9. Inspect the rendered homepage, canonical, mobile usability and Core Web Vitals after deployment.
10. Record real field data before making performance claims.

## Content architecture after launch

Do not build all of these as thin pages at once. Publish only when each page has enough product proof and useful operational guidance.

### Pillar 1 — Inventory management

Target concepts:
- inventory management software for small business;
- multi-location inventory management;
- stock control software;
- inventory movement history;
- cycle counting software.

Useful pages:
- `/inventory-management/`
- `/multi-location-inventory/`
- `/cycle-counting/`

### Pillar 2 — Orders and fulfilment

Target concepts:
- order management software;
- order fulfilment software;
- inventory reservation / overselling prevention;
- warehouse order prioritisation.

Useful pages:
- `/order-management/`
- `/order-fulfilment/`
- `/wave-picking/`

### Pillar 3 — Purchasing and replenishment

Target concepts:
- purchase order software;
- purchasing software for small business;
- inventory replenishment software;
- reorder point software;
- supplier inventory management.

Useful pages:
- `/purchase-order-software/`
- `/inventory-replenishment/`
- `/supplier-management/`

### Pillar 4 — Warehouse workflows

Target concepts:
- barcode inventory software;
- warehouse picking software;
- mobile warehouse scanning;
- receiving stock software.

Useful pages:
- `/warehouse-operations/`
- `/barcode-inventory/`
- `/goods-receiving/`

## High-value editorial content

Prefer operator-grade resources with diagrams, screenshots and concrete decision logic. Examples:
- “On-hand vs reserved vs available stock: what each number should mean”;
- “How to build a reorder point without hiding the assumptions”;
- “Cycle counting vs full stocktake: when to use each”;
- “Wave picking for small warehouses: when it helps and when it does not”;
- “How partial receiving should affect incoming inventory”;
- “Why purchase-order due dates should not become fake lifecycle states”;
- “Human-reviewed AI in inventory operations: where automation should stop”.

These topics map directly to product knowledge already encoded in the application and can demonstrate real expertise rather than generic SEO copy.

## Internal linking

Every capability page should:
- link back to its parent pillar;
- link to the adjacent operational stage (for example orders → warehouse picking → inventory movements → replenishment);
- include one contextual link to the relevant product proof;
- avoid repetitive exact-match anchor text.

## Conversion and trust

Search landing pages still need to convert humans. Keep:
- a clear category statement above the fold;
- real UI proof early;
- security/audit/human-review claims close to automation claims;
- one primary CTA;
- no fake customer logos, usage counts or ROI figures.

Search visibility is a compounding programme, not a one-time metadata exercise. Technical SEO creates eligibility; useful, differentiated product content and real authority create durable ranking potential.
