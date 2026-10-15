/**
 * CDP 转发：把服务端发来的命令转给对应的 webview guest，把结果与事件转回去。
 *
 * 只认**本应用自己创建的浏览器标签**（`allowed` 集合由 `did-attach-webview` 填）：否则服务端一句
 * `webContentsId` 就能驱动我们的界面本身（它也是 webContents），那是把应用自己交出去。
 *
 * 抽成不依赖 electron 的一层是为了能单测：这里的判断（认不认这个 id、要不要挂 debugger、错误怎么回）
 * 出错的代价是「agent 驱动了错误的页面」或「静默失效」，比崩掉更难发现。
 */

/** 用得到的那几个 webContents 成员（`webContents.fromId` 的结果就是它） */
export type GuestHandle = {
  id: number;
  isDestroyed: () => boolean;
  debugger: {
    isAttached: () => boolean;
    attach: (protocolVersion: string) => void;
    /** 监听登记在 debugger 实例上，attach / detach 不会把它摘掉，所以只挂一次（见 `attach`） */
    on: (
      event: "message",
      listener: (event: unknown, method: string, params: object, sessionId?: string) => void,
    ) => void;
    sendCommand: (method: string, params?: object) => Promise<unknown>;
  };
};

export type CdpCommandFrame = {
  id: number;
  webContentsId: number;
  method: string;
  params?: object;
};

export type CdpResultFrame =
  | { type: "cdp-result"; id: number; result: unknown }
  | { type: "cdp-result"; id: number; error: { message: string } };

export type CdpEventFrame = {
  type: "cdp-event";
  webContentsId: number;
  method: string;
  params: object;
  sessionId?: string;
};

export type CdpForwarder = {
  /** 这条 webContents 是不是本应用创建的浏览器标签 */
  register: (id: number) => void;
  unregister: (id: number) => void;
  /** 处理一条命令：结果与错误都以 `cdp-result` 回给服务端 */
  handle: (frame: CdpCommandFrame) => Promise<void>;
};

export const createCdpForwarder = (deps: {
  /** 按 id 找 webContents（生产是 `webContents.fromId`） */
  lookup: (id: number) => GuestHandle | undefined;
  /** 把一帧发回服务端 */
  send: (frame: CdpResultFrame | CdpEventFrame) => void;
}): CdpForwarder => {
  const allowed = new Set<number>();
  /** 已经挂上事件监听的：一个 webContents 只挂一次（挂没挂 debugger 另说，见 `attach`） */
  const wired = new Set<number>();

  /*
    「挂上 debugger」与「事件监听挂上了没有」是两件事，别用 `isAttached()` 短路：
    它只说明 debugger 挂着（可能是别的客户端挂的，也可能是我们上一轮挂的），而 `message` 没注册上
    就等于导航类事件全丢——编号表不再失效，而且因为以为「挂过了」也不会再补。
    反过来，监听是登记在 debugger 实例上的、attach / detach 不会摘掉它，所以只能挂一次：
    重新 attach 后再挂一次会让每条事件转发两遍。
  */
  const attach = (guest: GuestHandle): void => {
    if (!guest.debugger.isAttached()) guest.debugger.attach("1.3");
    if (wired.has(guest.id)) return;
    wired.add(guest.id);
    // 事件按 webContents 转上去：我们的动作语义只用到导航类事件，但过滤放在服务端（这边不认识语义）
    guest.debugger.on("message", (_event, method, params, sessionId) => {
      deps.send({
        type: "cdp-event",
        webContentsId: guest.id,
        method,
        params,
        ...(sessionId === undefined ? {} : { sessionId }),
      });
    });
  };

  return {
    register: (id) => allowed.add(id),
    unregister: (id) => {
      allowed.delete(id);
      wired.delete(id);
    },

    async handle(frame) {
      const reply = (payload: { result: unknown } | { error: { message: string } }) =>
        deps.send({ type: "cdp-result", id: frame.id, ...payload });

      if (!allowed.has(frame.webContentsId)) {
        reply({
          error: { message: `webContents ${frame.webContentsId} 不是本应用创建的浏览器标签` },
        });
        return;
      }
      const guest = deps.lookup(frame.webContentsId);
      if (!guest || guest.isDestroyed()) {
        reply({ error: { message: "目标浏览器标签已经关掉了" } });
        return;
      }
      try {
        attach(guest);
        const result = await guest.debugger.sendCommand(
          frame.method,
          frame.params === undefined ? {} : frame.params,
        );
        reply({ result });
      } catch (error) {
        // 失败也要回话：服务端那边等着这条结果，不回就是让它干等到超时
        reply({ error: { message: error instanceof Error ? error.message : String(error) } });
      }
    },
  };
};
