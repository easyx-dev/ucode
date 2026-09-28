/** 空态：未配置模型 / 还没有会话 / 未选择会话 */
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type WelcomePanelProps = {
  configured: boolean;
  /** 当前默认模型，"provider/model" */
  defaultModel: string | null;
  /** 是否已有任何会话 */
  hasSessions: boolean;
  onCreate: () => void;
  onOpenSettings: () => void;
};

export function WelcomePanel({
  configured,
  defaultModel,
  hasSessions,
  onCreate,
  onOpenSettings,
}: WelcomePanelProps) {
  if (!configured) {
    return (
      <Card className="mx-auto max-w-lg border-dashed">
        <CardHeader>
          <CardTitle className="text-base">还没有配置模型</CardTitle>
          <CardDescription>
            填入一个 OpenAI 兼容端点（baseUrl / apiKey / 模型 id）后即可开始对话。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={onOpenSettings}>打开模型设置</Button>
        </CardContent>
      </Card>
    );
  }

  if (!hasSessions) {
    return (
      <Card className="mx-auto max-w-lg border-dashed">
        <CardHeader>
          <CardTitle className="text-base">开始第一个会话</CardTitle>
          <CardDescription>
            模型已就绪：{defaultModel ?? "-"}。会话里的 agent 可以读写
            <code className="mx-1 rounded bg-muted px-1">.tmp/.ucode</code>
            下的文件并执行命令。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={onCreate}>新建会话</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-2 text-center text-sm text-muted-foreground">
      <p>选择左侧会话，或新建一个会话开始对话。</p>
    </div>
  );
}
