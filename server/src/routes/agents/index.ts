/** /api/v1/agents：列出可选的 primary / subagent 角色（选择器与设置页共用） */
import {
  type AgentsListInput,
  type AgentsListResponse,
  type AgentView,
  agentsListInputSchema,
  ERROR_CODES,
  SESSION_MODES,
} from "@ucode/contracts";
import { Hono } from "hono";
import { resolveSessionCwd } from "../../core/session-paths";
import { env } from "../../env";
import {
  type AgentProfile,
  type AgentRegistry,
  loadAgentRegistry,
  PRIMARY_PROFILES,
  SUBAGENT_PROFILES,
  SUBAGENT_SLUGS,
} from "../../harness/setup/agents";
import { AppError, ok } from "../../platform/response";
import { jsonBody } from "../../platform/validate";
import type { Services } from "../../services";

const toView = (slug: string, profile: AgentProfile, fallbackSource: "builtin"): AgentView => ({
  slug,
  label: profile.label,
  description: profile.description,
  kind: profile.kind,
  source: profile.source ?? fallbackSource,
  ...(profile.hidden ? { hidden: true } : {}),
});

/** primary：内置三位（可被同名自定义覆盖）+ 自定义新增 */
const primaryViews = (registry: AgentRegistry): AgentView[] => {
  const builtins = SESSION_MODES.map((slug) => {
    const custom = registry.primary[slug];
    const profile = custom ?? (PRIMARY_PROFILES as Record<string, AgentProfile>)[slug];
    return toView(slug, profile as AgentProfile, "builtin");
  });
  const custom = Object.entries(registry.primary)
    .filter(([slug]) => !(SESSION_MODES as readonly string[]).includes(slug))
    .map(([slug, profile]) => toView(slug, profile, "builtin"));
  return [...builtins, ...custom];
};

/** subagent：内置（可被同名自定义覆盖）+ 自定义新增 */
const subagentViews = (registry: AgentRegistry): AgentView[] => {
  const builtins = SUBAGENT_SLUGS.map((slug) =>
    toView(slug, registry.subagents[slug] ?? SUBAGENT_PROFILES[slug], "builtin"),
  );
  const custom = Object.entries(registry.subagents)
    .filter(([slug]) => !(SUBAGENT_SLUGS as readonly string[]).includes(slug))
    .map(([slug, profile]) => toView(slug, profile, "builtin"));
  return [...builtins, ...custom];
};

/** 列举所用的工作目录：优先会话，其次显式 cwd，最后助理工作区 */
const resolveCwd = (services: Services, input: AgentsListInput): string => {
  if (input.sessionId) {
    const record = services.sessions.find(input.sessionId);
    if (!record) {
      throw new AppError(ERROR_CODES.notFound, `会话不存在：${input.sessionId}`, 404, undefined, {
        path: input.sessionId,
      });
    }
    return resolveSessionCwd(record);
  }
  return input.cwd ?? env.workspacesDir;
};

export const createAgentsRoute = (services: Services) => {
  const router = new Hono();

  router.post("/list", jsonBody(agentsListInputSchema), (c) => {
    const input = c.req.valid("json");
    const registry = loadAgentRegistry({
      cwd: resolveCwd(services, input),
      appHome: env.homeDir,
      pluginAgents: services.plugins.agentProfiles(),
    });
    return c.json(
      ok({
        primary: primaryViews(registry),
        subagents: subagentViews(registry),
      } satisfies AgentsListResponse),
    );
  });

  return router;
};
