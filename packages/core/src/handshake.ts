import type { IndexedSession, Store } from "@ucode/data-layer-spec";
import {
  type Capability,
  CURRENT_PROTOCOL_VERSION,
  type Hello,
  isVersionSupported,
  MIN_READABLE_PROTOCOL_VERSION,
  type Rejected,
  type SessionSummary,
  type TrustLevel,
  type Welcome,
} from "@ucode/protocol";
import { grantCapabilities } from "./trust.ts";

/**
 * 握手（spec §4.3）。
 *
 * 三条必须满足的性质：
 * 1. **能力声明与能力授予分离**——客户端说"我能承载什么"，核心层说"实际授予什么"，
 *    这样"操作被拒"才能区分"承载不了"与"能承载但信任不足"；
 * 2. **版本双向校验**——不支持就显式拒绝，从不静默降级；
 * 3. **身份信息只是信息性载荷**——不涉及可验证性，核心层只记下"这条 attachment 属于谁"。
 */

export type HandshakeInput = {
  hello: Hello;
  coreId: string;
  trustLevel: TrustLevel;
  coreCapabilities: Capability[];
  store: Store;
};

export type HandshakeResult = { ok: true; welcome: Welcome } | { ok: false; rejected: Rejected };

export async function handleHello(input: HandshakeInput): Promise<HandshakeResult> {
  const { hello } = input;

  if (!isVersionSupported(hello.protocolVersion)) {
    return {
      ok: false,
      rejected: {
        type: "rejected",
        code: "version_unsupported",
        message: `协议版本不兼容：对端 ${hello.protocolVersion}，本核心层支持 ${MIN_READABLE_PROTOCOL_VERSION}–${CURRENT_PROTOCOL_VERSION}。`,
        coreProtocolVersion: CURRENT_PROTOCOL_VERSION,
        minReadableProtocolVersion: MIN_READABLE_PROTOCOL_VERSION,
      },
    };
  }

  const sessions = await input.store.listSessions();

  let resumeAck: Welcome["resumeAck"] = null;
  if (hello.resume !== null) {
    const target = sessions.find((session) => session.id === hello.resume?.sessionId);
    if (target === undefined) {
      resumeAck = {
        sessionId: hello.resume.sessionId,
        fromSeq: hello.resume.fromSeq,
        valid: false,
        cursor: 0,
      };
    } else {
      // 游标 = 行序号。只要会话还在且没被整体替换（迁移），位置就仍然有效；
      // 客户端拿这个 cursor 与自己的位置比对，缺口用 session.get_entries 补齐。
      resumeAck = {
        sessionId: hello.resume.sessionId,
        fromSeq: hello.resume.fromSeq,
        valid: true,
        cursor: target.entryCount,
      };
    }
  }

  return {
    ok: true,
    welcome: {
      type: "welcome",
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      coreId: input.coreId,
      capabilities: input.coreCapabilities,
      grantedCapabilities: grantCapabilities(input.trustLevel, hello.capabilities),
      trustLevel: input.trustLevel,
      dataLayerVersion: input.store.version.protocolVersion,
      sessions: sessions.map(toSummary),
      resumeAck,
    },
  };
}

export function toSummary(session: IndexedSession): SessionSummary {
  return {
    id: session.id,
    cwd: session.cwd,
    name: session.name,
    file: session.file,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    entryCount: session.entryCount,
    firstMessage: session.firstMessage,
    owned: session.owned,
  };
}
