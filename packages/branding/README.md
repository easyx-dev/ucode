# @ucode/branding

品牌配置与资源的唯一来源（[ADR-023](../../docs/archive/02-决策记录.md)）。叶子包。

## 职责

- 读取并暴露构建期注入的 `brand.json`：产品名、数据层目录名、appId、厂商名、URL scheme、主题。
- 由产品名派生环境变量名（`envVar("DATA_DIR")`），避免各处手写品牌前缀。
- **不做**：不含业务逻辑，不依赖任何内部包。

## 公开入口

| 子路径 | 入口 | 主要符号 |
|---|---|---|
| `.` | `src/index.ts` | `getBrand`、`envVar`、`defaultDataDirName`；类型 `BrandProfile` |
| `./brand.json` | `brand.json` | 品牌配置本体（主进程等无打包器的场景直接读它） |

## 依赖位置

零依赖。被 `@ucode/service`、`@ucode/ui`、`@ucode/hub` 与各壳（`cli` / `web` / `tui`）依赖。

权威来源：[tools/boundaries.json](../../tools/boundaries.json) 的 `@ucode/branding` 条目。

## 关键约束

- **源码里不得出现品牌字面量**：产品名、数据层目录名、appId、厂商名、urlScheme 一律从这里读，由 `pnpm check:brand` 强制。本包的 `brand.json` 与 `assets/` 是这些字面量唯一合法的载体。
- **B 端定制 = 换一份 `brand.json` 与 `assets/` 后重新构建**，代码与协议不动："目录叫什么"本身就是品牌参数。
- `@` 开头的包 scope（如 `@ucode/protocol`）属编译期标识，门禁扫描前会先剥离，不算违规。
- 品牌门禁**不扫**非源码文件（`.md` / `.json` / `.yml` / `.css` / `index.html`），这些位置的品牌信息须人工保证与 `brand.json` 同源。

## 开发

```bash
pnpm -F @ucode/branding typecheck
pnpm check:brand    # 品牌字面量门禁
```
