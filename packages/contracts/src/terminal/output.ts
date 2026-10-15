/**
 * terminal 域的响应模型。
 *
 * 输出流不是 HTTP 流而是 WebSocket 升级端点（`GET /api/v1/terminal/stream`），
 * 它的帧约定不套封套、也不进本文件的类型系统：
 *
 * - **下行**：二进制帧 = PTY 输出的原始字节（交给终端模拟器写屏）；没有文本消息——
 *   客户端的 WS 管道由 `@xterm/addon-attach` 承担，它会把任何文本消息也写进屏幕。
 * - **上行**：文本帧 = 用户输入原文（含控制序列），直接写进 PTY。
 * - **控制**：连接就绪即 `open`；进程结束时服务端发完输出后 `close(TERMINAL_CLOSE_EXIT, "exit:<code>")`；
 *   票据无效 `close(TERMINAL_CLOSE_UNAUTHORIZED)`、终端不存在 `close(TERMINAL_CLOSE_NOT_FOUND)`、
 *   客户端跟不上输出 `close(TERMINAL_CLOSE_OVERFLOW)`（见 `constants.ts`）。
 */

/**
 * 一个终端进程的视图。终端只活在服务进程内存里：不落库、不进会话记录，
 * 服务重启即消失（见「终端」一节的边界）。
 */
export type TerminalInfo = {
  /** 终端 id（进程内唯一） */
  id: string;
  /**
   * 该终端在所属目录里的创建序号（从 1 起，**不随关闭回收**）。
   * 界面用它给用户区分多个终端：按列表下标编号会在关掉中间一个时整体前移。
   */
  sequence: number;
  /** 工作目录绝对路径；终端按它归口，同目录的会话共用同一批终端 */
  cwd: string;
  /** 服务端用的 shell 可执行文件 */
  shell: string;
  cols: number;
  rows: number;
  /** 是否仍在运行；已退出时为 false，`exitCode` 随之有值 */
  running: boolean;
  /** 进程 id */
  pid: number;
  /** 退出码；仍在运行时为 null */
  exitCode: number | null;
  createdAt: string;
};

export type TerminalCreateResponse = TerminalInfo;

export type TerminalListResponse = {
  /** 该工作目录下的终端，按创建时间先后 */
  terminals: TerminalInfo[];
};

export type TerminalResizeResponse = {
  /** 实际生效的尺寸（服务端按取值域夹取后） */
  cols: number;
  rows: number;
};

export type TerminalCloseResponse = {
  /** 是否真的关掉了：终端不存在或已结束时为 false */
  closed: boolean;
};

/** 输出流的握手票：短时、单次、绑定终端；放进 WebSocket URL 的 `ticket` 查询参数 */
export type TerminalTicketResponse = {
  ticket: string;
  /** 过期时间（ISO）；客户端不必用，留给排障 */
  expiresAt: string;
};
