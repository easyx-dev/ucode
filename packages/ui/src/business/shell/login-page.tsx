/** 登录页：用服务密码换取会话 token（由宿主存下并放进请求头）；`notice` 用于携带配对链接失败等已翻译提示 */

import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { BrandLogo } from "../../base/brand-logo";
import { Button } from "../../base/button";
import { Input } from "../../base/input";
import { Label } from "../../base/label";
import { Spinner } from "../../base/spinner";
import { useAuth } from "../../hooks/use-auth";
import { useErrorText } from "../../hooks/use-error-text";
import { useClient } from "../../provider";

export function LoginPage({ notice }: { notice?: string | null }) {
  const { t } = useTranslation();
  const client = useClient();
  const auth = useAuth();
  const errorText = useErrorText(auth.error);
  const [password, setPassword] = useState("");

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (!password || auth.busy) return;
    void client.auth.login({ password });
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-5 rounded-xl border bg-popover p-6 shadow-raised"
      >
        <div className="flex items-center gap-2">
          <BrandLogo className="size-6" />
          <span className="text-base font-medium">{t("登录")}</span>
        </div>

        {notice ? <p className="text-sm text-destructive">{notice}</p> : null}

        <div className="space-y-2">
          <Label htmlFor="login-password">{t("密码")}</Label>
          <Input
            id="login-password"
            type="password"
            value={password}
            autoFocus
            autoComplete="current-password"
            placeholder={t("输入服务密码")}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        {errorText ? <p className="text-sm text-destructive">{errorText}</p> : null}

        <Button type="submit" className="w-full" disabled={auth.busy || password.length === 0}>
          {auth.busy ? <Spinner className="size-icon-base" /> : null}
          {t("登录")}
        </Button>

        <p className="text-xs leading-relaxed text-foreground-subtle">
          {t("密码在服务首次启动时生成，可查看服务注册文件 service.json。")}
        </p>
      </form>
    </div>
  );
}
