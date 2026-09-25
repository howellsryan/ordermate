import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "./styles.css";
import "./operations.css";
import "./operational-polish.css";
import "./document-inbox.css";
import "./document-proposals.css";
import "./record-details.css";
import "./inventory-history.css";
import "./product-edit.css";
import "./confirmations.css";
import "./supply-planning.css";
import "./maintenance.css";
import "./warehouse.css";
import "./delivery-notes.css";
import "./camera-scanner.css";

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
