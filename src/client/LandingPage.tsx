import { useState } from "react";
import {
  ArrowRight,
  Boxes,
  Check,
  ClipboardCheck,
  ClipboardList,
  PackageCheck,
  PlayCircle,
  ScanBarcode,
  ShieldCheck,
  Sparkles,
  Truck,
  Users,
  Warehouse,
  Zap,
} from "lucide-react";
import { BrandLockup, BrandMark } from "./Brand";

const problemGroups = [
  {
    icon: Boxes,
    title: "You do not trust the stock number until somebody checks it.",
    copy: "Keep on-hand, reserved, available and incoming stock tied to the movements that created it, so the team can act without reconciling a spreadsheet first.",
    tag: "One stock answer",
  },
  {
    icon: ClipboardList,
    title: "Purchasing starts too late.",
    copy: "See stockout risk, incoming supply, lead time and supplier terms while there is still time to choose the right purchase instead of panic-buying after availability becomes a problem.",
    tag: "Buy earlier",
  },
  {
    icon: PackageCheck,
    title: "The urgent customer order looks like every other order.",
    copy: "Bring required-by dates, reservations and priority into the same view so the team protects the promises that matter before routine work consumes the day.",
    tag: "Protect promises",
  },
  {
    icon: ScanBarcode,
    title: "More volume creates more checking, re-keying and warehouse friction.",
    copy: "Give the team clear, scan-ready picking, receiving and counting workflows so growth does not automatically mean more manual handling and avoidable stock errors.",
    tag: "Less repeated handling",
  },
  {
    icon: Users,
    title: "Customer work disappears between the inbox, diary and invoice.",
    copy: "For service teams, keep the customer, request, quote, job, visit, materials, invoice and payment connected instead of rebuilding the story whenever somebody asks for an update.",
    tag: "Keep work joined up",
  },
  {
    icon: Sparkles,
    title: "Managers spend the morning finding problems before fixing them.",
    copy: "Turn late orders, stock risk, overdue supply and receiving exceptions into a short, prioritised flow plan so people can start with the work that needs attention.",
    tag: "Less firefighting",
  },
];

const outcomes = [
  "Open the day knowing what needs action instead of checking five places first",
  "Protect customer deadlines before they become apology emails and urgent calls",
  "Order stock while there is still time to choose, not after the situation becomes expensive",
  "Make the operation less dependent on one person knowing where everything stands",
];

const faqs = [
  {
    question: "What problem does Operating Layer solve?",
    answer: "Operating Layer is for growing SMEs whose operational work has become spread across spreadsheets, inboxes, stock tools and team knowledge. It joins the records behind customer work, stock, purchasing and suppliers so the team can see what needs attention and act earlier.",
  },
  {
    question: "What kinds of businesses is it for?",
    answer: "It is strongest today for product businesses that manage stock, customer orders, suppliers, purchasing and fulfilment, and for service businesses that need CRM, requests, quotes, jobs, visits, materials, invoices and payments. The workspace is modular, so a business only needs to expose the operational areas it actually uses.",
  },
  {
    question: "Can I try it before creating an account?",
    answer: "Yes. The guest demos run locally in your browser and do not need an account. You can choose from ecommerce, retail, electrician, salon, cafe and dropship scenarios, then reset or switch business at any time. Prototype-only steps are labelled rather than presented as finished production functionality.",
  },
  {
    question: "Will it tell us what needs attention?",
    answer: "For stock-owning operations, the Flow Plan continuously checks customer promise dates, forecast stock risk, incoming supplier dates and receiving discrepancies, then prioritises the highest-impact exceptions into a short action list for review.",
  },
  {
    question: "Does automation change stock or orders by itself?",
    answer: "No. Operating Layer can detect, explain, prioritise and prepare work, but business-critical changes still go through explicit, permission-checked and audited workflows. The software can do the checking and preparation while your team keeps authority.",
  },
  {
    question: "Is this a heavyweight ERP?",
    answer: "No. Operating Layer is aimed at growing SMEs that need more operational control than spreadsheets and disconnected point tools provide, without forcing every business into one large all-or-nothing system. Modules can be enabled around the workflows the business actually needs.",
  },
];

type LandingPageProps = {
  inviteToken: string | null;
  onChooseDemo?: () => void;
};

export default function LandingPage({ inviteToken, onChooseDemo }: LandingPageProps) {
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

  const tryDemo = () => {
    if (inviteToken) return void signIn();
    onChooseDemo?.();
  };

  return <div className="landing-page">
    <a className="landing-skip" href="#landing-main">Skip to main content</a>

    <header className="landing-header">
      <a className="landing-brand" href="#top" aria-label="Operating Layer home">
        <BrandLockup />
      </a>
      <nav className="landing-nav" aria-label="Landing page navigation">
        <a href="#platform">Is this you?</a>
        <a href="#product">See it work</a>
        <a href="#automation">How it helps</a>
        <a href="#trust">Trust</a>
      </nav>
      <button type="button" className="landing-nav-cta" disabled={busy} onClick={inviteToken ? signIn : tryDemo}>
        {busy ? "Opening Google…" : inviteToken ? "Accept invite" : "Try a live demo"}
        <ArrowRight size={16} aria-hidden="true" />
      </button>
    </header>

    <main id="landing-main">
      <section className="landing-hero" id="top" aria-labelledby="landing-title">
        <div className="landing-hero-copy">
          {inviteToken && <div className="invite-ribbon" role="status"><Users size={16} aria-hidden="true" /> You’ve been invited to an Operating Layer workspace</div>}
          <div className="brand-chip">Operations software for growing product & service SMEs</div>
          <p className="landing-kicker"><span aria-hidden="true" /> Orders · stock · suppliers · service work — one operational picture</p>
          <h1 id="landing-title">Know what needs attention <em>before it becomes urgent.</em></h1>
          <p className="landing-hero-lede">Operating Layer joins the customer work, stock, purchasing and supplier information your team currently chases across spreadsheets, inboxes and separate tools — then surfaces what needs action next.</p>
          <div className="landing-hero-actions">
            <button type="button" className="landing-primary-cta" disabled={busy} onClick={inviteToken ? signIn : tryDemo}>
              {inviteToken ? <GoogleGlyph /> : <PlayCircle size={18} aria-hidden="true" />}
              {busy ? "Opening Google…" : inviteToken ? "Join your workspace" : "See it with a business like yours"}
            </button>
            <a className="landing-secondary-cta" href="#platform">See if you have outgrown the patchwork <ArrowRight size={16} aria-hidden="true" /></a>
          </div>
          <div className="landing-proof-row" aria-label="Platform highlights">
            <span><Check size={15} aria-hidden="true" /> No-account demos</span>
            <span><Check size={15} aria-hidden="true" /> Use only the operational areas you need</span>
            <span><Check size={15} aria-hidden="true" /> Business-changing actions stay reviewed</span>
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
                <div className="mini-heading"><div><span>TODAY’S FLOW PLAN</span><strong>Good morning.</strong></div><b>What needs attention first.</b></div>
                <div className="mini-metrics">
                  <div><span>Available stock</span><strong>4,286</strong><small>12 locations</small></div>
                  <div><span>Orders to fulfil</span><strong>38</strong><small>7 urgent</small></div>
                  <div><span>Incoming units</span><strong>1,240</strong><small>9 purchase orders</small></div>
                  <div><span>Priority actions</span><strong>6</strong><small>Ranked for the team</small></div>
                </div>
                <div className="mini-panels"><div className="mini-chart"><span>FULFILMENT THIS WEEK</span><div className="chart-bars"><i /><i /><i /><i /><i /><i /><i /></div></div><div className="mini-attention"><span>WHAT NEEDS ACTION</span><b>Protect 2 stock risks</b><b>Chase 1 late PO</b><b>Move 3 priority orders</b></div></div>
              </div>
            </div>
          </div>
          <div className="hero-float hero-float-order"><span><PackageCheck size={17} /> Customer promise</span><strong>Order #1842 should move first</strong><small>Required today · Nottingham</small></div>
          <div className="hero-float hero-float-stock"><span><Warehouse size={17} /> Stock risk</span><strong>Order before Friday</strong><small>12-day cover · supplier lead time included</small></div>
          <div className="hero-float hero-float-auto"><span><Sparkles size={17} /> Today’s priorities</span><strong>6 items need attention</strong><small>Reviewed by your team</small></div>
        </div>
      </section>

      <section className="landing-marquee" aria-label="Problems Operating Layer helps remove"><div><span>Stop chasing stock</span><i>•</i><span>Know what ships first</span><i>•</i><span>Buy before it is urgent</span><i>•</i><span>Catch late suppliers</span><i>•</i><span>Keep customer work joined up</span><i>•</i><span>One shared operational picture</span></div></section>

      <section className="landing-section landing-intro" id="platform" aria-labelledby="platform-title">
        <div className="landing-section-heading">
          <p className="landing-kicker"><span aria-hidden="true" /> When spreadsheets stop scaling</p>
          <h2 id="platform-title">More business should not mean <em>more coordination work.</em></h2>
          <p>When one person knows which supplier is late, another knows what is really in stock, and customer deadlines live somewhere else, growth creates a coordination tax. Operating Layer joins those operational facts so the team can spend less time checking and chasing.</p>
        </div>
        <div className="outcome-grid">{outcomes.map((outcome, index) => <article key={outcome}><span>0{index + 1}</span><p>{outcome}</p></article>)}</div>
      </section>

      <section className="landing-section feature-section" aria-labelledby="problem-title">
        <div className="landing-section-heading compact"><p className="landing-kicker"><span aria-hidden="true" /> Recognise your working day?</p><h2 id="problem-title">If these feel familiar, <em>you have outgrown the patchwork.</em></h2></div>
        <div className="feature-bento">
          {problemGroups.map(({ icon: Icon, title, copy, tag }, index) => <article className={`feature-card feature-card-${index + 1}`} key={title}>
            <div className="feature-icon"><Icon size={20} aria-hidden="true" /></div><span className="feature-tag">{tag}</span><h3>{title}</h3><p>{copy}</p>
            {index === 0 && <div className="feature-stock-visual" aria-hidden="true"><span><b>SKU-1048</b><small>Available now</small></span><strong>214</strong><div><i /><i /><i /></div></div>}
            {index === 3 && <div className="feature-scan-visual" aria-hidden="true"><ScanBarcode size={46} /><span>Scan → verify → move on</span></div>}
            {index === 5 && <div className="feature-ai-visual" aria-hidden="true"><span>Spot risk</span><ArrowRight size={13} /><span>Prioritise</span><ArrowRight size={13} /><strong>Team acts</strong></div>}
          </article>)}
        </div>
      </section>

      <section className="landing-system-band" aria-labelledby="positioning-title">
        <div className="system-band-head"><div><p className="landing-kicker light"><span aria-hidden="true" /> More control without an ERP project</p><h2 id="positioning-title">One place to run the work <em>without buying more complexity.</em></h2></div><p>Operating Layer is modular around the business. A product team can run orders, inventory, purchasing and warehouse work. A service team can run CRM, requests, quotes, jobs, materials, invoices and payments. You do not need to expose parts of the product your business does not use.</p></div>
        <div className="positioning-grid"><article><span>01 / ONE ANSWER</span><h3>Stop reconciling before acting</h3><p>Operational records stay connected so the team can understand the current position and the history behind it without rebuilding the story manually.</p></article><article><span>02 / EARLIER ACTION</span><h3>See the exception while there is still time</h3><p>Deadlines, stock risk, supplier dates and discrepancies can surface before they become a customer, cash-flow or availability problem.</p></article><article><span>03 / RIGHT-SIZED</span><h3>Use the operating pieces you need</h3><p>Modules are enabled around the business rather than forcing every SME through the same heavyweight setup.</p></article></div>
      </section>

      <section className="landing-section product-section" id="product" aria-labelledby="product-title">
        <div className="landing-section-heading"><p className="landing-kicker"><span aria-hidden="true" /> See what changes on Monday morning</p><h2 id="product-title">The next decision should be <em>easier to see.</em></h2><p>Operating Layer is designed to make the work requiring attention obvious, while keeping the underlying operational detail close enough for the people doing the job.</p></div>
        <div className="product-showcase">
          <figure className="product-shot product-shot-wide"><div className="shot-chrome"><span /><span /><span /><b>Overview</b></div><img src="/product/overview.svg" width="1200" height="760" alt="Operating Layer overview showing stock, order, purchasing and attention metrics" decoding="async" loading="lazy" /><figcaption><span>01</span><div><strong>Start with what needs attention</strong><p>Late customer promises, forecast stock risk, supplier delays and receiving exceptions are brought together before the team starts hunting for them.</p></div></figcaption></figure>
          <figure className="product-shot"><div className="shot-chrome"><span /><span /><span /><b>Wave Picking</b></div><img src="/product/wave-picking.svg" width="1200" height="760" alt="Operating Layer warehouse workspace combining repeated SKUs across customer orders" decoding="async" loading="lazy" /><figcaption><span>02</span><div><strong>Get more orders out with less repeated handling</strong><p>Group several orders, scan shared SKUs once and keep the allocation back to each customer clear.</p></div></figcaption></figure>
          <figure className="product-shot"><div className="shot-chrome"><span /><span /><span /><b>Purchasing</b></div><img src="/product/purchasing.svg" width="1200" height="760" alt="Operating Layer purchasing view showing incoming stock and replenishment planning" decoding="async" loading="lazy" /><figcaption><span>03</span><div><strong>Buy while you still have options</strong><p>See how long stock should last, when supply is due and when an order needs placing instead of waiting for a low-stock surprise.</p></div></figcaption></figure>
        </div>
      </section>

      <section className="landing-section automation-section" id="automation" aria-labelledby="automation-title">
        <div className="automation-visual" aria-hidden="true">
          <div className="automation-core"><BrandMark /><strong>Operating Layer</strong><span>today’s flow plan</span></div>
          <div className="automation-node node-a"><PackageCheck size={17} /> Customer deadlines</div><div className="automation-node node-b"><Truck size={17} /> Late supply</div><div className="automation-node node-c"><Boxes size={17} /> Stock risk</div><div className="automation-node node-d"><ClipboardCheck size={17} /> Receiving problems</div>
          <svg viewBox="0 0 600 420" focusable="false"><path d="M130 95C230 110 230 190 300 210M470 92C380 112 385 185 300 210M115 328C210 320 225 245 300 210M485 330C390 322 375 248 300 210" /></svg>
        </div>
        <div className="automation-copy">
          <p className="landing-kicker light"><span aria-hidden="true" /> Less checking. Earlier action.</p><h2 id="automation-title">Let the software find the exception. <em>Let your team make the call.</em></h2><p>For stock-owning teams, Operating Layer can continuously check the operational evidence and turn exceptions into a short, explainable list. That removes repetitive checking without handing business authority to a black box.</p>
          <ul><li><Zap size={18} aria-hidden="true" /><span><strong>Customer deadline at risk?</strong> Bring the order forward before routine work consumes the stock or time it needs.</span></li><li><Zap size={18} aria-hidden="true" /><span><strong>Likely to run out?</strong> Turn demand, incoming supply, lead time and supplier constraints into a buying decision while there is still room to act.</span></li><li><Zap size={18} aria-hidden="true" /><span><strong>Supplier or receipt problem?</strong> Surface it beside the downstream work it could delay instead of leaving it buried in a PO list.</span></li></ul>
          <div className="human-control"><ShieldCheck size={20} aria-hidden="true" /><span><strong>Your team stays in control.</strong> Operating Layer can detect, explain, prioritise and prepare. Stock, fulfilment, purchasing and other business-changing actions still move through explicit reviewed workflows.</span></div>
        </div>
      </section>

      <section className="landing-section trust-section" id="trust" aria-labelledby="trust-title">
        <div className="trust-copy"><p className="landing-kicker"><span aria-hidden="true" /> Built for a business you expect to keep</p><h2 id="trust-title">Simple for the team. <em>Serious underneath.</em></h2><p>The product keeps customer businesses separated, limits actions by role and records important operational changes so growth does not mean losing control of who changed what.</p></div>
        <div className="trust-grid"><article><ShieldCheck size={22} aria-hidden="true" /><strong>Your business stays separate</strong><p>Each customer’s operational data is kept in its own tenant datastore rather than mixed into one shared operational table.</p></article><article><Users size={22} aria-hidden="true" /><strong>People see what they need</strong><p>Roles keep owners, managers, inventory, fulfilment and read-only users aligned to the work they are responsible for.</p></article><article><ClipboardCheck size={22} aria-hidden="true" /><strong>Important changes leave a trail</strong><p>Inventory and order mutations follow controlled workflows with an audit record rather than hidden background shortcuts.</p></article><article><Warehouse size={22} aria-hidden="true" /><strong>EU data controls</strong><p>Core tenant data and documents use Cloudflare resources configured for EU jurisdiction where the platform supports it.</p></article></div>
      </section>

      <section className="seo-faq" id="faq" aria-labelledby="faq-title">
        <div className="landing-section-heading"><p className="landing-kicker"><span aria-hidden="true" /> Is it a fit for us?</p><h2 id="faq-title">The questions worth answering <em>before you spend time evaluating.</em></h2></div>
        <div className="seo-faq-grid">{faqs.map(item => <details key={item.question}><summary>{item.question}</summary><p>{item.answer}</p></details>)}</div>
      </section>

      <section className="landing-cta-section" id="get-started" aria-labelledby="cta-title"><div className="cta-orb" aria-hidden="true" /><p className="landing-kicker light"><span aria-hidden="true" /> No account needed to evaluate it</p><h2 id="cta-title">See how it handles <em>a business like yours.</em></h2><p>Choose the closest demo and follow a realistic workstream. If it removes problems you recognise, create a workspace and shape the operational areas around your business.</p><div className="landing-hero-actions"><button type="button" className="landing-primary-cta inverted" disabled={busy} onClick={inviteToken ? signIn : tryDemo}>{inviteToken ? <GoogleGlyph /> : <PlayCircle size={18} aria-hidden="true" />}{busy ? "Opening Google…" : inviteToken ? "Join your workspace" : "Choose a business demo"}</button>{!inviteToken && <button type="button" className="landing-secondary-cta" disabled={busy} onClick={signIn}><GoogleGlyph />{busy ? "Opening Google…" : "Create a workspace with Google"}</button>}</div></section>
    </main>

    <footer className="landing-footer"><BrandLockup inverse /><p>Operations software for growing SMEs that need customer work, stock and suppliers to stay joined up.</p><a href="#top">Back to top</a></footer>
  </div>;
}

function GoogleGlyph() {
  return <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.24-.2-1.8H12v3.45h5.52a4.72 4.72 0 0 1-2.05 3.01l-.02.12 2.98 2.31.2.02c1.85-1.7 2.97-4.22 2.97-7.11Z"/><path fill="#34A853" d="M12 22c2.68 0 4.93-.88 6.57-2.4l-3.13-2.43c-.84.57-1.98.97-3.44.97a5.98 5.98 0 0 1-5.66-4.13l-.11.01-3.1 2.4-.04.11A9.92 9.92 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.34 14.01A6.1 6.1 0 0 1 6 12c0-.7.12-1.38.33-2.01v-.12L3.2 7.43l-.1.05A10 10 0 0 0 2 12c0 1.62.39 3.15 1.09 4.52l3.25-2.51Z"/><path fill="#EA4335" d="M12 5.86c1.86 0 3.12.8 3.84 1.47l2.8-2.73C16.92 3 14.68 2 12 2a9.92 9.92 0 0 0-8.91 5.48l3.24 2.51A5.99 5.99 0 0 1 12 5.86Z"/></svg>;
}