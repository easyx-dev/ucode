/**
 * profile 目录：命名校验、落位、占用统计与删除。
 *
 * 目录落在 `$APP_HOME/app/browser/profiles/<name>`（`app/` 下是「服务生成的数据」的既定位置），
 * **权限 0700**——里面有 cookie / localStorage / IndexedDB，属凭证面（见方案第 5.2 节）。
 *
 * 名字来自工具入参与设置页，必须挡住路径穿越：只允许单段 `[a-z0-9]` 开头、长度受限的字符集，
 * 拼接前先校验，删除时也只接受校验过的名字。
 */
import { type Dirent, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  BROWSER_MAX_PROFILES,
  BROWSER_PROFILE_MAX_BYTES,
  BROWSER_PROFILE_NAME_PATTERN,
  BROWSER_PROFILE_SCAN_MAX_FILES,
} from "../../../constants/browser";
import { APP_DIRNAME, BROWSER_DIRNAME, BROWSER_PROFILES_DIRNAME } from "../../../constants/dirs";
import { env } from "../../../env";
import { hardenOwnerOnlyDir } from "../../../platform/file-permissions";
import { browserError } from "./errors";

/** 名字是否合法：单段、小写字母或数字开头、不含路径分隔符与 `..` */
export const isValidProfileName = (name: string): boolean =>
  BROWSER_PROFILE_NAME_PATTERN.test(name);

const requireValidName = (name: string): string => {
  if (!isValidProfileName(name)) {
    throw browserError("browser_profile_invalid", `profile 名不合法：${name}`, {
      hint: "只能用小写字母或数字开头、含小写字母 / 数字 / `.` `_` `-` 的单段名字，长度不超过 64",
    });
  }
  return name;
};

/** 所有 profile 的存放根目录 */
export const profilesRoot = (appHome: string = env.homeDir): string =>
  join(appHome, APP_DIRNAME, BROWSER_DIRNAME, BROWSER_PROFILES_DIRNAME);

/** 该 profile 的目录绝对路径（只做拼接，不保证已存在） */
export const profilePath = (name: string, appHome: string = env.homeDir): string =>
  join(profilesRoot(appHome), requireValidName(name));

/** 建目录并收紧权限；已存在也要收紧一次（老目录可能是旧版本建的） */
export const ensureProfileDir = (name: string, appHome: string = env.homeDir): string => {
  const dir = profilePath(name, appHome);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  hardenOwnerOnlyDir(dir);
  return dir;
};

export type ProfileSize = {
  bytes: number;
  /** 是否在遍历上限内数完；false 表示只是个下界 */
  exact: boolean;
};

/**
 * 目录占用：深度优先累加，超过遍历上限或体积上限就停下并标记不精确——
 * profile 里可能是几万个小文件，统计不该把设置页拖住（照插件目录哈希的先例）。
 */
export const directorySize = (dir: string): ProfileSize => {
  let bytes = 0;
  let files = 0;
  let exact = true;
  const walk = (current: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      exact = false;
      return;
    }
    for (const entry of entries) {
      if (files >= BROWSER_PROFILE_SCAN_MAX_FILES || bytes >= BROWSER_PROFILE_MAX_BYTES) {
        exact = false;
        return;
      }
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      files += 1;
      try {
        bytes += statSync(path).size;
      } catch {
        exact = false;
      }
    }
  };
  walk(dir);
  return { bytes, exact };
};

export type ProfileInfo = {
  name: string;
  /** 占用字节数；不精确时只是个下界 */
  bytes: number;
  exact: boolean;
  /** 最后一次改动时间（ISO）：用目录 mtime，不翻里面的文件 */
  lastUsedAt: string | null;
};

/** 列出已有 profile：只扫一层目录，不递归进各 profile 内部找时间戳 */
export const listProfiles = (appHome: string = env.homeDir): ProfileInfo[] => {
  const root = profilesRoot(appHome);
  let entries: Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const list: ProfileInfo[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !isValidProfileName(entry.name)) continue;
    const dir = join(root, entry.name);
    const size = directorySize(dir);
    let lastUsedAt: string | null = null;
    try {
      lastUsedAt = statSync(dir).mtime.toISOString();
    } catch {
      lastUsedAt = null;
    }
    list.push({ name: entry.name, bytes: size.bytes, exact: size.exact, lastUsedAt });
  }
  return list.sort((a, b) => a.name.localeCompare(b.name));
};

/** 还有几个 profile 名额（新建持久化 profile 时用） */
export const remainingProfileSlots = (appHome: string = env.homeDir): number =>
  BROWSER_MAX_PROFILES - listProfiles(appHome).length;

export type DeleteProfilesResult = {
  deleted: string[];
  /** 传了名字但目录不在的，原样报回去，便于设置页对照 */
  missing: string[];
};

/**
 * 删除 profile 目录。
 * 「正在使用」的判断不在这里：调用方（注册表 / 服务层）先确认没有实例握着它，
 * 否则删到一半会把实例正打开着的文件抽走。
 */
export const deleteProfiles = (
  names: readonly string[],
  appHome: string = env.homeDir,
): DeleteProfilesResult => {
  const deleted: string[] = [];
  const missing: string[] = [];
  for (const raw of names) {
    const name = requireValidName(raw.trim());
    const dir = join(profilesRoot(appHome), name);
    try {
      statSync(dir);
    } catch {
      missing.push(name);
      continue;
    }
    rmSync(dir, { recursive: true, force: true });
    deleted.push(name);
  }
  return { deleted, missing };
};
