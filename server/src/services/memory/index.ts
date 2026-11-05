/**
 * 记忆浏览与维护：把磁盘上的项目级记忆读成界面能展示的视图，并支持改 / 删单条。
 *
 * 记忆按会话工作目录归属，磁盘上是 `memory/projects/<目录末段-路径哈希>` 一个项目一个目录，
 * 目录名里的哈希无法反算路径——因此候选项从**已知的工作目录**出发（项目登记表 + 会话表的 cwd），
 * 逐个算出目录名去比对；对不上的目录（原会话已被删掉、目录被手工搬过）照列，只是标不出项目。
 *
 * 只有「改」「删」两条写入路径，都是维护已有条目；**新增**仍走模型侧（`remember` 工具与自动回顾，
 * 见 `harness/features/memory`）——记忆是模型按用户意图固化的东西，界面不负责起草。
 * 改完让已装配的会话按新内容重装（与改开关同一条路径，由装配层注入 `onChange`）。
 */
import { readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

import type { MemoryEntryView, MemoryFactView, MemoryProjectView } from "@ucode/contracts";
import { ERROR_CODES } from "@ucode/contracts";

import type { ConfigStore } from "../../config/store";
import type { ProjectRepository } from "../../db/project-repository";
import type { SessionRepository } from "../../db/session-repository";
import { env } from "../../env";
import { projectDirName } from "../../harness/features/memory/paths";
import type { MemoryFactInput } from "../../harness/features/memory/store";
import {
  deleteFactInDir,
  memoryProjectsRoot,
  readFactInDir,
  readIndexInDir,
  updateFactInDir,
} from "../../harness/features/memory/store";
import { resolveTargetPath } from "../../platform/paths";
import { AppError } from "../../platform/response";

/** 目录名与文件名都必须是单段：带上分隔符、`.` / `..` 一律拒掉 */
const isSingleSegment = (value: string): boolean =>
  value.length > 0 &&
  value !== "." &&
  value !== ".." &&
  !value.includes("/") &&
  !value.includes("\\");

export type MemoryLibraryOptions = {
  sessions: SessionRepository;
  /** 项目登记表：展示名与项目级记忆开关都从这里读 */
  repository: ProjectRepository;
  config: ConfigStore;
  /** 记忆根目录；缺省用 `$APP_HOME/app` */
  appDir?: string;
  /**
   * 改 / 删之后的通知：记忆索引在会话装配时读入（见 `harness/setup`），已建好的会话要按新内容重装。
   * 由装配层注入，本服务不认识会话池。
   */
  onChange?: () => void;
};

export class MemoryLibrary {
  private readonly appDir: string;

  constructor(private readonly options: MemoryLibraryOptions) {
    this.appDir = options.appDir ?? env.appDir;
  }

  /**
   * 列出所有有记忆的项目。目录为空（还没写过任何记忆）时给空清单，不报错——
   * 「还没开启记忆」是正常状态，不是异常。
   */
  list(): MemoryProjectView[] {
    const root = memoryProjectsRoot(this.appDir);
    const dirs = this.projectDirs(root);
    const known = this.knownProjects();
    const overrides = new Map(
      this.options.repository.list().map((record) => [record.path, record.memoryEnabled]),
    );
    const enabledByDefault = this.options.config.get().memory.enabled;

    return dirs.map((dir) => {
      const project = known.get(dir);
      const entries: MemoryEntryView[] = readIndexInDir(resolve(root, dir)).map((entry) => ({
        file: entry.file,
        title: entry.title,
        description: entry.description,
      }));
      return {
        dir,
        path: project?.path ?? null,
        name: project?.name ?? null,
        // 生效值与装配层同口径（`MemoryService.enabledFor`）：项目覆盖优先，未设过跟随全局
        enabled: project ? (overrides.get(project.path) ?? enabledByDefault) : enabledByDefault,
        entries,
      };
    });
  }

  /** 读一条记忆的正文；名字不合法给 400，条目对不上给 404 */
  read(dir: string, file: string): MemoryFactView {
    this.assertSegments(dir, file);
    const absolute = this.resolveDir(dir);
    const content = readFactInDir(absolute, file);
    if (!content) {
      throw new AppError(ERROR_CODES.notFound, `记忆不存在：${file}`, 404, undefined, {
        path: file,
      });
    }
    const entry = readIndexInDir(absolute).find((item) => item.file === file);
    return { dir, file, title: entry?.title ?? file, content };
  }

  /** 改一条已有记忆的标题与正文；不在索引里（或文件已被删）按 404 */
  update(dir: string, file: string, input: MemoryFactInput): MemoryFactView {
    this.assertSegments(dir, file);
    const absolute = this.resolveDir(dir);
    const entry = updateFactInDir(absolute, file, input);
    if (!entry) {
      throw new AppError(ERROR_CODES.notFound, `记忆不存在：${file}`, 404, undefined, {
        path: file,
      });
    }
    this.options.onChange?.();
    return {
      dir,
      file: entry.file,
      title: entry.title,
      content: readFactInDir(absolute, entry.file),
    };
  }

  /** 删一条记忆；条目已不在时 `removed` 为 false，不报错（与删资产同口径） */
  remove(dir: string, file: string): { dir: string; file: string; removed: boolean } {
    this.assertSegments(dir, file);
    const absolute = this.resolveDir(dir);
    const removed = deleteFactInDir(absolute, file);
    if (removed) this.options.onChange?.();
    return { dir, file, removed };
  }

  /**
   * 目录名与文件名都必须是单段：带分隔符或 `.` / `..` 的一律 400——
   * 记忆根之外的文件不该有任何一条路径能指到（`safeFileName` 兜底，但那是静默忽略，这里要明说）。
   */
  private assertSegments(dir: string, file: string): void {
    const invalid = !isSingleSegment(dir) ? dir : !isSingleSegment(file) ? file : null;
    if (invalid === null) return;
    throw new AppError(ERROR_CODES.invalidRequest, `记忆路径不合法：${invalid}`, 400, undefined, {
      path: invalid,
    });
  }

  /** 把记忆目录名解析成绝对路径；目录不在清单里给 404 */
  private resolveDir(dir: string): string {
    const root = memoryProjectsRoot(this.appDir);
    if (!this.projectDirs(root).includes(dir)) {
      throw new AppError(ERROR_CODES.notFound, `记忆目录不存在：${dir}`, 404, undefined, {
        path: dir,
      });
    }
    return resolve(root, dir);
  }

  /** 记忆根下的项目目录清单；根不存在时给空数组 */
  private projectDirs(root: string): string[] {
    let names: string[];
    try {
      names = readdirSync(root);
    } catch {
      return [];
    }
    return names
      .filter((name) => {
        try {
          return statSync(resolve(root, name)).isDirectory();
        } catch {
          return false;
        }
      })
      .sort();
  }

  /**
   * 目录名 → 项目：候选项是项目登记表与会话表里出现过的工作目录。
   * 重名时以先登记的为准（同名目录属于同一路径，算出来的目录名也一样）。
   */
  private knownProjects(): Map<string, { path: string; name: string | null }> {
    const known = new Map<string, { path: string; name: string | null }>();
    const nameByPath = new Map(
      this.options.repository.list().map((record) => [record.path, record.name]),
    );
    for (const cwd of [...nameByPath.keys(), ...this.options.sessions.listCwds()]) {
      const path = resolveTargetPath(cwd);
      if (!known.has(projectDirName(path))) {
        known.set(projectDirName(path), { path, name: nameByPath.get(path) ?? null });
      }
    }
    return known;
  }
}
