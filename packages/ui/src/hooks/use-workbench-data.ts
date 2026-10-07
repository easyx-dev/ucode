/** 工作台取数：文件内容与 git 的四个只读接口，统一走 `useAsyncData` 的 key + reloadToken 形态 */
import type {
  FsReadResponse,
  GitDiffResponse,
  GitDiffSource,
  GitLogResponse,
  GitShowResponse,
  GitStatusResponse,
} from "@ucode/contracts";
import { useCallback } from "react";

import { useClient } from "../provider";
import { type AsyncData, useAsyncData } from "./use-async-data";

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

export function useGitDiff(
  input: { path: string; file: string; source: GitDiffSource; commit?: string } | null,
  reloadToken = 0,
): AsyncData<GitDiffResponse> {
  const client = useClient();
  const key = input
    ? `${input.path}\u0000${input.file}\u0000${input.source}\u0000${input.commit ?? ""}`
    : "";
  const load = useCallback(() => {
    // i18n-ignore: 组件已保证传参非空，这里只是防御，不会渲染给用户
    if (!input) return Promise.reject(new Error("没有选中文件"));
    return client.apis.git.diff(input);
  }, [client, input]);
  return useAsyncData(key, load, reloadToken);
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
