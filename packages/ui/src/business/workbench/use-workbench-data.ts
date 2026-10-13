/** 工作台取数：文件内容与 git 的五个只读接口，统一走 `useAsyncData` 的 key + reloadToken 形态 */
import type {
  FsReadResponse,
  GitContentsResponse,
  GitDiffResponse,
  GitDiffSource,
  GitLogResponse,
  GitShowResponse,
  GitStatusResponse,
} from "@ucode/contracts";
import { useCallback } from "react";
import { type AsyncData, useAsyncData } from "../../hooks/use-async-data";
import { useClient } from "../../provider";

/** 读一个文件的内容；`path` 为 null 时不发请求 */
export function useFileContent(path: string | null, reloadToken = 0): AsyncData<FsReadResponse> {
  const client = useClient();
  return useAsyncData(
    path ?? "",
    () => {
      // i18n-ignore: 组件已保证传参非空，这里只是防御，不会渲染给用户
      if (!path) return Promise.reject(new Error("没有选中文件"));
      return client.apis.fs.read({ path });
    },
    reloadToken,
  );
}

export function useGitStatus(path: string | null, reloadToken = 0): AsyncData<GitStatusResponse> {
  const client = useClient();
  return useAsyncData(
    path ?? "",
    () => {
      // i18n-ignore: 组件已保证传参非空，这里只是防御，不会渲染给用户
      if (!path) return Promise.reject(new Error("没有工作目录"));
      return client.apis.git.status({ path });
    },
    reloadToken,
  );
}

/** 单文件 diff 的参数：来源与是否指定提交都进缓存键，换任一维都要重取 */
export type GitDiffTarget = {
  path: string;
  file: string;
  source: GitDiffSource;
  commit?: string;
};

const targetKey = (target: GitDiffTarget | null): string =>
  target
    ? `${target.path}\u0000${target.file}\u0000${target.source}\u0000${target.commit ?? ""}`
    : "";

export function useGitDiff(
  target: GitDiffTarget | null,
  reloadToken = 0,
): AsyncData<GitDiffResponse> {
  const client = useClient();
  const load = useCallback(() => {
    // i18n-ignore: 组件已保证传参非空，这里只是防御，不会渲染给用户
    if (!target) return Promise.reject(new Error("没有选中文件"));
    return client.apis.git.diff(target);
  }, [client, target]);
  return useAsyncData(targetKey(target), load, reloadToken);
}

/**
 * 对比两侧的原文：编辑器展开「未变更区域」时按行号从这里切片。
 * 参数与 `useGitDiff` 同一套，但要单独取——diff 的结构化 hunk 仍由服务端解析。
 */
export function useGitContents(
  target: GitDiffTarget | null,
  reloadToken = 0,
): AsyncData<GitContentsResponse> {
  const client = useClient();
  const load = useCallback(() => {
    // i18n-ignore: 组件已保证传参非空，这里只是防御，不会渲染给用户
    if (!target) return Promise.reject(new Error("没有选中文件"));
    return client.apis.git.contents(target);
  }, [client, target]);
  return useAsyncData(`contents\u0000${targetKey(target)}`, load, reloadToken);
}

export function useGitLog(
  path: string | null,
  limit: number,
  skip: number,
  reloadToken = 0,
): AsyncData<GitLogResponse> {
  const client = useClient();
  return useAsyncData(
    `${path ?? ""}\u0000${limit}\u0000${skip}`,
    () => {
      // i18n-ignore: 组件已保证传参非空，这里只是防御，不会渲染给用户
      if (!path) return Promise.reject(new Error("没有工作目录"));
      return client.apis.git.log({ path, limit, skip });
    },
    reloadToken,
  );
}

/** 单次提交的元信息与改动文件列表；`hash` 为 null 时不发请求 */
export function useGitCommit(
  path: string | null,
  hash: string | null,
  reloadToken = 0,
): AsyncData<GitShowResponse> {
  const client = useClient();
  return useAsyncData(
    `${path ?? ""}\u0000${hash ?? ""}`,
    () => {
      // i18n-ignore: 组件已保证传参非空，这里只是防御，不会渲染给用户
      if (!path || !hash) return Promise.reject(new Error("没有选中提交"));
      return client.apis.git.show({ path, hash });
    },
    reloadToken,
  );
}
