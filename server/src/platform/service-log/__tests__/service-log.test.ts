/** platform/service-log：尾部读取、跨轮转拼接、轮转与跟随 */
import assert from "node:assert/strict";
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { followLog, readLogTail, readServiceLogTail, rotateLog } from "..";

const created: string[] = [];

const layout = (): string => {
  const root = mkdtempSync(join(tmpdir(), "service-log-"));
  created.push(root);
  return root;
};

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const wait = (ms: number): Promise<void> => new Promise((resume) => setTimeout(resume, ms));

describe("readLogTail", () => {
  it("取最后若干行，末尾的换行不算空行", () => {
    const path = join(layout(), "service.log");
    writeFileSync(path, "a\nb\nc\n", "utf8");
    assert.equal(readLogTail(path, { lines: 2 }), "b\nc");
  });

  it("文件读不到时回传空串", () => {
    assert.equal(readLogTail(join(layout(), "missing.log"), { lines: 5 }), "");
  });

  it("按字节上限截断时丢掉半截的首行", () => {
    const path = join(layout(), "service.log");
    writeFileSync(path, `${"x".repeat(200)}\nline-2\nline-3\n`, "utf8");
    assert.equal(readLogTail(path, { lines: 5, maxBytes: 10 }), "line-3");
  });

  it("多字节字符跨截断点时不产生替换字符", () => {
    const path = join(layout(), "service.log");
    const lines = Array.from({ length: 50 }, (_, index) => `第${index}行中文日志`);
    writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
    const tail = readLogTail(path, { lines: 50, maxBytes: 64 });
    assert.ok(tail.length > 0);
    assert.equal(tail.includes("\uFFFD"), false, "截断不该把中文切成半个字");
    assert.ok(tail.endsWith("第49行中文日志"));
  });
});

describe("readServiceLogTail", () => {
  const rotated = (): string => {
    const root = layout();
    writeFileSync(join(root, "service.log.1"), "old-1\nold-2\nold-3\n", "utf8");
    writeFileSync(join(root, "service.log"), "new-1\nnew-2\nnew-3\n", "utf8");
    return join(root, "service.log");
  };

  it("当前文件行数不够时从 `.1` 补齐，且总行数不超过要求", () => {
    assert.equal(
      readServiceLogTail(rotated(), { lines: 5 }).text,
      "old-2\nold-3\nnew-1\nnew-2\nnew-3",
    );
  });

  it("要求超过两份之和时全部给出", () => {
    assert.equal(
      readServiceLogTail(rotated(), { lines: 100 }).text,
      "old-1\nold-2\nold-3\nnew-1\nnew-2\nnew-3",
    );
  });

  it("没有轮转文件时只读当前文件", () => {
    const path = join(layout(), "service.log");
    writeFileSync(path, "only-1\nonly-2\n", "utf8");
    assert.equal(readServiceLogTail(path, { lines: 5 }).text, "only-1\nonly-2");
  });

  it("续读点落在当前文件末尾", () => {
    const path = rotated();
    const tail = readServiceLogTail(path, { lines: 2 });
    assert.equal(tail.resume.offset, statSync(path).size);
    assert.ok(tail.resume.identity);
  });

  it("当前文件不存在时续读点为 0，等它出现后从头读", () => {
    const tail = readServiceLogTail(join(layout(), "service.log"), { lines: 5 });
    assert.equal(tail.text, "");
    assert.equal(tail.resume.offset, 0);
    assert.equal(tail.resume.identity, null);
  });
});

describe("rotateLog", () => {
  it("超过上限时挪成 `.1`，并覆盖上一份", () => {
    const root = layout();
    const path = join(root, "service.log");
    writeFileSync(`${path}.1`, "stale\n", "utf8");
    writeFileSync(path, "x".repeat(5 * 1024 * 1024 + 1), "utf8");

    rotateLog(path);

    assert.equal(existsSync(path), false, "轮转后当前文件应由新实例重建");
    assert.ok(statSync(`${path}.1`).size > 5 * 1024 * 1024, "上一份被覆盖成本次轮转的内容");
  });

  it("没超过上限时不动文件", () => {
    const path = join(layout(), "service.log");
    writeFileSync(path, "small\n", "utf8");
    rotateLog(path);
    assert.equal(existsSync(`${path}.1`), false);
    assert.equal(readLogTail(path, { lines: 1 }), "small");
  });

  it("文件不存在时不报错", () => {
    rotateLog(join(layout(), "missing.log"));
  });
});

describe("followLog", () => {
  it("从当前末尾开始，只吐出之后追加的内容", async () => {
    const path = join(layout(), "service.log");
    writeFileSync(path, "before\n", "utf8");

    let output = "";
    const follow = followLog(path, { onChunk: (text) => (output += text), intervalMs: 20 });
    try {
      await wait(150);
      assert.equal(output, "", "跟随前的历史不该重复打印");
      appendFileSync(path, "after-1\n", "utf8");
      await wait(200);
    } finally {
      follow.stop();
    }
    assert.equal(output, "after-1\n");
  });

  it("从尾部读完后给的续读点接着读：两段之间写入的行不会漏", async () => {
    const path = join(layout(), "service.log");
    writeFileSync(path, "tail-1\n", "utf8");
    const tail = readServiceLogTail(path, { lines: 5 });
    appendFileSync(path, "between\n", "utf8");

    let output = "";
    const follow = followLog(path, {
      resume: tail.resume,
      onChunk: (text) => (output += text),
      intervalMs: 20,
    });
    try {
      await wait(200);
    } finally {
      follow.stop();
    }
    assert.equal(output, "between\n", "tail 与 follow 之间写入的行不能丢");
  });

  it("续读点指向的是别的文件时从头读", async () => {
    const root = layout();
    const path = join(root, "service.log");
    writeFileSync(path, "old\n", "utf8");
    const stale = readServiceLogTail(path, { lines: 5 }).resume;
    // 模拟 tail 之后发生轮转：文件被换掉，旧偏移没有意义
    renameSync(path, `${path}.1`);
    writeFileSync(path, "fresh\n", "utf8");

    let output = "";
    const follow = followLog(path, {
      resume: stale,
      onChunk: (text) => (output += text),
      intervalMs: 20,
    });
    try {
      await wait(200);
    } finally {
      follow.stop();
    }
    assert.equal(output, "fresh\n");
  });

  it("轮转后从新文件继续读", async () => {
    const root = layout();
    const path = join(root, "service.log");
    writeFileSync(path, "before\n", "utf8");

    let output = "";
    const follow = followLog(path, { onChunk: (text) => (output += text), intervalMs: 20 });
    try {
      await wait(150);
      renameSync(path, `${path}.1`);
      writeFileSync(path, "rotated\n", "utf8");
      await wait(200);
    } finally {
      follow.stop();
    }
    assert.equal(output, "rotated\n");
  });

  it("停止跟随之后不再接受追加", async () => {
    const path = join(layout(), "service.log");
    let output = "";
    const follow = followLog(path, { onChunk: (text) => (output += text), intervalMs: 20 });
    follow.stop();
    await wait(150);
    appendFileSync(path, "ignored\n", "utf8");
    await wait(150);
    assert.equal(output, "");
  });
});
