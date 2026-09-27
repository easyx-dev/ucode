import { homedir } from "node:os";
import { join } from "node:path";
import { envVar, getBrand } from "@ucode/branding";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DATA_FORMAT_VERSION, resolveDataRoot, servicePaths } from "../paths.ts";

const ENV_KEY = envVar("DATA_DIR");

describe("resolveDataRoot", () => {
  const original = process.env[ENV_KEY];

  beforeEach(() => {
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    if (original === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = original;
  });

  it("没有输入也没有环境变量时落在家目录下的品牌数据目录", () => {
    expect(resolveDataRoot()).toBe(join(homedir(), getBrand().dataDirName));
  });

  it("环境变量优先于默认值", () => {
    process.env[ENV_KEY] = "/tmp/env-root";
    expect(resolveDataRoot()).toBe("/tmp/env-root");
  });

  it("显式参数优先于环境变量，且 ~ 展开到家目录", () => {
    process.env[ENV_KEY] = "/tmp/env-root";
    expect(resolveDataRoot("~/explicit")).toBe(join(homedir(), "explicit"));
    expect(resolveDataRoot("~")).toBe(homedir());
  });

  it("相对路径按给定的工作目录解析", () => {
    expect(resolveDataRoot("data", "/tmp/work")).toBe(join("/tmp/work", "data"));
  });

  it("只有空白的输入等同于没给（不会落成当前目录）", () => {
    expect(resolveDataRoot("   ")).toBe(join(homedir(), getBrand().dataDirName));
  });
});

describe("servicePaths", () => {
  it("数据在版本目录下、运行时状态在数据根下", () => {
    const paths = servicePaths("/tmp/root");
    expect(paths.root).toBe("/tmp/root");
    expect(paths.dataDir).toBe(join("/tmp/root", DATA_FORMAT_VERSION));
    expect(paths.serviceDir).toBe(join(paths.dataDir, "service"));
    expect(paths.piDir).toBe(join(paths.dataDir, "pi"));
    expect(paths.database).toBe(join(paths.serviceDir, "service.db"));
    expect(paths.runtimeDir).toBe(join("/tmp/root", "runtime"));
    expect(paths.registry).toBe(join(paths.runtimeDir, "service.json"));
    expect(paths.lock).toBe(join(paths.runtimeDir, "service.lock"));
    expect(paths.log).toBe(join(paths.runtimeDir, "service.log"));
  });

  it("相对路径先解析成绝对路径（同一个根不会算出两套目录）", () => {
    expect(servicePaths("rel").root).toBe(join(process.cwd(), "rel"));
  });

  it("数据根太深时不给 unix socket，退回只用环回 HTTP", () => {
    expect(servicePaths(join("/tmp", "d".repeat(120))).socket).toBeUndefined();
  });

  it("正常的根能放下 unix socket", () => {
    expect(servicePaths("/tmp/root").socket).toBe(join("/tmp/root", "runtime", "socket.sock"));
  });
});
