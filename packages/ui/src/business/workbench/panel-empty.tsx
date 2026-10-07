/** 面板占位态：居中图标 + 主文案 + 可选说明与操作，空态与「没有内容可看」共用 */
export function PanelEmpty({
  icon,
  title,
  hint,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  /** 可选的后续动作（如「打开文件」「查看改动」） */
  action?: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-8 text-center">
      <span className="text-muted-foreground/60">{icon}</span>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {action ? <div className="mt-1 flex items-center gap-2">{action}</div> : null}
    </div>
  );
}
