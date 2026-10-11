/**
 * 服务注册文件：`$APP_HOME/app/service.json` 的定位、读写与凭证生成。
 *
 * 文件由服务独占写入、客户端只读，权限固定 `0600`——整份文件的信任根是「只有属主读得到」，
 * 因此 `serviceToken` / `password` 均为明文（同一文件里已含等价的 owner 凭证，再做哈希无收益）。
 * 本模块不读 env，路径由调用方传入，便于单测。
 */
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

/** 注册文件权限：仅属主可读写 */
const FILE_MODE = 0o600;

/** 可读凭证字符集：去掉 0/O/1/l/I 等易混字符，密码要能被人抄写 */
const PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

const relaySchema = z.object({
  enabled: z.boolean(),
  url: z.string().nullable(),
  deviceId: z.string().nullable(),
  deviceToken: z.string().nullable(),
});

const registrationSchema = z.object({
  /** 监听地址：`127.0.0.1` 仅本机，`0.0.0.0` 允许局域网 */
  host: z.string(),
  /** 监听端口：0 表示自选可用端口，启动后回写真实端口 */
  port: z.number().int().min(0).max(65535),
  /** 服务进程 pid，供 `--restart` 精确结束旧实例；优雅退出时清空，崩溃后为陈旧值 */
  pid: z.number().int().nullable(),
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

/** 原子写入（临时文件 + rename），并兜底校正权限为 0600 */
export const writeServiceRegistration = (path: string, registration: ServiceRegistration): void => {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(registration, null, 2)}\n`, {
    encoding: "utf8",
    mode: FILE_MODE,
  });
  renameSync(temporary, path);
  chmodSync(path, FILE_MODE);
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
  };
  // 不动 pid：绑定失败（如端口占用）时注册文件里的旧实例 pid 必须保持不变
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
