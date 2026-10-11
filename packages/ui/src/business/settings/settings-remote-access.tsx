/** 远程访问设置：局域网开关、配对链接、活动会话与改密码 */
import type { AuthSessionView, PairingCreateOutput } from "@ucode/contracts";
import { Check, Copy } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../base/button";
import { Input } from "../../base/input";
import { Label } from "../../base/label";
import { Spinner } from "../../base/spinner";
import { useAuth } from "../../hooks/use-auth";
import { type RemoteAccess, useRemoteAccess } from "../../hooks/use-remote-access";
import { copyText } from "../../lib/clipboard";
import { useErrorText } from "../../lib/error";
import { useClient } from "../../provider";
import { SegmentedControl, type SegmentedOption } from "../segmented-control";
import { SettingsGroup, SettingsRow } from "./settings-row";

/** 剩余秒数倒计时；`expiresAt` 为空时恒为 0 */
function useCountdown(expiresAt: string | undefined): number {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (!expiresAt) {
      setRemaining(0);
      return;
    }
    const tick = (): void =>
      setRemaining(Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  return remaining;
}

const formatRemaining = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/** 配对链接二维码：用 qrcode 生成 data URL，供同一网络下的设备扫码打开 */
function PairingQrCode({ url }: { url: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void QRCode.toDataURL(url, { margin: 1, width: 180 }).then((next) => {
      if (active) setDataUrl(next);
    });
    return () => {
      active = false;
    };
  }, [url]);

  if (!dataUrl) return null;
  return (
    <img
      src={dataUrl}
      alt=""
      className="mx-auto size-45 rounded-lg p-1 ring-1 ring-border-strong"
    />
  );
}

function PairingPanel({
  pairing,
  busy,
  onCreate,
}: {
  pairing: PairingCreateOutput | null;
  busy: boolean;
  onCreate: () => void;
}) {
  const { t } = useTranslation();
  const remaining = useCountdown(pairing?.expiresAt);
  const [copied, setCopied] = useState(false);

  useEffect(() => setCopied(false), [pairing?.code]);

  const copy = (): void => {
    if (!pairing) return;
    // 局域网明文 HTTP 是非安全上下文（没有 `navigator.clipboard`），这里靠 lib/clipboard 的兜底能照样复制
    void copyText(pairing.url).then((ok) => setCopied(ok));
  };

  return (
    <section className="space-y-2">
      <h3 className="px-1 text-xs font-medium text-foreground-subtle">{t("配对链接")}</h3>
      <div className="space-y-2 rounded-xl bg-popover p-4 ring-1 ring-border-strong">
        <p className="text-xs leading-relaxed text-foreground-subtle">
          {t("生成一条链接发给同一网络下的设备，打开即可接入；5 分钟内有效，且只能使用一次。")}
        </p>

        {pairing && remaining > 0 ? (
          <>
            <PairingQrCode url={pairing.url} />
            <div className="flex items-center gap-2">
              <Input readOnly value={pairing.url} className="font-mono text-xs" />
              <Button variant="outline" size="icon-sm" aria-label={t("复制链接")} onClick={copy}>
                {copied ? (
                  <Check className="size-icon-base" />
                ) : (
                  <Copy className="size-icon-base" />
                )}
              </Button>
            </div>
            <p className="text-xs text-foreground-subtle">
              {t("剩余有效时间 {{time}}", { time: formatRemaining(remaining) })}
            </p>
          </>
        ) : (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={busy} onClick={onCreate}>
              {busy ? <Spinner className="size-icon-base" /> : null}
              {t("生成配对链接")}
            </Button>
            {pairing && remaining === 0 ? (
              <span className="text-xs text-foreground-subtle">{t("链接已过期")}</span>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}

function SessionList({
  sessions,
  currentId,
  busy,
  onRevoke,
}: {
  sessions: AuthSessionView[];
  currentId: string | null;
  busy: boolean;
  onRevoke: (id: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <section className="space-y-2">
      <h3 className="px-1 text-xs font-medium text-foreground-subtle">{t("活动会话")}</h3>
      <div className="space-y-2">
        {sessions.length === 0 ? (
          <p className="rounded-xl border border-dashed px-3 py-4 text-sm text-foreground-subtle">
            {t("暂无活动会话")}
          </p>
        ) : null}
        {sessions.map((session) => (
          <div
            key={session.id}
            className="flex items-center justify-between gap-4 rounded-xl bg-popover px-4 py-3 ring-1 ring-border-strong"
          >
            <div className="min-w-0 space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{session.label}</span>
                {session.id === currentId ? (
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-foreground-subtle">
                    {t("本端")}
                  </span>
                ) : null}
              </div>
              <p className="truncate text-xs text-foreground-subtle">
                {t("最近使用 {{time}}", { time: new Date(session.lastSeenAt).toLocaleString() })}
              </p>
            </div>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => onRevoke(session.id)}>
              {t("撤销")}
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}

function PasswordForm() {
  const { t } = useTranslation();
  const client = useClient();
  const auth = useAuth();
  const errorText = useErrorText(auth.error);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const canSubmit = current.length > 0 && next.length >= 8 && !auth.busy;

  return (
    <section className="space-y-2">
      <h3 className="px-1 text-xs font-medium text-foreground-subtle">{t("修改密码")}</h3>
      <form
        className="space-y-3 rounded-xl bg-popover p-4 ring-1 ring-border-strong"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit)
            void client.auth.changePassword({ currentPassword: current, newPassword: next });
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="current-password">{t("当前密码")}</Label>
          <Input
            id="current-password"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="new-password">{t("新密码")}</Label>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(event) => setNext(event.target.value)}
          />
        </div>
        <p className="text-xs leading-relaxed text-foreground-subtle">
          {t("新密码至少 8 位；修改后所有设备都需要重新登录。")}
        </p>
        {errorText ? <p className="text-xs text-destructive">{errorText}</p> : null}
        <Button type="submit" variant="outline" size="sm" disabled={!canSubmit}>
          {auth.busy ? <Spinner className="size-icon-base" /> : null}
          {t("修改密码")}
        </Button>
      </form>
    </section>
  );
}

/** 局域网访问开关：改的是服务监听地址，重启后才真正生效 */
function LanAccess({ access }: { access: RemoteAccess }) {
  const { t } = useTranslation();
  const lanEnabled = access.info?.host === "0.0.0.0";
  const options = [
    { value: "off", label: t("仅本机") },
    { value: "on", label: t("局域网") },
  ] as const satisfies ReadonlyArray<SegmentedOption<"on" | "off">>;

  return (
    <>
      <SettingsGroup>
        <SettingsRow
          title={t("局域网访问")}
          description={
            lanEnabled
              ? t("已允许局域网设备访问；如需关闭请切回「仅本机」并重启服务。")
              : t("当前仅本机可访问；开启后同一网络下的设备可访问，请只在可信网络使用。")
          }
          control={
            <SegmentedControl
              label={t("局域网访问")}
              value={lanEnabled ? "on" : "off"}
              options={options}
              onChange={(value) => void access.setHost(value === "on" ? "0.0.0.0" : "127.0.0.1")}
            />
          }
        />
      </SettingsGroup>

      {access.info?.restartRequired ? (
        <p className="text-xs text-destructive">{t("监听地址已更新，需要重启服务后生效。")}</p>
      ) : null}
    </>
  );
}

export function SettingsRemoteAccess() {
  const { t } = useTranslation();
  // 本页一挂载即拉取访问状态，离开设置页就停止
  const access = useRemoteAccess(true);
  const auth = useAuth();
  const errorText = useErrorText(access.error);

  return (
    <div className="max-w-3xl space-y-5">
      <p className="text-xs leading-relaxed text-foreground-subtle">
        {t(
          "让同一网络下的设备接入本服务。通过鉴权的设备等于本机 owner，可驱动 agent 读写文件、执行命令。",
        )}
      </p>

      <LanAccess access={access} />
      {errorText ? <p className="text-xs text-destructive">{errorText}</p> : null}

      <PairingPanel
        pairing={access.pairing}
        busy={access.busy}
        onCreate={() => void access.createPairing()}
      />
      <SessionList
        sessions={access.sessions}
        currentId={auth.session?.id ?? null}
        busy={access.busy}
        onRevoke={(id) => void access.revoke(id)}
      />
      <PasswordForm />
    </div>
  );
}
