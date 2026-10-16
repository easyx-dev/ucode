/** 会话标题的取料与解析：首条交流的取法与模型输出的清理 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AgentSession, ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  TITLE_INPUT_MAX_CHARS,
  TITLE_MAX_LENGTH,
  TITLE_MAX_USER_TURNS,
} from "../../../../constants/title";
import {
  buildTitleMessage,
  firstExchange,
  firstPromptExchange,
  generateSessionTitle,
  isFirstTurn,
  isTitleWindowOpen,
  parseSessionTitle,
} from "../generate";

type SessionMessage = AgentSession["messages"][number];

const user = (text: string): SessionMessage => ({ role: "user", content: text }) as SessionMessage;
const assistant = (text: string): SessionMessage =>
  ({ role: "assistant", content: [{ type: "text", text }] }) as SessionMessage;

describe("firstExchange", () => {
  it("取首条用户消息与它的回复", () => {
    assert.deepEqual(firstExchange([user("帮我修登录"), assistant("先看下入口")]), {
      userText: "帮我修登录",
      assistantText: "先看下入口",
    });
  });

  it("助手还没回复时不取料，留到下一次落定", () => {
    assert.equal(firstExchange([user("帮我修登录")]), null);
  });

  it("首条消息之后才出现的回复才算（工具结果不充当回复）", () => {
    const toolResult = { role: "toolResult", content: [] } as unknown as SessionMessage;
    assert.equal(firstExchange([user("帮我修登录"), toolResult]), null);
    assert.deepEqual(firstExchange([user("帮我修登录"), toolResult, assistant("改好了")]), {
      userText: "帮我修登录",
      assistantText: "改好了",
    });
  });

  it("会话已经聊过若干轮时不再取料", () => {
    const messages = [user("一"), assistant("回复一"), user("二"), assistant("回复二")];
    assert.equal(
      messages.filter((message) => message.role === "user").length,
      TITLE_MAX_USER_TURNS,
    );
    assert.deepEqual(firstExchange(messages), {
      userText: "一",
      assistantText: "回复一",
    });
    assert.equal(firstExchange([...messages, user("三")]), null);
  });

  it("没有用户消息时取不到料", () => {
    assert.equal(firstExchange([assistant("在的")]), null);
  });
});

describe("isFirstTurn", () => {
  it("空会话与只有助手消息时都算首轮", () => {
    assert.equal(isFirstTurn([]), true);
    assert.equal(isFirstTurn([assistant("在的")]), true);
  });

  it("已有带正文的用户消息时不算首轮", () => {
    assert.equal(isFirstTurn([user("帮我修登录")]), false);
    assert.equal(isFirstTurn([user("帮我修登录"), assistant("先看下入口")]), false);
  });

  it("没有正文的用户消息（纯附件）不占首轮", () => {
    const attachment = {
      role: "user",
      content: [{ type: "image", data: "..." }],
    } as unknown as SessionMessage;
    assert.equal(isFirstTurn([attachment]), true);
  });
});

describe("firstPromptExchange", () => {
  it("只带用户提问，不要求已有回复", () => {
    assert.deepEqual(firstPromptExchange("帮我修登录"), { userText: "帮我修登录" });
  });

  it("超预算按码点截断", () => {
    const exchange = firstPromptExchange("🙂".repeat(TITLE_INPUT_MAX_CHARS));
    assert.equal([...exchange.userText].length, Math.floor(TITLE_INPUT_MAX_CHARS / 2));
  });
});

describe("parseSessionTitle", () => {
  it("原样保留一条干净标题", () => {
    assert.equal(parseSessionTitle("修复登录超时"), "修复登录超时");
  });

  it("丢掉前缀、包裹引号与收尾标点，只取第一行", () => {
    assert.equal(parseSessionTitle("标题：「修复登录超时。」\n\n说明文字"), "修复登录超时");
    assert.equal(parseSessionTitle('Title: "Fix login timeout".'), "Fix login timeout");
  });

  it("超长按码点截断，不切开代理对", () => {
    const emoji = "🙂".repeat(TITLE_MAX_LENGTH + 5);
    const title = parseSessionTitle(emoji);
    assert.equal([...(title ?? "")].length, TITLE_MAX_LENGTH);
    assert.equal(title?.includes("\uFFFD"), false);
  });

  it("清理后为空按失败处理", () => {
    assert.equal(parseSessionTitle("   \n  "), null);
    assert.equal(parseSessionTitle("「」"), null);
  });

  it("首行明显超长（模型在回答问题而不是起标题）按失败处理，不截断充数", () => {
    const answer = `"工作台"听起来像是 VS Code（Workbench）里的 Git Diff 视图。${"如果是的话，".repeat(10)}`;
    assert.equal(parseSessionTitle(answer), null);
  });
});

describe("buildTitleMessage", () => {
  it("把指令与待概括的交流拼进同一条消息", () => {
    const message = buildTitleMessage({ userText: "登录超时了" });
    assert.ok(message.includes("会话列表起标题"));
    assert.ok(message.includes("第一条用户消息：\n登录超时了"));
    assert.equal(message.includes("助手的回复"), false);
  });

  it("有助手回复时一并带上", () => {
    const message = buildTitleMessage({ userText: "登录超时了", assistantText: "先看下入口" });
    assert.ok(message.includes("助手的回复：\n先看下入口"));
  });

  it("重试时收尾强调里把格式要求再说一遍", () => {
    const retried = buildTitleMessage({ userText: "登录超时了" }, true);
    assert.ok(retried.includes("上一次的输出不符合格式要求"));
    assert.equal(
      buildTitleMessage({ userText: "登录超时了" }).includes("上一次的输出不符合格式要求"),
      false,
    );
  });
});

describe("isTitleWindowOpen", () => {
  it("用户轮数不超过上限时仍在窗口内", () => {
    assert.equal(isTitleWindowOpen([]), true);
    assert.equal(isTitleWindowOpen([user("一"), assistant("回复一")]), true);
    assert.equal(isTitleWindowOpen([user("一"), user("二"), user("三")]), false);
  });

  it("没有正文的用户消息（纯附件）不算一轮", () => {
    const attachment = {
      role: "user",
      content: [{ type: "image", data: "..." }],
    } as unknown as SessionMessage;
    assert.equal(isTitleWindowOpen([attachment, attachment, attachment]), true);
  });
});

describe("generateSessionTitle", () => {
  it("不依赖 systemPrompt：指令内联在 user 消息里", async () => {
    let captured: { systemPrompt?: string; messages: { content: string }[] } | undefined;
    const runtime = {
      completeSimple: async (_model: unknown, context: typeof captured) => {
        captured = context;
        return { role: "assistant", content: [{ type: "text", text: "修复登录超时" }] };
      },
    } as unknown as ModelRuntime;

    await generateSessionTitle({
      runtime,
      model: {} as never,
      exchange: { userText: "登录超时了" },
    });

    assert.equal(captured?.systemPrompt, undefined);
    assert.ok(captured?.messages[0]?.content.includes("会话列表起标题"));
  });

  /** 只关心请求参数与「从哪个块取正文」，用一个捕获参数的替身就能覆盖 */
  const withRuntime = async (
    answer: unknown,
  ): Promise<{ title: string | null; options: { maxTokens?: number; reasoning?: string } }> => {
    let options: { maxTokens?: number; reasoning?: string } = {};
    const runtime = {
      completeSimple: async (
        _model: unknown,
        _context: unknown,
        requestOptions: { maxTokens?: number; reasoning?: string },
      ) => {
        options = requestOptions;
        return answer;
      },
    } as unknown as ModelRuntime;

    const title = await generateSessionTitle({
      runtime,
      model: {} as never,
      exchange: { userText: "登录超时了" },
    });
    return { title, options };
  };

  it("从 text 块取正文，并给足输出预算与最低档思考", async () => {
    const { title, options } = await withRuntime({
      role: "assistant",
      content: [
        { type: "thinking", thinking: "先想一下要不要起名" },
        { type: "text", text: "「修复登录超时」" },
      ],
    });

    assert.equal(title, "修复登录超时");
    // 思考与正文共享 maxTokens：给少了只会拿到 thinking（实测 48 时正文为空）
    assert.ok((options.maxTokens ?? 0) >= 512, `maxTokens 太小：${options.maxTokens}`);
    assert.equal(options.reasoning, "minimal");
  });

  it("重试那次把格式强调带进请求消息", async () => {
    let content = "";
    const runtime = {
      completeSimple: async (_model: unknown, context: { messages: { content: string }[] }) => {
        content = context.messages[0]?.content ?? "";
        return { role: "assistant", content: [{ type: "text", text: "修复登录超时" }] };
      },
    } as unknown as ModelRuntime;

    await generateSessionTitle({
      runtime,
      model: {} as never,
      exchange: { userText: "登录超时了" },
      retry: true,
    });

    assert.ok(content.includes("上一次的输出不符合格式要求"));
  });

  it("只有 thinking、没有正文时返回 null，不把思考当标题", async () => {
    const { title } = await withRuntime({
      role: "assistant",
      content: [{ type: "thinking", thinking: "思考很长、被上限截断…" }],
    });

    assert.equal(title, null);
  });
});
