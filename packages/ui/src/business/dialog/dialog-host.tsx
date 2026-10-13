/**
 * 函数式弹层的宿主：订阅 `business/dialog/queue` 的队列，把队首渲染出来。
 *
 * 与 `Toaster` 一样挂在工作区里——弹层要用 i18n 与 UI 上下文，而调用方（任意业务代码）不该关心这些。
 */
import { useEffect, useSyncExternalStore } from "react";
import { ConfirmDialog } from "./confirm-dialog";
import { dialogHead, registerDialogHost, settleDialog, subscribeDialogs } from "./queue";

export function DialogHost() {
  const request = useSyncExternalStore(subscribeDialogs, dialogHead, dialogHead);

  // 挂载期即「有宿主」；卸载时注销会把未决请求结算掉
  useEffect(() => registerDialogHost(), []);

  if (!request) return null;
  const close = (result?: unknown): void => {
    settleDialog(request, result);
  };

  if (request.kind === "confirm") {
    return (
      <ConfirmDialog
        variant="confirm"
        options={request.options}
        onResolve={(confirmed) => close(confirmed)}
      />
    );
  }
  if (request.kind === "alert") {
    return <ConfirmDialog variant="alert" options={request.options} onResolve={() => close()} />;
  }
  return <>{request.render(close)}</>;
}
