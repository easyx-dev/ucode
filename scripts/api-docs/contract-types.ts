/**
 * 用 TypeScript 编译器读取 `@ucode/contracts`：解析导出类型、取字段 JSDoc、把类型转成 `DocNode`。
 *
 * 响应侧目前只有 TS 类型（没有 zod schema），响应结构与字段说明只能从这里取；
 * 请求侧的字段说明也复用这套（zod 推断出的 `*Input` 类型会把 schema 字面量上的 JSDoc 带出来）。
 *
 * TS 7 起类型查询只在 `typescript/unstable/sync` 里：语言服务跑在独立子进程，本模块负责起进程、
 * 按契约包的 tsconfig 开项目；用完必须 `close()`，否则子进程会一直挂着不退。
 */
import { dirname, resolve } from "node:path";

import {
  isArrayTypeNode,
  isPropertySignatureDeclaration,
  isTypeAliasDeclaration,
  isTypeReferenceNode,
} from "typescript/unstable/ast";
import {
  API,
  type Checker,
  type Project,
  SymbolFlags,
  type Symbol as TsSymbol,
  type Type,
  TypeFlags,
  type TypeReference,
  type UnionType,
} from "typescript/unstable/sync";

import type { DocField, DocNode } from "./model.ts";

const CONTRACTS_DIR = resolve(import.meta.dirname, "../../packages/contracts");

/**
 * 统一成 `/` 分隔再比对。TS 给的路径一律用 `/`（`typescript` 包里 `documentURIToFileName` 的文档就写着
 * `c:/path/to/file.ts`），而 `node:path` 在 Windows 上会把 `join` 出的分隔符变成 `\`——直接比会整体不匹配。
 */
const toPosix = (path: string): string => path.replace(/\\/g, "/");

/** 源码目录前缀，用于筛程序里的文件名（保留原大小写） */
const CONTRACTS_SRC = toPosix(`${CONTRACTS_DIR}/src`);

export type ContractProgram = {
  project: Project;
  checker: Checker;
  /**
   * 契约源码目录前缀，用于判断符号声明在不在契约里：`NodeHandle.path` 是 TS 归一过的路径
   * （分隔符一律 `/`，大小写不敏感的平台还会整体小写），与程序里文件名的拼法不是同一套，不能共用常量。
   */
  srcPath: string;
  /** 契约包里「名字 → 导出符号」，扫一次源文件建表，避免每个类型都重扫 */
  exports: Map<string, TsSymbol>;
  /** 关掉语言服务子进程 */
  close: () => void;
};

/** 以契约包的 tsconfig 开项目（Bundler 解析，能正确解析 zod 推断出的类型） */
export const createContractProgram = (): ContractProgram => {
  const configPath = resolve(CONTRACTS_DIR, "tsconfig.json");
  const api = new API();
  try {
    const snapshot = api.updateSnapshot({ openProjects: [configPath] });
    const project = snapshot.getProject(configPath);
    if (!project) throw new Error(`打开契约项目失败：${configPath}`);
    return {
      project,
      checker: project.checker,
      srcPath: `${toPosix(dirname(project.id))}/src`,
      exports: collectExports(project, project.checker),
      close: () => api.close(),
    };
  } catch (error) {
    api.close();
    throw error;
  }
};

/** 契约包各源文件的导出符号（`export *` 转出来的也算在各自文件上） */
const collectExports = (project: Project, checker: Checker): Map<string, TsSymbol> => {
  const exports = new Map<string, TsSymbol>();
  for (const fileName of project.program.getSourceFileNames()) {
    if (!toPosix(fileName).startsWith(CONTRACTS_SRC)) continue;
    const source = project.program.getSourceFile(fileName);
    if (!source) continue;
    const moduleSymbol = checker.getSymbolAtLocation(source);
    if (!moduleSymbol) continue;
    for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
      if (!exports.has(symbol.name)) exports.set(symbol.name, symbol);
    }
  }
  return exports;
};

const isInContractsSrc = (ctx: ContractProgram, symbol: TsSymbol | undefined): boolean =>
  symbol?.declarations.some((declaration) => toPosix(declaration.path).startsWith(ctx.srcPath)) ??
  false;

/** 类型或类型别名是否声明在契约源码里 */
const contractNameOf = (ctx: ContractProgram, type: Type): string | undefined => {
  const alias = type.getAliasSymbol();
  if (alias && isInContractsSrc(ctx, alias)) return alias.name;
  const symbol = type.getSymbol();
  if (symbol && isInContractsSrc(ctx, symbol)) {
    if (!symbol.name.startsWith("__")) return symbol.name;
  }
  return undefined;
};

const isObjectFlags = (type: Type): boolean =>
  (type.flags & (TypeFlags.Object | TypeFlags.Intersection)) !== 0;

const isObjectLike = (checker: Checker, type: Type): boolean => {
  if (checker.isArrayType(type)) return false;
  if (type.isUnionType()) return type.getTypes().some((member) => isObjectLike(checker, member));
  return isObjectFlags(type) && checker.getPropertiesOfType(type).length > 0;
};

/** 解析导出类型别名 / 具名类型为可用类型 */
const typeOfExport = (ctx: ContractProgram, name: string): Type => {
  const symbol = ctx.exports.get(name);
  if (!symbol) throw new Error(`契约里找不到导出：${name}`);
  const declaration = symbol.declarations[0]?.resolve(ctx.project);
  if (declaration && isTypeAliasDeclaration(declaration)) {
    const aliasType = ctx.checker.getTypeAtLocation(declaration.type);
    if (aliasType) return aliasType;
  }
  return ctx.checker.getDeclaredTypeOfSymbol(symbol);
};

const cleanDoc = (raw: string): string => raw.replace(/\s+/g, " ").trim();

const isUndefined = (type: Type): boolean => (type.flags & TypeFlags.Undefined) !== 0;
const isNull = (type: Type): boolean => (type.flags & TypeFlags.Null) !== 0;

/** 联合的判别字段：各分支都有、且取互异字符串字面量的那个字段 */
const detectDiscriminator = (ctx: ContractProgram, type: UnionType): string | undefined => {
  const members = type.getTypes().filter((member) => isObjectFlags(member));
  const first = members[0];
  if (!first || members.length < 2) return undefined;
  for (const property of ctx.checker.getPropertiesOfType(first)) {
    const values = members.map((member) => {
      const target = ctx.checker.getPropertyOfType(member, property.name);
      if (!target) return undefined;
      const memberType = ctx.checker.getTypeOfSymbol(target);
      return memberType?.isStringLiteralType() ? memberType.value : undefined;
    });
    if (values.every((value) => value !== undefined) && new Set(values).size === members.length) {
      return property.name;
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
  property: TsSymbol,
  resolved: Type,
): DocNode | undefined => {
  const declaration = property.valueDeclaration?.resolve(ctx.project);
  if (!declaration || !isPropertySignatureDeclaration(declaration) || !declaration.type)
    return undefined;
  const typeNode = declaration.type;

  if (isTypeReferenceNode(typeNode)) {
    const symbol = ctx.checker.getSymbolAtLocation(typeNode.typeName);
    if (symbol && isInContractsSrc(ctx, symbol) && isObjectLike(ctx.checker, resolved)) {
      return { kind: "ref", name: typeNode.typeName.getText() };
    }
    return undefined;
  }

  if (isArrayTypeNode(typeNode) && isTypeReferenceNode(typeNode.elementType)) {
    const elementName = typeNode.elementType.typeName;
    const symbol = ctx.checker.getSymbolAtLocation(elementName);
    if (!symbol || !isInContractsSrc(ctx, symbol) || !ctx.checker.isArrayType(resolved)) {
      return undefined;
    }
    const [element] = ctx.checker.getTypeArguments(resolved as TypeReference);
    if (element && isObjectLike(ctx.checker, element)) {
      return { kind: "array", element: { kind: "ref", name: elementName.getText() } };
    }
  }

  return undefined;
};

/** 字符串索引签名的值类型，如 `Record<string, T>` 里的 `T` */
const stringIndexValue = (ctx: ContractProgram, type: Type): Type | undefined =>
  ctx.checker
    .getIndexInfosOfType(type)
    .find((info) => (info.keyType.flags & TypeFlags.String) !== 0)?.valueType;

const fieldsOfType = (ctx: ContractProgram, type: Type): DocField[] =>
  ctx.checker.getPropertiesOfType(type).map((property) => {
    const resolved = ctx.checker.getTypeOfSymbol(property) ?? ctx.checker.getAnyType();
    const override = declaredRefNode(ctx, property, resolved);
    return {
      name: property.name,
      optional: (property.flags & SymbolFlags.Optional) !== 0,
      doc: cleanDoc(property.getDocumentationComment(ctx.checker)),
      node: override ?? buildNode(ctx, resolved, { asRef: true }),
    };
  });

const buildNode = (ctx: ContractProgram, type: Type, options: BuildOptions): DocNode => {
  if (options.asRef && isObjectLike(ctx.checker, type)) {
    const name = contractNameOf(ctx, type);
    if (name) return { kind: "ref", name };
  }

  if (ctx.checker.isArrayType(type)) {
    const [element] = ctx.checker.getTypeArguments(type as TypeReference);
    return {
      kind: "array",
      element: element ? buildNode(ctx, element, options) : { kind: "text", text: "unknown" },
    };
  }

  if (type.isUnionType()) {
    const members = type.getTypes();
    const nonNull = members.filter((member) => !isUndefined(member) && !isNull(member));
    // TS 内部把 boolean 表示成 `false | true`，按语义还原成 boolean，避免表格里出现 `false | true`
    if (
      nonNull.length === 2 &&
      nonNull.every((member) => (member.flags & TypeFlags.BooleanLiteral) !== 0)
    ) {
      return { kind: "text", text: "boolean" };
    }
    const variants: DocNode[] = [];
    let nullable = false;
    for (const member of members) {
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
    const fields = fieldsOfType(ctx, type);
    if (fields.length > 0) return { kind: "object", fields };
    const indexValue = stringIndexValue(ctx, type);
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
