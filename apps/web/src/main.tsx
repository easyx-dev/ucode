import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { BrandHead } from "./components/brand-head";
import { ThemeProvider } from "./components/theme-provider";
import "./index.css";
// 副作用引入：在任何组件渲染前完成 i18next 初始化与 SDK 运行时注入
import "./lib/i18n";
import "./lib/sdk";

const container = document.getElementById("root");
// i18n-ignore: 开发者错误，不面向用户
if (!container) throw new Error("#root 不存在");

createRoot(container).render(
  <StrictMode>
    <BrandHead />
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
