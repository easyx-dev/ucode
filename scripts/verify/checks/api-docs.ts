/**
 * 接口文档守卫。
 *
 * 1. 清单里的请求 schema / 请求类型 / 响应类型必须在契约里存在；
 * 2. 端点清单（`scripts/api-docs/endpoints.ts`）与 server 路由双向核对，漏登记 / 多登记都拦下；
 * 3. 生成文档与 `docs/api-reference.md` 逐字节比对，漂移即报「运行 pnpm api:docs」。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { API_ENDPOINTS } from "../../api-docs/endpoints.ts";
import { buildApiDoc } from "../../api-docs/generate.ts";
import { listFiles } from "../files.ts";

/** 从 server 路由文件里扫出的端点 */
type ScannedEndpoint = {
  domain: string;
  method: string;
  action: string;
  input: string | null;
};

const MOUNT = /v1\.route\(\s*"([^"]+)"/g;
const ROUTE = /router\.(get|post)\(\s*"([^"]*)"/g;
const JSON_BODY = /jsonBody\(\s*(\w+)\s*\)/;

/** server 里真实注册的端点集合 */
const scanServerRoutes = (root: string): ScannedEndpoint[] => {
  const entry = readFileSync(join(root, "server/src/index.ts"), "utf8");
  const domains = [...entry.matchAll(MOUNT)]
    .map((match) => match[1])
    .filter((domain): domain is string => Boolean(domain))
    .map((domain) => domain.replace(/^\//, ""));

  const endpoints: ScannedEndpoint[] = [];
  for (const domain of domains) {
    const file = join(root, `server/src/routes/${domain}/index.ts`);
    const source = readFileSync(file, "utf8");
    const matches = [...source.matchAll(ROUTE)];
    for (let index = 0; index < matches.length; index += 1) {
      const match = matches[index];
      if (!match) continue;
      const method = match[1]?.toUpperCase();
      const action = match[2]?.replace(/^\//, "");
      if (!method || action === undefined) continue;
      // jsonBody 只在本条注册语句内找：截到下一次 router 注册
      const start = match.index + match[0].length;
      const end = matches[index + 1]?.index ?? source.length;
      const rawInput = JSON_BODY.exec(source.slice(start, end))?.[1] ?? null;
      endpoints.push({
        domain,
        method,
        action,
        input: rawInput === "emptyInputSchema" ? null : rawInput,
      });
    }
  }
  return endpoints;
};

const keyOf = (endpoint: { domain: string; method: string; action: string }): string =>
  `${endpoint.domain} ${endpoint.method} ${endpoint.action || "(root)"}`;

/** 契约里导出的类型名与常量名（用于校验清单引用） */
const collectContractNames = (root: string): { types: Set<string>; values: Set<string> } => {
  const types = new Set<string>();
  const values = new Set<string>();
  const files = listFiles(root, "packages/contracts/src", (path) => path.endsWith(".ts"));
  for (const file of files) {
    const source = readFileSync(join(root, file), "utf8");
    for (const match of source.matchAll(/export type (\w+)/g)) {
      if (match[1]) types.add(match[1]);
    }
    for (const match of source.matchAll(/export const (\w+)/g)) {
      if (match[1]) values.add(match[1]);
    }
  }
  return { types, values };
};

export const run = (root: string): string[] => {
  const problems: string[] = [];

  // 1. 请求 schema 名与响应类型名在契约里存在（先于生成，避免清单写错时生成器直接抛异常）
  const contract = collectContractNames(root);
  for (const endpoint of API_ENDPOINTS) {
    if (endpoint.input && !contract.values.has(endpoint.input)) {
      problems.push(
        `endpoints.ts 的请求 schema ${endpoint.input} 在契约里不存在（${keyOf(endpoint)}）`,
      );
    }
    if (endpoint.requestType && !contract.types.has(endpoint.requestType)) {
      problems.push(
        `endpoints.ts 的请求类型 ${endpoint.requestType} 在契约里不存在（${keyOf(endpoint)}）`,
      );
    }
    if (!endpoint.stream && !endpoint.binary && !contract.types.has(endpoint.output)) {
      problems.push(
        `endpoints.ts 的响应类型 ${endpoint.output} 在契约里不存在（${keyOf(endpoint)}）`,
      );
    }
  }

  // 2. 清单与 server 路由双向核对（路径 + 请求 schema）
  const scanned = new Map(
    scanServerRoutes(root).map((endpoint) => [keyOf(endpoint), endpoint.input]),
  );
  const declared = new Map(API_ENDPOINTS.map((endpoint) => [keyOf(endpoint), endpoint.input]));
  for (const [key, input] of scanned) {
    if (!declared.has(key)) {
      problems.push(`server 路由未登记到 scripts/api-docs/endpoints.ts：${key}`);
      continue;
    }
    if (declared.get(key) !== input) {
      problems.push(
        `端点请求 schema 不一致：${key}（清单 ${declared.get(key) ?? "无参数"}，server ${input ?? "无参数"}）`,
      );
    }
  }
  for (const key of declared.keys()) {
    if (!scanned.has(key)) problems.push(`endpoints.ts 登记的接口在 server 路由里找不到：${key}`);
  }

  // 3. 文档是否与契约一致（前两组有问题时不生成，避免用坏清单触发异常）
  if (problems.length === 0) {
    const actual = readFileSync(join(root, "docs/api-reference.md"), "utf8");
    if (buildApiDoc() !== actual) {
      problems.push("docs/api-reference.md 与契约不一致，请运行 `pnpm api:docs` 重新生成");
    }
  }

  return problems;
};
