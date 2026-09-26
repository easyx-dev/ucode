/**
 * @ucode/data-layer-spec —— 协议 D 的规范与一致性测试套件。
 *
 * 叶子包：不依赖任何内部包（spec §7.2 的禁令表）。它定义：
 * - 目录布局与命名的编码规则（与 pi agent-dir 布局兼容）；
 * - 会话文件的记录形状与解析规则（追加式、带父指针的树、单调游标）；
 * - 数据层的实现契约（Store / SessionRepo / OwnerLease）；
 * - `createConformanceSuite(factory)`：任何实现传入自己的工厂即跑全套（spec §7.3）。
 */
export * from "./conformance.ts";
export * from "./entries.ts";
export * from "./errors.ts";
export * from "./paths.ts";
export * from "./store.ts";
export * from "./version.ts";
