# @ucode/hub — 骨架

单独部署的服务（uhub）：登录、准入、审计、中继、能力目录。

## 当前状态

**只有骨架**：`src/index.ts` 内容为一段职责注释加 `export {}`。包边界、依赖方向与类型检查已就位，实现按 [实现设计 §七](../docs/01-实现设计.md) 推进。

远控通路与 uhub **不在当前范围内**，因此这里长期保持骨架。

## 依赖位置

依赖 `@ucode/protocol`、`@ucode/branding`。

**没有任何工作区包依赖它**。

权威来源：[tools/boundaries.json](../tools/boundaries.json) 的 `@ucode/hub` 条目。

## 关键约束

- **可整包删除**：删掉本目录与 `tools/boundaries.json` 里的 `@ucode/hub` 条目即可，不影响主产品。两处要一起改——只删目录会在依赖边界门禁报"包不存在"，只删条目会报"未登记的包"。
- 中继不改协议：协议 C 是服务层与控制层之间的约定，uhub 只是在中间转发。

## 开发

```bash
pnpm -F @ucode/hub typecheck
```
