/** 注册表到契约视图的映射：组件计数与「未注入运行时」的分组供设置页直接渲染 */
import type { PluginComponentCounts, PluginView } from "@ucode/contracts";

import type { PluginDescriptor, PluginRegistry } from "./types";

const countOf = (descriptor: PluginDescriptor, group: keyof PluginComponentCounts): number =>
  descriptor.components.filter((entry) => entry.group === group).length;

export const toPluginComponentCounts = (descriptor: PluginDescriptor): PluginComponentCounts => ({
  skills: countOf(descriptor, "skills"),
  commands: countOf(descriptor, "commands"),
  agents: countOf(descriptor, "agents"),
  hooks: countOf(descriptor, "hooks"),
  mcp: countOf(descriptor, "mcp"),
  bin: countOf(descriptor, "bin"),
  extensions: countOf(descriptor, "extensions"),
});

export const toPluginView = (descriptor: PluginDescriptor): PluginView => ({
  id: descriptor.id,
  name: descriptor.name,
  displayName: descriptor.displayName,
  description: descriptor.description,
  version: descriptor.version,
  source: descriptor.source,
  enabled: descriptor.enabled,
  path: descriptor.root,
  installedAt: descriptor.installedAt,
  components: toPluginComponentCounts(descriptor),
  blockedComponents: descriptor.blocked,
  updateAvailable: descriptor.updateAvailable,
  ...(descriptor.checkedAt ? { checkedAt: descriptor.checkedAt } : {}),
  diagnostics: descriptor.diagnostics,
});

export const toPluginViews = (registry: PluginRegistry): PluginView[] =>
  registry.plugins.map(toPluginView);
