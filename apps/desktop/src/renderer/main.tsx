/**
 * 桌面渲染层入口：取主进程给的服务地址，装配 client 与 i18n 后渲染。
 *
 * 凭证不出主进程（请求头由主进程注入），这里只拿 `baseUrl`。
 * 未找到服务 / 连不上 / 凭证失效时落到「服务不可用」态，而不是 web 的登录页。
 */
import { createClient, type Translate } from "@ucode/sdk";
import { ThemeProvider } from "@ucode/ui/business/shell/theme-provider";
import { useAuth } from "@ucode/ui/hooks/use-auth";
import { UiProvider } from "@ucode/ui/provider";
import { type ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { DesktopApp } from "./app";
import { BrandHead } from "./components/brand-head";
import {
  ServiceUnavailable,
  type ServiceUnavailableReason,
} from "./components/service-unavailable";
import { WindowDragStrip } from "./components/window-drag-strip";
import "./index.css";
// 副作用引入：在任何组件渲染前完成 i18next 初始化
import i18n from "./lib/i18n";
import { isFramelessWindow } from "./lib/window-chrome";

const container = document.getElementById("root");
// i18n-ignore: 开发者错误，不面向用户
if (!container) throw new Error("#root 不存在");

const root = createRoot(container);
const translate = i18n.t as unknown as Translate;

/**
 * 外壳：品牌元素 + 主题 + 当前内容。
 *
 * 拖拽宿主与窗口控件不在这一层：工作区里由布局挂在侧栏顶部或对话区头部（见 `app.tsx`），
 * 只有「服务不可用」态才由这里渲染一块（见下面 `unavailable`）。
 */
const renderShell = (content: ReactNode): void => {
  root.render(
    <StrictMode>
      <BrandHead />
      <ThemeProvider>{content}</ThemeProvider>
    </StrictMode>,
  );
};

/**
 * 不可用态：没有工作区，没人当拖拽宿主，这里自己铺一块，否则这几颗点同样会点不动。
 * 三条路径（未注册 / 连不上 / 运行期凭证失效）都走这里，少一条就会让那屏既没有窗口控件也拖不动窗口。
 */
const unavailable = (reason: ServiceUnavailableReason, servicePath: string): ReactNode => (
  <>
    {isFramelessWindow() ? <WindowDragStrip /> : null}
    <ServiceUnavailable
      reason={reason}
      servicePath={servicePath}
      onRetry={() => void bootstrap()}
    />
  </>
);

const renderUnavailable = (reason: ServiceUnavailableReason, servicePath: string): void => {
  renderShell(unavailable(reason, servicePath));
};

/**
 * 工作区门禁：运行期 401（服务重启换了 token）会把 auth 置为匿名，
 * 此时回到不可用态，而不是留在工作区持续报错。
 */
function AuthenticatedWorkspace({ servicePath }: { servicePath: string }): ReactNode {
  const auth = useAuth();
  if (auth.status !== "authenticated") return unavailable("unauthorized", servicePath);
  return <DesktopApp />;
}

const bootstrap = async (): Promise<void> => {
  const connection = await window.desktop.connection();
  if (!connection.registered) {
    renderUnavailable("missing", connection.servicePath);
    return;
  }

  // 同源：接口走渲染层自己的来源（开发由 Vite 代理、生产由 `app://` 协议处理器转给服务），
  // 所以不需要知道服务的地址，baseUrl 是空串（相对路径）
  const client = createClient({ baseUrl: "", translate });

  // 先用未认证的 info 探活：`auth.load` 会把网络错误也当成匿名，
  // 单看它会把「服务没起」误报成「凭证无效」
  try {
    await client.apis.info();
  } catch {
    renderUnavailable("unreachable", connection.servicePath);
    return;
  }

  await client.auth.load();
  if (client.auth.getState().status !== "authenticated") {
    renderUnavailable("unauthorized", connection.servicePath);
    return;
  }

  renderShell(
    <UiProvider client={client}>
      <AuthenticatedWorkspace servicePath={connection.servicePath} />
    </UiProvider>,
  );
};

void bootstrap();
