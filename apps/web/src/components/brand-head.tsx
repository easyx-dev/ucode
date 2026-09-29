/** 文档级品牌元素：favicon（React 19 会把它提升到 `<head>`） */
import { brandAssets } from "@ucode/brand";

export function BrandHead() {
  return <link rel="icon" href={brandAssets.favicon} />;
}
