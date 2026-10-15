/**
 * 桌面端浏览器通道：桌面端把「工作台里开了哪些浏览器标签、当前在看哪一个」报给服务端，
 * 服务端据此决定 agent 驱动哪一个（画面由桌面端自己的 webview 承载，见 docs/browser.md）。
 *
 * 通道是 WebSocket（`GET /api/v1/browser/desktop`），鉴权照终端那套：先带凭证换一张一次性握手票，
 * 再把票放进握手 query。桌面端接上才存在「可驱动的桌面浏览器」，断开即清空状态。
 */
import { z } from "zod";

/**
 * 通道被新连接顶掉时的关闭码：同一个桌面端多开时只有最新那条有效（旧连接留着会两边抢着改状态）。
 * 收到它的那一端不再重连，等下一次用户操作（标签变化）再试——那时多半已经轮到自己了。
 */
export const DESKTOP_CHANNEL_CLOSE_REPLACED = 4409;

/**
 * 一个浏览器标签的当前状态。
 *
 * `webContentsId` 是 Electron 侧的 webContents id，服务端把它当驱动句柄（它不解析页面，只负责转发命令）；
 * 标签刚建、guest 还没挂上时为 null。
 */
export const desktopBrowserTabSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  url: z.string(),
  webContentsId: z.number().int().nullable(),
  /** 用户当前看的是这一个 */
  active: z.boolean(),
});

export type DesktopBrowserTab = z.infer<typeof desktopBrowserTabSchema>;

/** 一条 CDP 命令的结果：成功给 result，失败给 error（两边都不套封套，通道不是 HTTP） */
export const desktopCdpResultSchema = z.object({
  type: z.literal("cdp-result"),
  id: z.number().int(),
  result: z.unknown().optional(),
  error: z.object({ message: z.string() }).optional(),
});

/** 桌面端把目标 webContents 的 CDP 事件转上来（我们的动作语义只用到导航类事件） */
export const desktopCdpEventSchema = z.object({
  type: z.literal("cdp-event"),
  webContentsId: z.number().int(),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});

/** 桌面端 → 服务端的通道消息（上行） */
export const desktopChannelMessageSchema = z.discriminatedUnion("type", [
  /** 标签集合与激活项：有变更就整份重发（标签不多，整份最简单也最不容易错位） */
  z.object({ type: z.literal("tabs"), tabs: z.array(desktopBrowserTabSchema).max(64) }),
  desktopCdpResultSchema,
  desktopCdpEventSchema,
]);

export type DesktopChannelMessage = z.infer<typeof desktopChannelMessageSchema>;

/**
 * 服务端 → 桌面端的通道消息（下行）：一条 CDP 命令；`webContentsId` 指定发给哪个 webContents
 * （桌面端只认自己创建的 webview guest，见 apps/desktop 的转发实现）。
 */
export const desktopCdpCommandSchema = z.object({
  type: z.literal("cdp"),
  id: z.number().int(),
  webContentsId: z.number().int(),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});

export type DesktopCdpCommand = z.infer<typeof desktopCdpCommandSchema>;

/** 通道的当前状态：排障、冒烟与「有没有可驱动的桌面浏览器」都看它 */
export type DesktopChannelState = {
  /** 桌面端是否接着（接上但还没报过标签也算接上） */
  connected: boolean;
  tabs: DesktopBrowserTab[];
};

/** 一次性握手票（`POST /api/v1/browser/desktop/ticket`） */
export type DesktopTicketResponse = {
  ticket: string;
  expiresAt: string;
};
