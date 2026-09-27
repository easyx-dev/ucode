import { describe, expect, it } from "vitest";
import {
  activeCommandToken,
  commandUsage,
  matchCommands,
  parseSlashCommand,
  SLASH_COMMANDS,
  usageOf,
} from "./command-hints.ts";

describe("命令提示：触发条件", () => {
  it("以 / 开头且还没进参数时才提示", () => {
    expect(activeCommandToken("/")).toBe("/");
    expect(activeCommandToken("/mod")).toBe("/mod");
  });

  it("进了参数就不再提示（否则会盖住用户正在看的内容）", () => {
    expect(activeCommandToken("/new /tmp")).toBeNull();
    expect(activeCommandToken("/new\n/tmp")).toBeNull();
  });

  it("普通消息不触发", () => {
    expect(activeCommandToken("你好")).toBeNull();
    expect(activeCommandToken("hello /mod")).toBeNull();
  });
});

describe("命令提示：过滤", () => {
  it("只有斜杠时列出全部命令", () => {
    expect(matchCommands("/").length).toBe(SLASH_COMMANDS.length);
  });

  it("按前缀过滤", () => {
    const names = matchCommands("/m").map((command) => command.name);
    expect(names).toEqual(["/model"]);
  });

  it("大小写不敏感", () => {
    expect(matchCommands("/MOD").map((command) => command.name)).toEqual(["/model"]);
  });

  it("没有匹配时返回空数组", () => {
    expect(matchCommands("/zzz")).toEqual([]);
  });
});

describe("命令解析", () => {
  it("拆出命令名与参数", () => {
    expect(parseSlashCommand("/new /tmp/work")).toEqual({ name: "/new", args: ["/tmp/work"] });
  });

  it("孤零零一个斜杠当普通消息（否则没法正常说话）", () => {
    expect(parseSlashCommand("/")).toBeNull();
  });

  it("不以斜杠开头就不是命令", () => {
    expect(parseSlashCommand("你好")).toBeNull();
  });

  it("命令名归一化成小写", () => {
    expect(parseSlashCommand("/MODEL")?.name).toBe("/model");
  });
});

describe("用法说明", () => {
  it("带参数的命令给出占位", () => {
    const autonomy = SLASH_COMMANDS.find((command) => command.name === "/autonomy");
    expect(autonomy).toBeDefined();
    expect(usageOf(autonomy as never)).toContain("/autonomy <级别>");
  });

  it("未知命令没有用法（调用方据此回一句「未知命令」）", () => {
    expect(commandUsage("/zzz")).toBeNull();
  });

  it("每个命令都有说明（面板里不能出现空白行）", () => {
    for (const command of SLASH_COMMANDS) expect(command.description.length).toBeGreaterThan(0);
  });
});
