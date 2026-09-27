import { type ReactNode, useState } from "react";
import { useAgentStore } from "../context.ts";
import {
  describePreflight,
  describeVersions,
  formatTokenCount,
  topModelRows,
} from "./insights-format.ts";
import { Badge, Button, Card } from "./primitives.tsx";

/**
 * 用量 / 支持包 / 迁移面板（F-5.6~5.8）。
 *
 * 三块：**用量**（从会话记录本地聚合，展示总量与按模型/按天分布）、
 * **支持包**（一键导出脱敏的 `.json.gz`，显示路径与体积）、
 * **迁移**（先只读预检，看清冲突与阻塞再决定是否导入）。
 *
 * 面板不做任何聚合或脱敏——那些在服务层；这里只是把结果摆出来、把动作接上。
 */

export function InsightsPanel({ onClose }: { onClose: () => void }): ReactNode {
  const insights = useAgentStore((store) => store.insights);
  const loadUsage = useAgentStore((store) => store.loadUsage);
  const exportBundle = useAgentStore((store) => store.exportBundle);
  const preflight = useAgentStore((store) => store.preflightMigration);
  const importData = useAgentStore((store) => store.importData);

  const [from, setFrom] = useState("");
  const usage = insights.usage;

  return (
    <aside className="flex w-96 shrink-0 flex-col border-l border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)]">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--color-border-subtle)] px-3">
        <h2 className="text-sm font-medium">用量与数据</h2>
        {insights.loading && <Badge tone="muted">处理中</Badge>}
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" onClick={() => void loadUsage()}>
            刷新
          </Button>
          <Button size="sm" onClick={onClose}>
            ×
          </Button>
        </div>
      </header>

      {(insights.error !== null || insights.note !== null) && (
        <div
          className={`border-b border-[var(--color-border-subtle)] px-3 py-1.5 text-[11px] ${
            insights.error === null
              ? "text-[var(--color-content-muted)]"
              : "text-[var(--color-danger)]"
          }`}
        >
          {insights.error ?? insights.note}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2">
        <section className="mb-3">
          <div className="mb-1 px-1 text-[11px] font-medium text-[var(--color-content-muted)]">
            用量（本地聚合自会话记录）
          </div>
          <Card className="p-2">
            {usage === null ? (
              <p className="text-[11px] text-[var(--color-content-muted)]">
                还没有数据，点"刷新"。
              </p>
            ) : (
              <>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px]">
                  <span>调用 {usage.records} 次</span>
                  <span>输入 {formatTokenCount(usage.totals.input)}</span>
                  <span>输出 {formatTokenCount(usage.totals.output)}</span>
                  {usage.totals.cacheRead + usage.totals.cacheWrite > 0 && (
                    <span>
                      缓存 {formatTokenCount(usage.totals.cacheRead)}/
                      {formatTokenCount(usage.totals.cacheWrite)}
                    </span>
                  )}
                  {usage.totals.cost > 0 && <span>成本 {usage.totals.cost.toFixed(4)}</span>}
                </div>
                <div className="mt-2 flex flex-col gap-0.5">
                  {topModelRows(usage).map((row) => (
                    <div key={row.key} className="flex items-center gap-2 text-[11px]">
                      <span className="truncate font-[var(--font-mono)]">{row.key}</span>
                      <span className="ml-auto shrink-0 text-[var(--color-content-muted)]">
                        {row.turns} 次 · {row.tokens}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </Card>
        </section>

        <section className="mb-3">
          <div className="mb-1 px-1 text-[11px] font-medium text-[var(--color-content-muted)]">
            支持包（可分享；导出前已脱敏）
          </div>
          <Card className="flex flex-col gap-2 p-2">
            <p className="text-[11px] text-[var(--color-content-muted)]">
              含清单、用量、会话索引、配置与日志尾部；密钥字段会被替换，**不含会话正文**。
            </p>
            <Button size="sm" variant="primary" onClick={() => void exportBundle()}>
              导出支持包
            </Button>
            {insights.exported !== null && (
              <div className="break-all font-[var(--font-mono)] text-[10px] text-[var(--color-content-muted)]">
                {insights.exported.file}
              </div>
            )}
          </Card>
        </section>

        <section>
          <div className="mb-1 px-1 text-[11px] font-medium text-[var(--color-content-muted)]">
            迁移（先预检再导入）
          </div>
          <Card className="flex flex-col gap-2 p-2">
            <input
              className="rounded border border-[var(--color-border-subtle)] bg-[var(--color-surface-overlay)] px-2 py-1 font-[var(--font-mono)] text-[12px]"
              placeholder="要导入的数据层目录（旧机器上的数据层路径）"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
            <div className="flex gap-1">
              <Button size="sm" onClick={() => void preflight(from)} disabled={from.trim() === ""}>
                预检
              </Button>
              <Button
                size="sm"
                variant="primary"
                disabled={insights.preflight?.canMigrate !== true}
                onClick={() => void importData(from)}
              >
                导入（同名跳过）
              </Button>
            </div>
            {insights.preflight !== null && (
              <div className="flex flex-col gap-1 text-[11px]">
                <div
                  className={
                    insights.preflight.canMigrate
                      ? "text-[var(--color-success)]"
                      : "text-[var(--color-danger)]"
                  }
                >
                  {describePreflight(insights.preflight)}
                </div>
                <div className="text-[10px] text-[var(--color-content-muted)]">
                  {describeVersions(insights.preflight)}
                </div>
              </div>
            )}
          </Card>
        </section>
      </div>
    </aside>
  );
}
