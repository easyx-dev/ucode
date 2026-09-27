import type { TaskSummary } from "@ucode/sdk";
import { type ReactNode, useState } from "react";
import { useAgentStore } from "../context.ts";
import { Badge, Button, Card } from "./primitives.tsx";
import {
  describeNextRun,
  describeRuns,
  describeSchedule,
  statusLabel,
  statusTone,
} from "./task-format.ts";

/**
 * 自动化面板（F-4.5）。
 *
 * 数据来自 SDK 的 `state.tasks`（`task.list` 刷新，不随事件流推送——任务列表变化低频，
 * 轮询式刷新足够且更省）。动作全部翻译成 SDK 调用，面板本身不认识协议细节。
 *
 * 三种任务形态在同一个表单里：定时（cron 表达式）、一次性（N 分钟后）、闲时（每 N 分钟、宿主空闲才跑）。
 */

type FormKind = "cron" | "idle";

export function TasksPanel({ onClose }: { onClose: () => void }): ReactNode {
  const tasks = useAgentStore((store) => store.state.tasks);
  const keepAwake = useAgentStore((store) => store.state.keepAwake);
  const loadTasks = useAgentStore((store) => store.loadTasks);
  const createTask = useAgentStore((store) => store.createTask);
  const cancelTask = useAgentStore((store) => store.cancelTask);
  const toggleTask = useAgentStore((store) => store.toggleTask);
  const runTask = useAgentStore((store) => store.runTask);

  const [composing, setComposing] = useState(false);
  const [kind, setKind] = useState<FormKind>("cron");
  const [prompt, setPrompt] = useState("");
  const [cron, setCron] = useState("0 9 * * 1-5");
  const [delayMinutes, setDelayMinutes] = useState("30");
  const [everyMinutes, setEveryMinutes] = useState("30");
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    const text = prompt.trim();
    if (text === "") {
      setError("请填写任务提示词。");
      return;
    }
    setError(null);
    if (kind === "idle") {
      const every = Number(everyMinutes);
      if (!Number.isFinite(every) || every <= 0) {
        setError("间隔必须是正数分钟。");
        return;
      }
      await createTask({ kind: "idle", prompt: text, everyMinutes: every });
    } else if (/^\d+$/u.test(delayMinutes) && Number(delayMinutes) > 0 && cron.trim() === "") {
      await createTask({ kind: "cron", prompt: text, delayMinutes: Number(delayMinutes) });
    } else {
      await createTask({ kind: "cron", prompt: text, cron: cron.trim() });
    }
    setPrompt("");
    setComposing(false);
  }

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)]">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--color-border-subtle)] px-3">
        <h2 className="text-sm font-medium">自动化</h2>
        {keepAwake && <Badge tone="accent">保持唤醒</Badge>}
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" title="刷新" onClick={() => void loadTasks()}>
            刷新
          </Button>
          <Button size="sm" title="关闭" onClick={onClose}>
            ×
          </Button>
        </div>
      </header>

      <div className="border-b border-[var(--color-border-subtle)] p-2">
        {composing ? (
          <div className="flex flex-col gap-2">
            <div className="flex gap-1">
              <Button
                size="sm"
                variant={kind === "cron" ? "primary" : "ghost"}
                onClick={() => setKind("cron")}
              >
                定时 / 一次性
              </Button>
              <Button
                size="sm"
                variant={kind === "idle" ? "primary" : "ghost"}
                onClick={() => setKind("idle")}
              >
                闲时
              </Button>
            </div>
            <textarea
              className="h-20 w-full resize-none rounded border border-[var(--color-border-subtle)] bg-[var(--color-surface-overlay)] p-2 text-[13px]"
              placeholder="任务提示词：到点后交给 agent 做什么"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
            />
            {kind === "idle" ? (
              <label className="flex items-center gap-2 text-[11px] text-[var(--color-content-muted)]">
                每
                <input
                  className="w-16 rounded border border-[var(--color-border-subtle)] bg-[var(--color-surface-overlay)] px-1.5 py-1"
                  value={everyMinutes}
                  onChange={(event) => setEveryMinutes(event.target.value)}
                />
                分钟（宿主空闲时）
              </label>
            ) : (
              <div className="flex flex-col gap-1 text-[11px] text-[var(--color-content-muted)]">
                <label className="flex items-center gap-2">
                  cron
                  <input
                    className="flex-1 rounded border border-[var(--color-border-subtle)] bg-[var(--color-surface-overlay)] px-1.5 py-1 font-[var(--font-mono)]"
                    placeholder="0 9 * * 1-5"
                    value={cron}
                    onChange={(event) => setCron(event.target.value)}
                  />
                </label>
                <label className="flex items-center gap-2">
                  或一次性
                  <input
                    className="w-16 rounded border border-[var(--color-border-subtle)] bg-[var(--color-surface-overlay)] px-1.5 py-1"
                    value={delayMinutes}
                    onChange={(event) => setDelayMinutes(event.target.value)}
                  />
                  分钟后（清空 cron 生效）
                </label>
              </div>
            )}
            {error !== null && (
              <div className="text-[11px] text-[var(--color-danger)]">{error}</div>
            )}
            <div className="flex justify-end gap-2">
              <Button size="sm" onClick={() => setComposing(false)}>
                取消
              </Button>
              <Button size="sm" variant="primary" onClick={() => void submit()}>
                创建
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="primary" className="w-full" onClick={() => setComposing(true)}>
            新建任务
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {tasks.length === 0 ? (
          <p className="p-2 text-[11px] text-[var(--color-content-muted)]">
            还没有任务。定时任务按 cron 触发；闲时任务只在宿主空闲时跑。
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                onToggle={() => void toggleTask(task.id, task.status)}
                onRun={() => void runTask(task.id)}
                onCancel={() => void cancelTask(task.id)}
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

function TaskRow({
  task,
  onToggle,
  onRun,
  onCancel,
}: {
  task: TaskSummary;
  onToggle: () => void;
  onRun: () => void;
  onCancel: () => void;
}): ReactNode {
  const now = new Date();
  return (
    <Card className="p-2.5">
      <div className="flex items-center gap-2">
        <Badge tone={statusTone(task.status)}>{statusLabel(task.status)}</Badge>
        <span className="truncate text-[11px] text-[var(--color-content-muted)]">
          {describeSchedule(task)}
        </span>
      </div>
      <p className="mt-1.5 line-clamp-2 text-[13px]">{task.prompt}</p>
      <div className="mt-1.5 flex items-center gap-2 text-[10px] text-[var(--color-content-muted)]">
        <span>{describeNextRun(task, now)}</span>
        <span>·</span>
        <span className="truncate">{describeRuns(task)}</span>
      </div>
      <div className="mt-2 flex gap-1">
        <Button size="sm" onClick={onToggle}>
          {task.status === "active" ? "暂停" : "继续"}
        </Button>
        <Button size="sm" onClick={onRun}>
          立即运行
        </Button>
        <Button size="sm" variant="danger" className="ml-auto" onClick={onCancel}>
          删除
        </Button>
      </div>
    </Card>
  );
}
