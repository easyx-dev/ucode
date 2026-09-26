import type { AgentSdk } from "@ucode/sdk";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import { createElement as h, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { InteractionPanel, MessageLine } from "./panel.ts";
import { useSdkState, useTranscript } from "./use-sdk.ts";

/**
 * TUI 壳（Ink）。
 *
 * 只复用 `sdk`（不 import ui，spec §7.2）：终端与浏览器共享的是"协议 C 的折叠结果"，
 * 而不是 React 组件——这也是"新增一种壳不改核心层"能否成立的实际检验。
 *
 * 用 `createElement` 而不是 JSX：TUI 由 Node 直接执行（源码直出 + 原生类型剥离），
 * 而类型剥离不支持 JSX。
 */

export type AppProps = {
  sdk: AgentSdk;
  productName: string;
};

type Mode =
  | { kind: "idle" }
  | { kind: "compose" }
  | { kind: "sessions" }
  | { kind: "models" }
  | { kind: "help" };

export function App({ sdk, productName }: AppProps): ReactNode {
  const state = useSdkState(sdk);
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [mode, setMode] = useState<Mode>({ kind: "idle" });
  const [draft, setDraft] = useState("");
  const [pickerIndex, setPickerIndex] = useState(0);
  const [bootError, setBootError] = useState<string | null>(null);
  const activeSessionId = state.activeSessionId;
  const transcript = useTranscript(sdk, activeSessionId);
  const height = (stdout?.rows ?? 30) - 8;
  const visible = useMemo(
    () => transcript.slice(Math.max(0, transcript.length - height)),
    [transcript, height],
  );
  const interactions = state.interactions.filter(
    (request) => request.sessionId === activeSessionId,
  );
  const pending = interactions[0];
  const initialized = useRef(false);

  // 启动：列会话 → 有就接上最近一个，没有就建一个
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    void (async () => {
      try {
        const sessions = await sdk.listSessions();
        const first = sessions[0];
        if (first === undefined) {
          const created = await sdk.createSession({});
          await sdk.attachSession(created.sessionId);
        } else {
          await sdk.attachSession(first.id);
        }
        await sdk.getEntries(state.activeSessionId ?? "").catch(() => undefined);
        await sdk.listModels().catch(() => undefined);
      } catch (error) {
        setBootError(error instanceof Error ? error.message : String(error));
      }
    })();
  }, [sdk, state.activeSessionId]);

  const sessions = state.sessions;

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      void sdk.close().finally(() => exit());
      return;
    }

    if (mode.kind === "sessions" || mode.kind === "models") {
      const list = mode.kind === "sessions" ? sessions : state.models;
      if (key.upArrow) setPickerIndex((index) => Math.max(0, index - 1));
      else if (key.downArrow)
        setPickerIndex((index) => Math.min(Math.max(0, list.length - 1), index + 1));
      else if (key.escape) setMode({ kind: "idle" });
      else if (key.return) {
        if (mode.kind === "sessions") {
          const picked = sessions[pickerIndex];
          if (picked !== undefined) void sdk.attachSession(picked.id).catch(() => undefined);
        } else {
          const picked = state.models[pickerIndex];
          if (picked !== undefined && activeSessionId !== null) {
            void sdk
              .setModel(activeSessionId, picked.provider, picked.modelId)
              .catch(() => undefined);
          }
        }
        setMode({ kind: "idle" });
      }
      return;
    }

    if (mode.kind === "help") {
      setMode({ kind: "idle" });
      return;
    }

    // 有交互待应答时，键盘归弹窗（见 panel.ts），这里不抢
    if (pending !== undefined) return;

    if (mode.kind === "idle") {
      if (input === "i" || input === ":") {
        setMode({ kind: "compose" });
        return;
      }
      if (input === "n") {
        void sdk
          .createSession({})
          .then((created) => sdk.attachSession(created.sessionId))
          .catch(() => undefined);
        return;
      }
      if (input === "s") {
        setPickerIndex(0);
        setMode({ kind: "sessions" });
        return;
      }
      if (input === "m") {
        setPickerIndex(0);
        setMode({ kind: "models" });
        return;
      }
      if (input === "?") {
        setMode({ kind: "help" });
        return;
      }
      if (input === "a") {
        if (activeSessionId !== null) void sdk.abort(activeSessionId).catch(() => undefined);
        return;
      }
      if (input === "E") {
        if (activeSessionId !== null)
          void sdk.setAutonomy(activeSessionId, "auto-edit").catch(() => undefined);
        return;
      }
      if (input === "C") {
        if (activeSessionId !== null)
          void sdk.setAutonomy(activeSessionId, "confirm").catch(() => undefined);
        return;
      }
      return;
    }

    // compose：单行输入
    if (key.escape) {
      setDraft("");
      setMode({ kind: "idle" });
      return;
    }
    if (key.return) {
      const text = draft.trim();
      setDraft("");
      setMode({ kind: "idle" });
      if (text === "" || activeSessionId === null) return;
      if (state.views[activeSessionId]?.readOnly === true) {
        setBootError(
          "该会话是只读挂载：写权限在另一个核心层实例手上。请改用 `--core <该实例的地址>` 连过去。",
        );
        return;
      }
      const running = state.views[activeSessionId]?.running === true;
      void (running ? sdk.steer(activeSessionId, text) : sdk.prompt(activeSessionId, text)).catch(
        (error: unknown) => {
          setBootError(error instanceof Error ? error.message : String(error));
        },
      );
      return;
    }
    if (key.backspace || key.delete) {
      setDraft((current) => current.slice(0, -1));
      return;
    }
    if (input !== "" && !key.ctrl && !key.meta) setDraft((current) => current + input);
  });

  const view = activeSessionId === null ? undefined : state.views[activeSessionId];
  const status =
    view?.running === true
      ? "运行中"
      : view !== undefined && view.pendingInteractions > 0
        ? "等待应答"
        : "空闲";
  const lastNotice = state.notices.at(-1);
  const model = view?.state?.model;
  const headerRight = [
    activeSessionId === null
      ? "无会话"
      : (sessions.find((session) => session.id === activeSessionId)?.name ??
        activeSessionId.slice(0, 12)),
    model === undefined || model === null ? "" : `${model.provider}/${model.modelId}`,
    view?.state?.autonomy ?? "",
    status,
    state.connected ? "" : "未连接（正在重连）",
  ]
    .filter((part) => part !== "")
    .join(" · ");

  return h(
    Box,
    { flexDirection: "column", height: stdout?.rows },
    h(
      Box,
      { justifyContent: "space-between" },
      h(Text, { bold: true, color: "cyan" }, productName),
      h(Text, { dimColor: true }, headerRight),
    ),
    h(
      Box,
      { flexDirection: "column", flexGrow: 1, marginTop: 1 },
      bootError !== null ? h(Text, { color: "red" }, `启动失败：${bootError}`) : null,
      visible.length === 0
        ? h(Text, { dimColor: true }, "（还没有消息。按 i 输入，? 查看快捷键）")
        : null,
      visible.map((message) => h(MessageLine, { key: `${message.id}-${message.seq}`, message })),
    ),
    pending !== undefined
      ? h(InteractionPanel, {
          key: pending.id,
          sdk,
          sessions: sessions.map((session) => ({
            id: session.id,
            label: session.name ?? session.id.slice(0, 12),
          })),
        })
      : null,
    pending === undefined && mode.kind === "sessions"
      ? h(Picker, {
          title: "选择会话（Enter 挂载 / Esc 取消）",
          items: sessions.map((session) => ({
            label: `${session.name ?? session.id.slice(0, 12)}  ${session.entryCount} 条  ${session.firstMessage ?? ""}`,
            active: session.id === activeSessionId,
          })),
          index: pickerIndex,
        })
      : null,
    pending === undefined && mode.kind === "models"
      ? h(Picker, {
          title: "切换模型（Enter 应用 / Esc 取消）",
          items: state.models.map((entry) => ({
            label: `${entry.provider}/${entry.modelId}  ${entry.name}`,
            active: entry.modelId === view?.state?.model?.modelId,
          })),
          index: pickerIndex,
        })
      : null,
    pending === undefined && mode.kind === "help"
      ? h(
          Box,
          { flexDirection: "column", borderStyle: "round", paddingX: 1 },
          h(Text, { bold: true }, "快捷键"),
          h(Text, null, "i / : 输入 · n 新建会话 · s 会话列表 · m 切换模型"),
          h(Text, null, "a 中止本轮 · C 变更前确认 · E 自动编辑 · ? 本帮助 · Ctrl+C 退出"),
          h(Text, { dimColor: true }, "运行中提交的输入会作为 steer 送入当前这一轮（不打断）。"),
        )
      : null,
    pending === undefined && (mode.kind === "compose" || mode.kind === "idle")
      ? h(
          Box,
          null,
          h(Text, { color: "cyan" }, mode.kind === "compose" ? "❯ " : "· "),
          h(Text, null, mode.kind === "compose" ? draft : "按 i 输入…"),
          view?.running === true
            ? h(Text, { dimColor: true }, "  （本轮运行中，Enter 将作为 steer 送入）")
            : null,
        )
      : null,
    lastNotice !== undefined
      ? h(
          Box,
          null,
          h(
            Text,
            {
              color:
                lastNotice.level === "error"
                  ? "red"
                  : lastNotice.level === "warn"
                    ? "yellow"
                    : "gray",
            },
            lastNotice.message,
          ),
        )
      : null,
  );
}

function Picker({
  title,
  items,
  index,
}: {
  title: string;
  items: { label: string; active: boolean }[];
  index: number;
}): ReactNode {
  return h(
    Box,
    { flexDirection: "column", borderStyle: "round", paddingX: 1 },
    h(Text, { bold: true }, title),
    items.length === 0 ? h(Text, { dimColor: true }, "（空）") : null,
    items
      .slice(0, 12)
      .map((item, position) =>
        h(
          Text,
          { key: item.label, color: position === index ? "cyan" : undefined },
          `${position === index ? "❯ " : "  "}${item.active ? "* " : ""}${item.label}`,
        ),
      ),
  );
}
