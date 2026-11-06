/**
 * 后台实例日志的定位、轮转与读取：`service start` 把子进程输出追加进 `$APP_HOME/app/service.log`，
 * `logs` 子命令再从这里读回来，启动失败时也靠它给出线索。
 *
 * 读写两侧共用同一份规则：轮转大小、尾部截断与命名（`.1`）都只在这里定义，否则会各自跑偏。
 * 实例常驻数月，日志能涨到几百 MB，因此所有读取都带字节上限——整份读进来本身就是一次事故。
 */
import { closeSync, fstatSync, openSync, readSync, renameSync, rmSync, statSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";

/** 轮转上限：超过就在下次启动前换成 `.1`，只留最近两份 */
const ROTATE_BYTES = 5 * 1024 * 1024;
/** 尾部读取的默认字节上限：行数与字节数谁先到算谁 */
const DEFAULT_MAX_READ_BYTES = 256 * 1024;
/** 跟随日志时单轮的读取上限：一次吐出几百 MB 会直接把终端顶住 */
const FOLLOW_CHUNK_BYTES = 64 * 1024;
/** 跟随轮询间隔：跨平台（不依赖 inotify），人眼等得住 */
const FOLLOW_INTERVAL_MS = 500;

export type LogTailOptions = {
  /** 需要的行数 */
  lines: number;
  /** 字节上限：日志很长时先按它截断，再取最后若干行 */
  maxBytes?: number;
};

/**
 * 日志轮转：没有上限就不是「日志」而是「积压」。
 * 只在启动前轮转——那时旧实例刚被停掉，没有别的进程还在往这个文件里写。
 */
export const rotateLog = (logPath: string): void => {
  try {
    if (statSync(logPath).size < ROTATE_BYTES) return;
    // Windows 上 rename 不覆盖已存在的目标，先删掉上一份
    rmSync(`${logPath}.1`, { force: true });
    renameSync(logPath, `${logPath}.1`);
  } catch {
    // 文件不存在 / 挪不动都不阻断启动
  }
};

/** 读单个文件的尾部若干行与读到的位置；文件读不到时回传空结果（调用方按场景决定怎么提示） */
type TailRead = {
  /** 读到的行（不含末尾空行） */
  lines: string[];
  /** stat 到的字节数：内容只覆盖到它，跟随可以从这里续读而不重不漏 */
  size: number;
};

const readTailLines = (path: string, options: LogTailOptions): TailRead => {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const size = fstatSync(fd).size;
    const length = Math.min(size, options.maxBytes ?? DEFAULT_MAX_READ_BYTES);
    if (length === 0) return { lines: [], size };
    const buffer = Buffer.alloc(length);
    const filled = readSync(fd, buffer, 0, length, size - length);
    const lines = buffer.subarray(0, filled).toString("utf8").split("\n");
    // 从中间读起时首行是半截的（甚至切在多字节字符上），去掉它
    if (size > length) lines.shift();
    // 正常写入的日志以换行结尾：末尾空串不是空行
    if (lines.at(-1) === "") lines.pop();
    return { lines, size };
  } catch {
    return { lines: [], size: 0 };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
};

/**
 * 单文件尾部：失败诊断用它就够（只关心本次启动前最后几行）。
 * 读不到返回空串，由调用方给出「没有日志」的提示。
 */
export const readLogTail = (logPath: string, options: LogTailOptions): string =>
  readTailLines(logPath, options).lines.slice(-options.lines).join("\n");

/**
 * 跟随的续读位置：`offset` 与 `identity` 成对使用。
 * 文件换了（identity 变）说明发生了轮转，旧偏移落在新文件中间，那时必须从头读。
 */
export type LogResumePoint = {
  /** 字节偏移 */
  offset: number;
  /** 不透明文件标识（每次 stat 算得，只用于判断是不是同一个文件） */
  identity: string | null;
};

export type LogTail = {
  /** 尾部文本（没有日志时为空串） */
  text: string;
  /** 读到时的位置：交给 `followLog` 从这继续，首尾之间新写入的行不会漏也不会重 */
  resume: LogResumePoint;
};

/**
 * 跨轮转的尾部：当前文件行数不够时，从 `.1` 里接着补。
 * 刚轮转过就起不来时，唯一线索在 `.1` 里，只看当前文件会「什么都没提到」。
 */
export const readServiceLogTail = (logPath: string, options: LogTailOptions): LogTail => {
  const current = readTailLines(logPath, options);
  const resume: LogResumePoint = { offset: current.size, identity: fileIdentity(logPath) };
  if (current.lines.length >= options.lines) {
    return { text: current.lines.slice(-options.lines).join("\n"), resume };
  }

  const missing = options.lines - current.lines.length;
  const previous = readTailLines(`${logPath}.1`, { ...options, lines: missing }).lines.slice(
    -missing,
  );
  return { text: [...previous, ...current.lines].join("\n"), resume };
};

/** 文件身份：轮转（被换成新文件）时它会变，据此决定要不要从头读 */
const fileIdentity = (path: string): string | null => {
  try {
    const stat = statSync(path);
    return `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
  } catch {
    return null;
  }
};

const fileSize = (path: string): number => {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
};

export type FollowOptions = {
  /** 新增内容的回调 */
  onChunk: (text: string) => void;
  /** 读取出错（文件还没出现不属于错误） */
  onError?: (message: string) => void;
  /** 轮询间隔；默认 500ms，测试用小值把等待压下来 */
  intervalMs?: number;
  /** 从哪个位置续读；缺省从当前末尾开始（配合 `readServiceLogTail` 的 `resume` 才不会漏行） */
  resume?: LogResumePoint;
};

export type LogFollow = {
  /** 停止跟随（Ctrl-C 后调用） */
  stop: () => void;
};

/**
 * 跟随日志：从当前末尾开始吐出新增内容，跟着轮转走。
 *
 * 按字节偏移续读而不是每轮重读整份；多字节字符跨读取块时由 `StringDecoder` 补全，
 * 不会在中文日志里切出半个字。
 */
export const followLog = (logPath: string, options: FollowOptions): LogFollow => {
  const decoder = new StringDecoder("utf8");
  let identity = fileIdentity(logPath);
  // 续读点只在「还是同一个文件」时有效：中间的轮转会让旧偏移落到新文件中间，那会静默跳过一段
  let offset =
    options.resume === undefined
      ? fileSize(logPath)
      : options.resume.identity === identity
        ? options.resume.offset
        : 0;

  const readNew = (): void => {
    const latest = fileIdentity(logPath);
    if (latest !== identity) {
      // 轮转或新建：换了一份文件，从头读
      identity = latest;
      offset = 0;
    }

    let fd: number | undefined;
    try {
      fd = openSync(logPath, "r");
      const size = fstatSync(fd).size;
      // 被截断（手工清空）时也要回到起点，否则会一直等一个永远到不了的大小
      if (size < offset) offset = 0;
      while (offset < size) {
        const length = Math.min(size - offset, FOLLOW_CHUNK_BYTES);
        const buffer = Buffer.alloc(length);
        const filled = readSync(fd, buffer, 0, length, offset);
        if (filled <= 0) break;
        offset += filled;
        const text = decoder.write(buffer.subarray(0, filled));
        if (text) options.onChunk(text);
      }
    } catch (error) {
      // 文件还没出现（首次启动前）属于正常等待；其它错误提示一次即可，不打断跟随
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        options.onError?.(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  };

  const timer = setInterval(readNew, options.intervalMs ?? FOLLOW_INTERVAL_MS);
  return {
    stop: () => {
      clearInterval(timer);
      decoder.end();
    },
  };
};
