/**
 * 终端的错误边界：终端这一块出问题时只让它自己让位，别把整个工作台（乃至整个应用）带崩。
 *
 * 需要它是因为 xterm 与它的 addon 是「第三方在渲染期与 effect 里抛错」的来源：
 * 实测一次 addon 要求的 proposed API 没放行，就让 React 卸载了整棵树、整页空白——
 * 这种失败模式不该由一个可选的辅助面板引发。重试即换 key 重新挂载子树。
 */
import { Component, type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../../../base/button";
import { Empty } from "../../../base/empty";

type CatcherProps = {
  children: ReactNode;
  title: string;
  action: string;
  onRetry: () => void;
};

class TerminalErrorCatcher extends Component<CatcherProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <Empty
        className="h-full"
        title={this.props.title}
        action={
          <Button size="sm" variant="outline" onClick={this.props.onRetry}>
            {this.props.action}
          </Button>
        }
      />
    );
  }
}

export function TerminalBoundary({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  // 换 key 即重新挂载子树：终端实例与连接都会重建，比留在坏状态里强
  const [attempt, setAttempt] = useState(0);

  return (
    <TerminalErrorCatcher
      key={attempt}
      action={t("重试")}
      title={t("终端画面出错了")}
      onRetry={() => setAttempt((prev) => prev + 1)}
    >
      {children}
    </TerminalErrorCatcher>
  );
}
