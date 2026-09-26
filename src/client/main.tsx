import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { DEMO_TENANT_ID, enterDemoMode } from "./demo-store";
import "./styles.css";
import "./landing.css";
import "./landing-hardening.css";
import "./brand.css";
import "./demo.css";
import "./flow-plan.css";

function activateDemoDeepLink() {
  const url = new URL(window.location.href);
  if (url.searchParams.get("demo") !== "1") return;

  enterDemoMode();
  window.localStorage.setItem("operating-layer:tenant", DEMO_TENANT_ID);
  url.searchParams.delete("demo");
  const search = url.searchParams.toString();
  window.history.replaceState({}, "", `${url.pathname}${search ? `?${search}` : ""}${url.hash}`);
}

activateDemoDeepLink();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
