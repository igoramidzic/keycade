import "@keycade/ui/styles.css";
import { captureConfirmation } from "@keycade/ui/components/identity-portal";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { BankApp } from "./app";

const root = document.getElementById("root");
if (!root) throw new Error("Root element is missing.");
const confirmation = captureConfirmation();

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <BankApp confirmation={confirmation} />
    </BrowserRouter>
  </StrictMode>,
);
