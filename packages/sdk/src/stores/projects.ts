/** 项目列表：初次加载，改名 / 记忆开关后由 projects_changed 控制帧刷新 */
import type { ProjectListResponse, ProjectSummary, ProjectUpdateRequest } from "@ucode/contracts";

import type { Apis } from "../apis";
import { type ApiError, asApiError } from "../error";
import type { EventStream } from "../events";
import { createStore, type Store } from "../store";

export type ProjectsState = {
  data: ProjectListResponse | null;
  error: ApiError | null;
};

export type ProjectsStore = {
  getState: Store<ProjectsState>["getState"];
  subscribe: Store<ProjectsState>["subscribe"];
  load: () => Promise<void>;
  /** 重命名（`name` 传 null 即清空）；成功后由控制帧带来权威列表 */
  rename: (body: ProjectUpdateRequest) => Promise<ProjectSummary | null>;
  /** 设项目级记忆开关（`null` 表示回到「跟随全局」）；成功后由控制帧带来权威列表 */
  setMemory: (path: string, enabled: boolean | null) => Promise<ProjectSummary | null>;
  /** 重排（`paths` 是侧栏里从上到下的目录次序） */
  reorder: (paths: string[]) => Promise<void>;
};

/**
 * 按 `paths` 重排项目行：没提到的接在后面，保持它们当前的相对次序（与服务端同一口径）。
 * 用稳定排序，才能让「没提到的」这一段不动。
 */
const orderByPaths = (projects: ProjectSummary[], paths: string[]): ProjectSummary[] => {
  const position = new Map(paths.map((path, index) => [path, index]));
  const rankOf = (project: ProjectSummary): number => position.get(project.path) ?? paths.length;
  return [...projects].sort((a, b) => rankOf(a) - rankOf(b));
};

export const createProjectsStore = (deps: { apis: Apis; events: EventStream }): ProjectsStore => {
  const store = createStore<ProjectsState>({ data: null, error: null });

  const load = async (): Promise<void> => {
    try {
      const data = await deps.apis.projects.list();
      store.setState((prev) => ({ ...prev, data, error: null }));
    } catch (error) {
      store.setState((prev) => ({ ...prev, error: asApiError(error) }));
    }
  };

  /** 改项目设置：两个入口走同一个接口，失败都记到 error 上 */
  const send = async (body: ProjectUpdateRequest): Promise<ProjectSummary | null> => {
    try {
      return await deps.apis.projects.update(body);
    } catch (error) {
      store.setState((prev) => ({ ...prev, error: asApiError(error) }));
      return null;
    }
  };

  deps.events.onEvent((frame) => {
    if (frame.type === "projects_changed") {
      store.setState((prev) => ({ ...prev, data: frame.projects, error: null }));
    }
  });

  void load();

  // 重连补快照：断流期间可能错过 projects_changed
  let connectedOnce = false;
  deps.events.onConnected(() => {
    if (!connectedOnce) {
      connectedOnce = true;
      return;
    }
    void load();
  });

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    load,
    rename: send,
    setMemory: (path, enabled) => send({ path, memoryEnabled: enabled }),
    async reorder(paths) {
      // 拖拽落下就要看到新次序：先在本地落位，再用服务端回的整份列表覆盖
      store.setState((prev) =>
        prev.data
          ? { ...prev, data: { ...prev.data, projects: orderByPaths(prev.data.projects, paths) } }
          : prev,
      );
      try {
        const data = await deps.apis.projects.reorder({ paths });
        store.setState((prev) => ({ ...prev, data, error: null }));
      } catch (error) {
        const failure = asApiError(error);
        // 本地已经先动过了：取回权威列表纠正回来；错误最后设，别被 load 的成功清掉
        await load();
        store.setState((prev) => ({ ...prev, error: failure }));
      }
    },
  };
};
