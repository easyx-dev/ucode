/**
 * 设计稿标签里的画布：把「一份稿子」解析成画布视图。
 *
 * 稿子是**项目里的普通文件**，会话只是「当前在改哪一份」。所以打开一个设计标签就是两件事：
 * 把这份文件设成本会话的当前稿（服务端只记指针，不改文件），然后照它渲染。
 * 别的会话正在改同一份也没关系——服务端按路径只有一份文档，两边看到的是同一份。
 *
 * 于是不再有「只读预览 / 可编辑」两套分支：打开即接管输入，谁都可以改任何一份稿子。
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../../base/button";
import { Empty } from "../../../base/empty";
import { useDesignCanvas } from "../../../hooks/store/use-design";
import { useComposerInsert } from "../../../provider/composer-insert";
import { useWorkbench } from "../../../provider/workbench";
import { baseName } from "../../../utils/path";
import { DesignTabView as DesignTab } from "./design-tab";

export function DesignCanvas({ path }: { path: string }) {
  const workbench = useWorkbench();
  const sessionId = workbench?.sessionId ?? null;
  const canvas = useDesignCanvas(sessionId);

  if (sessionId === null) return <NoSession path={path} />;
  return <SessionCanvas path={path} sessionId={sessionId} canvas={canvas} />;
}

/** 没有会话时（草稿态打开文件）：画布要有一个会话才能落稿 */
function NoSession({ path }: { path: string }) {
  const { t } = useTranslation();
  return (
    <Empty
      className="h-full"
      title={t("还没有会话")}
      hint={`${baseName(path)} · ${t("设计稿挂在会话上：先发一条消息，画布才有地方落稿")}`}
    />
  );
}

/** 正在取数据的空壳：工具条先占位，避免加载时高度跳一下 */
const pendingView = (path: string) => ({
  path,
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

function SessionCanvas({
  path,
  sessionId,
  canvas,
}: {
  path: string;
  sessionId: string;
  canvas: ReturnType<typeof useDesignCanvas>;
}) {
  const { t } = useTranslation();
  const insert = useComposerInsert();
  const state = canvas.state;

  /** 已为哪个路径发过聚焦请求：`canvas` 每帧都是新对象，不加这个闸门会每渲染发一次 */
  const requested = useRef<string | null>(null);
  /**
   * 请求发出后迟迟没落到这份文件上（乱序的响应、服务端刚被回收……）。
   *
   * 只显示 spinner 的话用户只能刷新页面，所以给一个时限，过了就换成「重新打开」。
   */
  const [stalled, setStalled] = useState(false);
  const waiting = state === null || state.path !== path;
  useEffect(() => {
    if (!waiting) {
      setStalled(false);
      return;
    }
    const timer = setTimeout(() => setStalled(true), 4000);
    return () => clearTimeout(timer);
  }, [waiting]);

  // 打开设计标签 = 让本会话指向这份文件。指针在服务端内存里，界面就是它的唯一来源；
  // 标签只在**激活**时才挂载（见 editor-area），所以「挂载即聚焦」正是要的语义
  useEffect(() => {
    if (state?.path === path) {
      requested.current = null;
      return;
    }
    if (requested.current === path) return;
    requested.current = path;
    canvas.openFile(path);
  }, [canvas, path, state?.path]);

  // 指针还没指到这份文件（或首屏还没到）：先占位，别把另一份稿画出来
  if (waiting) {
    if (canvas.error !== null) {
      return <Empty className="h-full" title={t("这份设计稿打不开")} hint={canvas.error} />;
    }
    if (stalled) {
      return (
        <Empty
          className="h-full"
          title={t("没能打开这份设计稿")}
          hint={t("重试一次；还不行就重新打开这个标签")}
          action={
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                requested.current = null;
                setStalled(false);
                canvas.openFile(path);
              }}
            >
              {t("重试")}
            </Button>
          }
        />
      );
    }
    return <DesignTab {...pendingView(path)} />;
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
