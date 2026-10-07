import "@keycade/ui/styles.css";
import { FoundationShell } from "@keycade/ui/components/foundation-shell";
import { captureConfirmation } from "@keycade/ui/components/identity-portal";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

const root = document.getElementById("root");
if (!root) throw new Error("Root element is missing.");
const confirmation = captureConfirmation();

createRoot(root).render(
  <StrictMode>
    <FoundationShell app="borrower" confirmation={confirmation} />
  </StrictMode>,
);
