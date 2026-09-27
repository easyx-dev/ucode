import {
  createAgentSession,
  DefaultResourceLoader,
  type ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

/**
 * 目标完成度的**每轮校验**（F-1.6）。
 *
 * 用一个**独立的一次性会话来判定**，而不是问正在干活的 agent"你做完了吗"——
 * 干活的 agent 有把"看起来差不多了"说成"完成了"的倾向；换一个只读目标与最近进展的判定者，
 * 结果更可信。判定失败（模型不可用/答非所问）保守地当作"未完成"，让自动续跑继续。
 */

export type VerifyOptions = {
  objective: string;
  /** 最近一轮的助手输出（判定依据）。 */
  latest: string;
  cwd: string;
  dataDir: string;
  modelRuntime: ModelRuntime;
};

export async function verifyGoalCompletion(options: VerifyOptions): Promise<boolean> {
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  try {
    const loader = new DefaultResourceLoader({ cwd: options.cwd, agentDir: options.dataDir });
    await loader.reload();
    const available = await options.modelRuntime.getAvailable();
    const model = available[0];
    const created = await createAgentSession({
      cwd: options.cwd,
      agentDir: options.dataDir,
      modelRuntime: options.modelRuntime,
      ...(model === undefined ? {} : { model }),
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(options.cwd),
    });
    session = created.session;
    await session.prompt(
      [
        "你在判定一个持久目标是否已经完成。只依据下面给出的信息判断，不要臆测。",
        "",
        `目标：${options.objective}`,
        "",
        "最近一轮的进展：",
        options.latest.slice(0, 4000),
        "",
        "如果目标已**确实完成**，只回答 YES；否则只回答 NO。不要输出别的字。",
      ].join("\n"),
    );
    const reply = (session.getLastAssistantText() ?? "").trim();
    return /^YES\b|^YES$/iu.test(reply) || reply.toUpperCase().startsWith("YES");
  } catch {
    return false; // 保守：判定不了就当作未完成
  } finally {
    session?.dispose();
  }
}
