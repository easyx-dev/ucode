import { type ReactNode, useState } from "react";
import { useAgentStore } from "../context.ts";
import { PackageIcon, RefreshIcon } from "./icons.tsx";
import {
  componentKindLabel,
  describeCatalogEntry,
  groupInstalled,
  summarizeInstallReport,
} from "./marketplace-format.ts";
import { Badge, Button, Card, IconButton, Panel } from "./primitives.tsx";

/**
 * 插件市场面板（F-3.6）。
 *
 * 三块内容：**源**（用户登记的可装插件的地方，local 目录或 remote 清单）、
 * **目录**（点开源才读，按需拉取）、**已装**（数据层里现在有什么，按类型分组，可卸载）。
 *
 * 面板只做展示与动作转发；装/卸、清单解析、落盘都在服务层（协议命令）。
 */

export function MarketplacePanel({ onClose }: { onClose: () => void }): ReactNode {
  const marketplace = useAgentStore((store) => store.marketplace);
  const loadMarketplace = useAgentStore((store) => store.loadMarketplace);
  const loadCatalog = useAgentStore((store) => store.loadCatalog);
  const addSource = useAgentStore((store) => store.addMarketplaceSource);
  const removeSource = useAgentStore((store) => store.removeMarketplaceSource);
  const installPlugin = useAgentStore((store) => store.installPlugin);
  const uninstallPlugin = useAgentStore((store) => store.uninstallPlugin);

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"local" | "remote">("local");
  const [location, setLocation] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [openSource, setOpenSource] = useState<string | null>(null);

  const groups = groupInstalled(marketplace.installed);

  async function submitSource(): Promise<void> {
    if (name.trim() === "" || location.trim() === "") {
      setNote("源需要名字与位置。");
      return;
    }
    setNote(null);
    await addSource({ name: name.trim(), kind, location: location.trim() });
    setName("");
    setLocation("");
    setAdding(false);
  }

  async function install(source: string, plugin: string): Promise<void> {
    setNote(null);
    const report = await installPlugin({ source, plugin });
    setNote(report === null ? "安装失败（详见上方错误）。" : summarizeInstallReport(report));
  }

  return (
    <Panel
      title="插件与市场"
      icon={<PackageIcon />}
      onClose={onClose}
      actions={
        <>
          {marketplace.loading && <Badge tone="muted">加载中</Badge>}
          <IconButton
            icon={<RefreshIcon />}
            label="刷新市场"
            onClick={() => void loadMarketplace()}
          />
        </>
      }
      bodyClassName="p-2"
    >
      {marketplace.error !== null && (
        <div className="mb-2 rounded-md bg-[var(--color-danger-soft)] px-2.5 py-1.5 text-[11px] text-[var(--color-danger)]">
          {marketplace.error}
        </div>
      )}
      {note !== null && (
        <div className="mb-2 rounded-md bg-[var(--color-surface-overlay)] px-2.5 py-1.5 text-[11px] text-[var(--color-content-muted)]">
          {note}
        </div>
      )}

      <div>
        <section className="mb-3">
          <div className="mb-1 flex items-center gap-2 px-1">
            <span className="text-[11px] font-medium text-[var(--color-content-muted)]">
              市场源
            </span>
            <Button size="sm" className="ml-auto" onClick={() => setAdding((value) => !value)}>
              {adding ? "取消" : "添加源"}
            </Button>
          </div>

          {adding && (
            <Card className="mb-2 flex flex-col gap-2 p-2">
              <input
                className="rounded border border-[var(--color-border-subtle)] bg-[var(--color-surface-overlay)] px-2 py-1 text-[12px]"
                placeholder="源名，如 official"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant={kind === "local" ? "primary" : "ghost"}
                  onClick={() => setKind("local")}
                >
                  本机目录
                </Button>
                <Button
                  size="sm"
                  variant={kind === "remote" ? "primary" : "ghost"}
                  onClick={() => setKind("remote")}
                >
                  远程清单
                </Button>
              </div>
              <input
                className="rounded border border-[var(--color-border-subtle)] bg-[var(--color-surface-overlay)] px-2 py-1 font-[var(--font-mono)] text-[12px]"
                placeholder={kind === "local" ? "/path/to/plugins" : "https://…/marketplace.json"}
                value={location}
                onChange={(event) => setLocation(event.target.value)}
              />
              <Button size="sm" variant="primary" onClick={() => void submitSource()}>
                登记
              </Button>
            </Card>
          )}

          {marketplace.sources.length === 0 ? (
            <p className="px-1 text-[11px] text-[var(--color-content-muted)]">
              还没有源。源由你登记：本机目录（每个子目录一个插件）或一个返回 JSON 清单的地址。
            </p>
          ) : (
            marketplace.sources.map((source) => (
              <Card key={source.name} className="mb-2 p-2">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-medium">{source.name}</span>
                  <Badge tone="muted">{source.kind === "local" ? "本机" : "远程"}</Badge>
                  <Button
                    size="sm"
                    className="ml-auto"
                    onClick={() => {
                      const next = openSource === source.name ? null : source.name;
                      setOpenSource(next);
                      if (next !== null) void loadCatalog(next);
                    }}
                  >
                    {openSource === source.name ? "收起" : "目录"}
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => void removeSource(source.name)}>
                    移除
                  </Button>
                </div>
                <div className="mt-1 truncate font-[var(--font-mono)] text-[10px] text-[var(--color-content-muted)]">
                  {source.location}
                </div>
                {openSource === source.name && (
                  <div className="mt-2 flex flex-col gap-1">
                    {(marketplace.catalog[source.name] ?? []).length === 0 ? (
                      <p className="text-[11px] text-[var(--color-content-muted)]">
                        这个源里没有可装的插件。
                      </p>
                    ) : (
                      (marketplace.catalog[source.name] ?? []).map((entry) => (
                        <div key={entry.name} className="flex items-center gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-[12px]">{entry.name}</div>
                            <div className="truncate text-[10px] text-[var(--color-content-muted)]">
                              {describeCatalogEntry(entry)}
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="primary"
                            className="ml-auto shrink-0"
                            onClick={() => void install(source.name, entry.name)}
                          >
                            安装
                          </Button>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </Card>
            ))
          )}
        </section>

        <section>
          <div className="mb-1 px-1 text-[11px] font-medium text-[var(--color-content-muted)]">
            已装（{marketplace.installed.length}）
          </div>
          {groups.length === 0 ? (
            <p className="px-1 text-[11px] text-[var(--color-content-muted)]">
              数据层里还没有技能/提示/子智能体/扩展。
            </p>
          ) : (
            groups.map((group) => (
              <Card key={group.kind} className="mb-2 p-2">
                <div className="mb-1 text-[11px] text-[var(--color-content-muted)]">
                  {group.label}（{group.items.length}）
                </div>
                {group.items.map((item) => (
                  <div key={item.path} className="flex items-center gap-2 py-0.5">
                    <span className="truncate text-[12px]">{item.name}</span>
                    {group.kind === "extension" && <Badge tone="warn">可执行</Badge>}
                    <Button
                      size="sm"
                      className="ml-auto shrink-0"
                      onClick={() =>
                        void uninstallPlugin({
                          kind: group.kind as "skill" | "prompt" | "agent" | "extension",
                          name: item.name,
                        })
                      }
                    >
                      卸载
                    </Button>
                  </div>
                ))}
              </Card>
            ))
          )}
        </section>
      </div>
    </Panel>
  );
}

export { componentKindLabel };
