/**
 * 函数式弹层的调度：`openDialog` / `confirm` / `alert` 直接调用，弹层由宿主组件按队列渲染。
 *
 * 调用方不持有 open 状态，等 Promise 即可——`confirm` 给 boolean，`openDialog` 拿自定义弹层 close 出来的值。
 * 队列串行：同一时刻只渲染队首，避免多层遮罩叠在一起；宿主卸载时未决请求一律结算（confirm 视为取消），
 * 免得调用方的 await 永远悬着。
 *
 * `confirm` / `alert` 只传描述数据、不带组件：它们的渲染在 `business/confirm-dialog`，这里不引组件，
 * 否则 lib 要反向依赖 business。
 */
import type { ReactNode } from "react";

/** 确认框的描述数据 */
export type ConfirmOptions = {
  title: string;
  /** 补充说明；长文案放这里而不是标题里 */
  description?: string;
  /** 确认按钮文案；缺省「确定」 */
  confirmText?: string;
  /** 取消按钮文案；缺省「取消」 */
  cancelText?: string;
  /** 破坏性动作（归档 / 删除）：确认按钮走危险样式 */
  destructive?: boolean;
};

/** 单按钮提示的描述数据 */
export type AlertOptions = {
  title: string;
  description?: string;
  /** 按钮文案；缺省「知道了」 */
  confirmText?: string;
};

/** 自定义弹层的收尾回调：结果值交回调用方，省略即 undefined */
export type DialogClose<T = unknown> = (result?: T) => void;

type Settle = (result: unknown) => void;

/** 队列里的一条请求；宿主按 `kind` 选渲染器，custom 走 render */
export type DialogRequest =
  | { id: number; kind: "custom"; render: (close: DialogClose) => ReactNode; settle: Settle }
  | { id: number; kind: "confirm"; options: ConfirmOptions; settle: Settle }
  | { id: number; kind: "alert"; options: AlertOptions; settle: Settle };

let queue: DialogRequest[] = [];
let nextId = 0;
let hosts = 0;
const listeners = new Set<() => void>();

const emit = (): void => {
  for (const listener of listeners) listener();
};

/** 没有宿主就没人渲染：同步抛错，别让调用方的 await 悬着 */
const assertHost = (): void => {
  if (hosts > 0) return;
  // i18n-ignore: 开发者错误，不面向用户
  throw new Error("弹层宿主未挂载：请渲染 <DialogHost />（工作区预设里已挂在 Toaster 旁）");
};

const push = (request: DialogRequest): void => {
  queue = [...queue, request];
  emit();
};

const nextRequestId = (): number => {
  nextId += 1;
  return nextId;
};

/** 结算一条请求：先出队再 resolve，resolve 回调里再开弹层不会看到陈旧的队首 */
export const settleDialog = (request: DialogRequest, result: unknown): void => {
  const index = queue.findIndex((item) => item.id === request.id);
  if (index < 0) return;
  queue = [...queue.slice(0, index), ...queue.slice(index + 1)];
  emit();
  request.settle(result);
};

/** 结算全部未决请求：confirm 按取消算，其余给 undefined */
export const settlePendingDialogs = (): void => {
  const pending = queue;
  queue = [];
  emit();
  for (const request of pending) request.settle(request.kind === "confirm" ? false : undefined);
};

/** 宿主挂载；返回的注销函数会顺带结算未决请求 */
export const registerDialogHost = (): (() => void) => {
  hosts += 1;
  return () => {
    hosts -= 1;
    settlePendingDialogs();
  };
};

export const subscribeDialogs = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** 队首请求；宿主只渲染它 */
export const dialogHead = (): DialogRequest | null => queue[0] ?? null;

/** 排一个自定义弹层；`render` 拿到的 close 用来收尾并把结果交给调用方 */
export const openDialog = <T>(
  render: (close: DialogClose<T>) => ReactNode,
): Promise<T | undefined> => {
  assertHost();
  const id = nextRequestId();
  return new Promise<T | undefined>((resolve) => {
    push({
      id,
      kind: "custom",
      render,
      settle: (result) => resolve(result as T | undefined),
    });
  });
};

/** 确认框：确认 true；取消 / Esc / 宿主卸载 false */
export const confirm = (options: ConfirmOptions): Promise<boolean> => {
  assertHost();
  const id = nextRequestId();
  return new Promise<boolean>((resolve) => {
    push({ id, kind: "confirm", options, settle: (result) => resolve(result === true) });
  });
};

/** 单按钮提示：点掉即完成 */
export const alert = (options: AlertOptions): Promise<void> => {
  assertHost();
  const id = nextRequestId();
  return new Promise<void>((resolve) => {
    push({ id, kind: "alert", options, settle: () => resolve() });
  });
};
