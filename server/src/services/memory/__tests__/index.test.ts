/** services/memory：记忆目录 → 项目视图的反查、只读读取与路径校验 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import type { ConfigStore } from "../../../config/store";
import type { ProjectRecord, ProjectRepository } from "../../../db/project-repository";
import type { SessionRepository } from "../../../db/session-repository";
import { projectDirName } from "../../../harness/features/memory/paths";
import { MemoryLibrary } from "..";

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const projectOf = (path: string, name: string | null, memoryEnabled: boolean | null) =>
  ({ path, name, memoryEnabled }) as ProjectRecord;

/** 在临时目录里造一份记忆：`<appDir>/memory/projects/<dir>/MEMORY.md` + 事实文件 */
const makeLibrary = (options: {
  projects?: ProjectRecord[];
  cwds?: string[];
  memoryEnabled?: boolean;
  /** 额外造一个反查不到的项目目录 */
  orphanDir?: string;
  /** 改 / 删后的通知 */
  onChange?: () => void;
}) => {
  const appDir = mkdtempSync(join(tmpdir(), "memory-library-"));
  created.push(appDir);

  const write = (dir: string, entries: Array<{ file: string; title: string; body: string }>) => {
    const root = join(appDir, "memory", "projects", dir);
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, "MEMORY.md"),
      `${[
        "# 项目记忆",
        ...entries.map((entry) => `- [${entry.title}](${entry.file})：${entry.body}`),
      ].join("\n")}\n`,
      "utf8",
    );
    for (const entry of entries) {
      writeFileSync(join(root, entry.file), `# ${entry.title}\n\n${entry.body}\n`, "utf8");
    }
  };

  const projects = options.projects ?? [];
  const cwds = options.cwds ?? [];
  for (const path of [...projects.map((record) => record.path), ...cwds]) {
    write(projectDirName(path), [{ file: "a.md", title: "标题 A", body: "正文 A" }]);
  }
  if (options.orphanDir) {
    write(options.orphanDir, [{ file: "b.md", title: "标题 B", body: "正文 B" }]);
  }

  const library = new MemoryLibrary({
    sessions: { listCwds: () => cwds } as unknown as SessionRepository,
    repository: { list: () => projects } as unknown as ProjectRepository,
    config: {
      get: () => ({ memory: { enabled: options.memoryEnabled ?? false } }),
    } as unknown as ConfigStore,
    appDir,
    ...(options.onChange ? { onChange: options.onChange } : {}),
  });
  return { library, appDir };
};

describe("MemoryLibrary.list", () => {
  it("按项目列出记忆：展示名取项目行，开关按项目覆盖优先", () => {
    const { library } = makeLibrary({
      projects: [projectOf("/work/a", "项目 A", true)],
      memoryEnabled: false,
    });

    const projects = library.list();

    assert.equal(projects.length, 1);
    assert.deepEqual(projects[0], {
      dir: projectDirName("/work/a"),
      path: "/work/a",
      name: "项目 A",
      enabled: true,
      entries: [{ file: "a.md", title: "标题 A", description: "正文 A" }],
    });
  });

  it("项目没设过覆盖时跟随全局开关", () => {
    const { library } = makeLibrary({
      projects: [projectOf("/work/a", null, null)],
      memoryEnabled: true,
    });

    assert.equal(library.list()[0]?.enabled, true);
    assert.equal(library.list()[0]?.name, null);
  });

  it("会话记录里的 cwd 也算候选：没有项目行也能反查出路径", () => {
    const { library } = makeLibrary({ cwds: ["/work/b"] });

    const project = library.list()[0];
    assert.equal(project?.path, "/work/b");
    assert.equal(project?.name, null);
  });

  it("反查不到的目录照列，只是标不出项目", () => {
    const { library } = makeLibrary({ orphanDir: "旧目录-0123456789ab" });

    const project = library.list()[0];
    assert.equal(project?.dir, "旧目录-0123456789ab");
    assert.equal(project?.path, null);
    assert.equal(project?.entries[0]?.title, "标题 B");
  });

  it("还没有任何记忆时给空清单，不报错", () => {
    const { library } = makeLibrary({ cwds: [] });

    assert.deepEqual(library.list(), []);
  });
});

describe("MemoryLibrary.read", () => {
  it("读一条记忆的正文与标题", () => {
    const { library } = makeLibrary({ cwds: ["/work/a"] });

    assert.deepEqual(library.read(projectDirName("/work/a"), "a.md"), {
      dir: projectDirName("/work/a"),
      file: "a.md",
      title: "标题 A",
      content: "# 标题 A\n\n正文 A\n",
    });
  });

  it("带分隔符或上跳的名字一律 400", () => {
    const { library } = makeLibrary({ cwds: ["/work/a"] });

    for (const [dir, file] of [
      ["../a", "a.md"],
      [projectDirName("/work/a"), "../app.db"],
      ["a/b", "a.md"],
      [".", "a.md"],
    ]) {
      assert.throws(() => library.read(dir as string, file as string), { status: 400 });
    }
  });

  it("目录不存在与文件不存在都按 404", () => {
    const { library } = makeLibrary({ cwds: ["/work/a"] });

    assert.throws(() => library.read("没有这个目录", "a.md"), { status: 404 });
    assert.throws(() => library.read(projectDirName("/work/a"), "没有这个文件.md"), {
      status: 404,
    });
  });
});

describe("MemoryLibrary.update / remove", () => {
  it("改一条：标题与正文重写，返回新正文与标题", () => {
    const { library } = makeLibrary({ cwds: ["/work/a"] });
    const dir = projectDirName("/work/a");

    const fact = library.update(dir, "a.md", { title: "改过的标题", content: "改过的正文" });

    assert.deepEqual(fact, {
      dir,
      file: "a.md",
      title: "改过的标题",
      content: "# 改过的标题\n\n改过的正文\n",
    });
    assert.equal(library.list()[0]?.entries[0]?.title, "改过的标题");
    assert.equal(library.read(dir, "a.md").content, fact.content);
  });

  it("改一条：目录或条目对不上按 400 / 404，不新建文件", () => {
    const { library } = makeLibrary({ cwds: ["/work/a"] });
    const dir = projectDirName("/work/a");

    assert.throws(() => library.update("../a", "a.md", { title: "标题", content: "正文" }), {
      status: 400,
    });
    assert.throws(
      () => library.update("没有这个目录", "a.md", { title: "标题", content: "正文" }),
      {
        status: 404,
      },
    );
    assert.throws(() => library.update(dir, "新建.md", { title: "标题", content: "正文" }), {
      status: 404,
    });
  });

  it("改 / 删之后通知装配层重装会话", () => {
    let changes = 0;
    const { library } = makeLibrary({ cwds: ["/work/a"], onChange: () => (changes += 1) });
    const dir = projectDirName("/work/a");

    library.update(dir, "a.md", { title: "标题", content: "正文" });
    assert.equal(changes, 1);

    // 删不到（已不在索引里）不算一次改动
    assert.equal(library.remove(dir, "没有这个.md").removed, false);
    assert.equal(changes, 1);

    assert.equal(library.remove(dir, "a.md").removed, true);
    assert.equal(changes, 2);
  });
});
