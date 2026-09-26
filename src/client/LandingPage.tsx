import { useState } from "react";
import {
  ArrowRight,
  BarChart3,
  Boxes,
  Check,
  ClipboardCheck,
  ClipboardList,
  PackageCheck,
  ScanBarcode,
  ShieldCheck,
  Sparkles,
  Truck,
  Users,
  Warehouse,
  Zap,
} from "lucide-react";
import { BrandLockup, BrandMark } from "./Brand";

const featureGroups = [
  {
    icon: Boxes,
    title: "Inventory management without reconciliation",
    copy: "See on-hand, reserved, available and incoming inventory by location, with an immutable stock movement history behind every number.",
    tag: "Inventory management",
  },
  {
    icon: ClipboardList,
    title: "Purchase orders and replenishment in one loop",
    copy: "Create purchase orders, track expected delivery, receive partially, surface discrepancies and turn replenishment signals into reviewed buying work.",
    tag: "Purchasing",
  },
  {
    icon: PackageCheck,
    title: "Order management built around fulfilment",
    copy: "Prioritise customer orders, reserve stock, prevent overselling, fulfil partially, handle returns and preserve the commercial snapshot.",
    tag: "Order management",
  },
  {
    icon: ScanBarcode,
    title: "Warehouse workflows made for scanners and phones",
    copy: "Use manual entry, hardware barcode scanners or a phone camera for picking, receiving, cycle counts and multi-order wave picking.",
    tag: "Warehouse operations",
  },
  {
    icon: BarChart3,
    title: "Inventory reporting from operational truth",
    copy: "Understand stock value, fulfilment, returns, purchase commitments, overdue work and top-moving SKUs from canonical records.",
    tag: "Reporting",
  },
  {
    icon: Sparkles,
    title: "AI assistance with approval boundaries",
    copy: "Extract documents, propose supplier mappings and surface stock risks without letting AI silently change inventory, orders or purchasing.",
    tag: "Reviewed automation",
  },
];

const outcomes = [
  "Know what inventory is actually available before promising it",
  "Turn customer orders into a clear, prioritised warehouse queue",
  "See purchase and replenishment risk before it becomes a stockout",
  "Replace spreadsheet reconciliation with traceable operational history",
];

const workflows = [
  { step: "01", title: "Order lands", copy: "Reserve stock and rank fulfilment by priority, required-by date and age." },
  { step: "02", title: "Team picks", copy: "Scan once, aggregate repeated SKUs and allocate exact quantities back to each order." },
  { step: "03", title: "Stock moves", copy: "Every fulfilment, receipt, transfer, count and adjustment becomes an auditable movement." },
  { step: "04", title: "Layer responds", copy: "Replenishment, overdue work and discrepancies surface automatically for human review." },
];

const faqs = [
  {
    question: "What is Operating Layer?",
    answer: "Operating Layer is inventory, order, purchasing and warehouse operations software for growing product businesses. It connects stock control, customer fulfilment, purchase orders, suppliers, replenishment and reporting in one auditable workspace.",
  },
  {
    question: "Can Operating Layer manage inventory across multiple locations?",
    answer: "Yes. It separates on-hand, reserved, available and incoming stock by location and records inventory changes as movements, so teams can understand both the current quantity and how it got there.",
  },
  {
    question: "Does it support purchase orders and stock replenishment?",
    answer: "Yes. Teams can create and receive purchase orders, track expected delivery dates and discrepancies, and review deterministic replenishment suggestions based on stock, incoming supply, recent demand and supplier lead time.",
  },
  {
    question: "Can warehouse teams use barcode scanners?",
    answer: "Yes. Warehouse workflows support manual barcode entry, USB or Bluetooth keyboard-wedge scanners and mobile-camera scanning for picking, receiving and cycle counting.",
  },
  {
    question: "Does AI automatically change inventory or orders?",
    answer: "No. Operating Layer can extract evidence and prepare proposals for review, but canonical stock, order fulfilment and purchase-order changes still go through explicit, deterministic and audited workflows.",
  },
];

export default function LandingPage({ inviteToken }: { inviteToken: string | null }) {
  const [busy, setBusy] = useState(false);
  const callbackURL = inviteToken ? `${window.location.origin}/?invite=${encodeURIComponent(inviteToken)}` : window.location.origin;

  const signIn = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { authClient } = await import("./auth-client");
      await authClient.signIn.social({ provider: "google", callbackURL });
    } catch (error) {
      console.error("Google sign-in failed", error);
      setBusy(false);
    }
  };

  return <div className="landing-page">
    <a className="landing-skip" href="#landing-main">Skip to main content</a>

    <header className="landing-header">
      <a className="landing-brand" href="#top" aria-label="Operating Layer home">
        <BrandLockup />
      </a>
      <nav className="landing-nav" aria-label="Landing page navigation">
        <a href="#platform">Platform</a>
        <a href="#product">Product</a>
        <a href="#automation">Automation</a>
        <a href="#trust">Trust</a>
      </nav>
      <button type="button" className="landing-nav-cta" disabled={busy} onClick={signIn}>
        {busy ? "Opening Google…" : inviteToken ? "Accept invite" : "Start with Google"}
        <ArrowRight size={16} aria-hidden="true" />
      </button>
    </header>

    <main id="landing-main">
      <section className="landing-hero" id="top" aria-labelledby="landing-title">
        <div className="landing-hero-copy">
          {inviteToken && <div className="invite-ribbon" role="status"><Users size={16} aria-hidden="true" /> You’ve been invited to an Operating Layer workspace</div>}
          <div className="brand-chip">Operations software for inventory-led teams</div>
          <p className="landing-kicker"><span aria-hidden="true" /> Inventory · Orders · Purchasing · Warehouse</p>
          <h1 id="landing-title">Inventory, orders & purchasing. <em>One operating layer.</em></h1>
          <p className="landing-hero-lede">Operating Layer gives growing product businesses one live system for inventory control, order fulfilment, purchasing and warehouse work — replacing disconnected spreadsheets, reactive admin and “ask the person who knows”.</p>
          <div className="landing-hero-actions">
            <button type="button" className="landing-primary-cta" disabled={busy} onClick={signIn}>
              <GoogleGlyph />
              {busy ? "Opening Google…" : inviteToken ? "Join your workspace" : "Start with Google"}
            </button>
            <a className="landing-secondary-cta" href="#product">See the product <ArrowRight size={16} aria-hidden="true" /></a>
          </div>
          <div className="landing-proof-row" aria-label="Platform highlights">
            <span><Check size={15} aria-hidden="true" /> Multi-location inventory</span>
            <span><Check size={15} aria-hidden="true" /> Human-reviewed automation</span>
            <span><Check size={15} aria-hidden="true" /> Auditable by design</span>
          </div>
        </div>

        <div className="landing-hero-visual" aria-hidden="true">
          <div className="hero-orbit hero-orbit-one" />
          <div className="hero-orbit hero-orbit-two" />
          <div className="hero-product-card">
            <div className="hero-product-topbar">
              <div className="mini-brand"><BrandMark /><b>Operating Layer</b></div>
              <div className="mini-search">Search products, orders, SKUs…</div>
              <div className="mini-user">RH</div>
            </div>
            <div className="hero-product-body">
              <div className="mini-sidebar"><i className="active" /><i /><i /><i /><i /><i /></div>
              <div className="mini-dashboard">
                <div className="mini-heading"><div><span>LIVE OPERATIONS OVERVIEW</span><strong>Good morning.</strong></div><b>Everything in motion.</b></div>
                <div className="mini-metrics">
                  <div><span>Available stock</span><strong>4,286</strong><small>12 locations</small></div>
                  <div><span>Orders to fulfil</span><strong>38</strong><small>7 urgent</small></div>
                  <div><span>Incoming units</span><strong>1,240</strong><small>9 purchase orders</small></div>
                  <div><span>Needs attention</span><strong>6</strong><small>Layer surfaced</small></div>
                </div>
                <div className="mini-panels"><div className="mini-chart"><span>FULFILMENT THIS WEEK</span><div className="chart-bars"><i /><i /><i /><i /><i /><i /><i /></div></div><div className="mini-attention"><span>WHAT NEEDS YOU</span><b>2 stock risks</b><b>1 late PO</b><b>3 priority orders</b></div></div>
              </div>
            </div>
          </div>
          <div className="hero-float hero-float-order"><span><PackageCheck size={17} /> Order #1842</span><strong>Ready to wave pick</strong><small>8 lines · Nottingham</small></div>
          <div className="hero-float hero-float-stock"><span><Warehouse size={17} /> Inventory signal</span><strong>14 units left</strong><small>Reorder before Friday</small></div>
          <div className="hero-float hero-float-auto"><span><Sparkles size={17} /> Reviewed assist</span><strong>Delivery note matched</strong><small>Ready for your review</small></div>
        </div>
      </section>

      <section className="landing-marquee" aria-label="Operating Layer capabilities"><div><span>Inventory management</span><i>•</i><span>Order management</span><i>•</i><span>Purchase orders</span><i>•</i><span>Warehouse picking</span><i>•</i><span>Barcode scanning</span><i>•</i><span>Cycle counts</span><i>•</i><span>Replenishment</span><i>•</i><span>Inventory reporting</span></div></section>

      <section className="landing-section landing-intro" id="platform" aria-labelledby="platform-title">
        <div className="landing-section-heading">
          <p className="landing-kicker"><span aria-hidden="true" /> The operating layer your business grows into</p>
          <h2 id="platform-title">Less reconciliation. Fewer surprises. <em>More control.</em></h2>
          <p>Operating Layer is designed around the operational questions inventory-led businesses ask every day — then connects the answers so the team can act without reconciling five different sources first.</p>
        </div>
        <div className="outcome-grid">{outcomes.map((outcome, index) => <article key={outcome}><span>0{index + 1}</span><p>{outcome}</p></article>)}</div>
      </section>

      <section className="landing-system-band" aria-labelledby="positioning-title">
        <div className="system-band-head"><div><p className="landing-kicker light"><span aria-hidden="true" /> One record of the operation</p><h2 id="positioning-title">The work between <em>order and outcome</em> finally has a system.</h2></div><p>Inventory software should not be a static stock table. Orders, purchasing, warehouse execution and replenishment all change the same operational truth. Operating Layer keeps that loop connected.</p></div>
        <div className="positioning-grid"><article><span>01 / LIVE TRUTH</span><h3>One inventory position</h3><p>On-hand, reserved, available and incoming quantities stay connected to the movements that created them.</p></article><article><span>02 / CONTROLLED FLOW</span><h3>One path through the work</h3><p>Customer demand flows into picking, fulfilment, stock movement and replenishment without duplicate operational engines.</p></article><article><span>03 / EXPLAINABLE ACTION</span><h3>One audit trail</h3><p>People can see what changed, why it changed and who approved it — including where automation proposed the next step.</p></article></div>
      </section>

      <section className="landing-section feature-section" aria-labelledby="feature-title">
        <div className="landing-section-heading compact"><p className="landing-kicker"><span aria-hidden="true" /> Connected operations software</p><h2 id="feature-title">Built around the work, not a list of disconnected modules.</h2></div>
        <div className="feature-bento">
          {featureGroups.map(({ icon: Icon, title, copy, tag }, index) => <article className={`feature-card feature-card-${index + 1}`} key={title}>
            <div className="feature-icon"><Icon size={20} aria-hidden="true" /></div><span className="feature-tag">{tag}</span><h3>{title}</h3><p>{copy}</p>
            {index === 0 && <div className="feature-stock-visual" aria-hidden="true"><span><b>SKU-1048</b><small>Available</small></span><strong>214</strong><div><i /><i /><i /></div></div>}
            {index === 3 && <div className="feature-scan-visual" aria-hidden="true"><ScanBarcode size={46} /><span>Scan → stage → verify → fulfil</span></div>}
            {index === 5 && <div className="feature-ai-visual" aria-hidden="true"><span>Evidence</span><ArrowRight size={13} /><span>Proposal</span><ArrowRight size={13} /><strong>Human review</strong></div>}
          </article>)}
        </div>
      </section>

      <section className="landing-section product-section" id="product" aria-labelledby="product-title">
        <div className="landing-section-heading"><p className="landing-kicker"><span aria-hidden="true" /> Product proof, not product theatre</p><h2 id="product-title">A calm interface for <em>busy operations.</em></h2><p>Dense enough for the people doing the job. Clear enough that a growing team does not need a systems expert to understand what happens next.</p></div>
        <div className="product-showcase">
          <figure className="product-shot product-shot-wide"><div className="shot-chrome"><span /><span /><span /><b>Overview</b></div><img src="/product/overview.svg" width="1200" height="760" alt="Operating Layer inventory and operations dashboard showing stock, order, purchasing and attention metrics" decoding="async" loading="lazy" /><figcaption><span>01</span><div><strong>Start with what matters today</strong><p>Operational metrics, inventory risk and order attention without building your own spreadsheet dashboard.</p></div></figcaption></figure>
          <figure className="product-shot"><div className="shot-chrome"><span /><span /><span /><b>Wave Picking</b></div><img src="/product/wave-picking.svg" width="1200" height="760" alt="Operating Layer warehouse wave picking workspace aggregating repeated SKUs across customer orders" decoding="async" loading="lazy" /><figcaption><span>02</span><div><strong>Turn an order queue into a pick</strong><p>Group 2–10 orders, scan shared SKUs once and see exactly how units allocate back to each order.</p></div></figcaption></figure>
          <figure className="product-shot"><div className="shot-chrome"><span /><span /><span /><b>Purchasing</b></div><img src="/product/purchasing.svg" width="1200" height="760" alt="Operating Layer purchasing software showing purchase orders, incoming inventory and replenishment recommendations" decoding="async" loading="lazy" /><figcaption><span>03</span><div><strong>Buy before it becomes urgent</strong><p>Connect incoming supply, supplier lead time and operational demand instead of relying on memory and gut feel.</p></div></figcaption></figure>
        </div>
      </section>

      <section className="landing-section workflow-section" aria-labelledby="workflow-title">
        <div className="landing-section-heading compact"><p className="landing-kicker"><span aria-hidden="true" /> The operating loop</p><h2 id="workflow-title">From customer order to inventory decision — without losing the thread.</h2></div>
        <div className="operating-loop"><ol className="workflow-line">{workflows.map(item => <li key={item.step}><span>{item.step}</span><div><h3>{item.title}</h3><p>{item.copy}</p></div></li>)}</ol></div>
      </section>

      <section className="landing-section automation-section" id="automation" aria-labelledby="automation-title">
        <div className="automation-visual" aria-hidden="true">
          <div className="automation-core"><BrandMark /><strong>Operating Layer</strong><span>reviewed assistance</span></div>
          <div className="automation-node node-a"><ClipboardList size={17} /> Purchase document</div><div className="automation-node node-b"><Truck size={17} /> Delivery note</div><div className="automation-node node-c"><Boxes size={17} /> Stock risk</div><div className="automation-node node-d"><BarChart3 size={17} /> Demand signal</div>
          <svg viewBox="0 0 600 420" focusable="false"><path d="M130 95C230 110 230 190 300 210M470 92C380 112 385 185 300 210M115 328C210 320 225 245 300 210M485 330C390 322 375 248 300 210" /></svg>
        </div>
        <div className="automation-copy">
          <p className="landing-kicker light"><span aria-hidden="true" /> Automation that respects the operation</p><h2 id="automation-title">Let software do the chasing. <em>Keep people making the decisions.</em></h2><p>Operating Layer turns repetitive operational evidence into structured work: matching documents, surfacing exceptions, suggesting replenishment and making priorities obvious.</p>
          <ul><li><Zap size={18} aria-hidden="true" /><span><strong>Document assistance</strong> — extract purchase and delivery information into reviewable proposals.</span></li><li><Zap size={18} aria-hidden="true" /><span><strong>Replenishment signals</strong> — combine inventory, incoming supply, demand and lead time to surface what needs buying.</span></li><li><Zap size={18} aria-hidden="true" /><span><strong>Exception-first operations</strong> — focus the team on overdue, urgent or inconsistent work instead of manually hunting for it.</span></li></ul>
          <div className="human-control"><ShieldCheck size={20} aria-hidden="true" /><span><strong>Human-reviewed by design.</strong> AI can propose; canonical inventory, orders and purchasing still change through deterministic, audited workflows.</span></div>
        </div>
      </section>

      <section className="landing-section trust-section" id="trust" aria-labelledby="trust-title">
        <div className="trust-copy"><p className="landing-kicker"><span aria-hidden="true" /> Serious foundations for a growing business</p><h2 id="trust-title">Operational control should scale with the team.</h2><p>Operating Layer is a multi-tenant Cloudflare-native SaaS with clear permission boundaries, isolated business data and an audit trail behind operational mutations.</p></div>
        <div className="trust-grid"><article><ShieldCheck size={22} aria-hidden="true" /><strong>Business isolation</strong><p>Operational data lives in a separate tenant datastore rather than sharing one giant operational table across customers.</p></article><article><Users size={22} aria-hidden="true" /><strong>Role-aware access</strong><p>Owner, admin, manager, inventory, fulfilment and viewer roles keep capability aligned to responsibility.</p></article><article><ClipboardCheck size={22} aria-hidden="true" /><strong>Auditable work</strong><p>Inventory and order mutations follow canonical workflows rather than hidden automation shortcuts.</p></article><article><Warehouse size={22} aria-hidden="true" /><strong>EU data controls</strong><p>Control-plane data and documents use Cloudflare resources configured with EU jurisdiction where supported.</p></article></div>
      </section>

      <section className="seo-faq" id="faq" aria-labelledby="faq-title">
        <div className="landing-section-heading"><p className="landing-kicker"><span aria-hidden="true" /> Common questions</p><h2 id="faq-title">What growing operations teams ask before they switch.</h2></div>
        <div className="seo-faq-grid">{faqs.map(item => <details key={item.question}><summary>{item.question}</summary><p>{item.answer}</p></details>)}</div>
      </section>

      <section className="landing-cta-section" aria-labelledby="cta-title"><div className="cta-orb" aria-hidden="true" /><p className="landing-kicker light"><span aria-hidden="true" /> Run the work between order and outcome</p><h2 id="cta-title">Give your operation a system it can <em>grow into.</em></h2><p>Bring inventory, orders, purchasing and warehouse execution into one connected workspace built for growing product businesses.</p><button type="button" className="landing-primary-cta inverted" disabled={busy} onClick={signIn}><GoogleGlyph />{busy ? "Opening Google…" : inviteToken ? "Join your workspace" : "Start with Google"}</button></section>
    </main>

    <footer className="landing-footer"><BrandLockup inverse /><p>Inventory, order, purchasing & warehouse operations software for growing businesses.</p><a href="#top">Back to top</a></footer>
  </div>;
}

function GoogleGlyph() {
  return <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.24-.2-1.8H12v3.45h5.52a4.72 4.72 0 0 1-2.05 3.01l-.02.12 2.98 2.31.2.02c1.85-1.7 2.97-4.22 2.97-7.11Z"/><path fill="#34A853" d="M12 22c2.68 0 4.93-.88 6.57-2.4l-3.13-2.43c-.84.57-1.98.97-3.44.97a5.98 5.98 0 0 1-5.66-4.13l-.11.01-3.1 2.4-.04.11A9.92 9.92 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.34 14.01A6.1 6.1 0 0 1 6 12c0-.7.12-1.38.33-2.01v-.12L3.2 7.43l-.1.05A10 10 0 0 0 2 12c0 1.62.39 3.15 1.09 4.52l3.25-2.51Z"/><path fill="#EA4335" d="M12 5.86c1.86 0 3.12.8 3.84 1.47l2.8-2.73C16.92 3 14.68 2 12 2a9.92 9.92 0 0 0-8.91 5.48l3.24 2.51A5.99 5.99 0 0 1 12 5.86Z"/></svg>;
}
