/**
 * 节点属性浮窗：显示选中节点的完整属性。
 *
 * 数据来自 `design/node`——与 `design_get_node` 工具给模型的是**同一份投影**，所以「把标题改成 24px」
 * 这种事，人看到的数字和模型拿到的数字不会对不上。
 *
 * 这里只读是刻意的：编辑一律走对话（画布不吃拖拽改属性），浮窗只回答「这个节点现在的值是多少」。
 */
import type { DesignNodeDetail, DesignPaint } from "@ucode/contracts";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Empty } from "../../../base/empty";
import { ScrollArea } from "../../../base/scroll-area";
import { Spinner } from "../../../base/spinner";
import { useAsyncData } from "../../../hooks/use-async-data";
import { useClient } from "../../../provider";

/** 0..1 通道 → `#RRGGBB`（不透明度单独显示，颜色块只表达色相） */
const toHex = (color: { r: number; g: number; b: number }): string => {
  const channel = (value: number): string =>
    Math.round(Math.min(1, Math.max(0, value)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`.toUpperCase();
};

const round = (value: number): number => Math.round(value * 10) / 10;

export function DesignInspector({
  sessionId,
  nodeId,
  revision,
}: {
  /** 会话：属性读的就是它当前在改的那份（画布打开即指向） */
  sessionId: string;
  nodeId: string | null;
  /** 文档代数：变了就重取（agent 改完稿子，属性要跟着变） */
  revision: number;
}) {
  const { t } = useTranslation();
  const client = useClient();
  const data = useAsyncData<DesignNodeDetail>(
    nodeId === null ? "" : `${sessionId}#${nodeId}#${revision}`,
    () => {
      // i18n-ignore: 组件已挡住这种情况，这里只是防御，不会渲染给用户
      if (nodeId === null) return Promise.reject(new Error("没有选中节点"));
      return client.apis.design.node({ sessionId, id: nodeId });
    },
  );

  if (nodeId === null) {
    return (
      <Empty
        className="h-full"
        title={t("未选中节点")}
        hint={t("在画布或图层里点一个节点，这里显示它的属性")}
      />
    );
  }
  const detail = data.data;
  if (detail === null) {
    return data.error === null ? (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    ) : (
      <Empty className="h-full" title={t("读不到这个节点的属性")} hint={data.error.message} />
    );
  }

  return (
    // 自绘滚动条：属性行数常常超出浮窗高度，得让人一眼看出还有内容
    <ScrollArea type="always" horizontal className="h-full">
      <div className="px-3 py-2 text-xs">
        <Section title={t("基本")}>
          <Row label={t("名称")} value={detail.name || t("未命名图层")} />
          <Row label={t("类型")} value={detail.type} />
          <Row label={t("路径")} value={detail.path} mono />
        </Section>

        <Section title={t("位置与尺寸")}>
          <Row label={t("位置")} value={`${round(detail.x)}, ${round(detail.y)}`} mono />
          <Row label={t("尺寸")} value={`${round(detail.width)} × ${round(detail.height)}`} mono />
          {detail.rotation === 0 ? null : (
            <Row label={t("旋转")} value={`${round(detail.rotation)}°`} />
          )}
          <Row label={t("不透明度")} value={`${Math.round(detail.opacity * 100)}%`} />
          {detail.visible ? null : <Row label={t("可见")} value={t("否")} />}
          {detail.cornerRadius === 0 ? null : (
            <Row label={t("圆角")} value={`${round(detail.cornerRadius)}px`} />
          )}
        </Section>

        <Section title={t("填充")}>
          <Paints paints={detail.fills} empty={t("没有填充")} />
        </Section>

        <Section title={t("描边")}>
          <Paints paints={detail.strokes} empty={t("没有描边")} />
        </Section>

        {detail.text === undefined ? null : (
          <Section title={t("文本")}>
            <Row label={t("内容")} value={detail.text.characters || t("（空）")} />
            <Row label={t("字号")} value={`${round(detail.text.fontSize)}px`} />
            <Row label={t("字重")} value={String(detail.text.fontWeight)} />
            <Row label={t("字体")} value={detail.text.fontFamily} />
            <Row label={t("对齐")} value={detail.text.textAlignHorizontal} />
            {detail.text.lineHeight === null ? null : (
              <Row label={t("行高")} value={`${round(detail.text.lineHeight)}px`} />
            )}
            {detail.text.letterSpacing === 0 ? null : (
              <Row label={t("字距")} value={`${round(detail.text.letterSpacing)}px`} />
            )}
          </Section>
        )}

        <Section title={t("布局")}>
          <Row label={t("自动布局")} value={detail.layoutMode} />
          {detail.layoutMode === "NONE" ? null : (
            <>
              <Row label={t("间距")} value={`${round(detail.itemSpacing)}px`} />
              <Row
                label={t("内边距")}
                value={`${round(detail.padding.top)} / ${round(detail.padding.right)} / ${round(
                  detail.padding.bottom,
                )} / ${round(detail.padding.left)}`}
                mono
              />
            </>
          )}
          <Row label={t("子节点")} value={String(detail.childCount)} />
        </Section>
      </div>
    </ScrollArea>
  );
}

/** 一节：小标题 + 若干行 */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-3 last:mb-0">
      <h3 className="mb-1 font-medium text-foreground-subtle">{title}</h3>
      <dl className="space-y-1">{children}</dl>
    </section>
  );
}

/**
 * 一行属性：左标签右值。
 *
 * 值不换行（换行会把长路径挤成三行、面板被撑高），超宽交给浮窗的横向滚动条；
 * 同时挂 `title`，悬停就能看全文，不必真去滚。
 */
function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-2">
      <dt className="w-16 shrink-0 text-foreground-subtle">{label}</dt>
      <dd className={`flex-1 whitespace-nowrap ${mono ? "font-mono" : ""}`} title={value}>
        {value}
      </dd>
    </div>
  );
}

/** 填充 / 描边列表：颜色块 + 十六进制 + 不透明度；图片填充没有色相可看，标出画法与放法 */
function Paints({ paints, empty }: { paints: readonly DesignPaint[]; empty: string }) {
  const { t } = useTranslation();
  const visible = paints.filter((paint) => paint.visible);
  if (visible.length === 0) return <dd className="text-foreground-subtle">{empty}</dd>;
  return (
    <>
      {visible.map((paint, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 色板按顺序排列，位置即身份
        <div key={`paint-${index}`} className="flex items-center gap-2">
          {paint.imageHash === undefined ? (
            <>
              <span
                className="size-icon-sm shrink-0 rounded-xs ring-1 ring-border"
                style={{ backgroundColor: toHex(paint.color) }}
                aria-hidden
              />
              <span className="font-mono">{toHex(paint.color)}</span>
            </>
          ) : (
            <>
              <span className="font-mono">{t("图片")}</span>
              <span className="text-foreground-subtle">{paint.imageScaleMode}</span>
            </>
          )}
          {paint.opacity === 1 ? null : (
            <span className="text-foreground-subtle">
              {t("不透明度 {{value}}%", { value: String(Math.round(paint.opacity * 100)) })}
            </span>
          )}
          {paint.weight === undefined ? null : (
            <span className="text-foreground-subtle">{`${round(paint.weight)}px`}</span>
          )}
        </div>
      ))}
    </>
  );
}
