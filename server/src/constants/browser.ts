/** 浏览器工具集的固定值与上限：探测、实例生命周期、快照与动作的默认值集中在这里 */
import { brand } from "@ucode/brand/values";
/** 启动（或连接）浏览器与首次导航的上限 */
export const BROWSER_LAUNCH_TIMEOUT_MS = 30_000;

/** 单个动作的上限；不做自动等待，超时即失败（理由见 `plans/browser-tools.md` 3.2） */
export const BROWSER_ACTION_TIMEOUT_MS = 10_000;

/** 页面加载上限 */
export const BROWSER_NAVIGATION_TIMEOUT_MS = 30_000;

/** 一份 profile 空闲多久自动关实例 */
export const BROWSER_IDLE_TTL_MS = 10 * 60 * 1000;

/** 同时运行的浏览器实例上限 */
export const BROWSER_MAX_SESSIONS = 3;

/** 一份快照交给模型的字符上限，超过即截断并在结果里说明 */
export const BROWSER_SNAPSHOT_MAX_CHARS = 12_000;

/** 一份快照最多编号多少个元素 */
export const BROWSER_SNAPSHOT_MAX_ELEMENTS = 400;

/** 可访问名的截断长度：够区分同页同类元素，又不至于把整段正文塞进快照 */
export const BROWSER_NAME_MAX_CHARS = 80;

/** ref 的哈希后缀长度（base36 字符数）；4 位在几百个元素的页面里足够避开碰撞 */
export const BROWSER_REF_LENGTH = 4;

/** 缺省 profile 名：工具入参没给时用它（此时是临时目录，不落盘） */
export const BROWSER_DEFAULT_PROFILE = "default";

/** profile 名规则：单段、小写字母或数字开头，长度受限（拼接目录前必须先校验） */
export const BROWSER_PROFILE_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** 持久化 profile 的份数上限，防设置页被垃圾目录塞满 */
export const BROWSER_MAX_PROFILES = 10;

/** 单份 profile 的占用上限：超过就不再精确统计，并在新建时提醒清理 */
export const BROWSER_PROFILE_MAX_BYTES = 2 * 1024 * 1024 * 1024;

/** 统计 profile 占用时最多遍历多少个文件，超过就只给下界（照 `PLUGIN_HASH_MAX_*` 的先例） */
export const BROWSER_PROFILE_SCAN_MAX_FILES = 20_000;

/** 受管实例的视口：只影响渲染与截图尺寸，不模拟移动端 */
export const BROWSER_VIEWPORT = { width: 1280, height: 800 } as const;

/** 探测失败时最多列出几条试过的路径，避免错误文案淹没上下文 */
export const BROWSER_DETECT_TRIED_MAX = 6;

/** 元素 ref 落在 DOM 上的属性名：解析 ref 靠它，导航后随 DOM 一起失效（前缀随品牌走，避免与站点的属性撞名） */
export const BROWSER_REF_ATTRIBUTE = `data-${brand.slug}-ref`;

/** 快照当次用的临时序号属性：Node 侧据此把算好的 ref 写回对应元素 */
export const BROWSER_INDEX_ATTRIBUTE = `data-${brand.slug}-idx`;

/** 截图的 jpeg 画质：够看清布局与文本，又不至于把上下文塞满 */
export const BROWSER_SCREENSHOT_QUALITY = 60;

/**
 * 桌面端浏览器通道的判活间隔：到点发 WebSocket ping，上一轮没回 pong 就断开（与终端同档）。
 * 通道代表「有没有可驱动的桌面浏览器」，半死连接比断开更糟——状态会一直显示「接着」。
 */
export const BROWSER_DESKTOP_PING_INTERVAL_MS = 15_000;
