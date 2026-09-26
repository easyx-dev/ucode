// spike/fixtures/hook-decide.js —— 清单式子进程 hook 的决策脚本：stdin 一行 JSON，stdout 一行 JSON
let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  let decision = { decision: "allow" };
  try {
    const ev = JSON.parse(input.trim());
    const cmd = String(ev?.command ?? "");
    if (ev?.toolName === "bash" && /rm\s+-rf\s+\//.test(cmd)) {
      decision = { decision: "deny", reason: "blocked dangerous rm -rf" };
    }
  } catch (e) {
    decision = { decision: "ask", reason: "hook could not parse input" };
  }
  process.stdout.write(JSON.stringify(decision));
});
