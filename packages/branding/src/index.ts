import brand from "../brand.json" with { type: "json" };

/**
 * 品牌配置（brand profile）——运行期产品标识的单一事实来源。
 *
 * 构建期注入：B 端定制 = 换一份 brand.json 与 assets/、重新构建，代码与协议不动。
 * 因此本包之外的任何源码都不得出现产品名与数据层目录名的字面量
 * （由 tools/check-brand-literals.mjs 门禁强制）。
 */
export type BrandProfile = {
  /** 产品名：CLI 帮助与版本、窗口标题、文档标题。 */
  productName: string;
  /** 数据层默认目录名（含前导点）；实际路径仍可被 --data-dir / 环境变量覆盖。 */
  dataDirName: string;
  /** 桌面应用的 appId（electron-builder 用）。 */
  appId: string;
  /** 厂商名。 */
  vendor: string;
  /** 自定义 URL scheme。 */
  urlScheme: string;
  /** 默认主题标识。 */
  theme: string;
};

/** 读取当前构建的品牌配置。 */
export function getBrand(): BrandProfile {
  return brand as BrandProfile;
}

/** 数据层默认目录名（相对用户主目录）。 */
export function defaultDataDirName(): string {
  return getBrand().dataDirName;
}

/** 环境变量前缀，由产品名派生——避免在代码里写死品牌名。 */
export function envPrefix(): string {
  return getBrand()
    .productName.toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_");
}

/** 品牌派生的环境变量名，如 <前缀>_DATA_DIR。 */
export function envVar(suffix: string): string {
  const normalized = suffix
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${envPrefix()}_${normalized}`;
}
