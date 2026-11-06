/** services/cli/help：帮助文本由命令表渲染，命令与选项不能漏 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { brand } from "@ucode/brand/values";

import { renderCommandHelp, renderOverview } from "..";
import { CLI_COMMANDS, CLI_OPTIONS } from "../spec";

describe("renderOverview", () => {
  it("列出全部命令与它们的摘要", () => {
    const overview = renderOverview();
    for (const command of CLI_COMMANDS) {
      assert.ok(overview.includes(command.name), `缺少命令 ${command.name}`);
      assert.ok(overview.includes(command.summary), `缺少 ${command.name} 的摘要`);
    }
  });

  it("列出全部选项、版本与帮助的写法", () => {
    const overview = renderOverview();
    for (const option of CLI_OPTIONS) {
      assert.ok(overview.includes(`--${option.long}`), `缺少 --${option.long}`);
      if (option.short) assert.ok(overview.includes(`-${option.short}`), `缺少 -${option.short}`);
    }
    assert.ok(overview.includes("--version"));
    assert.ok(overview.includes("--help"));
  });

  it("用法行用品牌 slug 作为命令名", () => {
    assert.ok(renderOverview().includes(`用法：${brand.slug} <命令> [选项]`));
  });
});

describe("renderCommandHelp", () => {
  it("给出该命令的用法、摘要与它自己的选项", () => {
    const help = renderCommandHelp("logs");
    assert.ok(help);
    assert.ok(help.includes(`用法：${brand.slug} logs [选项]`));
    assert.ok(help.includes("查看后台实例日志"));
    assert.ok(help.includes("-n, --lines <行数>"));
    assert.ok(help.includes("-f, --follow"));
    assert.equal(help.includes("--port"), false, "不属于 logs 的选项不该出现");
  });

  it("没有选项的命令只列帮助写法", () => {
    const help = renderCommandHelp("stop");
    assert.ok(help);
    assert.equal(help.includes("[选项]"), false);
    assert.ok(help.includes("-h, --help"));
  });

  it("service 的用法带上子命令写法", () => {
    const help = renderCommandHelp("service");
    assert.ok(help);
    assert.ok(help.includes("start | restart | stop | status"));
    assert.ok(help.includes("--json"), "service status 认 --json");
  });

  it("未知命令回传 undefined", () => {
    assert.equal(renderCommandHelp("nope"), undefined);
  });
});
