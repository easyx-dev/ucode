/**
 * 变更列表 → 目录树：把「相对仓库根的路径」按 `/` 折成树，供改动面板按目录浏览。
 *
 * 不做「单子目录合并成 `a/b/c`」这种压缩——改动集通常不大，压了反而看不出层级。
 * 排序固定为目录在前、各自按名称，与服务端 `fs/list` 以及 git 自己的输出同口径。
 * 条目类型交给调用方：工作区变更带来源桶，提交里的文件没有。
 *
 * 同一个节点可以既是文件又有子节点：子模块路径 `hub` 是指针变更的条目，`hub/app/x.ts` 是它内部的
 * 改动，两者折到同一个节点上（渲染见 `git-change-tree`）。
 */
import { GIT_MARK_ORDER, type GitMark } from "./git-marks";

export type ChangeTreeNode<T> = {
  /** 该层展示的名字；根节点为空串 */
  name: string;
  /** 相对仓库根的路径前缀；文件节点为文件自身路径 */
  path: string;
  /** 子节点，仅目录有 */
  children: ChangeTreeNode<T>[];
  /** 文件节点带原始条目；目录为 undefined */
  file?: T;
};

const byKindThenName = <T>(a: ChangeTreeNode<T>, b: ChangeTreeNode<T>): number => {
  const aDir = a.file === undefined;
  const bDir = b.file === undefined;
  if (aDir !== bDir) return aDir ? -1 : 1;
  return a.name.localeCompare(b.name);
};

/** 把一组条目折成树；入参为空时返回单个根节点 */
export const buildChangeTree = <T extends { path: string }>(
  files: readonly T[],
): ChangeTreeNode<T> => {
  const root: ChangeTreeNode<T> = { name: "", path: "", children: [] };

  for (const file of files) {
    const segments = file.path.split("/").filter(Boolean);
    let node = root;
    segments.forEach((segment, index) => {
      const isLeaf = index === segments.length - 1;
      const path = segments.slice(0, index + 1).join("/");
      let child = node.children.find((item) => item.name === segment);
      if (!child) {
        child = { name: segment, path, children: [] };
        node.children.push(child);
      }
      // 同名文件与目录可能共存（子模块路径既是指针条目、又是它内部文件的父目录），
      // 所以最后一段既属于这个文件，也可能已经有子节点
      if (isLeaf) child.file = file;
      node = child;
    });
  }

  const sort = (node: ChangeTreeNode<T>): void => {
    node.children.sort(byKindThenName);
    for (const child of node.children) sort(child);
  };
  sort(root);
  return root;
};

/** 节点下的变更文件数：自身是文件的算一个，目录按子节点汇总 */
export const countFiles = <T>(node: ChangeTreeNode<T>): number => {
  const self = node.file === undefined ? 0 : 1;
  return node.children.reduce((total, child) => total + countFiles(child), self);
};

/** 目录下出现过的标记：去重后按展示顺序排；文件节点只给自己那一个 */
export const marksOf = <T>(
  node: ChangeTreeNode<T>,
  markOfFile: (file: T) => GitMark,
): readonly GitMark[] => {
  const marks = new Set<GitMark>();
  const collect = (current: ChangeTreeNode<T>): void => {
    if (current.file) marks.add(markOfFile(current.file));
    for (const child of current.children) collect(child);
  };
  collect(node);
  return GIT_MARK_ORDER.filter((mark) => marks.has(mark));
};
