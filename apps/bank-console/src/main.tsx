import "@keycade/ui/styles.css";
import { FoundationShell } from "@keycade/ui/components/foundation-shell";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

const root = document.getElementById("root");
if (!root) throw new Error("Root element is missing.");

createRoot(root).render(
  <StrictMode>
    <FoundationShell app="bank-console" />
  </StrictMode>,
);
