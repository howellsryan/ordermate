# SME buying friction research — 26 September 2026

This note records the commercial research behind the sales-readiness changes in PR #7. It is intentionally buyer-risk-led rather than feature-led.

## Executive conclusion

An interested SME does not stop at “does this look useful?”. The next questions are about adoption risk:

1. What will this cost me?
2. How much time will implementation consume?
3. Can I bring the data I already have?
4. Will it work with the systems I already depend on?
5. Can my team adopt it without an ERP-style project?
6. Is the product trustworthy enough to hold operational data?
7. What happens when we need help?
8. Is this mature enough to become operationally important?

Operating Layer can answer several of those well today, but not all of them. The commercial strategy should therefore reduce genuine adoption risk and disclose material gaps rather than compensate for them with stronger marketing language.

## What UK SME research says

The UK Government's SME Digital Adoption Taskforce identifies three headline blockers to digital adoption: adoption can look too hard and costly; SMEs can lack expertise and execution support; and switching technologies can feel too high-risk. It also highlights time, cash and know-how gaps.

The Department for Business and Trade's mixed-method research into SME technology adoption reports a similar pattern across the buying journey. SMEs value ease of use, compatibility and cost; often struggle to evaluate supplier claims; have limited time and technical capacity; and can hit integration, troubleshooting and support problems during implementation. Reliable and personalised support is particularly valued.

Cyber-security assurance is also a real buying criterion. The UK Cyber Security Breaches Survey 2025/2026 reports that 22% of businesses considered cyber security to a large extent when purchasing software, rising to 54% of medium businesses.

### Primary research sources

- UK Government, *SME Digital Adoption Taskforce: final report*, 31 July 2025: https://www.gov.uk/government/publications/sme-digital-adoption-taskforce-final-report/sme-digital-adoption-taskforce-final-report
- UK Government, *Understanding technology adoption among UK SMEs*, 31 July 2025: https://www.gov.uk/government/publications/understanding-technology-adoption-among-uk-smes
- UK Government, *SME Digital Adoption Taskforce: 2026 update*, 26 June 2026: https://www.gov.uk/government/publications/sme-digital-adoption-taskforce-2026-update
- UK Government, *Cyber security breaches survey 2025/2026*, 30 April 2026: https://www.gov.uk/government/statistics/cyber-security-breaches-survey-20252026/cyber-security-breaches-survey-20252026

## What category leaders teach us about the buying decision

The point is not to copy larger incumbents. Their public propositions show what buyers have been trained to expect around the product itself.

### Cin7

Cin7 puts integrations, onboarding and support directly into plan evaluation. Its current public pricing page shows ecommerce/app connection allowances, Xero and QuickBooks Online accounting integrations, multiple onboarding routes, 24/7 support, help-centre/academy resources and professional services alongside the software tiers.

Source: https://www.cin7.com/pricing/

### Unleashed

Unleashed similarly treats implementation as part of the commercial product. Its UK pricing currently advertises Xero and QuickBooks Online integrations, ecommerce integrations, a free trial, paid onboarding routes from self-serve through guided implementation, and separate ongoing support packages.

Source: https://www.unleashedsoftware.com/en-gb/pricing/

### Commercial implication for Operating Layer

A low price does not remove migration, integration, implementation or support risk. In this category, those are part of the buying proposition rather than after-sales details.

## Operating Layer: current buyer-risk map

### 1. Price — LOW RISK TODAY

**Current position:** £0 / free for now.

The repository contains no subscription or billing flow. The public site should state the current price clearly, without implying a permanent free commitment.

**Delivered in PR #7:**

- “Free to use today” is visible in the hero proof.
- The adoption section states that there is no subscription charge or billing step today.
- FAQ answers the price question directly and makes clear that current free pricing is not a promise about all future pricing.

### 2. Evaluation risk — LOW RISK

**Current position:** strong.

Six browser-local guest demos can be used without an account and reset independently from production. This is a meaningful commercial advantage because a prospect can validate fit before creating a workspace or migrating data.

**Delivered in PR #7:** demo-first remains the primary cold-visitor CTA and is now explicitly framed as a way to reduce switching risk.

### 3. Migration / existing data — PARTLY SOLVED

**Current position:** credible for product-catalogue onboarding; incomplete for whole-business migration.

The production CSV catalogue import supports products, variants, supplier mappings and opening stock. It parses locally, performs a tenant dry-run, requires review and then commits atomically. Imports support up to 2,000 data rows per file.

This is materially stronger than telling a prospect “you can import CSVs”. The reviewed dry-run and atomic commit reduce the chance that onboarding corrupts the new workspace.

**Current limit:** this is not a general migration framework for historic orders, CRM/service history, accounting data or every external record.

**Delivered in PR #7:** the site now explains exactly what the importer can migrate and does not imply broader migration support.

### 4. Integrations / compatibility — HIGH RISK, UNSOLVED

**Current position:** the most important commercial product gap.

The current repository does not provide live production Shopify, Xero or QuickBooks connectors. The existing competitive-gap analysis also lists external demand capture from storefronts, marketplaces and sales channels as future work.

For many product SMEs, requiring staff to manually recreate online demand in an operations tool would prevent adoption regardless of price or feature quality. Accounting-system compatibility is similarly likely to be a buying gate once Operating Layer becomes the system of operational record.

**Delivered in PR #7:** the public site explicitly says these connectors do not exist today and clarifies that CSV onboarding is not ongoing synchronisation.

**Recommended next product priority:** design the integration boundary before adding more general-purpose features. Shopify and accounting should be evaluated as the first commercial integrations because they remove a buying veto rather than merely adding capability.

### 5. Implementation effort — PARTLY SOLVED

**Current position:** modularity reduces scope, but there is no complete guided implementation journey.

Workspaces can enable only the modules they need, and the no-account demos reduce discovery cost. That is a good basis for a “start narrow” rollout.

**Current limit:** the repository does not yet present a comprehensive first-run implementation checklist, migration wizard or process-mapping flow for a new live business.

**Delivered in PR #7:** the public proposition now recommends proving the workflow first and starting only with required operating areas, rather than implying a big-bang replacement.

**Recommended follow-up:** build a short owner/admin first-run checklist driven by enabled modules, including business defaults, import/create data, invite team and complete the first real workflow.

### 6. Trust, security and operational control — STRONG FOUNDATION, EVIDENCE GAP

**Current position:** technically credible.

The current product has tenant isolation, role-aware permissions, audit-oriented mutation paths and EU-jurisdiction Cloudflare resources where supported. Automation stops at detection/explanation/preparation for business-changing workflows rather than silently changing canonical stock/orders/purchasing.

**Commercial limit:** architecture claims are not equivalent to independent assurance. The product should not imply SOC 2, ISO 27001, penetration-test certification or other independent credentials unless they are actually obtained.

**Delivered in PR #7:** trust is explained in buyer language and the adoption section explicitly preserves the human-control boundary.

### 7. Support and onboarding assistance — HIGH RISK, UNSOLVED AS A SERVICE OFFER

**Current position:** there is no formal support/onboarding proposition represented in the repository.

This matters because government adoption research repeatedly identifies expertise, execution support and troubleshooting as barriers, while category leaders actively sell onboarding and support alongside the software.

**Decision needed outside code:** define what a real SME customer can expect today. Options could range from explicitly self-serve to founder-led onboarding, but the website should not promise a channel, SLA or implementation service until it actually exists.

**Recommendation:** treat this as a commercial operating-model decision before broad external selling, not as copy to invent.

### 8. Customer proof / maturity — HIGH RISK UNTIL REAL USERS EXIST

**Current position:** product proof exists; social proof does not.

The demos and product screens can demonstrate workflows, but there is no repository evidence of validated customer logos, case studies, independent reviews or measured customer outcomes.

**Recommendation:** do not fabricate proxy metrics. The first external users should be instrumented as learning partners. Capture permissioned before/after evidence such as reconciliation time, order handling steps, stock discrepancy frequency or purchasing lead-time visibility only after those outcomes have actually been measured.

## Reasons an interested SME should still say “not yet”

The sales page should make it easy for the wrong current buyer to self-disqualify. Today, an SME should probably not make Operating Layer its primary operational replacement if:

- continuous Shopify, Xero, QuickBooks or other external-system synchronisation is mandatory from day one;
- it requires certified security/compliance credentials that Operating Layer has not obtained;
- it expects a contracted support SLA or implementation consultancy that has not yet been defined;
- it requires a complete automated migration of historical orders, accounting or service records;
- a prototype-only vertical workflow is essential to production operations.

Making these boundaries visible increases credibility with prospects for whom the existing product *is* a fit.

## Commercial priority order from here

### P0 — remove buying vetoes

1. **Integration strategy and first live connectors** — likely Shopify plus a UK-accounting path, subject to customer discovery.
2. **Define the support/onboarding operating model** — even if deliberately lightweight.
3. **First-run live-workspace onboarding** — turn modularity and CSV import into a guided route to first value.
4. **Data portability and exit story** — document or build how a customer gets operational data back out before asking them to trust the platform with more of it.

### P1 — create evidence

5. Recruit a small number of genuine SME design partners.
6. Instrument adoption and operational outcomes with their permission.
7. Publish specific case studies only once results are observed and attributable.
8. Build a public implementation/security facts page from verifiable product controls rather than generic trust language.

### P2 — improve conversion after the fundamentals exist

9. Add vertical landing journeys around the strongest proven use cases.
10. Test CTA and message variants using real conversion data.
11. Introduce future pricing only once packaging and willingness-to-pay evidence exist.

## Principle for future sales work

Do not solve product risk with marketing language.

For every material buyer objection, Operating Layer should do one of three things:

1. prove the product already removes the risk;
2. state the limitation clearly; or
3. build the missing capability.

That is the standard PR #7 now applies to cost, evaluation, migration, integrations and operational control.
