/**
 * 插件副本在磁盘上的落位与清理：暂存目录 → 版本化缓存目录、旧版本孤儿标记与过期清扫、
 * 卸载时按来源删副本、项目级覆盖文件的按需读取与缓存。
 *
 * 与 `index.ts` 的分工：这里只做「路径 + 文件系统」，不知道登记表与注册表；
 * 是否需要清扫、覆盖值怎么用，都由 `index.ts` 决定后调进来。
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";
import {
  PLUGIN_CACHE_DIRNAME,
  PLUGIN_DATA_DIRNAME,
  PLUGIN_ORPHAN_DIRNAME_PREFIX,
  PLUGIN_ORPHAN_MARKER_FILENAME,
  PLUGIN_PROJECT_OVERRIDES_FILENAME,
  PLUGIN_PROJECT_OVERRIDES_LOCAL_FILENAME,
  PROJECT_CONFIG_DIRNAME,
} from "../../constants/dirs";
import { PLUGIN_ORPHAN_TTL_DAYS } from "../../constants/plugins";
import { toDataDirName } from "../../harness/plugins/sanitize";
import {
  type InstalledPluginRecord,
  LOCAL_MARKETPLACE_NAME,
  type LoadedProjectOverrides,
  loadProjectPluginOverrides,
} from "../../harness/plugins/state";
import { logger } from "../../platform/logger";
import { isInsidePath } from "../../platform/paths";

export type PluginStorage = {
  /** 暂存目录：`cache/<市场>/.staging`，每次拉取一个子目录，装完即清 */
  stagingRootFor(marketplace: string | undefined): string;
  /** 把暂存目录搬进 `cache/<市场>/<插件>/<版本>`；本地目录来源不复制，原样返回源目录 */
  placeStaged(input: {
    staged: { path: string; staged: boolean };
    marketplace: string | undefined;
    name: string;
    version: string;
    stagingRoot: string;
  }): string;
  /**
   * 卸载时清理磁盘内容：插件数据目录（`${*_PLUGIN_DATA}`）无条件清，
   * 安装副本只删复制型来源的；返回是否删了副本。
   */
  purge(record: InstalledPluginRecord): boolean;
  /** 按会话 cwd 取项目级覆盖（按文件 `mtime:size` 缓存）；没给 cwd 时返回 null */
  overridesFor(cwd?: string): LoadedProjectOverrides | null;
  /** 清扫过期的旧版本孤儿副本；`hasInstalled` 为 false 时不动（与 Claude Code 同一前提） */
  sweepOrphans(reason: string, hasInstalled: boolean): void;
};

export const createPluginStorage = (input: { pluginsDir: string }): PluginStorage => {
  const { pluginsDir } = input;
  let overridesCache: { cwd: string; key: string; value: LoadedProjectOverrides } | null = null;

  const cacheDir = resolve(pluginsDir, PLUGIN_CACHE_DIRNAME);

  /** 缓存失效键：两份覆盖文件的 `mtime:size`，文件不存在记 `-` */
  const overridesKeyOf = (cwd: string): string => {
    const dir = resolve(cwd, PROJECT_CONFIG_DIRNAME);
    return [PLUGIN_PROJECT_OVERRIDES_FILENAME, PLUGIN_PROJECT_OVERRIDES_LOCAL_FILENAME]
      .map((name) => {
        try {
          const stat = statSync(resolve(dir, name));
          return `${stat.mtimeMs}:${stat.size}`;
        } catch {
          return "-";
        }
      })
      .join("|");
  };

  /** 目录读不出来就当空：清扫是尽力而为，不该因为一个坏目录让插件服务起不来 */
  const safeReaddir = (dir: string): string[] => {
    try {
      return readdirSync(dir);
    } catch {
      return [];
    }
  };

  const orphanedAtOf = (dir: string): number => {
    try {
      return statSync(resolve(dir, PLUGIN_ORPHAN_MARKER_FILENAME)).mtimeMs;
    } catch {
      try {
        return statSync(dir).mtimeMs;
      } catch {
        return Date.now();
      }
    }
  };

  /**
   * 把已经存在的版本目录改名成孤儿并写标记；不存在就什么都不做。
   * 改名而不是删除：正在跑的会话可能还指着它，交给清扫按保留期处理。
   */
  const orphanAt = (target: string): void => {
    if (!existsSync(target)) return;
    const stamp = new Date().toISOString();
    const orphan = resolve(
      dirname(target),
      `${PLUGIN_ORPHAN_DIRNAME_PREFIX}${basename(target)}-${stamp.replace(/[:.]/g, "-")}`,
    );
    try {
      renameSync(target, orphan);
    } catch (error) {
      // 改名失败（权限、跨设备）退回原路：先删掉再放新的，否则新副本无处落地
      logger.warn({ err: error, target }, "旧版本副本改名失败，改为直接删除");
      rmSync(target, { recursive: true, force: true });
      return;
    }
    try {
      writeFileSync(resolve(orphan, PLUGIN_ORPHAN_MARKER_FILENAME), stamp, "utf8");
    } catch (error) {
      // 标记写不进去不影响清扫：它会退回目录 mtime 计时
      logger.warn({ err: error, orphan }, "旧版本副本的标记文件写入失败，改按目录时间计算保留期");
    }
  };

  return {
    stagingRootFor: (marketplace) =>
      resolve(cacheDir, marketplace ?? LOCAL_MARKETPLACE_NAME, ".staging"),

    placeStaged: (staged) => {
      if (!staged.staged.staged) return staged.staged.path;
      const finalDir = resolve(
        cacheDir,
        staged.marketplace ?? LOCAL_MARKETPLACE_NAME,
        staged.name,
        staged.version,
      );
      try {
        mkdirSync(dirname(finalDir), { recursive: true });
        // 旧副本改名成孤儿并留 14 天：会话可能正握着 `${*_PLUGIN_ROOT}` 指向的旧路径在跑
        orphanAt(finalDir);
        renameSync(staged.staged.path, finalDir);
      } finally {
        // 暂存目录一律不留在盘上：它会污染内容哈希与组件扫描
        rmSync(staged.stagingRoot, { recursive: true, force: true });
      }
      return finalDir;
    },

    purge: (record) => {
      rmSync(resolve(pluginsDir, PLUGIN_DATA_DIRNAME, toDataDirName(record.id)), {
        recursive: true,
        force: true,
      });
      // `directory` 源的内容永远是用户（或市场克隆副本）的目录，删它等于删别人的东西——
      // 只看路径在不在 pluginsDir 里会漏掉「市场条目用相对路径」的那类（克隆副本恰好落在这里面）
      if (record.source.source === "directory") return false;
      if (!isInsidePath(pluginsDir, record.path)) return false;
      rmSync(record.path, { recursive: true, force: true });
      return true;
    },

    overridesFor: (cwd) => {
      if (!cwd) return null;
      const key = overridesKeyOf(cwd);
      if (overridesCache?.cwd === cwd && overridesCache.key === key) return overridesCache.value;
      const value = loadProjectPluginOverrides(cwd);
      overridesCache = { cwd, key, value };
      return value;
    },

    sweepOrphans: (reason, hasInstalled) => {
      // 一条记录都没有时留着现场，方便排查
      if (!hasInstalled) return;
      const now = Date.now();
      const ttlMs = PLUGIN_ORPHAN_TTL_DAYS * 24 * 60 * 60 * 1000;
      let removed = 0;
      for (const marketplace of safeReaddir(cacheDir)) {
        const marketDir = resolve(cacheDir, marketplace);
        for (const plugin of safeReaddir(marketDir)) {
          const pluginDir = resolve(marketDir, plugin);
          for (const entry of safeReaddir(pluginDir)) {
            if (!entry.startsWith(PLUGIN_ORPHAN_DIRNAME_PREFIX)) continue;
            const dir = resolve(pluginDir, entry);
            if (now - orphanedAtOf(dir) < ttlMs) continue;
            rmSync(dir, { recursive: true, force: true });
            removed += 1;
          }
        }
      }
      if (removed > 0) logger.info({ removed, reason }, "清掉了过期的插件旧版本副本");
    },
  };
};
