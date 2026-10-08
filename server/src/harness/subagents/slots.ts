/**
 * 子智能体的并发占位：满了就排队等空位，而不是立刻报错。
 *
 * 一条回复里同时派多个子智能体的场景很常见（实测一次派 6 个，其中 2 个直接撞到并发上限白跑一步），
 * 而它们本质上是「等价的一批活」，排队等一等比让模型重试更划算。队列本身有上限，
 * 排不下就明确告诉模型把批次拆小，而不是无限期挂着。
 */
export type SubagentSlot = {
  release: () => void;
};

export class SubagentSlots {
  private active = 0;
  private readonly waiting: Array<{
    resolve: (slot: SubagentSlot) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
    onAbort?: () => void;
    signal?: AbortSignal;
  }> = [];

  constructor(
    private readonly limit: number,
    private readonly queueMax: number,
    private readonly waitMs: number,
  ) {}

  /** 当前占位中的数量（含已交接给排队者的） */
  get running(): number {
    return this.active;
  }

  async acquire(signal?: AbortSignal): Promise<SubagentSlot> {
    if (this.active < this.limit) {
      this.active += 1;
      return this.slot();
    }
    if (this.waiting.length >= this.queueMax) {
      throw new Error(
        `同时运行的子智能体已达上限（${this.limit}），排队也满了；请少派几个，或等其中一个完成后再派。`,
      );
    }
    return new Promise<SubagentSlot>((resolve, reject) => {
      const waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.drop(waiter);
          reject(
            new Error(
              `等待空位超过 ${Math.round(this.waitMs / 60_000)} 分钟仍未轮到；请把这一批拆小后重试。`,
            ),
          );
        }, this.waitMs),
        signal,
        onAbort: undefined as (() => void) | undefined,
      };
      waiter.timer.unref?.();
      if (signal) {
        waiter.onAbort = () => {
          this.drop(waiter);
          reject(new Error("子智能体已中止。"));
        };
        if (signal.aborted) {
          waiter.onAbort();
          return;
        }
        signal.addEventListener("abort", waiter.onAbort, { once: true });
      }
      this.waiting.push(waiter);
    });
  }

  /** 把占位交给下一个排队者；没人排才真正释放 */
  private handover(): void {
    const next = this.waiting.shift();
    if (!next) {
      this.active -= 1;
      return;
    }
    clearTimeout(next.timer);
    if (next.onAbort && next.signal) next.signal.removeEventListener("abort", next.onAbort);
    next.resolve(this.slot());
  }

  private slot(): SubagentSlot {
    let used = false;
    return {
      release: () => {
        if (used) return;
        used = true;
        this.handover();
      },
    };
  }

  private drop(waiter: (typeof this.waiting)[number]): void {
    const index = this.waiting.indexOf(waiter);
    if (index >= 0) this.waiting.splice(index, 1);
    clearTimeout(waiter.timer);
    if (waiter.onAbort && waiter.signal) waiter.signal.removeEventListener("abort", waiter.onAbort);
  }
}
