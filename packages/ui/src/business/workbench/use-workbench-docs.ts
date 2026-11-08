/**
 * 编辑器区的文档标签：状态与动作。
 *
 * 纯逻辑在 `business/workbench/workbench-docs`，这里只管持状态、把动作包成稳定回调。
 * 工作目录或会话变了即清空标签：标签里的路径与画布都绑在旧会话上，留着只会打开另一个仓库里的同名文件。
 * 浏览器标签例外，它跟目录与会话都无关（见 `workbench-docs` 的 `reset`）。
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

export function useWorkbenchDocs(cwd: string | null, sessionId: string | null): WorkbenchDocs {
  const [state, dispatch] = useReducer(workbenchDocsReducer, emptyWorkbenchDocs);
  const previousRef = useRef({ cwd, sessionId });

  useEffect(() => {
    const previous = previousRef.current;
    // 目录换了：文件 / diff 标签都绑旧目录，全清；只是换了会话：设计画布属于会话，单独丢
    if (previous.cwd !== cwd) dispatch({ type: "reset" });
    else if (previous.sessionId !== sessionId) dispatch({ type: "dropDesign" });
    previousRef.current = { cwd, sessionId };
  }, [cwd, sessionId]);

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
