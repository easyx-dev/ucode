/** auth 域的响应模型：会话视图、whoami 与一次性配对链接 */
import type { ListResult } from "../common";

/** 一条活动会话（不含明文 token，id 可安全展示 / 用于撤销） */
export type AuthSessionView = {
  id: string;
  /** 签发时间（ISO 8601 UTC） */
  createdAt: string;
  /** 过期时间（ISO 8601 UTC） */
  expiresAt: string;
  /** 最近一次使用时间（ISO 8601 UTC） */
  lastSeenAt: string;
  /** 会话标签（设备名 / 备注） */
  label: string;
};

/** 当前主体身份：Cookie 会话带 session，Bearer（本机原生客户端）无会话 */
export type WhoamiResponse = {
  kind: "owner";
  /** 角色 / 权限分级暂缓，当前恒为 ["*"]（见 plans/service-and-auth.md §3.8） */
  scopes: string[];
  session: AuthSessionView | null;
};

/** 活动会话列表 */
export type AuthSessionListResponse = ListResult & {
  sessions: AuthSessionView[];
};

/** 登录成功：返回签发的会话（Cookie 由响应头种下） */
export type AuthLoginResponse = {
  session: AuthSessionView;
};

/** 登出回执；Bearer 主体没有会话可撤销时为 false */
export type AuthLogoutResponse = {
  revoked: boolean;
};

/** 改密码回执：顺带撤销的会话数 */
export type AuthPasswordResponse = {
  revokedSessions: number;
};

/** 撤销单个会话的回执 */
export type AuthSessionRevokeResponse = {
  revoked: boolean;
};

/** 一次性配对链接：短 TTL、单次使用、高熵 */
export type PairingCreateOutput = {
  /** 完整可访问地址，形如 http://<lan-ip>:<port>/auth/connect/<code> */
  url: string;
  /** 一次性码 */
  code: string;
  /** 过期时间（ISO 8601 UTC） */
  expiresAt: string;
};
