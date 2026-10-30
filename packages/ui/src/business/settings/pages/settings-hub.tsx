/**
 * 中继设置：登录 / 登出中继，查看设备绑定与隧道运行态，把它的模型端点写成本机的普通 provider。
 *
 * 已接入时把「本机连中继用的地址」与「公网访问入口」分开说：后者由中继侧部署决定，本机推不出来，不拼。
 */
import type { HubStatusResponse } from "@ucode/contracts";
import { RefreshCw } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Badge } from "../../../base/badge";
import { Button } from "../../../base/button";
import { Input } from "../../../base/input";
import { Label } from "../../../base/label";
import { Spinner } from "../../../base/spinner";
import { useErrorText } from "../../../hooks/use-error-text";
import { confirm } from "../../dialog/queue";
import { SettingsSectionHeader } from "../settings-page";
import { SettingsGroup, SettingsRow } from "../settings-row";
import { type Hub, type HubPhase, useHub } from "./use-hub";

/** 字段取不到值时的占位：不留空白，也不假装有值 */
const EMPTY = "—";

/** 未接入：用中继侧账号登录，成功即把本机登记为设备 */
function LoginForm({ hub, defaultUrl }: { hub: Hub; defaultUrl: string }) {
  const { t } = useTranslation();
  const [url, setUrl] = useState(defaultUrl);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const canSubmit = username.trim().length > 0 && password.length > 0 && !hub.busy;

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!canSubmit) return;
    void hub.login({ url, username, password });
  };

  return (
    <section className="space-y-3">
      <SettingsSectionHeader title={t("接入中继")} />
      <form
        className="space-y-4 rounded-xl bg-popover p-4 ring-1 ring-border-strong"
        onSubmit={submit}
      >
        <p className="text-sm leading-relaxed text-foreground-subtle">
          {t(
            "用中继侧的账号登录：登录成功即把本机登记为中继上的一台设备，此后由服务维持隧道保活。",
          )}
        </p>

        <div className="space-y-1">
          <Label htmlFor="hub-url">{t("中继地址")}</Label>
          <Input
            id="hub-url"
            type="url"
            autoComplete="off"
            placeholder={t("留空则用部署预置值")}
            aria-describedby="hub-url-hint"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
          <p id="hub-url-hint" className="text-xs text-foreground-subtle">
            {t(
              "形如 https://hub.example.com。公网访问入口由中继侧部署决定，可能与本机连接的地址不同。",
            )}
          </p>
        </div>

        <div className="space-y-1">
          <Label htmlFor="hub-username">{t("账号")}</Label>
          <Input
            id="hub-username"
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="hub-password">{t("密码")}</Label>
          <Input
            id="hub-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        <Button type="submit" size="sm" disabled={!canSubmit}>
          {hub.busy ? <Spinner /> : null}
          {t("登录")}
        </Button>
      </form>
    </section>
  );
}

/** 隧道状态：阶段徽标 + 上线时间 / 最近错误 / 重连次数 */
function TunnelStatus({ data, phase }: { data: HubStatusResponse; phase: HubPhase }) {
  const { t } = useTranslation();
  const { runtime } = data;

  const labels: Record<HubPhase, string> = {
    connected: t("已连接"),
    connecting: t("连接中"),
    reconnecting: t("重连中"),
    offline: t("未连接"),
  };
  const hints: Record<HubPhase, string> = {
    connected: t("本机已与中继建立隧道，中继上的请求可以转给本机服务。"),
    connecting: t("正在与中继建立隧道连接。"),
    reconnecting: t("连接已断开，正在按退避重试；重连成功前请求无法转给本机。"),
    offline: t("当前没有隧道连接。"),
  };

  return (
    <SettingsGroup>
      <SettingsRow
        title={t("状态")}
        description={hints[phase]}
        control={
          <Badge variant={phase === "connected" ? "default" : "secondary"}>{labels[phase]}</Badge>
        }
      />
      {runtime.connectedAt ? (
        <SettingsRow
          title={t("上线时间")}
          control={
            <span className="text-sm tabular-nums">
              {new Date(runtime.connectedAt).toLocaleString()}
            </span>
          }
        />
      ) : null}
      {runtime.lastError ? (
        <SettingsRow
          title={t("最近错误")}
          control={<span className="text-sm text-destructive">{runtime.lastError}</span>}
        />
      ) : null}
      {runtime.reconnectAttempt > 0 ? (
        <SettingsRow
          title={t("重连次数")}
          control={<span className="text-sm tabular-nums">{runtime.reconnectAttempt}</span>}
        />
      ) : null}
    </SettingsGroup>
  );
}

/** 中继的模型端点：一键写成本机的普通 provider（凭证用设备令牌，模型清单现拉） */
function ModelEndpointSection({ hub }: { hub: Hub }) {
  const { t } = useTranslation();
  const errorText = useErrorText(hub.providerError);
  const result = hub.providerResult;

  const add = async (): Promise<void> => {
    const written = await hub.addProvider();
    if (!written) return;
    const count = written.models.length;
    // 覆盖同 id 的供应商是用户自己配的，要在提示里说明，不能让这次写入无声地换掉它
    toast.success(
      written.outcome === "overwritten"
        ? t("已覆盖同 id 的供应商「{{id}}」并写入 {{count}} 个模型，可在模型设置里选它", {
            id: written.providerId,
            count,
          })
        : t("已写入 {{count}} 个模型，可在模型设置里选它", { count }),
    );
  };

  return (
    <section className="space-y-3">
      <SettingsSectionHeader title={t("模型端点")} />
      <div className="space-y-3 rounded-xl bg-popover p-4 ring-1 ring-border-strong">
        <p className="text-sm leading-relaxed text-foreground-subtle">
          {t(
            "中继提供 OpenAI 兼容的模型端点：对话由中继用它配好的厂商转发，并按中继账号记账。写成本机供应商后即可在模型设置里选它的模型。",
          )}
        </p>
        <Button size="sm" disabled={hub.providerBusy} onClick={() => void add()}>
          {hub.providerBusy ? <Spinner /> : null}
          {t("添加为中继供应商")}
        </Button>
        {result ? (
          <p className="text-xs text-foreground-subtle">
            {t("已写入 {{count}} 个模型：{{baseUrl}}", {
              count: result.models.length,
              baseUrl: result.baseUrl,
            })}
          </p>
        ) : null}
        {errorText ? <p className="text-sm text-destructive">{errorText}</p> : null}
      </div>
    </section>
  );
}

/** 已接入：接入信息、隧道运行态、模型端点与登出 */
function ConnectedView({ hub, data }: { hub: Hub; data: HubStatusResponse }) {
  const { t } = useTranslation();

  const logout = async (): Promise<void> => {
    const confirmed = await confirm({
      title: t("登出中继？"),
      description: t("登出会清掉本机凭证，并尽力吊销中继上的这台设备；需重新登录。"),
      confirmText: t("登出"),
      destructive: true,
    });
    if (confirmed) await hub.logout();
  };

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <SettingsSectionHeader
          title={t("接入信息")}
          action={
            <Button
              variant="outline"
              size="sm"
              disabled={hub.refreshing}
              onClick={() => void hub.refresh()}
            >
              {hub.refreshing ? <Spinner /> : <RefreshCw />}
              {t("刷新状态")}
            </Button>
          }
        />
        <SettingsGroup>
          <SettingsRow
            title={t("中继地址")}
            description={t("本机连接中继用的地址；公网访问入口由中继侧部署决定，与它可能不同。")}
            control={
              <span className="max-w-64 truncate font-mono text-xs">{data.url ?? EMPTY}</span>
            }
          />
          <SettingsRow
            title={t("登录账号")}
            control={<span className="text-sm">{data.username ?? EMPTY}</span>}
          />
          <SettingsRow
            title={t("设备名称")}
            description={t("登记到中继时用的名字，缺省是本机主机名。")}
            control={<span className="text-sm">{data.deviceName ?? EMPTY}</span>}
          />
          <SettingsRow
            title={t("设备标识")}
            description={t("中继为本机分配的 id，隧道按它识别这台设备。")}
            control={
              <span className="max-w-64 truncate font-mono text-xs">{data.deviceId ?? EMPTY}</span>
            }
          />
        </SettingsGroup>
      </section>

      <section className="space-y-3">
        <SettingsSectionHeader title={t("隧道")} />
        <TunnelStatus data={data} phase={hub.phase} />
      </section>

      <ModelEndpointSection hub={hub} />

      <section className="space-y-3">
        <SettingsSectionHeader title={t("登出")} />
        <div className="space-y-3 rounded-xl bg-popover p-4 ring-1 ring-border-strong">
          <p className="text-sm leading-relaxed text-foreground-subtle">
            {t("登出后本机不再接受经中继转发的请求，直到重新登录。")}
          </p>
          <Button variant="outline" size="sm" disabled={hub.busy} onClick={() => void logout()}>
            {hub.busy ? <Spinner /> : null}
            {t("登出")}
          </Button>
        </div>
      </section>
    </div>
  );
}

export function SettingsHub() {
  const { t } = useTranslation();
  const hub = useHub();
  const errorText = useErrorText(hub.error);

  // 首次取数还没回来；失败时数据同样为空，这时交给下面的错误提示与重试
  if (!hub.data) {
    return errorText ? (
      <div className="space-y-3">
        <p className="text-sm text-destructive">{errorText}</p>
        <Button variant="outline" size="sm" onClick={() => void hub.refresh()}>
          {t("重试")}
        </Button>
      </div>
    ) : (
      <p className="flex items-center justify-center gap-2 py-8 text-sm text-foreground-subtle">
        <Spinner />
        {t("加载中…")}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {errorText ? <p className="text-sm text-destructive">{errorText}</p> : null}
      {/* 地址已存（登录过又登出，或部署预置）就带出来：它就是当前生效的那个 */}
      {hub.data.configured ? (
        <ConnectedView hub={hub} data={hub.data} />
      ) : (
        <LoginForm hub={hub} defaultUrl={hub.data.url ?? ""} />
      )}
    </div>
  );
}
