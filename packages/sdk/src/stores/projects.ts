/** 项目列表：初次加载，改名后由 projects_changed 控制帧刷新 */
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
    async rename(body) {
      try {
        return await deps.apis.projects.update(body);
      } catch (error) {
        store.setState((prev) => ({ ...prev, error: asApiError(error) }));
        return null;
      }
    },
  };
};
