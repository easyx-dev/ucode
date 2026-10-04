/**
 * 把 zod 的 JSON Schema（`z.toJSONSchema` 产物）转成 `DocNode`，
 * 字段说明按「字段路径 → JSDoc」表回填（zod 的 `.describe()` 在本仓库未使用，说明都在 JSDoc 上）。
 */
import type { DocField, DocNode } from "./model.ts";

type JsonObject = Record<string, unknown>;

const asObject = (value: unknown): JsonObject | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;

const joinPath = (parent: string, name: string): string => (parent ? `${parent}.${name}` : name);

/** 叶子类型的约束文本，折进类型括号里 */
const constraintsOf = (schema: JsonObject): string[] => {
  const parts: string[] = [];
  const min = (key: string): number | undefined =>
    typeof schema[key] === "number" ? (schema[key] as number) : undefined;

  const lengthMin = min("minLength");
  const lengthMax = min("maxLength");
  if (lengthMin !== undefined && lengthMax !== undefined)
    parts.push(`长度 ${lengthMin}–${lengthMax}`);
  else if (lengthMin !== undefined) parts.push(`长度≥${lengthMin}`);
  else if (lengthMax !== undefined) parts.push(`长度≤${lengthMax}`);

  const itemMin = min("minItems");
  const itemMax = min("maxItems");
  if (itemMin !== undefined && itemMax !== undefined) parts.push(`${itemMin}–${itemMax} 项`);
  else if (itemMin !== undefined) parts.push(`≥${itemMin} 项`);
  else if (itemMax !== undefined) parts.push(`≤${itemMax} 项`);

  const lower = min("minimum");
  const lowerExclusive = min("exclusiveMinimum");
  if (lowerExclusive !== undefined) parts.push(`>${lowerExclusive}`);
  else if (lower !== undefined) parts.push(`≥${lower}`);
  // zod 对整数默认补 maximum = Number.MAX_SAFE_INTEGER，这不是业务上限，不展示
  const upper = min("maximum");
  const upperExclusive = min("exclusiveMaximum");
  if (upperExclusive !== undefined) parts.push(`<${upperExclusive}`);
  else if (upper !== undefined && upper !== Number.MAX_SAFE_INTEGER) parts.push(`≤${upper}`);

  if (typeof schema.pattern === "string") parts.push(`格式 \`${schema.pattern}\``);
  return parts;
};

/** 叶子类型的展示文本：基础类型 + 约束括号 */
const leafText = (schema: JsonObject): string => {
  const base =
    schema.type === "string"
      ? "string"
      : schema.type === "integer"
        ? "integer"
        : schema.type === "number"
          ? "number"
          : schema.type === "boolean"
            ? "boolean"
            : schema.type === "null"
              ? "null"
              : "unknown";
  const constraints = constraintsOf(schema);
  return constraints.length > 0 ? `${base}（${constraints.join("，")}）` : base;
};

const literalText = (value: unknown): string =>
  typeof value === "string" ? `"${value}"` : JSON.stringify(value);

const enumText = (values: unknown[]): string => values.map(literalText).join(" | ");

/** 判别字段：各分支都有、且取值唯一的 const / 单值 enum */
const detectDiscriminator = (branches: JsonObject[]): string | undefined => {
  const first = branches[0];
  if (!first) return undefined;
  const properties = asObject(first.properties);
  if (!properties) return undefined;
  for (const name of Object.keys(properties)) {
    const values = branches.map((branch) => {
      const field = asObject(asObject(branch.properties)?.[name]);
      if (!field) return undefined;
      if ("const" in field) return field.const;
      const single =
        Array.isArray(field.enum) && field.enum.length === 1 ? field.enum[0] : undefined;
      return single;
    });
    if (values.every((value) => value !== undefined) && new Set(values).size === branches.length)
      return name;
  }
  return undefined;
};

const arrayText = (element: DocNode): string => {
  const text = nodeText(element);
  const needsParens = element.kind === "union" || (element.kind === "text" && text.includes("|"));
  return needsParens ? `(${text})[]` : `${text}[]`;
};

/** 节点的类型文本；具名引用渲染成链接近似（锚点在渲染层补齐） */
export const nodeText = (node: DocNode): string => {
  switch (node.kind) {
    case "array": {
      const text = arrayText(node.element);
      return node.constraint ? `${text}（${node.constraint}）` : text;
    }
    case "ref":
      return `[${node.name}](#${node.name.toLowerCase()})`;
    case "union": {
      if (node.variants.length > 1 && node.variants.every((variant) => variant.kind === "object")) {
        const suffix = node.nullable ? " | null" : "";
        if (!node.discriminator) return `object${suffix}`;
        const values = node.variants.map((variant) => {
          const field =
            variant.kind === "object"
              ? variant.fields.find((item) => item.name === node.discriminator)
              : undefined;
          return field ? nodeText(field.node) : "?";
        });
        return `object（${node.discriminator} = ${values.join(" | ")}）${suffix}`;
      }
      const parts = node.variants.map(nodeText);
      if (node.nullable) parts.push("null");
      return parts.join(" | ");
    }
    case "object":
      return "object";
    default:
      return node.text;
  }
};

/** JSON Schema → DocNode（`path` 与 `collectFieldDocs` 的路径口径一致：数组 / 联合不下钻路径） */
export const jsonSchemaToDocNode = (
  schema: unknown,
  docs: Map<string, string>,
  path = "",
): DocNode => {
  const node = asObject(schema);
  if (!node) return { kind: "text", text: "unknown" };

  const union = node.oneOf ?? node.anyOf;
  if (Array.isArray(union)) {
    const branches = union.map((branch) => asObject(branch) ?? {});
    return {
      kind: "union",
      variants: union.map((branch) => jsonSchemaToDocNode(branch, docs, path)),
      nullable: false,
      discriminator: detectDiscriminator(branches),
    };
  }

  if (Array.isArray(node.enum)) return { kind: "text", text: enumText(node.enum) };
  if ("const" in node) return { kind: "text", text: literalText(node.const) };

  // `z.string().nullable()` 这类会产出 `type: ["string", "null"]`
  if (Array.isArray(node.type)) {
    const types = node.type as unknown[];
    const rest = types.filter((entry) => entry !== "null");
    return {
      kind: "union",
      variants: rest.map((entry) => ({ kind: "text", text: leafText({ ...node, type: entry }) })),
      nullable: types.includes("null"),
    };
  }

  if (node.type === "array") {
    const constraints = constraintsOf(node);
    return {
      kind: "array",
      element: jsonSchemaToDocNode(node.items, docs, path),
      constraint: constraints.length > 0 ? constraints.join("，") : undefined,
    };
  }

  const properties = asObject(node.properties);
  if (properties) {
    const required = new Set(Array.isArray(node.required) ? (node.required as string[]) : []);
    const fields: DocField[] = Object.entries(properties).map(([name, child]) => {
      const childPath = joinPath(path, name);
      return {
        name,
        optional: !required.has(name),
        doc: docs.get(childPath) ?? "",
        defaultValue: asObject(child)?.default,
        node: jsonSchemaToDocNode(child, docs, childPath),
      };
    });
    if (fields.length > 0) return { kind: "object", fields };
  }

  const additional = asObject(node.additionalProperties);
  if (additional) {
    return {
      kind: "text",
      text: `Record<string, ${nodeText(jsonSchemaToDocNode(additional, docs, path))}>`,
    };
  }

  return { kind: "text", text: leafText(node) };
};
