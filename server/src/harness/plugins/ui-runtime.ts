/**
 * 宿主运行时的浏览器侧 shim：插件模块只能从这三个名字取能力，由服务端托管后在托管时改写成它们。
 *
 * 为什么是字符串常量而不是 `.js` 文件：这些内容**不在本进程执行**，只是发给浏览器的 ESM 源码；
 * 本服务最终被 esbuild 打成单文件，磁盘上的独立 `.js` 不会随产物走，写成字符串才能保证四种形态
 * （源码运行 / 打包产物 / 桌面端 / 中继前缀）都能取到同一份。
 *
 * 三个名字的分工：
 * - `@ucode/plugin-api`：宿主 API 本体（React 实例、UI 原语、只读 store、白名单动作、i18n、http、event）
 * - `react` / `react/jsx-runtime`：让作者能写正常的 JSX 与 hooks，并且**共用宿主那一份 React**
 *   （插件自带的 React 会让 hooks 立刻报「Invalid hook call」）
 */

import { brand } from "@ucode/brand/values";

/**
 * 全局安装点：宿主在加载任何插件模块之前写入。
 * 键名由品牌 slug 派生，与宿主（`packages/ui` 的 `plugin-api`）各算一遍同一个字符串。
 */
export const PLUGIN_HOST_GLOBAL = `__${brand.slug.toUpperCase()}_PLUGIN_HOST__`;

/** 暴露给插件的 React 成员：够写组件与 hooks，避免把整个命名空间当 API 承诺出去 */
const REACT_EXPORTS = [
  "Children",
  "Component",
  "Fragment",
  "PureComponent",
  "StrictMode",
  "Suspense",
  "cloneElement",
  "createContext",
  "createElement",
  "createRef",
  "forwardRef",
  "isValidElement",
  "lazy",
  "memo",
  "startTransition",
  "use",
  "useCallback",
  "useContext",
  "useDeferredValue",
  "useEffect",
  "useId",
  "useImperativeHandle",
  "useInsertionEffect",
  "useLayoutEffect",
  "useMemo",
  "useOptimistic",
  "useReducer",
  "useRef",
  "useState",
  "useSyncExternalStore",
  "useTransition",
  "version",
] as const;

/** shim 的公共头：取全局运行时（局部名不叫 `host`，它与下面导出的 `host` 会撞名） */
const hostOf = (): string =>
  `const runtime = globalThis.${PLUGIN_HOST_GLOBAL};\n` +
  `if (!runtime) throw new Error("插件宿主未就绪：插件模块必须在宿主装配之后加载");\n`;

/** 插件 API 本体：只做转发，逻辑全在宿主里 */
const PLUGIN_API_SHIM = `/** 由宿主在托管时生成：插件模块从这里取宿主能力，不要直接依赖宿主内部模块 */
${hostOf()}
export const version = runtime.version;
export const react = runtime.react;
export const ui = runtime.ui;
export const hooks = runtime.hooks;
export const actions = runtime.actions;
export const http = runtime.http;
export const events = runtime.events;
export const i18n = runtime.i18n;
/** 整份运行时；default 导出与它同一个对象 */
export const host = runtime;
export default runtime;
`;

/** `react` 的转发：成员逐项列出，未列出的成员不承诺可用 */
const REACT_SHIM = `/** 由宿主在托管时生成：转发宿主那一份 React（插件不自带 React） */
${hostOf()}
export default runtime.react;
${REACT_EXPORTS.map((name) => `export const ${name} = runtime.react.${name};`).join("\n")}
`;

/** `react-dom` 的转发：插件组件里会用到 portal（浮窗、下拉） */
const REACT_DOM_SHIM = `/** 由宿主在托管时生成：转发宿主的 ReactDOM 入口 */
${hostOf()}
export const createPortal = runtime.reactDom.createPortal;
export const flushSync = runtime.reactDom.flushSync;
`;

/** `react/jsx-runtime` 的转发：JSX 编译产物只用到这几个导出 */
const JSX_RUNTIME_SHIM = `/** 由宿主在托管时生成：转发宿主的 JSX runtime */
${hostOf()}
export const Fragment = runtime.jsxRuntime.Fragment;
export const jsx = runtime.jsxRuntime.jsx;
export const jsxs = runtime.jsxRuntime.jsxs;
export const jsxDEV = runtime.jsxRuntime.jsxDEV;
`;

/**
 * 插件模块里的 bare specifier → shim 文件。
 * 托管时把右侧的 `import … from "<specifier>"` 改写成指向 shim 的绝对路径，其余源码原样发出。
 */
export const PLUGIN_RUNTIME_SPECIFIERS: Record<string, string> = {
  "@ucode/plugin-api": "plugin-api.js",
  react: "react.js",
  "react-dom": "react-dom.js",
  "react/jsx-runtime": "jsx-runtime.js",
};

/** 按 shim 文件名取源码；不认识的名字返回 null（路由据此回 404） */
export const pluginRuntimeShim = (name: string): string | null => {
  if (name === "plugin-api.js") return PLUGIN_API_SHIM;
  if (name === "react.js") return REACT_SHIM;
  if (name === "react-dom.js") return REACT_DOM_SHIM;
  if (name === "jsx-runtime.js") return JSX_RUNTIME_SHIM;
  return null;
};

export const PLUGIN_RUNTIME_SHIM_NAMES = [
  "plugin-api.js",
  "react.js",
  "react-dom.js",
  "jsx-runtime.js",
] as const;
