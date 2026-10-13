/**
 * 编辑器区的文档标签：状态与动作。
 *
 * 纯逻辑在 `business/workbench/workbench-docs`，这里只管持状态、把动作包成稳定回调。工作目录变化即清空标签
 * ——标签里的路径都绑在旧目录上，留着只会打开另一个仓库里的同名文件。
 */
import { useCallback, useEffect, useReducer, useRef } from "react";

import { emptyWorkbenchDocs, type WorkbenchDoc, workbenchDocsReducer } from "./workbench-docs";

export type WorkbenchDocs = {
  docs: readonly WorkbenchDoc[];
  activeDocId: string | null;
  open: (doc: WorkbenchDoc) => void;
  select: (id: string) => void;
  close: (id: string) => void;
  /** 只留这一个标签（标签右键菜单） */
  closeOthers: (id: string) => void;
  closeAll: () => void;
};

export function useWorkbenchDocs(cwd: string | null): WorkbenchDocs {
  const [state, dispatch] = useReducer(workbenchDocsReducer, emptyWorkbenchDocs);
  const previousCwd = useRef(cwd);

  useEffect(() => {
    if (previousCwd.current === cwd) return;
    previousCwd.current = cwd;
    dispatch({ type: "reset" });
  }, [cwd]);

  const open = useCallback((doc: WorkbenchDoc) => dispatch({ type: "open", doc }), []);
  const select = useCallback((id: string) => dispatch({ type: "select", id }), []);
  const close = useCallback((id: string) => dispatch({ type: "close", id }), []);
  const closeOthers = useCallback((id: string) => dispatch({ type: "closeOthers", id }), []);
  const closeAll = useCallback(() => dispatch({ type: "closeAll" }), []);

  return {
    docs: state.docs,
    activeDocId: state.activeDocId,
    open,
    select,
    close,
    closeOthers,
    closeAll,
  };
}
