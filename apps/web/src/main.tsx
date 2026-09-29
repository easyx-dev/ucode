import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { BrandHead } from "./components/brand-head";
import { ThemeProvider } from "./components/theme-provider";
import "./index.css";

const container = document.getElementById("root");
if (!container) throw new Error("#root 不存在");

createRoot(container).render(
  <StrictMode>
    <BrandHead />
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
