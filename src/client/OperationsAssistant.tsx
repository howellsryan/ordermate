import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ArrowRight, Bot, Send, Sparkles } from "lucide-react";
import type { OperationsAssistantResponse } from "../shared/operations-assistant";
import type { OrganizationSummary } from "../shared/types";
import { tenantOpsApi } from "./api";
import type { SearchResult } from "./model";
import { ErrorText } from "./ui";

const prompts = [
  "What am I most likely to run out of?",
  "Which orders need attention first?",
  "What should I know about incoming supply?",
];

export default function OperationsAssistant({ tenant, onNavigate }: { tenant: OrganizationSummary; onNavigate: (page: SearchResult["page"]) => void }) {
  const [question, setQuestion] = useState("");
  const mutation = useMutation({
    mutationFn: (value: string) => tenantOpsApi<OperationsAssistantResponse>(tenant.id, "/assistant", {
      method: "POST",
      body: JSON.stringify({ question: value }),
    }),
  });

  const ask = (value = question) => {
    const trimmed = value.trim();
    if (!trimmed || mutation.isPending) return;
    setQuestion(trimmed);
    mutation.mutate(trimmed);
  };

  const response = mutation.data;
  return <section className="panel operations-assistant">
    <div className="panel-heading">
      <div><p className="eyebrow">Ask Operating Layer</p><h3>Read-only operations copilot</h3></div>
      <Bot size={21} />
    </div>
    <p>Ask about stock risk, fulfilment or incoming supply. The copilot only receives data your role can already read and never gets a mutation path.</p>

    <div className="assistant-prompts">{prompts.map(prompt => <button type="button" key={prompt} disabled={mutation.isPending} onClick={() => ask(prompt)}>{prompt}</button>)}</div>
    <form className="assistant-input" onSubmit={event => { event.preventDefault(); ask(); }}>
      <input maxLength={500} value={question} onChange={event => setQuestion(event.target.value)} placeholder="e.g. What should purchasing focus on this week?" aria-label="Ask Operating Layer" />
      <button type="submit" className="primary" disabled={!question.trim() || mutation.isPending}>{mutation.isPending ? <Sparkles size={15} /> : <Send size={15} />} {mutation.isPending ? "Analysing" : "Ask"}</button>
    </form>
    {mutation.error && <ErrorText error={mutation.error} />}

    {response && <div className="assistant-answer" aria-live="polite">
      <div className="assistant-answer-head"><span className={`assistant-mode assistant-${response.mode}`}>{response.mode === "ai" ? "AI enhanced" : response.mode === "demo" ? "Demo · local" : "Deterministic"}</span><small>Read only · evidence first</small></div>
      <strong>{response.answer}</strong>
      {!!response.facts.length && <div className="assistant-evidence"><span>Evidence used</span><ul>{response.facts.map((fact, index) => <li key={index}>{fact}</li>)}</ul></div>}
      {!!response.recommendedPages.length && <div className="assistant-links">{response.recommendedPages.map(item => <button key={`${item.page}:${item.label}`} type="button" onClick={() => onNavigate(item.page as SearchResult["page"])}>{item.label}<ArrowRight size={13} /></button>)}</div>}
    </div>}
  </section>;
}
