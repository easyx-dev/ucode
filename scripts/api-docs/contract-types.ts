/**
 * 用 TypeScript 编译器读取 `@ucode/contracts`：解析导出类型、取字段 JSDoc、把类型转成 `DocNode`。
 *
 * 响应侧目前只有 TS 类型（没有 zod schema），响应结构与字段说明只能从这里取；
 * 请求侧的字段说明也复用这套（zod 推断出的 `*Input` 类型会把 schema 字面量上的 JSDoc 带出来）。
 */
import { resolve } from "node:path";

import ts from "typescript";

import type { DocField, DocNode } from "./model.ts";

const CONTRACTS_DIR = resolve(import.meta.dirname, "../../packages/contracts");
const CONTRACTS_SRC = `${CONTRACTS_DIR}/src`;

export type ContractProgram = {
  program: ts.Program;
  checker: ts.TypeChecker;
};

/** 以契约包的 tsconfig 建 Program（Bundler 解析，能正确解析 zod 推断出的类型） */
export const createContractProgram = (): ContractProgram => {
  const configPath = resolve(CONTRACTS_DIR, "tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) {
    throw new Error(
      `读取契约 tsconfig 失败：${ts.flattenDiagnosticMessageText(config.error.messageText, " ")}`,
    );
  }
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, CONTRACTS_DIR);
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  return { program, checker: program.getTypeChecker() };
};

const isInContractsSrc = (symbol: ts.Symbol | undefined): boolean =>
  symbol?.declarations?.some((decl) => decl.getSourceFile().fileName.startsWith(CONTRACTS_SRC)) ??
  false;

/** 类型或类型别名是否声明在契约源码里 */
const contractNameOf = (type: ts.Type): string | undefined => {
  const alias = type.aliasSymbol;
  if (alias && isInContractsSrc(alias)) return alias.getName();
  const symbol = type.getSymbol();
  if (symbol && isInContractsSrc(symbol)) {
    const name = symbol.getName();
    if (!name.startsWith("__")) return name;
  }
  return undefined;
};

const isObjectFlags = (type: ts.Type): boolean =>
  (type.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection)) !== 0;

const isObjectLike = (checker: ts.TypeChecker, type: ts.Type): boolean => {
  if (checker.isArrayType(type)) return false;
  if (type.isUnion()) return type.types.some((member) => isObjectLike(checker, member));
  return isObjectFlags(type) && checker.getPropertiesOfType(type).length > 0;
};

/** 找到契约包里导出的具名符号（类型或常量） */
const findExport = (ctx: ContractProgram, name: string): ts.Symbol | undefined => {
  for (const source of ctx.program.getSourceFiles()) {
    if (!source.fileName.startsWith(CONTRACTS_SRC)) continue;
    const moduleSymbol = ctx.checker.getSymbolAtLocation(source);
    if (!moduleSymbol) continue;
    for (const symbol of ctx.checker.getExportsOfModule(moduleSymbol)) {
      if (symbol.getName() === name) return symbol;
    }
  }
  return undefined;
};

/** 解析导出类型别名 / 具名类型为可用类型 */
const typeOfExport = (ctx: ContractProgram, name: string): ts.Type => {
  const symbol = findExport(ctx, name);
  if (!symbol) throw new Error(`契约里找不到导出：${name}`);
  const declaration = symbol.declarations?.[0];
  if (declaration && ts.isTypeAliasDeclaration(declaration)) {
    return ctx.checker.getTypeAtLocation(declaration.type);
  }
  return ctx.checker.getDeclaredTypeOfSymbol(symbol);
};

const cleanDoc = (raw: string): string => raw.replace(/\s+/g, " ").trim();

const isUndefined = (type: ts.Type): boolean => (type.flags & ts.TypeFlags.Undefined) !== 0;
const isNull = (type: ts.Type): boolean => (type.flags & ts.TypeFlags.Null) !== 0;

/** 联合的判别字段：各分支都有、且取互异字符串字面量的那个字段 */
const detectDiscriminator = (ctx: ContractProgram, type: ts.UnionType): string | undefined => {
  const members = type.types.filter((member) => isObjectFlags(member));
  const first = members[0];
  if (!first || members.length < 2) return undefined;
  for (const property of ctx.checker.getPropertiesOfType(first)) {
    const values = members.map((member) => {
      const target = ctx.checker.getPropertyOfType(member, property.getName());
      if (!target) return undefined;
      const memberType = ctx.checker.getTypeOfSymbol(target);
      return memberType.isStringLiteral() ? memberType.value : undefined;
    });
    if (values.every((value) => value !== undefined) && new Set(values).size === members.length) {
      return property.getName();
    }
  }
  return undefined;
};

export type BuildOptions = {
  /** 遇到具名契约类型时是否转成引用（根类型传 false，其余传 true） */
  asRef: boolean;
};

/** 字段声明类型是契约里具名的类型引用时，取其名字（用于 zod 推断丢失 aliasSymbol 的场合，如 `McpServerView`） */
const declaredRefNode = (
  ctx: ContractProgram,
  property: ts.Symbol,
  resolved: ts.Type,
): DocNode | undefined => {
  const declaration = property.valueDeclaration;
  if (!declaration || !ts.isPropertySignature(declaration) || !declaration.type) return undefined;
  const typeNode = declaration.type;

  if (ts.isTypeReferenceNode(typeNode)) {
    const symbol = ctx.checker.getSymbolAtLocation(typeNode.typeName);
    if (symbol && isInContractsSrc(symbol) && isObjectLike(ctx.checker, resolved)) {
      return { kind: "ref", name: typeNode.typeName.getText() };
    }
    return undefined;
  }

  if (ts.isArrayTypeNode(typeNode) && ts.isTypeReferenceNode(typeNode.elementType)) {
    const symbol = ctx.checker.getSymbolAtLocation(typeNode.elementType.typeName);
    if (!symbol || !isInContractsSrc(symbol) || !ctx.checker.isArrayType(resolved))
      return undefined;
    const [element] = ctx.checker.getTypeArguments(resolved as ts.TypeReference);
    if (element && isObjectLike(ctx.checker, element)) {
      return {
        kind: "array",
        element: { kind: "ref", name: typeNode.elementType.typeName.getText() },
      };
    }
  }

  return undefined;
};

const buildNode = (ctx: ContractProgram, type: ts.Type, options: BuildOptions): DocNode => {
  if (options.asRef && isObjectLike(ctx.checker, type)) {
    const name = contractNameOf(type);
    if (name) return { kind: "ref", name };
  }

  if (ctx.checker.isArrayType(type)) {
    const [element] = ctx.checker.getTypeArguments(type as ts.TypeReference);
    return {
      kind: "array",
      element: element ? buildNode(ctx, element, options) : { kind: "text", text: "unknown" },
    };
  }

  if (type.isUnion()) {
    const nonNull = type.types.filter((member) => !isUndefined(member) && !isNull(member));
    // TS 内部把 boolean 表示成 `false | true`，按语义还原成 boolean，避免表格里出现 `false | true`
    if (
      nonNull.length === 2 &&
      nonNull.every((member) => (member.flags & ts.TypeFlags.BooleanLiteral) !== 0)
    ) {
      return { kind: "text", text: "boolean" };
    }
    const variants: DocNode[] = [];
    let nullable = false;
    for (const member of type.types) {
      if (isUndefined(member)) continue;
      if (isNull(member)) {
        nullable = true;
        continue;
      }
      variants.push(buildNode(ctx, member, options));
    }
    return { kind: "union", variants, nullable, discriminator: detectDiscriminator(ctx, type) };
  }

  if (isObjectFlags(type)) {
    const properties = ctx.checker.getPropertiesOfType(type);
    if (properties.length > 0) {
      const fields: DocField[] = properties.map((property) => {
        const resolved = ctx.checker.getTypeOfSymbol(property);
        const override = declaredRefNode(ctx, property, resolved);
        return {
          name: property.getName(),
          optional: (property.flags & ts.SymbolFlags.Optional) !== 0,
          doc: cleanDoc(ts.displayPartsToString(property.getDocumentationComment(ctx.checker))),
          node: override ?? buildNode(ctx, resolved, { asRef: true }),
        };
      });
      return { kind: "object", fields };
    }
    const indexValue = ctx.checker.getIndexTypeOfType(type, ts.IndexKind.String);
    if (indexValue) {
      return { kind: "text", text: `Record<string, ${ctx.checker.typeToString(indexValue)}>` };
    }
  }

  return { kind: "text", text: ctx.checker.typeToString(type) };
};

/** 由导出类型名构建文档节点（根类型展开，不下钻成引用） */
export const typeToDocNode = (ctx: ContractProgram, name: string): DocNode =>
  buildNode(ctx, typeOfExport(ctx, name), { asRef: false });

/** 从类型的文档节点里收集「字段路径 → JSDoc」，供请求 JSON Schema 按路径回填说明 */
export const collectFieldDocs = (ctx: ContractProgram, typeName: string): Map<string, string> => {
  const docs = new Map<string, string>();
  const visit = (node: DocNode, path: string): void => {
    if (node.kind === "object") {
      for (const field of node.fields) {
        const key = path ? `${path}.${field.name}` : field.name;
        if (field.doc) docs.set(key, field.doc);
        visit(field.node, key);
      }
      return;
    }
    if (node.kind === "array") {
      visit(node.element, path);
      return;
    }
    if (node.kind === "union") {
      for (const variant of node.variants) visit(variant, path);
    }
  };
  visit(typeToDocNode(ctx, typeName), "");
  return docs;
};
