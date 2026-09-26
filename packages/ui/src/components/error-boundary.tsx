import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * 错误边界。
 *
 * 存在的理由来自一次真实运行：组件里抛错时整页白屏，看不到任何线索。
 * 壳子至少要把"哪一块坏了、坏在哪"显示出来——否则用户只会以为"什么都没发生"。
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; label?: string },
  { error: Error | null; info: string | null }
> {
  constructor(props: { children: ReactNode; label?: string }) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ error, info: info.componentStack ?? null });
  }

  override render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    return (
      <div className="m-4 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-4 text-sm">
        <p className="mb-2 font-medium text-[var(--color-danger)]">
          {this.props.label ?? "界面"}出错了：{this.state.error.message}
        </p>
        <p className="mb-3 text-[var(--color-content-muted)]">
          连接与会话数据不受影响；刷新页面即可恢复。
        </p>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-[var(--font-mono)] text-[11px] text-[var(--color-content-muted)]">
          {this.state.error.stack ?? ""}
          {this.state.info ?? ""}
        </pre>
      </div>
    );
  }
}
