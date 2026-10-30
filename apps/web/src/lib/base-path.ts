/**
 * 页面的挂载前缀：直连服务时是空串，挂在路径前缀下（中继的 `/d/<设备 id>`）时是那段前缀。
 *
 * 唯一事实源是文档里的 `<base href>`——服务端按访问方式改写它，前端不另设配置项。
 * 接口前缀、WebSocket 前缀与站内跳转都必须跟着它走，否则请求会落到宿主（中继）自己的根路径上。
 */
const stripTrailingSlash = (path: string): string => (path === "/" ? "" : path.replace(/\/+$/, ""));

export const appBasePath = (): string => stripTrailingSlash(new URL(document.baseURI).pathname);

/** 拼上挂载前缀的站内路径：`withAppBasePath("/login")` → `/d/<设备 id>/login` */
export const withAppBasePath = (path: string): string => `${appBasePath()}${path}`;
