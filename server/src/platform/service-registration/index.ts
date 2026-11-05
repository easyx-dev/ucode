/**
 * 服务注册文件：`$APP_HOME/app/service.json` 的定位、读写与凭证生成。
 *
 * 文件由服务独占写入、客户端只读，权限收紧到「仅属主可读写」——整份文件的信任根就是这一条，
 * 因此 `serviceToken` / `password` 均为明文（同一文件里已含等价的 owner 凭证，再做哈希无收益）。
 * 两个平台的具体做法见 `platform/file-permissions`。
 * 本模块不读 env，路径由调用方传入，便于单测。
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

import { hardenOwnerOnly, OWNER_ONLY_MODE } from "../file-permissions";
import { instanceId } from "../instance";

/** 可读凭证字符集：去掉 0/O/1/l/I 等易混字符，密码要能被人抄写 */
const PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/**
 * 中继（hub）配置：地址 + 设备绑定 + 登录态。
 *
 * 后两项（`token` / `username`）随中继客户端引入，旧注册文件里没有，故默认回落 `null`
 * ——注册文件读不出来会让服务重新生成凭证，代价远大于少两个可选字段。
 */
const relaySchema = z.object({
  enabled: z.boolean(),
  url: z.string().nullable(),
  deviceId: z.string().nullable(),
  deviceToken: z.string().nullable(),
  /** 中继登录会话令牌 */
  token: z.string().nullable().default(null),
  /** 中继登录账号（界面展示用） */
  username: z.string().nullable().default(null),
});

const registrationSchema = z.object({
  /** 监听地址：`127.0.0.1` 仅本机，`0.0.0.0` 允许局域网 */
  host: z.string(),
  /** 监听端口：0 表示自选可用端口，启动后回写真实端口 */
  port: z.number().int().min(0).max(65535),
  /** 服务进程 pid，供 `service restart` 精确结束旧实例；优雅退出时清空，崩溃后为陈旧值 */
  pid: z.number().int().nullable(),
  /**
   * 本次启动的实例标识，与 `GET /api/v1/health` 回报的一致。
   * 可为 null：早期版本的注册文件没有这一项，缺失即视为「无法核对身份」。
   * 这里**不**覆盖成当前进程的值（见下面的注释），由 `main` 在 listen 成功后写入。
   */
  instanceId: z.string().min(1).nullable().default(null),
  /** 本机原生客户端的免交互凭证 */
  serviceToken: z.string().min(1),
  /** 超管密码，明文；供登录页与忘记时回显 */
  password: z.string().min(1),
  createdAt: z.string(),
  relay: relaySchema,
});

export type ServiceRegistration = z.infer<typeof registrationSchema>;

const defaultRelay = (): ServiceRegistration["relay"] => ({
  enabled: false,
  url: null,
  deviceId: null,
  deviceToken: null,
  token: null,
  username: null,
});

/** 生成静态 Bearer 凭证（256bit 随机） */
export const createServiceToken = (): string => randomBytes(32).toString("base64url");

/** 生成分组可读的登录密码（约 99bit 随机） */
export const createPassword = (): string => {
  const chars = [...randomBytes(20)].map((byte) =>
    PASSWORD_ALPHABET.charAt(byte % PASSWORD_ALPHABET.length),
  );
  const groups: string[] = [];
  for (let index = 0; index < chars.length; index += 4)
    groups.push(chars.slice(index, index + 4).join(""));
  return groups.join("-");
};

/** 读取并校验注册文件；缺失或损坏一律返回 null，由 ensure 重新生成 */
export const readServiceRegistration = (path: string): ServiceRegistration | null => {
  try {
    const parsed = registrationSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

/**
 * 把注册文件里的监听地址拼成可直接访问的主机：通配地址改用回环（`0.0.0.0` / `::` 不可直接访问），
 * IPv6 字面量加方括号（`http://::1:19688` 不是合法 URL，`fetch` 会直接抛错、看起来就像「服务不在」）。
 */
export const toUrlHost = (host: string): string => {
  const target = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  return target.includes(":") ? `[${target}]` : target;
};

/** 原子写入（临时文件 + rename），再收紧权限：Windows 上靠 `mode` / `chmod` 拿不到「仅属主可读」 */
export const writeServiceRegistration = (path: string, registration: ServiceRegistration): void => {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(registration, null, 2)}\n`, {
    encoding: "utf8",
    mode: OWNER_ONLY_MODE,
  });
  renameSync(temporary, path);
  hardenOwnerOnly(path);
};

export type EnsureOptions = {
  path: string;
  /** 本次启动解析出的监听地址与端口（端口 0 为自选） */
  host: string;
  port: number;
};

/**
 * 确保注册文件存在：已有则复用其凭证，并把 host / port 对齐到本次启动值；
 * 缺失或损坏则生成新凭证（pid 先置空，实际值待 listen 成功后由 `writeServicePid` 写入）。
 * 返回 `created` 供启动日志提示初始密码。
 */
export const ensureServiceRegistration = (
  options: EnsureOptions,
): {
  registration: ServiceRegistration;
  created: boolean;
} => {
  const existing = readServiceRegistration(options.path);
  const base: ServiceRegistration = existing ?? {
    serviceToken: createServiceToken(),
    password: createPassword(),
    createdAt: new Date().toISOString(),
    relay: defaultRelay(),
    host: options.host,
    port: options.port,
    pid: null,
    instanceId,
  };
  // 不动 pid、不动 instanceId：绑定失败（如端口占用、改了 host 后重起）时注册文件里的旧实例信息
  // 必须保持不变，否则会把正在运行的实例的身份改成即将退出的本进程的，让它的 `service restart` 永远核对不上
  const registration: ServiceRegistration = {
    ...base,
    host: options.host,
    port: options.port,
  };

  const changed =
    !existing || existing.host !== registration.host || existing.port !== registration.port;
  if (changed) writeServiceRegistration(options.path, registration);

  return { registration, created: !existing };
};

/**
 * 写入 / 清空注册文件里的 pid。listen 成功后写入本进程 pid，优雅退出时传 `null` 清空；
 * 异常退出（如崩溃）留下的陈旧 pid 由调用方按存活 + 端口归属判定忽略。
 */
export const writeServicePid = (path: string, pid: number | null): void => {
  const existing = readServiceRegistration(path);
  if (!existing || existing.pid === pid) return;
  writeServiceRegistration(path, { ...existing, pid });
};
