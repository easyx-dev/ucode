# 组件规范

前端组件的组织方式与约束。视觉取值（颜色 / 圆角 / 字号 / 动效 / 表面与描边）见 `DESIGN.md`，
本文只管组件的结构与行为。

**本文声明规范并举例，不列举组件清单**——清单会随实现漂移，需要靠人维护；规范应当稳定到不需要维护。

## 组件来源与维护

`apps/web/src/components/ui/**` 由 shadcn CLI 生成（配置见 `apps/web/components.json`），但**只生成一次**：
之后与其它代码一样由我们维护，同等适用本仓库的格式化、命名、颜色 token 与行数规则。

- 新增基础组件仍可用 `npx shadcn@latest add <name>` 生成，生成完即视为项目代码，按本规范整理
- 对已经改过的组件再跑 CLI 会覆盖我们的改动，需要手工合并
- 唯一豁免：`ui/` 下都是对 Radix 的薄封装，不要求写文件级注释

## 目录与命名

```
components/
  ui/                 # 基础组件（shadcn 生成后归我们维护）
  <feature>/          # 业务组件，按功能分组
  <kebab-name>.tsx    # 顶层业务组件
```

- 一个文件一个主组件，文件名 kebab-case，与组件名对应（`xxx-card.tsx` → `XxxCard`）
- 同功能的多文件放同名文件夹；文件名与目录名同名时不重复语义（`settings/settings-row.tsx`，不是 `settings/settings-settings-row.tsx`）
- 子组件只服务单个父组件时留在父组件文件内，不单独开文件

## 分层

| 层 | 位置 | 职责 | 禁止 |
| --- | --- | --- | --- |
| 基础组件 | `components/ui/` | 纯展示，只关心 props | 调接口、读全局状态 |
| 业务组件 | `components/` | 组合基础组件、渲染业务数据 | 直接 `fetch`、直接操作 DOM 存储 |
| 状态层 | `hooks/` | 数据获取、订阅、派生状态、副作用 | 渲染 JSX |
| 纯逻辑 | `lib/` | 无 React 依赖的纯函数（归并、格式化、接口封装） | 依赖组件 |

- 业务组件通过 props 接数据，数据由 `hooks/use-*` 提供，组件内部不发请求
- 事件回调从上层传入（`onSelect` / `onSend` / `onDelete`）；组件不自己决定导航或调接口
- 纯函数下沉到 `lib/`，可单独测试

## props 约定

- 用 `type XxxProps = { ... }` 声明，字段逐个写注释；类型名与组件同名
- `className` 一律透传并合并：`cn("base", className)`
- 其余原生属性用 `...props` 展开，不逐个转写
- 布尔 prop 用肯定语义（`disabled`、`streaming`、`dense`），不用反义命名
- 变体用 `cva` 而不是三元堆叠；本项目自己的组件优先 `className` + `cn`，只有真正多变的才上 `cva`
- 不传「样式开关」类 prop（`hideBorder`、`big`）；需要不同外观就在调用处传 `className` 或拆组件

## 状态覆盖矩阵

每个组件都要过一遍下列状态，缺哪项就补哪项：

| 状态 | 要求 |
| --- | --- |
| default | 默认外观 |
| hover | 用语义类（`hover:bg-muted` / `hover:text-foreground`），不写死颜色 |
| active / selected | 用语义类区分（`bg-accent`，侧栏用 `bg-sidebar-accent`），不能只靠字重 |
| focus-visible | 必须有 `focus-visible:ring-2 focus-visible:ring-ring/50`，键盘可达 |
| disabled | `disabled:opacity-50 disabled:cursor-not-allowed`，并阻止事件 |
| loading | 图标 + `animate-spin` 或 `Skeleton`，文案用「加载中…」 |
| empty | 给出下一步动作；列表/搜索结果为空也要有一句说明，不留空白 |
| error | 就近显示原因，用 `text-destructive` / `bg-destructive/10` |
| running / streaming | 与普通态可区分，且不阻塞其它交互 |

状态用 `data-*` 属性表达，样式通过 `data-[state=...]:` 变体取值。

**隐藏式操作**：行内操作按钮可以默认隐藏（悬停或聚焦时显现），但必须保留占位（绝对定位或固定宽度），
不能让它在出现时挤压同行内容。键盘路径同样要能显现（`focus-visible`）。

## 可访问性

- 纯图标按钮必须带 `title` 或 `aria-label`
- 表单控件与 `Label` 关联；同一控件的说明文字用 `aria-describedby`
- 互斥选项组用原生 `fieldset` + `legend` + `radio`，不能只靠视觉高亮表示选中
- 装饰性元素（水印、纯装饰图标）加 `aria-hidden`
- 弹层支持 `Esc` 关闭与焦点回收；用 Radix 原语，不手写
- 键盘焦点顺序与视觉顺序一致

## 组件选型

- 2–4 个互斥选项用分段控件；超过 4 个改用下拉
- 单个动作、开关用按钮 / 开关；「标题 + 说明 + 控件」成组的用设置行
- 需要搜索、分组、带说明的选择用弹出层面板；选项少且无需说明时用普通下拉

## 组合模式

- 用 children / slot 组合，不用布尔 prop 堆叠。要「带图标的按钮」就传 `<Button><Icon/>文案</Button>`，
  不要 `<Button icon="plus" />`
- 需要把行为注入子元素时用 `asChild`（Radix `Slot`）
- 容器与内容分开：外框 + 分隔线是一层，行内容是另一层；新增同类界面直接复用容器
- 组件不感知路由与全局状态；会话 id、当前模型等都由上层传入

## 示例

具体写法直接读现有组件即可，下列只是**举例**，不代表必须覆盖的范围：

- 列表行（选中态、相对时间、隐藏式操作）：`session-list-item.tsx`
- 弹出层面板（搜索行、分组、条目说明）：`model-picker.tsx`
- 分组设置（容器 + 行 + 右侧控件）：`settings/settings-row.tsx`
