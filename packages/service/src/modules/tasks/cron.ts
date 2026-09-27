/**
 * 极小的 5 段 cron 解析（F-4.1）。
 *
 * 支持通配、步长（星号或区间加斜杠 n）、`a-b`、`a,b,c`、单值；按**本地时区**计算下一次触发。
 * 之所以自建而不是引依赖：需要的语义很窄（分钟级、无秒、无 @macro），
 * 而依赖会带来时区/库版本这类与产品无关的变量。
 */

export type CronFields = {
  minutes: number[];
  hours: number[];
  doms: number[];
  months: number[];
  dows: number[];
  domRestricted: boolean;
  dowRestricted: boolean;
};

const RANGES: Record<string, [number, number]> = {
  minute: [0, 59],
  hour: [0, 23],
  dom: [1, 31],
  month: [1, 12],
  dow: [0, 6],
};

const NAMES: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

export function parseCron(expr: string): CronFields | string {
  const parts = expr.trim().split(/\s+/u);
  if (parts.length !== 5)
    return `cron 表达式必须是 5 段（分 时 日 月 周），收到 ${parts.length} 段。`;
  const [minuteRaw, hourRaw, domRaw, monthRaw, dowRaw] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];

  const minute = parseField(minuteRaw, "minute");
  if (typeof minute === "string") return minute;
  const hour = parseField(hourRaw, "hour");
  if (typeof hour === "string") return hour;
  const dom = parseField(domRaw, "dom");
  if (typeof dom === "string") return dom;
  const month = parseField(monthRaw, "month");
  if (typeof month === "string") return month;
  const dow = parseField(dowRaw, "dow");
  if (typeof dow === "string") return dow;

  return {
    minutes: minute,
    hours: hour,
    doms: dom,
    months: month,
    dows: dow.map((value) => (value === 7 ? 0 : value)),
    domRestricted: domRaw.trim() !== "*",
    dowRestricted: dowRaw.trim() !== "*",
  };
}

function parseField(raw: string, kind: keyof typeof RANGES): number[] | string {
  const [min, max] = RANGES[kind] as [number, number];
  const out = new Set<number>();
  for (const piece of raw.split(",")) {
    const token = piece.trim().toLowerCase();
    if (token === "") return `cron ${kind} 段为空。`;
    const [rangePart, stepPart] = token.split("/") as [string, string | undefined];
    const step = stepPart === undefined ? 1 : Number.parseInt(stepPart, 10);
    if (!Number.isInteger(step) || step <= 0) return `cron ${kind} 段的步长非法：${token}`;

    let start: number;
    let end: number;
    if (rangePart === "*") {
      start = min;
      end = max;
    } else if (rangePart.includes("-")) {
      const [a, b] = rangePart.split("-") as [string, string];
      const av = resolveName(a, kind);
      const bv = resolveName(b, kind);
      if (av === null || bv === null) return `cron ${kind} 段非法：${token}`;
      start = av;
      end = bv;
    } else {
      const value = resolveName(rangePart, kind);
      if (value === null) return `cron ${kind} 段非法：${token}`;
      start = value;
      end = stepPart === undefined ? value : max;
    }
    if (start < min || end > max || start > end) return `cron ${kind} 段越界：${token}`;
    for (let value = start; value <= end; value += step) out.add(value);
  }
  return [...out].sort((a, b) => a - b);
}

function resolveName(token: string, kind: string): number | null {
  if (/^\d+$/u.test(token)) return Number.parseInt(token, 10);
  if (kind === "month" || kind === "dow") {
    const named = NAMES[token];
    if (named !== undefined) return named;
  }
  return null;
}

/** 下一次触发时间（严格晚于 `from`）。无匹配（如 2 月 30 日）返回 null。 */
export function nextCronTime(expr: string, from: Date): Date | null {
  const fields = parseCron(expr);
  if (typeof fields === "string") return null;

  const cursor = new Date(from.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);
  // 上限：4 年（覆盖闰年与 2/29 这类稀疏匹配）
  const limit = 4 * 366;
  for (let day = 0; day < limit; day += 1) {
    if (dayMatches(cursor, fields)) {
      const hit = matchWithinDay(cursor, fields);
      if (hit !== null) return hit;
    }
    cursor.setDate(cursor.getDate() + 1);
    cursor.setHours(0, 0, 0, 0);
  }
  return null;
}

function dayMatches(date: Date, fields: CronFields): boolean {
  if (!fields.months.includes(date.getMonth() + 1)) return false;
  const domMatch = fields.doms.includes(date.getDate());
  const dowMatch = fields.dows.includes(date.getDay());
  // 标准 cron 语义：日与周**都**受限时取"或"，只限一个时取那一个。
  if (fields.domRestricted && fields.dowRestricted) return domMatch || dowMatch;
  if (fields.domRestricted) return domMatch;
  if (fields.dowRestricted) return dowMatch;
  return true;
}

/** 在某天里找最小的匹配时刻；若该天所有匹配时刻都早于起始时刻，返回 null。 */
function matchWithinDay(start: Date, fields: CronFields): Date | null {
  const earliest = start.getTime();
  for (const hour of fields.hours) {
    for (const minute of fields.minutes) {
      const candidate = new Date(start.getTime());
      candidate.setHours(hour, minute, 0, 0);
      if (candidate.getTime() >= earliest) return candidate;
    }
  }
  return null;
}
