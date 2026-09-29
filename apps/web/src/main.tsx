import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import "./index.css";
import App from "./App.tsx";
import { createQueryClient } from "./lib/query-client";

const root = createRoot(document.getElementById("root")!);
const render = (node: ReactNode) =>
  root.render(<StrictMode>{node}</StrictMode>);

// The preview gallery exists only in `vite dev`; production builds drop it.
if (import.meta.env.DEV && window.location.hash === "#ui-preview") {
  void import("./dev/UiPreview").then(({ UiPreview }) => render(<UiPreview />));
} else {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <App />
    </QueryClientProvider>,
  );
}
