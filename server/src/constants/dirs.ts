/** 固定目录名与文件名：运行时布局的唯一出处，由 `$APP_HOME` 派生 */
import { brand } from "@ucode/brand/values";

/** 运行时数据目录名（位于 APP_HOME 下）：auth.json / sessions */
export const HARNESS_DIRNAME = "harness";

/** 应用自有数据目录名（位于 APP_HOME 下）：config.json / SQLite */
export const APP_DIRNAME = "app";

/** 会话 JSONL 目录名（位于 pi 目录下） */
export const SESSIONS_DIRNAME = "sessions";

/** 会话工作区根目录名（位于主目录下）：`workspace/<sessionId>` */
export const WORKSPACE_DIRNAME = "workspace";

/** SQLite 数据库文件名（位于 app 目录下），与品牌无关，保持稳定 */
export const DB_FILENAME = "app.db";

export const CONFIG_FILENAME = "config.json";

/** 服务注册文件（位于 app 目录下）：host / port / 凭证，由服务独占写、客户端只读 */
export const SERVICE_FILENAME = "service.json";

/** pi 的 MCP 服务器配置（用户级），位于 agent 目录下，由本服务读写 */
export const MCP_CONFIG_FILENAME = "mcp.json";

/** pi 的鉴权文件 */
export const AUTH_FILENAME = "auth.json";

/** 自定义角色目录名：全局 `$APP_HOME/agents/*.md`、项目配置目录 `agents/*.md` */
export const AGENTS_DIRNAME = "agents";

/** 全局技能目录名（位于 APP_HOME 下）：`skills/<id>/SKILL.md` */
export const SKILLS_DIRNAME = "skills";

/** 全局命令（提示词模板）目录名（位于 APP_HOME 下）：`prompts/<name>.md` */
export const PROMPTS_DIRNAME = "prompts";

/** 项目级配置目录名（位于会话 cwd 及其祖先）：品牌 slug 加前导点，如 `.<slug>` */
export const PROJECT_CONFIG_DIRNAME = `.${brand.slug}`;

/** 兼容生态的技能目录名（项目祖先或用户主目录下）：`.agents` */
export const AGENTS_COMPAT_DIRNAME = ".agents";

/** 附件库目录名（位于 `$APP_HOME/app` 下），按内容 sha256 寻址 */
export const ATTACHMENTS_DIRNAME = "attachments";

/** 项目记忆根目录名（位于 `$APP_HOME/app` 下）：`memory/projects/<project>` */
export const MEMORY_DIRNAME = "memory";

/** 记忆项目目录名（位于记忆根目录下） */
export const MEMORY_PROJECTS_DIRNAME = "projects";

/** 记忆索引文件名：一行一条，指向同目录下的事实文件 */
export const MEMORY_INDEX_FILENAME = "MEMORY.md";
