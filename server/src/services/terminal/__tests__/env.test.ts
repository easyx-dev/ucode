/** 终端环境清洗：剔掉包管理器、宿主运行模式与服务配置的痕迹，用户自己的变量原样保留 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { terminalEnvOf } from "../env";

describe("终端环境清洗", () => {
  it("剔除包管理器注入、宿主运行模式与服务配置，保留用户自己的变量", () => {
    const cleaned = terminalEnvOf({
      PATH: "/usr/bin",
      HOME: "/Users/me",
      LANG: "en_US.UTF-8",
      PNPM_HOME: "/Users/me/Library/pnpm",
      NODE_ENV: "production",
      NODE_PATH: "/repo/node_modules",
      NODE_OPTIONS: "--enable-source-maps",
      SHLVL: "3",
      APP_HOME: "~/.app-home",
      APP_PORT: "19688",
      SPIKE_API_KEY: "secret",
      INIT_CWD: "/repo",
      TERM: "xterm-ghostty",
      TERMINFO: "/Applications/Ghostty.app/share/terminfo",
      TERM_PROGRAM: "ghostty",
      TERM_PROGRAM_VERSION: "1.3.1",
      CI: "1",
      npm_lifecycle_event: "start",
      npm_lifecycle_script: "node",
      npm_execpath: "/Users/me/Library/pnpm/pnpm",
      npm_config_user_agent: "pnpm/12.6.0",
      npm_package_json: "/repo/package.json",
      pnpm_config_verify_deps_before_run: "false",
      PNPM_SCRIPT_SRC_DIR: "/repo",
    });

    assert.deepEqual(cleaned, {
      PATH: "/usr/bin",
      HOME: "/Users/me",
      LANG: "en_US.UTF-8",
      PNPM_HOME: "/Users/me/Library/pnpm",
    });
  });

  it("宿主缺值的键不落进结果", () => {
    assert.deepEqual(terminalEnvOf({ PATH: "/usr/bin", HOME: undefined }), { PATH: "/usr/bin" });
  });

  it("大小写不同的键同样命中剔除名单", () => {
    assert.deepEqual(
      terminalEnvOf({ Term: "xterm-ghostty", NPM_EXECPATH: "/x", Node_Env: "production" }),
      {},
    );
  });
});
