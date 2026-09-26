import { useMemo, useState } from "react";
import { ArrowRight, Check, FlaskConical, RotateCcw, ShieldCheck } from "lucide-react";
import type { OrganizationSummary } from "../../shared/types";
import { getDemoProfile } from "../demo-profiles";
import {
  completedDemoWorkstreamSteps,
  demoWorkstream,
  resetDemoWorkstream,
  setDemoWorkstreamStep,
  type DemoWorkstreamStep,
} from "../demo-workstreams";
import { PageHeader } from "../ui";

type Navigate = (page: string) => void;

export default function DemoWorkstream({ tenant, onNavigate }: { tenant: OrganizationSummary; onNavigate: Navigate }) {
  const profile = getDemoProfile();
  const workstream = demoWorkstream(profile.key);
  const [revision, setRevision] = useState(0);
  const completed = useMemo(() => completedDemoWorkstreamSteps(profile.key), [profile.key, revision]);
  const prototypeCount = workstream.steps.filter(step => step.kind === "vertical_prototype").length;
  const completedPrototypeCount = workstream.steps.filter(step => step.kind === "vertical_prototype" && completed.has(step.id)).length;

  const togglePrototype = (step: DemoWorkstreamStep) => {
    setDemoWorkstreamStep(profile.key, step.id, !completed.has(step.id));
    setRevision(value => value + 1);
  };

  const reset = () => {
    resetDemoWorkstream(profile.key);
    setRevision(value => value + 1);
  };

  return <>
    <PageHeader
      eyebrow={`${profile.name} · demo workstream`}
      title={workstream.headline}
      description={workstream.scenario}
      actions={prototypeCount > 0 ? <button type="button" className="secondary" onClick={reset}><RotateCcw size={15} /> Reset prototype steps</button> : undefined}
    />

    <section className="workstream-trust panel">
      <div><ShieldCheck size={20} /><span><strong>Live core</strong><small>Uses a real Operating Layer module and opens the actual browser-local demo workflow.</small></span></div>
      <div><FlaskConical size={20} /><span><strong>Vertical prototype</strong><small>Research-grounded but not yet a production module. Completing it only changes local demo progress.</small></span></div>
    </section>

    {prototypeCount > 0 && <div className="workstream-progress panel" role="status">
      <span>Prototype scenario progress</span>
      <strong>{completedPrototypeCount} / {prototypeCount}</strong>
      <div><span style={{ width: `${prototypeCount ? completedPrototypeCount / prototypeCount * 100 : 0}%` }} /></div>
    </div>}

    <div className="workstream-flow" aria-label={`${profile.name} operational workstream`}>
      {workstream.steps.map((step, index) => {
        const prototype = step.kind === "vertical_prototype";
        const done = prototype && completed.has(step.id);
        return <article key={step.id} className={`workstream-step panel ${prototype ? "prototype" : "core"} ${done ? "complete" : ""}`}>
          <div className="workstream-step-number">{done ? <Check size={17} /> : index + 1}</div>
          <div className="workstream-step-copy">
            <div className="workstream-step-heading">
              <h3>{step.title}</h3>
              <span className={`workstream-kind ${prototype ? "prototype" : "core"}`}>{prototype ? "Vertical prototype" : "Live core"}</span>
            </div>
            <p>{step.detail}</p>
            <div className="workstream-step-actions">
              {step.target && <button type="button" className="secondary" onClick={() => onNavigate(step.target!)}>{step.targetLabel || "Open module"} <ArrowRight size={14} /></button>}
              {prototype && <button type="button" className={done ? "secondary" : "primary"} onClick={() => togglePrototype(step)}>{done ? "Mark not complete" : "Play this step"}</button>}
            </div>
          </div>
          {index < workstream.steps.length - 1 && <span className="workstream-connector" aria-hidden="true" />}
        </article>;
      })}
    </div>

    <section className="panel workstream-note">
      <strong>Why the distinction matters</strong>
      <p>{tenant.name} is a demo, but the architecture is not pretending every business is a warehouse. Where a workflow maps to a canonical module, this page takes you into it. Where the domain needs a new primitive—such as café recipes/waste or supplier-direct dropship fulfilment—the demo keeps that step explicit until it deserves a production implementation.</p>
    </section>
  </>;
}
