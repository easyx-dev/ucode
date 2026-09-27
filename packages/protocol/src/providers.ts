/**
 * 供应商与模型配置的**线上形状**（F-5.3）。
 *
 * 这一层解决的是"控制层能不能配模型"这个问题：在此之前只有 CLI 的 `provider add`
 * 写得进配置，Web/桌面壳即使有模型选择器也只能在**已经配好的**模型里挑——
 * 全新用户打开界面看到的是空列表，且没有任何入口告诉他要先跑一条命令行。
 *
 * 两条硬约束：
 * 1. 密钥只入不出：读回来的形状（`ProviderSummary`）只有"有没有凭据"（`hasApiKey`），
 *    没有密钥本身——否则一次 `provider.list` 就会把明文密钥送到每个控制层、进日志、进屏幕。
 * 2. `models` 报的是**基座实际会用的**模型，不是配置文件里写的那串。
 *    两者在 id 与基座内置供应商重名时并不相同（实测：id 写 `deepseek`、
 *    模型写 `deepseek-v4-flash`，实际发送的是内置的 `deepseek-flash`），
 *    因此 `declared` 单独保留，让差异在界面上可见而不是被抹平。
 */

export type ProviderModelSummary = {
  id: string;
  name: string;
  /** 是否在会话里可选（与 `model.list` 的口径一致）。 */
  available: boolean;
};

export type ProviderSummary = {
  /** 供应商 id（写进数据层 `models.json` 的 providers 键）。 */
  id: string;
  baseUrl: string;
  /** 线上 API 形态，如 `openai-completions`。 */
  api: string;
  /**
   * 是否已配置凭据。**只报有/无，不回报密钥本身**——
   * 密钥的单向性在这里落地，而不是靠调用方自觉不打印。
   */
  hasApiKey: boolean;
  /** 基座实际解析出来的模型（会话里能真正选到的就是这些）。 */
  models: ProviderModelSummary[];
  /** 配置文件里声明的模型 id，用于识别"声明被基座改写"。 */
  declared: string[];
};

export type ProviderListResult = {
  providers: ProviderSummary[];
  /** 配置文件路径，便于界面直接告诉用户"写进了哪里"。 */
  configFile: string;
};

export type ProviderAddResult = {
  provider: ProviderSummary;
  /** 这次写入新增（而不是覆盖）的供应商为真——用于界面提示"已存在，已覆盖"。 */
  created: boolean;
  /**
   * 声明与基座解析结果不一致时的**如实提示**（`null` 表示没有差异）。
   *
   * 为什么必须有它：差异只会在发消息时以"端点报错"的形式暴露，
   * 而界面看到的只是"没有回复"。在写入这一刻说出来，是唯一能让用户自己修好的时机。
   */
  warning: string | null;
};

export type ProviderRemoveResult = { removed: boolean };
