/**
 * 项目偏好：按会话工作目录（cwd）归口的一组设置——侧栏展示用的名称，以及「最近一次在该项目里选择的」
 * 模型 / 思考档位 / 模式 / 权限档位。
 *
 * 两个方向：新建会话时把项目记住的值补进初始设置（`seedFor`），用户显式选过参数后写回项目（`remember`）。
 * 写回只由用户动作触发——子智能体与分叉继承来的值不算「用户选择」，都不经过这里。
 * 模型与模式的可用性只在读取时校验：记住的那个模型被删、模式角色被移除后按「未设置」回落，
 * 不能让项目里的陈旧值把 `sessions/create` 打成 400。
 */
import type { ProjectSummary } from "@ucode/contracts";
import { ERROR_CODES } from "@ucode/contracts";

import type { SessionSeed } from "../../core/session";
import {
  type ProjectDefaultsPatch,
  type ProjectRecord,
  ProjectRepository,
} from "../../db/project-repository";
import { toPermissionMode, toThinkingPreference } from "../../db/session-repository";
import { env } from "../../env";
import { AppError } from "../../lib/response";
import { resolveTargetPath } from "../../utils/path";
import { isWorkspaceCwd } from "../workspace";

export type ProjectServiceOptions = {
  /** 仓储；缺省用默认连接（测试可注入临时库） */
  repository?: ProjectRepository;
  /** 模型是否可用；不可用的项目默认值按未设置回落 */
  isModelUsable: (ref: string) => boolean;
  /** 该目录下是否存在这个 primary 模式角色（自定义角色随项目走，故要按目录判定） */
  hasMode: (cwd: string, mode: string) => boolean;
  /** 会话工作区根目录；它下面的目录是服务分配的，不算项目 */
  workspacesDir?: string;
  /**
   * 一次写入（改名或写回默认值）后的广播：客户端靠它刷新项目行。
   * 写回是「在会话里改了参数」的副作用，不发的话各端手上的还是初次加载的那份旧值。
   */
  onChange?: (projects: ProjectSummary[]) => void;
};

export class ProjectService {
  private readonly repository: ProjectRepository;
  private readonly workspacesDir: string;

  constructor(private readonly options: ProjectServiceOptions) {
    this.repository = options.repository ?? new ProjectRepository();
    this.workspacesDir = options.workspacesDir ?? env.workspacesDir;
  }

  /**
   * 项目列表。默认值已按当前可用性过滤：客户端拿它预填新建会话的选择器，
   * 填进去的必须是一次就能建起来的值（否则发送时会撞上 `unknown_model` / 未知模式）。
   */
  list(): ProjectSummary[] {
    return this.repository.list().map((record) => this.viewOf(record));
  }

  /** 改名；`name` 为 null 清空（界面回落目录末段）。路径不存在于磁盘上也允许——目录可能只是暂时没挂上 */
  rename(path: string, name: string | null): ProjectSummary {
    const normalized = this.toProjectPath(path);
    if (!normalized) {
      throw new AppError(ERROR_CODES.invalidRequest, "助理工作区不是项目目录", 400, undefined, {
        path,
      });
    }
    this.repository.setName(normalized, name);
    const record = this.repository.find(normalized);
    if (!record) {
      throw new AppError(ERROR_CODES.internal, "项目写入后读不回来", 500);
    }
    this.notify();
    return this.viewOf(record);
  }

  /**
   * 登记项目并写回用户这次显式选择的参数（会话创建与更新都走它）。
   * 没有显式参数时只登记一行；`cwd` 不是项目目录（未绑定目录的会话、助理工作区）时什么也不做。
   */
  remember(cwd: string | null, patch: ProjectDefaultsPatch): void {
    const path = this.toProjectPath(cwd);
    if (!path) return;

    const defaults: ProjectDefaultsPatch = {
      ...(patch.model ? { model: patch.model } : {}),
      ...(patch.thinkingLevel ? { thinkingLevel: patch.thinkingLevel } : {}),
      ...(patch.mode ? { mode: patch.mode } : {}),
      ...(patch.permissionMode ? { permissionMode: patch.permissionMode } : {}),
    };
    if (Object.keys(defaults).length === 0) {
      this.repository.ensure(path);
      this.notify();
      return;
    }
    this.repository.rememberDefaults(path, defaults);
    this.notify();
  }

  /** 新建会话的初始设置：请求里显式给的优先，缺的用项目记住的值补 */
  seedFor(cwd: string | null | undefined, seed: SessionSeed): SessionSeed {
    const path = this.toProjectPath(cwd);
    const record = path ? this.repository.find(path) : undefined;
    if (!record) return seed;

    const defaults = this.usableDefaults(record);
    const model = seed.model ?? defaults.model;
    const thinkingLevel = seed.thinkingLevel ?? defaults.thinkingLevel;
    const mode = seed.mode ?? defaults.mode;
    const permissionMode = seed.permissionMode ?? defaults.permissionMode;

    return {
      ...(seed.cwd ? { cwd: seed.cwd } : {}),
      ...(model ? { model } : {}),
      ...(thinkingLevel ? { thinkingLevel } : {}),
      ...(mode ? { mode } : {}),
      ...(permissionMode ? { permissionMode } : {}),
    };
  }

  /**
   * 启动对账：清掉没有任何会话行（含已归档）引用的项目行。
   *
   * 项目行随会话登记、界面上能看到的项目也来自会话，「一个会话都不引用」即无主：
   * 目录改名 / 迁移后留下的旧行只增不减，而每次写回都要连带重算并广播整份列表。
   * 与工作区孤儿清理同一取向，不广播（启动阶段还没有订阅者）；返回被清掉的路径供日志。
   */
  reconcile(keepPaths: readonly string[]): string[] {
    return this.repository.deleteOrphans(keepPaths.map((path) => resolveTargetPath(path)));
  }

  /** 归一化并排除助理工作区；返回 null 表示这个目录不归项目管 */
  private toProjectPath(path: string | null | undefined): string | null {
    if (!path) return null;
    const normalized = resolveTargetPath(path);
    return isWorkspaceCwd(normalized, this.workspacesDir) ? null : normalized;
  }

  private notify(): void {
    this.options.onChange?.(this.list());
  }

  /** 行里当前仍然可用的默认值：模型不可用、模式角色不存在、枚举非法的一律不出现 */
  private usableDefaults(record: ProjectRecord): ProjectDefaultsPatch {
    const thinkingLevel = toThinkingPreference(record.thinkingLevel);
    const permissionMode = toPermissionMode(record.permissionMode);
    return {
      ...(record.model && this.options.isModelUsable(record.model) ? { model: record.model } : {}),
      ...(thinkingLevel ? { thinkingLevel } : {}),
      ...(record.mode && this.options.hasMode(record.path, record.mode)
        ? { mode: record.mode }
        : {}),
      ...(permissionMode ? { permissionMode } : {}),
    };
  }

  private viewOf(record: ProjectRecord): ProjectSummary {
    const defaults = this.usableDefaults(record);
    return {
      id: record.id,
      path: record.path,
      name: record.name,
      model: defaults.model ?? null,
      thinkingLevel: defaults.thinkingLevel ?? null,
      mode: defaults.mode ?? null,
      permissionMode: defaults.permissionMode ?? null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
