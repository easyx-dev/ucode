#!/usr/bin/env node
// 测试用的最小 MCP 服务器：一行一条 JSON-RPC 2.0，只实现 initialize / tools/list / tools/call。
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  for (;;) {
    const newline = buffer.indexOf("\n");
    if (newline === -1) break;
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (line === "") continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    if (message.id === undefined) continue;
    const reply = (result) =>
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n`);
    if (message.method === "initialize") {
      reply({
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "echo", version: "1" },
      });
    } else if (message.method === "tools/list") {
      reply({
        tools: [
          {
            name: "echo",
            description: "原样回显",
            inputSchema: {
              type: "object",
              properties: { text: { type: "string" } },
              required: ["text"],
            },
          },
        ],
      });
    } else if (message.method === "tools/call") {
      const text = String(message.params?.arguments?.text ?? "");
      if (text === "__boom__") {
        reply({ content: [{ type: "text", text: "工具执行失败" }], isError: true });
      } else {
        reply({ content: [{ type: "text", text: `echo:${text}` }] });
      }
    } else {
      reply({});
    }
  }
});
