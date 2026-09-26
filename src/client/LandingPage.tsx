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
    title: "Buy before stock becomes urgent",
    copy: "Forecast demand, incoming supply, safety stock and supplier lead time together, then turn the recommended scenario into reviewed buying work.",
    tag: "Purchasing intelligence",
  },
  {
    icon: PackageCheck,
    title: "Order management built around promises",
    copy: "Prioritise customer orders by urgency and required-by date, reserve stock, prevent overselling and move the right work into fulfilment first.",
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
    title: "Forecast and reporting from operational truth",
    copy: "See stock value, fulfilment, returns, purchase commitments, days of cover, projected stockouts and the work most likely to delay the operation.",
    tag: "Operating intelligence",
  },
  {
    icon: Sparkles,
    title: "A live flow plan instead of another alert inbox",
    copy: "Continuously turn late orders, forecast stock risk, overdue supply and receiving discrepancies into a short, prioritised list of decisions for the team.",
    tag: "Flow automation",
  },
];

const outcomes = [
  "Start the day with the few operational decisions that matter most",
  "Protect customer required-by dates before lower-priority work consumes time",
  "See stockout and supplier risk early enough to make a calm buying decision",
  "Replace spreadsheet reconciliation and manual chasing with traceable operational flow",
];

const workflows = [
  { step: "01", title: "Demand lands", copy: "Orders reserve stock and enter a queue ranked by customer promise, priority and age." },
  { step: "02", title: "Layer plans", copy: "Forecast demand, supply timing and exceptions are checked continuously against live operational truth." },
  { step: "03", title: "Team executes", copy: "Pick, receive, count and fulfil with barcode-ready workflows that write canonical stock movements." },
  { step: "04", title: "Flow plan resets", copy: "Late orders, stock risk, overdue POs and receiving discrepancies are reprioritised into the next best work." },
];

const faqs = [
  {
    question: "What is Operating Layer?",
    answer: "Operating Layer is inventory, order, purchasing and warehouse operations software for growing product businesses. It connects stock control, customer fulfilment, purchase orders, suppliers, replenishment, forecasting and exception automation in one auditable workspace.",
  },
  {
    question: "Can Operating Layer manage inventory across multiple locations?",
    answer: "Yes. It separates on-hand, reserved, available and incoming stock by location and records inventory changes as movements, so teams can understand both the current quantity and how it got there.",
  },
  {
    question: "Does it support purchase orders and stock replenishment?",
    answer: "Yes. Teams can create and receive purchase orders, track expected delivery dates and discrepancies, and review forward-looking replenishment plans using up to 90 days of fulfilment history, dated incoming supply, lead time, safety stock, stockout timing and configurable replenishment policies.",
  },
  {
    question: "What does the automatic flow plan do?",
    answer: "It continuously checks customer required-by dates, forecast stock risk, incoming supplier dates and receiving discrepancies. It then prioritises the highest-impact exceptions into a short action list so a small team spends less time finding the next problem and more time resolving it.",
  },
  {
    question: "Can warehouse teams use barcode scanners?",
    answer: "Yes. Warehouse workflows support manual barcode entry, USB or Bluetooth keyboard-wedge scanners and mobile-camera scanning for picking, receiving and cycle counting.",
  },
  {
    question: "Does AI automatically change inventory or orders?",
    answer: "No. Operating Layer can extract evidence, explain risk and prepare proposals for review, but canonical stock, order fulfilment and purchase-order changes still go through explicit, deterministic and audited workflows.",
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
          <div className="brand-chip">Operations software for inventory-led SMEs</div>
          <p className="landing-kicker"><span aria-hidden="true" /> Inventory · Orders · Purchasing · Warehouse · Flow automation</p>
          <h1 id="landing-title">Run orders, stock & purchasing <em>without the daily chasing.</em></h1>
          <p className="landing-hero-lede">Operating Layer gives growing product businesses one live system that watches customer promises, inventory risk, incoming supply and warehouse work — then shows the team what should move next before delays turn into emergencies.</p>
          <div className="landing-hero-actions">
            <button type="button" className="landing-primary-cta" disabled={busy} onClick={signIn}>
              <GoogleGlyph />
              {busy ? "Opening Google…" : inviteToken ? "Join your workspace" : "Start with Google"}
            </button>
            <a className="landing-secondary-cta" href="#automation">See how work gets automated <ArrowRight size={16} aria-hidden="true" /></a>
          </div>
          <div className="landing-proof-row" aria-label="Platform highlights">
            <span><Check size={15} aria-hidden="true" /> Automatic exception triage</span>
            <span><Check size={15} aria-hidden="true" /> Forward stock planning</span>
            <span><Check size={15} aria-hidden="true" /> Human-reviewed actions</span>
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
                <div className="mini-heading"><div><span>AUTOMATIC FLOW PLAN</span><strong>Good morning.</strong></div><b>What should move next.</b></div>
                <div className="mini-metrics">
                  <div><span>Available stock</span><strong>4,286</strong><small>12 locations</small></div>
                  <div><span>Orders to fulfil</span><strong>38</strong><small>7 urgent</small></div>
                  <div><span>Incoming units</span><strong>1,240</strong><small>9 purchase orders</small></div>
                  <div><span>Priority actions</span><strong>6</strong><small>Continuously ranked</small></div>
                </div>
                <div className="mini-panels"><div className="mini-chart"><span>FULFILMENT THIS WEEK</span><div className="chart-bars"><i /><i /><i /><i /><i /><i /><i /></div></div><div className="mini-attention"><span>FLOW PLAN</span><b>Protect 2 stock risks</b><b>Chase 1 late PO</b><b>Move 3 priority orders</b></div></div>
              </div>
            </div>
          </div>
          <div className="hero-float hero-float-order"><span><PackageCheck size={17} /> Customer promise</span><strong>Order #1842 first</strong><small>Required today · Nottingham</small></div>
          <div className="hero-float hero-float-stock"><span><Warehouse size={17} /> Forecast stock risk</span><strong>Buy before Friday</strong><small>12-day cover · A-class SKU</small></div>
          <div className="hero-float hero-float-auto"><span><Sparkles size={17} /> Flow plan</span><strong>6 actions prioritised</strong><small>4 live checks · human review</small></div>
        </div>
      </section>

      <section className="landing-marquee" aria-label="Operating Layer capabilities"><div><span>Inventory management</span><i>•</i><span>Order management</span><i>•</i><span>Purchase orders</span><i>•</i><span>Automatic flow planning</span><i>•</i><span>Warehouse picking</span><i>•</i><span>Barcode scanning</span><i>•</i><span>Forecast replenishment</span><i>•</i><span>Inventory reporting</span></div></section>

      <section className="landing-section landing-intro" id="platform" aria-labelledby="platform-title">
        <div className="landing-section-heading">
          <p className="landing-kicker"><span aria-hidden="true" /> The operating layer your business grows into</p>
          <h2 id="platform-title">Less chasing. Fewer surprises. <em>More flow.</em></h2>
          <p>Operating Layer is designed around the operational questions a small product team asks every day — what is late, what will run out, what should we buy, and what must ship first — then connects the answers so the team can act without reconciling five sources first.</p>
        </div>
        <div className="outcome-grid">{outcomes.map((outcome, index) => <article key={outcome}><span>0{index + 1}</span><p>{outcome}</p></article>)}</div>
      </section>

      <section className="landing-system-band" aria-labelledby="positioning-title">
        <div className="system-band-head"><div><p className="landing-kicker light"><span aria-hidden="true" /> One record of the operation</p><h2 id="positioning-title">The work between <em>order and outcome</em> finally has a system.</h2></div><p>Inventory software should not be a static stock table. Orders, purchasing, warehouse execution and replenishment all change the same operational truth. Operating Layer keeps that loop connected and continuously reprioritises the exceptions around it.</p></div>
        <div className="positioning-grid"><article><span>01 / LIVE TRUTH</span><h3>Know the real position</h3><p>On-hand, reserved, available and incoming quantities stay connected to the movements that created them.</p></article><article><span>02 / AUTOMATIC TRIAGE</span><h3>Know what should move next</h3><p>Customer promise dates, stock forecasts, supplier dates and receiving exceptions feed one short operational flow plan.</p></article><article><span>03 / CONTROLLED ACTION</span><h3>Keep the human checkpoint</h3><p>People can see why work was prioritised and approve the business-changing action through deterministic, audited workflows.</p></article></div>
      </section>

      <section className="landing-section feature-section" aria-labelledby="feature-title">
        <div className="landing-section-heading compact"><p className="landing-kicker"><span aria-hidden="true" /> Connected operations software</p><h2 id="feature-title">Built around the work, not a list of disconnected modules.</h2></div>
        <div className="feature-bento">
          {featureGroups.map(({ icon: Icon, title, copy, tag }, index) => <article className={`feature-card feature-card-${index + 1}`} key={title}>
            <div className="feature-icon"><Icon size={20} aria-hidden="true" /></div><span className="feature-tag">{tag}</span><h3>{title}</h3><p>{copy}</p>
            {index === 0 && <div className="feature-stock-visual" aria-hidden="true"><span><b>SKU-1048</b><small>Available</small></span><strong>214</strong><div><i /><i /><i /></div></div>}
            {index === 3 && <div className="feature-scan-visual" aria-hidden="true"><ScanBarcode size={46} /><span>Scan → stage → verify → fulfil</span></div>}
            {index === 5 && <div className="feature-ai-visual" aria-hidden="true"><span>Detect</span><ArrowRight size={13} /><span>Prioritise</span><ArrowRight size={13} /><strong>Review action</strong></div>}
          </article>)}
        </div>
      </section>

      <section className="landing-section product-section" id="product" aria-labelledby="product-title">
        <div className="landing-section-heading"><p className="landing-kicker"><span aria-hidden="true" /> Product proof, not product theatre</p><h2 id="product-title">A calm interface for <em>busy operations.</em></h2><p>Dense enough for the people doing the job. Clear enough that a growing team does not need a systems expert to understand what happens next.</p></div>
        <div className="product-showcase">
          <figure className="product-shot product-shot-wide"><div className="shot-chrome"><span /><span /><span /><b>Overview</b></div><img src="/product/overview.svg" width="1200" height="760" alt="Operating Layer inventory and operations dashboard showing stock, order, purchasing and attention metrics" decoding="async" loading="lazy" /><figcaption><span>01</span><div><strong>Start with the next best work</strong><p>A continuously prioritised flow plan brings late promises, forecast stock risk, supplier delays and receiving exceptions together before the team starts hunting.</p></div></figcaption></figure>
          <figure className="product-shot"><div className="shot-chrome"><span /><span /><span /><b>Wave Picking</b></div><img src="/product/wave-picking.svg" width="1200" height="760" alt="Operating Layer warehouse wave picking workspace aggregating repeated SKUs across customer orders" decoding="async" loading="lazy" /><figcaption><span>02</span><div><strong>Turn priority orders into one efficient pick</strong><p>Group 2–10 orders, scan shared SKUs once and see exactly how units allocate back to each customer promise.</p></div></figcaption></figure>
          <figure className="product-shot"><div className="shot-chrome"><span /><span /><span /><b>Purchasing</b></div><img src="/product/purchasing.svg" width="1200" height="760" alt="Operating Layer purchasing software showing purchase orders, incoming inventory and replenishment recommendations" decoding="async" loading="lazy" /><figcaption><span>03</span><div><strong>Buy before it becomes urgent</strong><p>See days of cover, stockout and order-by timing, dated incoming supply and minimum/recommended/maximum buying scenarios instead of relying on memory and gut feel.</p></div></figcaption></figure>
        </div>
      </section>

      <section className="landing-section workflow-section" aria-labelledby="workflow-title">
        <div className="landing-section-heading compact"><p className="landing-kicker"><span aria-hidden="true" /> The operating loop</p><h2 id="workflow-title">From customer demand to next action — without losing the thread.</h2></div>
        <div className="operating-loop"><ol className="workflow-line">{workflows.map(item => <li key={item.step}><span>{item.step}</span><div><h3>{item.title}</h3><p>{item.copy}</p></div></li>)}</ol></div>
      </section>

      <section className="landing-section automation-section" id="automation" aria-labelledby="automation-title">
        <div className="automation-visual" aria-hidden="true">
          <div className="automation-core"><BrandMark /><strong>Operating Layer</strong><span>automatic flow plan</span></div>
          <div className="automation-node node-a"><PackageCheck size={17} /> Promise dates</div><div className="automation-node node-b"><Truck size={17} /> Incoming supply</div><div className="automation-node node-c"><Boxes size={17} /> Stock forecast</div><div className="automation-node node-d"><ClipboardCheck size={17} /> Receipt exceptions</div>
          <svg viewBox="0 0 600 420" focusable="false"><path d="M130 95C230 110 230 190 300 210M470 92C380 112 385 185 300 210M115 328C210 320 225 245 300 210M485 330C390 322 375 248 300 210" /></svg>
        </div>
        <div className="automation-copy">
          <p className="landing-kicker light"><span aria-hidden="true" /> Automation for the handoffs that slow SMEs down</p><h2 id="automation-title">Stop finding the work manually. <em>Start with what should move next.</em></h2><p>Operating Layer continuously turns live operational evidence into a short flow plan. Instead of asking someone to check orders, stock, suppliers and receiving separately, the system performs those checks and ranks the exceptions for review.</p>
          <ul><li><Zap size={18} aria-hidden="true" /><span><strong>Protect customer promises</strong> — overdue and urgent confirmed orders move ahead of routine fulfilment work.</span></li><li><Zap size={18} aria-hidden="true" /><span><strong>Protect availability</strong> — forecast demand, safety stock, incoming supply and lead time turn stock risk into a concrete buying decision.</span></li><li><Zap size={18} aria-hidden="true" /><span><strong>Protect supply flow</strong> — overdue POs, partial receipts and receiving discrepancies surface before someone discovers them in a spreadsheet or email trail.</span></li></ul>
          <div className="human-control"><ShieldCheck size={20} aria-hidden="true" /><span><strong>Automation does the triage; people keep authority.</strong> The flow plan can detect, explain and prioritise. Canonical inventory, fulfilment and purchasing still change through explicit, permission-checked and audited workflows.</span></div>
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

      <section className="landing-cta-section" aria-labelledby="cta-title"><div className="cta-orb" aria-hidden="true" /><p className="landing-kicker light"><span aria-hidden="true" /> Run the work between order and outcome</p><h2 id="cta-title">Give your team fewer things to chase <em>by hand.</em></h2><p>Bring inventory, orders, purchasing and warehouse execution into one connected workspace that continuously surfaces the next best operational work.</p><button type="button" className="landing-primary-cta inverted" disabled={busy} onClick={signIn}><GoogleGlyph />{busy ? "Opening Google…" : inviteToken ? "Join your workspace" : "Start with Google"}</button></section>
    </main>

    <footer className="landing-footer"><BrandLockup inverse /><p>Inventory, order, purchasing & warehouse operations software for growing businesses.</p><a href="#top">Back to top</a></footer>
  </div>;
}

function GoogleGlyph() {
  return <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.24-.2-1.8H12v3.45h5.52a4.72 4.72 0 0 1-2.05 3.01l-.02.12 2.98 2.31.2.02c1.85-1.7 2.97-4.22 2.97-7.11Z"/><path fill="#34A853" d="M12 22c2.68 0 4.93-.88 6.57-2.4l-3.13-2.43c-.84.57-1.98.97-3.44.97a5.98 5.98 0 0 1-5.66-4.13l-.11.01-3.1 2.4-.04.11A9.92 9.92 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.34 14.01A6.1 6.1 0 0 1 6 12c0-.7.12-1.38.33-2.01v-.12L3.2 7.43l-.1.05A10 10 0 0 0 2 12c0 1.62.39 3.15 1.09 4.52l3.25-2.51Z"/><path fill="#EA4335" d="M12 5.86c1.86 0 3.12.8 3.84 1.47l2.8-2.73C16.92 3 14.68 2 12 2a9.92 9.92 0 0 0-8.91 5.48l3.24 2.51A5.99 5.99 0 0 1 12 5.86Z"/></svg>;
}
