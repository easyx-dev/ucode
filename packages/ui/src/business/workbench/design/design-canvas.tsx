/**
 * 设计画布标签：把「本会话当前在改的那份稿」解析成画布视图。
 *
 * **标签只是视图**：它不携带稿子身份，也**不会把指针改到别处**——切换会话、刷新页面重开标签都不会把
 * 别的稿子带过来（没有指针时首次取值只是确立一个默认落点）。「本会话在改哪份」是会话上的指针，
 * 只由显式打开改写（清单点一份 / 文件树点 `.design` / agent `design_open`），并随会话持久化，
 * 重启后 agent 与画布仍指向同一份。
 *
 * 稿子仍是项目里的普通文件：别的会话正在改同一份也没关系——服务端按路径只有一份文档，
 * 两边看到的是同一份。
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../../base/button";
import { Empty } from "../../../base/empty";
import { useDesignCanvas } from "../../../hooks/store/use-design";
import { useComposerInsert } from "../../../provider/composer-insert";
import { useWorkbench } from "../../../provider/workbench";
import { DesignTabView as DesignTab } from "./design-tab";

/** 正在取数据的空壳：工具条先占位，避免加载时高度跳一下 */
const pendingView = () => ({
  path: "",
  sessionId: "",
  revision: 0,
  pages: [],
  pageId: "",
  svg: "",
  boxes: {},
  bounds: null,
  nodes: [],
  selection: [],
  loading: true,
});

export function DesignCanvas() {
  const { t } = useTranslation();
  const workbench = useWorkbench();
  const sessionId = workbench?.sessionId ?? null;
  const canvas = useDesignCanvas(sessionId);
  const insert = useComposerInsert();
  const state = canvas.state;

  /** 首屏迟迟没到（文档很大、服务端刚回收）：只转 spinner 的话用户只能刷新页面，所以给一个时限 */
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    if (state !== null) {
      setStalled(false);
      return;
    }
    const timer = setTimeout(() => setStalled(true), 4000);
    return () => clearTimeout(timer);
  }, [state]);

  if (sessionId === null) {
    return (
      <Empty
        className="h-full"
        title={t("还没有会话")}
        hint={t("设计稿挂在会话上：先发一条消息，画布才有地方落稿")}
      />
    );
  }

  if (state === null) {
    if (canvas.error !== null) {
      return <Empty className="h-full" title={t("这份设计稿打不开")} hint={canvas.error} />;
    }
    if (stalled) {
      return (
        <Empty
          className="h-full"
          title={t("没能打开这份设计稿")}
          hint={t("重试一次；还不行就换一份稿子再切回来")}
          action={
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setStalled(false);
                canvas.reload();
              }}
            >
              {t("重试")}
            </Button>
          }
        />
      );
    }
    return <DesignTab {...pendingView()} />;
  }

  return (
    <DesignTab
      path={state.path}
      pages={state.pages}
      pageId={state.pageId}
      svg={state.svg}
      boxes={state.boxes}
      bounds={state.bounds}
      nodes={state.nodes}
      selection={state.selection}
      loading={false}
      sessionId={sessionId}
      revision={state.revision}
      {...(state.truncated ? { truncated: true } : {})}
      {...(state.warning === undefined ? {} : { warning: state.warning })}
      mentionPrefix={state.mentionPrefix}
      onSelect={(ids) => canvas.select(ids)}
      onInsert={(nodeId) => {
        const label = state.nodes.find((node) => node.id === nodeId)?.name ?? nodeId;
        insert({
          kind: "designNode",
          label,
          anchor: `${state.mentionPrefix}/${state.pageId}/${nodeId}`,
        });
      }}
      onPageChange={(pageId) => canvas.setPage(pageId)}
      onCreatePage={() => canvas.createPage()}
      onReload={() => canvas.reload()}
    />
  );
}
