/**
 * 系统提示词单测：语言目录拼装、模式差异、模型变体口子。
 *
 * 这里只测拼装结果；「经 pi 装配后生效、pi 源保留默认提示词、custom 源无残留」在
 * `harness/__tests__/session-config.test.ts` 里走真实 SDK 验证。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { brand } from "@ucode/brand/values";
import { SESSION_MODES } from "@ucode/contracts";
import { PRIMARY_PROFILES, primaryToolNames } from "../../agents";
import { buildFullPrompt, buildPromptOverlay, composeFullPrompt, promptSectionOf } from "..";
import { catalogFor, DEFAULT_PROMPT_LOCALE, PROMPT_LOCALES } from "../locales";
import { DEFAULT_PROMPT_VARIANT, PROMPT_VARIANTS, type PromptCatalog } from "../types";
import { resolvePromptVariant } from "../variant";

const catalog = catalogFor();

describe("语言目录", () => {
  it("默认语言已注册，且每个模式都有约束文案", () => {
    assert.ok((PROMPT_LOCALES as readonly string[]).includes(DEFAULT_PROMPT_LOCALE));
    for (const mode of SESSION_MODES) {
      assert.ok(promptSectionOf(PRIMARY_PROFILES[mode]).length > 0, `${mode} 缺少约束文案`);
    }
  });

  it("每个模式都带身份、各行为分节、模式约束与外部内容边界", () => {
    for (const mode of SESSION_MODES) {
      const prompt = buildFullPrompt({ mode });
      assert.ok(prompt.includes(brand.name), `${mode} 缺少品牌名`);
      for (const section of [
        catalog.tone,
        catalog.objectivity,
        catalog.proactiveness,
        catalog.conventions,
        catalog.codeStyle,
        catalog.doingTasks,
        catalog.codeReferences,
      ]) {
        assert.ok(prompt.includes(section), `${mode} 缺少分节：${section.split("\n")[0]}`);
      }
      assert.ok(
        prompt.includes(promptSectionOf(PRIMARY_PROFILES[mode], primaryToolNames(mode))),
        `${mode} 未拼入模式约束`,
      );
      assert.ok(prompt.includes(catalog.untrusted), `${mode} 缺少外部内容边界`);
    }
  });

  it("工具使用分节随可用工具变化：只读模式的声明与编码一致，约束交给模式文案", () => {
    const build = buildFullPrompt({ mode: "build" });
    assert.ok(build.includes("codemode"), "build 工具说明应含 codemode");
    assert.ok(build.includes("edit 用最小且唯一"), "build 工具说明应含 edit 用法");

    // 只读模式的工具声明与编码一致（切模式不改工具表），所以工具说明照旧列出；
    // 「本模式下会被阻断」写在模式约束里，两者必须一致再说同一件事
    for (const mode of ["plan", "ask"] as const) {
      const prompt = buildFullPrompt({ mode });
      assert.ok(prompt.includes("edit 用最小且唯一"), `${mode} 工具说明应含 edit 用法`);
      assert.ok(prompt.includes("检索与阅读用"), `${mode} 应保留只读检索指引`);
      // 列举的工具名必须与实际工具表一致：Windows 上另有 powershell，非 Windows 上不该提到它
      assert.match(
        prompt,
        /edit \/ write \/ bash( \/ powershell)? 里写盘一律阻断，执行类工具只放行被判定为只读的命令/,
        `${mode} 模式约束应声明写盘阻断、执行收窄到只读命令`,
      );
    }
  });
});

describe("pi 源叠加片段", () => {
  it("每个模式都带身份、模式约束与外部内容边界，且不重复完整分节", () => {
    for (const mode of SESSION_MODES) {
      const overlay = buildPromptOverlay({ mode });
      assert.ok(overlay.includes(brand.name), `${mode} 叠加片段缺少品牌名`);
      assert.ok(
        overlay.includes(promptSectionOf(PRIMARY_PROFILES[mode])),
        `${mode} 未拼入模式约束`,
      );
      assert.ok(overlay.includes(catalog.untrusted), `${mode} 缺少外部内容边界`);
      assert.ok(!overlay.includes(catalog.toolPolicy(["read"])), "pi 源不应重复工具说明");
    }
  });
});

describe("模型变体口子", () => {
  it("默认变体已注册，解析函数对未知模型也返回合法变体", () => {
    assert.ok((PROMPT_VARIANTS as readonly string[]).includes(DEFAULT_PROMPT_VARIANT));
    assert.ok((PROMPT_VARIANTS as readonly string[]).includes(resolvePromptVariant(null)));
    assert.equal(resolvePromptVariant("some-provider/some-model"), DEFAULT_PROMPT_VARIANT);
  });

  it("目录声明了变体文案时，整段与叠加片段都会拼入", () => {
    const withNote: PromptCatalog = {
      ...catalog,
      variantNotes: { default: "## 模型叮嘱\n只回一句话。" },
    };
    assert.ok(
      composeFullPrompt(withNote, brand.name, { mode: "build", variant: "default" }).includes(
        "只回一句话",
      ),
    );
  });
});
