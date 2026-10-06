/** 配置变更后的内存会话回收计划：区分「现在就能丢」与「要等这一轮跑完」。 */
export type RecyclePlan = {
  /** 立即回收：下次访问按新配置重建 */
  dispose: string[];
  /** 标为待回收：正在生成 / 压缩的实例等这一轮落定 */
  markStale: string[];
};

/** 活跃与否由调用方判断（占位中的 run 与流式输出都算活跃） */
export const planRecycle = (sessions: readonly { id: string; active: boolean }[]): RecyclePlan => {
  const plan: RecyclePlan = { dispose: [], markStale: [] };
  for (const session of sessions) {
    if (session.active) plan.markStale.push(session.id);
    else plan.dispose.push(session.id);
  }
  return plan;
};
