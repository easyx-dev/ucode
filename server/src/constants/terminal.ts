/** 终端侧默认值：数量上限、输出缓冲与合批、输出流的连接策略 */

/**
 * 每个工作目录下的终端数上限。终端由用户显式开、显式关，上限只是防手滑：
 * 开满之后新建会被拒（`terminal_limit`），而不是静默杀掉最老的那个。
 */
export const TERMINAL_MAX_PER_CWD = 4;

/**
 * 单个终端保留的可回放输出上限。订阅（含刷新页面后的重订阅）会用这段缓冲把屏幕填回去，
 * 所以它决定「断线期间丢了多少历史」——不是越多越好：每个终端常驻一份，4 个终端就是 1MB 量级。
 */
export const TERMINAL_SCROLLBACK_BYTES = 256 * 1024;

/**
 * 输出合批窗口。PTY 的 onData 分片很碎（一个字符回显也算一片），逐片发帧会把连接与前端渲染压满；
 * 8ms 是「一帧 60fps」的量级，人眼看不出延迟。
 */
export const TERMINAL_OUTPUT_FLUSH_MS = 8;

/**
 * 输出流的判活：到点发 WebSocket ping，上一轮没回 pong 就断开。
 * 判活的权威在服务端——浏览器端拿不到 pong 事件，让服务端决定何时踢更可靠。
 */
export const TERMINAL_PING_INTERVAL_MS = 15_000;

/**
 * 单条连接的发送缓冲上限：超过它说明客户端已经跟不上输出，
 * 直接断开（可重连的那种），由重放收敛，而不是让服务端内存无限堆积。
 */
export const TERMINAL_MAX_BUFFERED_BYTES = 4 * 1024 * 1024;
