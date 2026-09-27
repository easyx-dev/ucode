import { describe, expect, it } from "vitest";
import { defaultDataDirName, envPrefix, envVar, getBrand } from "../index.ts";

describe("getBrand", () => {
  it("字段齐备且非空", () => {
    const brand = getBrand();
    for (const key of ["productName", "appId", "vendor", "urlScheme", "theme"] as const) {
      expect(brand[key], key).toBeTypeOf("string");
      expect(brand[key].length, key).toBeGreaterThan(0);
    }
  });
});

describe("defaultDataDirName", () => {
  it("数据层目录名是隐藏目录", () => {
    expect(defaultDataDirName().startsWith(".")).toBe(true);
    expect(defaultDataDirName().length).toBeGreaterThan(1);
  });
});

describe("envVar", () => {
  it("环境变量名由产品名派生，不写死品牌", () => {
    expect(envPrefix()).toBe(getBrand().productName.toUpperCase());
    expect(envVar("DATA_DIR")).toBe(`${envPrefix()}_DATA_DIR`);
    expect(envVar("data-dir")).toBe(`${envPrefix()}_DATA_DIR`);
  });
});
