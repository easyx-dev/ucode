/**
 * 一轮生成的生命周期：占位登记、出错标记与收尾顺序。
 *
 * 收尾顺序是硬约束——**先写索引、再释放占位、最后补发摘要**：
 * 索引必须在实例还在池里时写（释放可能触发配置变更回收，之后就取不到会话对象）；
 * 而摘要必须在占位释放之后发，否则最后一帧带着 `running: true` 落地，
 * 客户端只能等到重连或手动刷新才把侧栏的生成态收掉（多客户端也是同样的错法）。
 */
export type RunTrackerDeps = {
  /** 把 pi 会话的列表索引写进库；不改变事件流的可见状态 */
  writeIndex: (sessionId: string) => void;
  /** 占位释放后的收尾（配置变更留下的脏实例在这里兜底回收） */
  onReleased: (sessionId: string) => void;
  /** 补发一帧权威摘要，让所有客户端看到收尾后的状态 */
  emitSummary: (sessionId: string) => void;
};

export class RunTracker {
  private readonly running = new Set<string>();
  /** 本轮以错误结束且尚未开始新一轮的会话 */
  private readonly errored = new Set<string>();

  constructor(private readonly deps: RunTrackerDeps) {}

  /** 同步占位：返回 true 表示本次调用负责开启这一轮，false 表示已有 run 在跑 */
  begin(sessionId: string): boolean {
    if (this.running.has(sessionId)) return false;
    this.running.add(sessionId);
    // 新一轮把上一轮的出错标记清掉：状态跟着当前这一轮走
    this.errored.delete(sessionId);
    return true;
  }

  isRunning(sessionId: string): boolean {
    return this.running.has(sessionId);
  }

  /** 标记本轮以错误结束；由错误回传处调用，开始新一轮时清除 */
  fail(sessionId: string): void {
    this.errored.add(sessionId);
  }

  isErrored(sessionId: string): boolean {
    return this.errored.has(sessionId);
  }

  /** 收尾：写索引 → 释放占位（顺带回收脏实例）→ 补发摘要 */
  finish(sessionId: string): void {
    this.deps.writeIndex(sessionId);
    this.running.delete(sessionId);
    this.deps.onReleased(sessionId);
    this.deps.emitSummary(sessionId);
  }

  /** 会话被回收 / 删除时清理，避免状态留在内存里 */
  forget(sessionId: string): void {
    this.running.delete(sessionId);
    this.errored.delete(sessionId);
  }
}
