/**
 * 把 `DocNode` 渲染成 markdown 参数表：对象字段扁平展开（嵌套用点号、数组用 `[]`），
 * 对象联合（oneOf）拆成多张按判别值命名的表，具名引用收集到附录。
 */
import type { DocField, DocNode, DocRow, DocTable, RefRegistry } from "./model.ts";
import { nodeText } from "./schema-params.ts";

export type TableMode = "request" | "response";

export const createRefRegistry = (): RefRegistry => ({ names: [], seen: new Set() });

const addRef = (refs: RefRegistry, name: string): void => {
  if (refs.seen.has(name)) return;
  refs.seen.add(name);
  refs.names.push(name);
};

const collectRefs = (node: DocNode, refs: RefRegistry): void => {
  if (node.kind === "ref") {
    addRef(refs, node.name);
    return;
  }
  if (node.kind === "array") {
    collectRefs(node.element, refs);
    return;
  }
  if (node.kind === "union") {
    for (const variant of node.variants) collectRefs(variant, refs);
  }
};

const escapeCell = (text: string): string => text.replace(/\|/g, "\\|");

const formatDefault = (value: unknown): string => {
  if (value === undefined) return "—";
  if (value === null) return "`null`";
  if (typeof value === "string") return `\`${value}\``;
  return `\`${JSON.stringify(value)}\``;
};

const isObjectUnion = (node: DocNode): boolean =>
  node.kind === "union" &&
  node.variants.length >= 2 &&
  node.variants.every((v) => v.kind === "object");

const makeRow = (path: string, field: DocField, refs: RefRegistry): DocRow => {
  collectRefs(field.node, refs);
  return {
    path,
    type: nodeText(field.node),
    required: !field.optional,
    defaultText: formatDefault(field.defaultValue),
    doc: escapeCell(field.doc) || "—",
  };
};

type NestedUnion = { title: string; node: DocNode };

const flatten = (
  node: DocNode,
  prefix: string,
  rows: DocRow[],
  refs: RefRegistry,
  nested: NestedUnion[],
): void => {
  if (node.kind !== "object") return;
  for (const field of node.fields) {
    const path = prefix ? `${prefix}.${field.name}` : field.name;
    rows.push(makeRow(path, field, refs));
    const child = field.node;
    if (child.kind === "object") flatten(child, path, rows, refs, nested);
    else if (child.kind === "array" && child.element.kind === "object") {
      flatten(child.element, `${path}[]`, rows, refs, nested);
    } else if (isObjectUnion(child)) {
      nested.push({ title: path, node: child });
    }
  }
};

const variantLabel = (union: DocNode, variant: DocNode, title: string): string => {
  if (union.kind === "union" && union.discriminator && variant.kind === "object") {
    const field = variant.fields.find((candidate) => candidate.name === union.discriminator);
    if (field) return `${title}（${union.discriminator} = ${nodeText(field.node)}）`;
  }
  return `${title}（之一）`;
};

const renderObjectUnion = (node: DocNode, refs: RefRegistry, title: string): DocTable[] => {
  if (node.kind !== "union") return [];
  return node.variants.flatMap((variant) =>
    renderNodeTables(variant, refs, variantLabel(node, variant, title)),
  );
};

/** 单个节点 → 若干张表 */
export const renderNodeTables = (node: DocNode, refs: RefRegistry, title?: string): DocTable[] => {
  if (node.kind === "object") {
    const rows: DocRow[] = [];
    const nested: NestedUnion[] = [];
    flatten(node, "", rows, refs, nested);
    const tables: DocTable[] = [{ title, rows }];
    for (const child of nested) tables.push(...renderObjectUnion(child.node, refs, child.title));
    return tables;
  }
  if (isObjectUnion(node)) return renderObjectUnion(node, refs, title ?? "取值之一");
  const row: DocRow = {
    path: "（值）",
    type: nodeText(node),
    required: true,
    defaultText: "—",
    doc: "—",
  };
  collectRefs(node, refs);
  return [{ title, rows: [row] }];
};

const tableToMarkdown = (table: DocTable, mode: TableMode): string => {
  const lines = table.title ? [`**${table.title}**`, ""] : [];
  const cell = (row: DocRow): string => {
    const type = row.type.replace(/\|/g, "\\|");
    return mode === "request"
      ? `| \`${row.path}\` | ${type} | ${row.required ? "是" : "否"} | ${row.defaultText} | ${row.doc} |`
      : `| \`${row.path}\` | ${type} | ${row.required ? "是" : "否"} | ${row.doc} |`;
  };
  if (mode === "request") {
    lines.push("| 字段 | 类型 | 必填 | 默认 | 说明 |", "| --- | --- | --- | --- | --- |");
  } else {
    lines.push("| 字段 | 类型 | 必填 | 说明 |", "| --- | --- | --- | --- |");
  }
  for (const row of table.rows) lines.push(cell(row));
  return lines.join("\n");
};

/** 若干张表 → markdown 片段 */
export const renderTables = (tables: DocTable[], mode: TableMode): string =>
  tables.map((table) => tableToMarkdown(table, mode)).join("\n\n");
