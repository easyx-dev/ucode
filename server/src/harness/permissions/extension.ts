/**
 * 权限拦截：以 pi 内联扩展的形式挂到 `tool_call` 上。
 *
 * pi 只在构造会话时接收 `resourceLoader`，没有「构造后注册处理器」的入口，
 * 所以模式规则与审批回调在这里收敛成一个扩展工厂，由装配层塞进
 * `DefaultResourceLoader({ extensionFactories })`。
 *
 * 判定为 `deny` 时直接阻断；`ask` 时挂起等前端回答，超时 / 断连按拒绝处理。
 * 「本会话恒允」= 往规则表追尾加一条 allow 规则（按判定给出的范围），下次判定即命中。
 * pi 对 `tool_call` 处理器抛错的处理是「按阻断兜底」，与这里的失败姿态一致。
 */
import type { ExtensionFactory, ToolCallEventResult } from "@earendil-works/pi-coding-agent";
import type { PermissionDecision, PermissionMode } from "@ucode/contracts";

import {
  applyApprovalMode,
  decidePermission,
  type PermissionAsk,
  type PermissionRule,
  severityOf,
} from "./engine";
import { isMcpToolName, mcpPermission, mcpSubject } from "./mcp-rules";

export type PermissionGate = {
  /** 会话工作目录：相对路径与越界判断的基准 */
  cwd: string;
  /** 当前规则（模式规则 + 本会话已追加的授权）；每次调用现取，授权即时生效 */
  rules: () => readonly PermissionRule[];
  /** 会话级权限档位：命中 `ask` 时是否自动放行；只放宽 `ask`，不突破 `deny` */
  approvalMode: PermissionMode;
  /** 子会话的父会话规则；提供时与 `rules` 的判定取较严者，保证能力只可收窄 */
  parentRules?: () => readonly PermissionRule[];
  /** 记下本会话恒允：追加一条 allow 规则 */
  grant: (rule: PermissionRule) => void;
  /** 发起审批；返回用户答复，超时 / 断连按 `deny` */
  request: (ask: PermissionAsk) => Promise<PermissionDecision>;
};

/** 装配层注入的会话级权限钩子：审批回调 + 会话授权读写 */
export type PermissionHooks = {
  /** 本会话已追加的授权规则 */
  listGrants: () => readonly PermissionRule[];
  /** 追加一条授权规则 */
  grant: (rule: PermissionRule) => void;
  /** 发起审批 */
  request: (ask: PermissionAsk) => Promise<PermissionDecision>;
};

const denyReason = (tool: string, subject: string, note?: string): string =>
  `已阻止 ${tool} 的调用（${subject}）${note ? `：${note}` : ""}，该操作被规则禁止`;

const askDenyReason = (tool: string, subject: string): string =>
  `用户拒绝了 ${tool} 的调用（${subject}）`;

export const createPermissionExtension =
  (gate: PermissionGate): ExtensionFactory =>
  (pi) => {
    pi.on("tool_call", async (event): Promise<ToolCallEventResult | undefined> => {
      const input = event.input as Record<string, unknown>;
      let verdict = decidePermission(gate.rules(), event.toolName, input, gate.cwd);
      // 子会话再算一遍父会话的判定，取较严者，保证角色权限放宽不了父的限制
      const parentRules = gate.parentRules?.();
      if (parentRules) {
        const parentVerdict = decidePermission(parentRules, event.toolName, input, gate.cwd);
        if (severityOf(parentVerdict.action) > severityOf(verdict.action)) verdict = parentVerdict;
      }
      // MCP 工具没有显式规则时按服务器声明的 annotations 兜底：只读放行，其余审批
      const mcp =
        verdict.rule === undefined && isMcpToolName(event.toolName)
          ? mcpPermission(
              pi.getAllTools().find((tool) => tool.name === event.toolName)?.annotations,
            )
          : undefined;
      const action = applyApprovalMode(
        mcp?.action ?? verdict.action,
        verdict.tool,
        gate.approvalMode,
      );
      const subject = mcp ? mcpSubject(input, mcp.note) : verdict.subject;

      if (action === "allow") return undefined;
      if (action === "deny") {
        return {
          block: true,
          reason: denyReason(verdict.tool, subject, verdict.rule?.note),
        };
      }

      const decision = await gate.request({
        // 展示实际工具名；授权范围按判定给出的 scope 记账
        tool: event.toolName,
        subject,
        scope: verdict.scope,
      });
      if (decision === "deny") {
        return { block: true, reason: askDenyReason(verdict.tool, subject) };
      }
      if (decision === "allow_session") {
        gate.grant({
          tool: verdict.tool,
          pattern: verdict.scope,
          action: "allow",
          note: verdict.rule?.note,
        });
      }
      return undefined;
    });
  };
