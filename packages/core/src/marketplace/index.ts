export {
  type CatalogEntry,
  type PluginComponent,
  type PluginComponentKind,
  parseEntry,
  readCatalog,
} from "./catalog.ts";
export {
  type InstallOptions,
  type InstallReport,
  installPlugin,
  listInstalled,
  marketplaceDestinationFor,
  summarizeInstall,
  uninstallPlugin,
} from "./install.ts";
export {
  addSource,
  findSource,
  listSources,
  type MarketplaceSource,
  type MarketplaceSourceKind,
  marketplacesFileFor,
  normalizeSource,
  removeSource,
} from "./sources.ts";
