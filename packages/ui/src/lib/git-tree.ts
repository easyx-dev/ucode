/**
 * 变更列表 → 目录树：把「相对仓库根的路径」按 `/` 折成树，供改动面板按目录浏览。
 *
 * 不做「单子目录合并成 `a/b/c`」这种压缩——改动集通常不大，压了反而看不出层级。
 * 排序固定为目录在前、各自按名称，与服务端 `fs/list` 以及 git 自己的输出同口径。
 */
import type { GitFileChange } from "@ucode/contracts";

export type ChangeTreeNode = {
  /** 该层展示的名字；根节点为空串 */
  name: string;
  /** 相对仓库根的路径前缀；文件节点为文件自身路径 */
  path: string;
  /** 子节点，仅目录有 */
  children: ChangeTreeNode[];
  /** 文件节点带原始变更条目；目录为 undefined */
  file?: GitFileChange;
};

const byKindThenName = (a: ChangeTreeNode, b: ChangeTreeNode): number => {
  const aDir = a.file === undefined;
  const bDir = b.file === undefined;
  if (aDir !== bDir) return aDir ? -1 : 1;
  return a.name.localeCompare(b.name);
};

/** 把一组变更折成树；入参为空时返回单个根节点 */
export const buildChangeTree = (files: readonly GitFileChange[]): ChangeTreeNode => {
  const root: ChangeTreeNode = { name: "", path: "", children: [] };

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
      // 同名目录与文件不会在同一个仓库里共存，因此最后一段一定属于这个文件
      if (isLeaf) child.file = file;
      node = child;
    });
  }

  const sort = (node: ChangeTreeNode): void => {
    node.children.sort(byKindThenName);
    for (const child of node.children) sort(child);
  };
  sort(root);
  return root;
};

/** 目录下的变更文件数（目录节点用；文件节点为 0） */
export const countFiles = (node: ChangeTreeNode): number => {
  if (node.file) return 0;
  return node.children.reduce((total, child) => total + (child.file ? 1 : countFiles(child)), 0);
};
