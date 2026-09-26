import { useState } from "react";
import {
  ArrowRight,
  BarChart3,
  Boxes,
  Check,
  ClipboardCheck,
  ClipboardList,
  Layers3,
  PackageCheck,
  ScanBarcode,
  ShieldCheck,
  Sparkles,
  Truck,
  Users,
  Warehouse,
  Zap,
} from "lucide-react";

const featureGroups = [
  {
    icon: Boxes,
    title: "Inventory that explains itself",
    copy: "See on-hand, reserved, available and incoming stock by location, with an immutable movement history behind every number.",
    tag: "Inventory",
  },
  {
    icon: ClipboardList,
    title: "Purchasing without the chase",
    copy: "Build purchase orders, track expected delivery, receive partially, surface discrepancies and turn replenishment signals into action.",
    tag: "Purchasing",
  },
  {
    icon: PackageCheck,
    title: "Orders that stay operational",
    copy: "Prioritise work, reserve stock, prevent overselling, fulfil partially, handle returns and keep the commercial snapshot intact.",
    tag: "Orders",
  },
  {
    icon: ScanBarcode,
    title: "A warehouse flow made for phones",
    copy: "Use manual entry, barcode scanners or the phone camera for picking, receiving, cycle counts and multi-order wave picking.",
    tag: "Warehouse",
  },
  {
    icon: BarChart3,
    title: "Reports built from business truth",
    copy: "Understand stock value, fulfilment, returns, purchasing commitments, overdue work and top-moving SKUs from canonical records.",
    tag: "Reports",
  },
  {
    icon: Sparkles,
    title: "Automation with a human in control",
    copy: "Extract and match documents, propose supplier mappings and surface replenishment work without letting AI silently mutate stock or orders.",
    tag: "Automation",
  },
];

const outcomes = [
  "Know what stock is actually available before promising it",
  "Turn incoming orders into a clear warehouse queue",
  "Spot purchasing gaps before they become customer problems",
  "Replace tribal knowledge with traceable operational history",
];

const workflows = [
  { step: "01", title: "Order lands", copy: "Reserve stock and rank the work by priority, required-by date and age." },
  { step: "02", title: "Team picks", copy: "Scan once, aggregate repeated SKUs and allocate exact quantities back to each order." },
  { step: "03", title: "Stock moves", copy: "Every fulfilment, receipt, transfer, count and adjustment becomes an auditable movement." },
  { step: "04", title: "OrderMate watches", copy: "Replenishment, overdue work and discrepancies surface automatically for review." },
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
      <a className="landing-brand" href="#top" aria-label="OrderMate home" translate="no">
        <span className="landing-brand-mark" aria-hidden="true">OM</span>
        <span><strong>OrderMate</strong><small>Operations, in order.</small></span>
      </a>
      <nav className="landing-nav" aria-label="Landing page navigation">
        <a href="#platform">Platform</a>
        <a href="#automation">Automation</a>
        <a href="#product">Product</a>
        <a href="#trust">Trust</a>
      </nav>
      <button type="button" className="landing-nav-cta" disabled={busy} onClick={signIn}>
        {busy ? "Opening Google…" : inviteToken ? "Accept Invite" : "Start With Google"}
        <ArrowRight size={16} aria-hidden="true" />
      </button>
    </header>

    <main id="landing-main">
      <section className="landing-hero" id="top" aria-labelledby="landing-title">
        <div className="landing-hero-copy">
          {inviteToken && <div className="invite-ribbon" role="status"><Users size={16} aria-hidden="true" /> You’ve been invited to an OrderMate workspace</div>}
          <p className="landing-kicker"><span aria-hidden="true" /> Built for ambitious SMEs</p>
          <h1 id="landing-title">Run stock, orders & purchasing <em>like a bigger business.</em></h1>
          <p className="landing-hero-lede">OrderMate gives growing teams one operational brain for inventory, purchasing, fulfilment and warehouse work — replacing disconnected spreadsheets, reactive admin and “ask the person who knows”.</p>
          <div className="landing-hero-actions">
            <button type="button" className="landing-primary-cta" disabled={busy} onClick={signIn}>
              <GoogleGlyph />
              {busy ? "Opening Google…" : inviteToken ? "Join Your Workspace" : "Start With Google"}
            </button>
            <a className="landing-secondary-cta" href="#product">See OrderMate in action <ArrowRight size={16} aria-hidden="true" /></a>
          </div>
          <div className="landing-proof-row" aria-label="Platform highlights">
            <span><Check size={15} aria-hidden="true" /> Multi-location stock</span>
            <span><Check size={15} aria-hidden="true" /> Human-reviewed automation</span>
            <span><Check size={15} aria-hidden="true" /> Auditable by design</span>
          </div>
        </div>

        <div className="landing-hero-visual" aria-hidden="true">
          <div className="hero-orbit hero-orbit-one" />
          <div className="hero-orbit hero-orbit-two" />
          <div className="hero-product-card">
            <div className="hero-product-topbar">
              <div className="mini-brand"><span>OM</span><b>OrderMate</b></div>
              <div className="mini-search">Search products, orders, SKUs…</div>
              <div className="mini-user">RH</div>
            </div>
            <div className="hero-product-body">
              <div className="mini-sidebar">
                <i className="active" /><i /><i /><i /><i /><i />
              </div>
              <div className="mini-dashboard">
                <div className="mini-heading"><div><span>FRIDAY, 26 SEPTEMBER</span><strong>Good morning.</strong></div><b>Everything in motion.</b></div>
                <div className="mini-metrics">
                  <div><span>Available stock</span><strong>4,286</strong><small>12 locations</small></div>
                  <div><span>Orders to fulfil</span><strong>38</strong><small>7 urgent</small></div>
                  <div><span>Incoming units</span><strong>1,240</strong><small>9 purchase orders</small></div>
                  <div><span>Needs attention</span><strong>6</strong><small>OrderMate surfaced</small></div>
                </div>
                <div className="mini-panels"><div className="mini-chart"><span>FULFILMENT THIS WEEK</span><div className="chart-bars"><i /><i /><i /><i /><i /><i /><i /></div></div><div className="mini-attention"><span>WHAT NEEDS YOU</span><b>2 stock risks</b><b>1 late PO</b><b>3 priority orders</b></div></div>
              </div>
            </div>
          </div>
          <div className="hero-float hero-float-order"><span><PackageCheck size={17} /> Order #1842</span><strong>Ready to wave pick</strong><small>8 lines · Nottingham</small></div>
          <div className="hero-float hero-float-stock"><span><Warehouse size={17} /> Stock intelligence</span><strong>14 units left</strong><small>Reorder before Friday</small></div>
          <div className="hero-float hero-float-auto"><span><Sparkles size={17} /> OrderMate assist</span><strong>Delivery note matched</strong><small>Ready for your review</small></div>
        </div>
      </section>

      <section className="landing-marquee" aria-label="OrderMate capabilities">
        <div>
          <span>Inventory</span><i>•</i><span>Orders</span><i>•</i><span>Purchasing</span><i>•</i><span>Warehouse</span><i>•</i><span>Cycle Counts</span><i>•</i><span>Wave Picking</span><i>•</i><span>Reports</span><i>•</i><span>Automation</span>
        </div>
      </section>

      <section className="landing-section landing-intro" id="platform" aria-labelledby="platform-title">
        <div className="landing-section-heading">
          <p className="landing-kicker"><span aria-hidden="true" /> The operating layer your SME grows into</p>
          <h2 id="platform-title">Less admin. Fewer surprises. <em>More control.</em></h2>
          <p>OrderMate is designed around the operational questions small businesses end up asking every day — then connects the answers so the team can act without reconciling five different sources first.</p>
        </div>
        <div className="outcome-grid">
          {outcomes.map((outcome, index) => <article key={outcome}><span>0{index + 1}</span><p>{outcome}</p></article>)}
        </div>
      </section>

      <section className="landing-section feature-section" aria-labelledby="feature-title">
        <div className="landing-section-heading compact">
          <p className="landing-kicker"><span aria-hidden="true" /> One connected platform</p>
          <h2 id="feature-title">Built around the work, not a list of modules.</h2>
        </div>
        <div className="feature-bento">
          {featureGroups.map(({ icon: Icon, title, copy, tag }, index) => <article className={`feature-card feature-card-${index + 1}`} key={title}>
            <div className="feature-icon"><Icon size={20} aria-hidden="true" /></div>
            <span className="feature-tag">{tag}</span>
            <h3>{title}</h3>
            <p>{copy}</p>
            {index === 0 && <div className="feature-stock-visual" aria-hidden="true"><span><b>SKU-1048</b><small>Available</small></span><strong>214</strong><div><i style={{ width: "72%" }} /><i style={{ width: "44%" }} /><i style={{ width: "88%" }} /></div></div>}
            {index === 3 && <div className="feature-scan-visual" aria-hidden="true"><ScanBarcode size={46} /><span>Scan → stage → verify → fulfil</span></div>}
            {index === 5 && <div className="feature-ai-visual" aria-hidden="true"><span>Evidence</span><ArrowRight size={13} /><span>Proposal</span><ArrowRight size={13} /><strong>Human review</strong></div>}
          </article>)}
        </div>
      </section>

      <section className="landing-section automation-section" id="automation" aria-labelledby="automation-title">
        <div className="automation-visual" aria-hidden="true">
          <div className="automation-core"><Sparkles size={30} /><strong>OrderMate</strong><span>operational assist</span></div>
          <div className="automation-node node-a"><ClipboardList size={17} /> Purchase document</div>
          <div className="automation-node node-b"><Truck size={17} /> Delivery note</div>
          <div className="automation-node node-c"><Boxes size={17} /> Stock risk</div>
          <div className="automation-node node-d"><BarChart3 size={17} /> Demand signal</div>
          <svg viewBox="0 0 600 420" focusable="false"><path d="M130 95C230 110 230 190 300 210M470 92C380 112 385 185 300 210M115 328C210 320 225 245 300 210M485 330C390 322 375 248 300 210" /></svg>
        </div>
        <div className="automation-copy">
          <p className="landing-kicker light"><span aria-hidden="true" /> Automation that respects the business</p>
          <h2 id="automation-title">Let software do the chasing. <em>Keep people making the decisions.</em></h2>
          <p>OrderMate is already designed to turn repetitive operational evidence into structured work: match documents, surface exceptions, suggest replenishment and make priorities obvious.</p>
          <ul>
            <li><Zap size={18} aria-hidden="true" /><span><strong>Document assistance</strong> — extract purchase and delivery information into reviewable proposals.</span></li>
            <li><Zap size={18} aria-hidden="true" /><span><strong>Replenishment signals</strong> — combine stock, incoming supply, demand and lead time to surface what needs buying.</span></li>
            <li><Zap size={18} aria-hidden="true" /><span><strong>Exception-first operations</strong> — focus the team on overdue, urgent or inconsistent work instead of manually hunting for it.</span></li>
          </ul>
          <div className="human-control"><ShieldCheck size={20} aria-hidden="true" /><span><strong>Human-reviewed by design.</strong> AI can propose; canonical stock, orders and purchasing still change through deterministic, audited workflows.</span></div>
        </div>
      </section>

      <section className="landing-section product-section" id="product" aria-labelledby="product-title">
        <div className="landing-section-heading">
          <p className="landing-kicker"><span aria-hidden="true" /> See the work clearly</p>
          <h2 id="product-title">A calm interface for <em>busy operations.</em></h2>
          <p>Dense enough for the people doing the job. Clear enough that a growing team does not need a systems expert to understand what happens next.</p>
        </div>

        <div className="product-showcase">
          <figure className="product-shot product-shot-wide">
            <div className="shot-chrome"><span /><span /><span /><b>Overview</b></div>
            <img src="/product/overview.svg" width="1200" height="760" alt="OrderMate overview showing stock, order, purchasing and attention metrics in one dashboard" decoding="async" loading="lazy" />
            <figcaption><span>01</span><div><strong>Start with what matters today</strong><p>Operational metrics, attention signals and business context without building your own dashboard.</p></div></figcaption>
          </figure>

          <figure className="product-shot">
            <div className="shot-chrome"><span /><span /><span /><b>Wave Picking</b></div>
            <img src="/product/wave-picking.svg" width="1200" height="760" alt="OrderMate wave picking workspace aggregating repeated SKUs across multiple customer orders" decoding="async" loading="lazy" />
            <figcaption><span>02</span><div><strong>Turn a queue into a route</strong><p>Group 2–10 orders, scan shared SKUs once and see exactly how units allocate back to each order.</p></div></figcaption>
          </figure>

          <figure className="product-shot">
            <div className="shot-chrome"><span /><span /><span /><b>Purchasing</b></div>
            <img src="/product/purchasing.svg" width="1200" height="760" alt="OrderMate purchasing workspace showing purchase orders, incoming stock and replenishment recommendations" decoding="async" loading="lazy" />
            <figcaption><span>03</span><div><strong>Buy before it becomes urgent</strong><p>Connect incoming supply, lead time and operational demand instead of relying on memory and gut feel.</p></div></figcaption>
          </figure>
        </div>
      </section>

      <section className="landing-section workflow-section" aria-labelledby="workflow-title">
        <div className="landing-section-heading compact">
          <p className="landing-kicker"><span aria-hidden="true" /> One connected flow</p>
          <h2 id="workflow-title">From customer order to stock decision — without losing the thread.</h2>
        </div>
        <ol className="workflow-line">
          {workflows.map(item => <li key={item.step}><span>{item.step}</span><div><h3>{item.title}</h3><p>{item.copy}</p></div></li>)}
        </ol>
      </section>

      <section className="landing-section trust-section" id="trust" aria-labelledby="trust-title">
        <div className="trust-copy">
          <p className="landing-kicker"><span aria-hidden="true" /> Serious foundations for a growing business</p>
          <h2 id="trust-title">Control should scale with the team.</h2>
          <p>OrderMate is built as a multi-tenant Cloudflare-native SaaS with clear permission boundaries, isolated business data and an audit trail behind operational mutations.</p>
        </div>
        <div className="trust-grid">
          <article><ShieldCheck size={22} aria-hidden="true" /><strong>Business isolation</strong><p>Operational data lives in a separate tenant datastore instead of sharing one giant table with every customer.</p></article>
          <article><Users size={22} aria-hidden="true" /><strong>Role-aware access</strong><p>Owner, admin, manager, inventory, fulfilment and viewer roles keep capability aligned to responsibility.</p></article>
          <article><ClipboardCheck size={22} aria-hidden="true" /><strong>Auditable work</strong><p>Stock and order mutations follow canonical workflows rather than hidden automation shortcuts.</p></article>
          <article><Warehouse size={22} aria-hidden="true" /><strong>EU data controls</strong><p>Control-plane data and documents use Cloudflare resources configured with EU jurisdiction where supported.</p></article>
        </div>
      </section>

      <section className="landing-cta-section" aria-labelledby="cta-title">
        <div className="cta-orb" aria-hidden="true" />
        <p className="landing-kicker light"><span aria-hidden="true" /> Grow without growing the chaos</p>
        <h2 id="cta-title">Give your operation a system it can <em>grow into.</em></h2>
        <p>Bring stock, orders, purchasing and warehouse execution into one connected workspace built for SMEs.</p>
        <button type="button" className="landing-primary-cta inverted" disabled={busy} onClick={signIn}><GoogleGlyph />{busy ? "Opening Google…" : inviteToken ? "Join Your Workspace" : "Start With Google"}</button>
      </section>
    </main>

    <footer className="landing-footer">
      <div className="landing-brand" translate="no"><span className="landing-brand-mark" aria-hidden="true">OM</span><span><strong>OrderMate</strong><small>Operations, in order.</small></span></div>
      <p>Inventory, purchasing, orders & warehouse operations for growing SMEs.</p>
      <a href="#top">Back to top</a>
    </footer>
  </div>;
}

function GoogleGlyph() {
  return <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.24-.2-1.8H12v3.45h5.52a4.72 4.72 0 0 1-2.05 3.01l-.02.12 2.98 2.31.2.02c1.85-1.7 2.97-4.22 2.97-7.11Z"/><path fill="#34A853" d="M12 22c2.68 0 4.93-.88 6.57-2.4l-3.13-2.43c-.84.57-1.98.97-3.44.97a5.98 5.98 0 0 1-5.66-4.13l-.11.01-3.1 2.4-.04.11A9.92 9.92 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.34 14.01A6.1 6.1 0 0 1 6 12c0-.7.12-1.38.33-2.01v-.12L3.2 7.43l-.1.05A10 10 0 0 0 2 12c0 1.62.39 3.15 1.09 4.52l3.25-2.51Z"/><path fill="#EA4335" d="M12 5.86c1.86 0 3.12.8 3.84 1.47l2.8-2.73C16.92 3 14.68 2 12 2a9.92 9.92 0 0 0-8.91 5.48l3.24 2.51A5.99 5.99 0 0 1 12 5.86Z"/></svg>;
}
