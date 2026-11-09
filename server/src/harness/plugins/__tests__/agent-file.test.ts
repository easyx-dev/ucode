/** harness/plugins/agent-file：插件角色文件的宽松解析与 Claude 语义映射 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { loadPluginAgents } from "../agent-file";

const created: string[] = [];

const writeAgent = (name: string, frontmatter: string, body = "正文"): string => {
  const dir = mkdtempSync(join(tmpdir(), "plugin-agent-"));
  created.push(dir);
  const file = join(dir, `${name}.md`);
  writeFileSync(file, `---\n${frontmatter}\n---\n\n${body}\n`, "utf8");
  return file;
};

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("loadPluginAgents", () => {
  it("落成子角色：slug 带插件前缀，工具名按映射表换成 pi 侧名字", () => {
    const file = writeAgent(
      "reviewer",
      "name: Reviewer\ndescription: 审查改动\ntools: Read, Grep, Task\nmodel: gpt-5",
    );
    const load = loadPluginAgents({ pluginName: "my-plugin", files: [file], taken: new Set() });

    assert.deepEqual(load.agents, [
      {
        slug: "my-plugin-reviewer",
        kind: "subagent",
        label: "Reviewer",
        description: "审查改动",
        promptSection: "正文",
        tools: ["read", "grep", "subagent"],
        disallowedTools: [],
        model: "gpt-5",
      },
    ]);
    assert.deepEqual(load.diagnostics, []);
  });

  it("不认识的东西只出诊断，不让整个角色失败", () => {
    const file = writeAgent(
      "audit",
      [
        "description: 审计",
        "mode: primary",
        "model: sonnet",
        "tools: Read, Mystery",
        "effort: high",
        "color: blue",
      ].join("\n"),
    );
    const load = loadPluginAgents({ pluginName: "p", files: [file], taken: new Set() });

    assert.deepEqual(load.agents[0]?.tools, ["read"]);
    assert.equal(load.agents[0]?.model, undefined, "模型别名回落会话默认");
    assert.equal(load.agents[0]?.slug, "p-audit", "没有 name 就用文件名");
    assert.equal(load.agents[0]?.kind, "primary", "mode: primary 落成主模式");
    // mode: primary 现在真的落成主模式，不再出「不做主模式」那条 info
    assert.deepEqual(load.diagnostics.map((item) => item.level).sort(), [
      "info",
      "info",
      "info",
      "warning",
    ]);
    const messages = load.diagnostics.map((item) => item.message).join("\n");
    assert.match(messages, /工具名 Mystery 不认识/);
    assert.match(messages, /模型别名 sonnet/);
    assert.match(messages, /字段 effort/);
    assert.match(messages, /字段 color/);
  });

  it("缺 description 或缺正文的文件被跳过并报错", () => {
    const noDescription = writeAgent("a", "name: A");
    const noBody = writeAgent("b", "description: B", "   ");
    const load = loadPluginAgents({
      pluginName: "p",
      files: [noDescription, noBody],
      taken: new Set(),
    });

    assert.deepEqual(load.agents, []);
    assert.deepEqual(
      load.diagnostics.map((item) => item.level),
      ["error", "error"],
    );
    assert.match(load.diagnostics[0]?.message ?? "", /缺少 description/);
    assert.match(load.diagnostics[1]?.message ?? "", /缺少提示词正文/);
  });

  it("slug 被占用时追加哈希后缀，两个插件同名角色不互相覆盖", () => {
    const taken = new Set<string>();
    const file = writeAgent("review", "description: 审查");
    const first = loadPluginAgents({ pluginName: "p", files: [file], taken });
    const second = loadPluginAgents({ pluginName: "p", files: [file], taken });

    assert.equal(first.agents[0]?.slug, "p-review");
    assert.match(second.agents[0]?.slug ?? "", /^p-review-[0-9a-f]{6}$/);
  });
});
