/** 项目空间：登记目录集合的加载与增 / 改名 / 移除 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { api, describeError } from "@/lib/api";
import type { Project } from "@/lib/types";

export type ProjectListController = {
  projects: Project[];
  loading: boolean;
  refresh: () => Promise<void>;
  /** 登记目录；已被登记时服务端幂等返回原项目 */
  add: (path: string) => Promise<Project | null>;
  rename: (projectId: string, name: string) => Promise<void>;
  /** 移除登记；会话不受影响，自动回落「默认」分组 */
  remove: (projectId: string) => Promise<void>;
};

export function useProjects(): ProjectListController {
  const { t } = useTranslation();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.projects.list();
      setProjects(data.projects);
    } catch (error) {
      toast.error(t("失败提示", { label: t("项目列表加载失败"), reason: describeError(error) }));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const add = useCallback(
    async (path: string): Promise<Project | null> => {
      try {
        const project = await api.projects.create(path);
        setProjects((prev) =>
          prev.some((item) => item.id === project.id) ? prev : [project, ...prev],
        );
        toast.success(t("项目已添加"));
        return project;
      } catch (error) {
        toast.error(t("失败提示", { label: t("添加项目失败"), reason: describeError(error) }));
        return null;
      }
    },
    [t],
  );

  const rename = useCallback(
    async (projectId: string, name: string): Promise<void> => {
      setProjects((prev) => prev.map((item) => (item.id === projectId ? { ...item, name } : item)));
      try {
        await api.projects.update({ projectId, name });
      } catch (error) {
        toast.error(t("失败提示", { label: t("重命名项目失败"), reason: describeError(error) }));
        // 失败后以服务端为准重新拉取，避免用旧快照回滚时丢掉并发的增删
        void refresh();
      }
    },
    [refresh, t],
  );

  const remove = useCallback(
    async (projectId: string): Promise<void> => {
      try {
        await api.projects.remove(projectId);
        setProjects((prev) => prev.filter((item) => item.id !== projectId));
        toast.success(t("项目已删除"));
      } catch (error) {
        toast.error(t("失败提示", { label: t("删除项目失败"), reason: describeError(error) }));
      }
    },
    [t],
  );

  return { projects, loading, refresh, add, rename, remove };
}
