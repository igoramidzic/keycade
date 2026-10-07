import "@keycade/ui/styles.css";
import { DemoKitProvider } from "@keycade/ui/components/demo-kit";
import { captureConfirmation } from "@keycade/ui/components/identity-portal";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { BorrowerApp } from "./app";

const root = document.getElementById("root");
if (!root) throw new Error("Root element is missing.");
const confirmation = captureConfirmation();
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <DemoKitProvider>
          <BorrowerApp confirmation={confirmation} />
        </DemoKitProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
