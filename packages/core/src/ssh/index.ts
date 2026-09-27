export { createSshExtension, type SshExtensionOptions } from "./extension.ts";
export {
  addConnection,
  findConnection,
  isValidConnectionName,
  listConnections,
  normalizeConnection,
  removeConnection,
  SSH_NAME_PATTERN,
  type SshConnection,
  sshFileFor,
} from "./registry.ts";
export {
  type RunRemoteOptions,
  remoteTarget,
  runRemote,
  type SshExec,
  type SshExecResult,
  shellQuote,
  sshArgv,
} from "./remote.ts";
