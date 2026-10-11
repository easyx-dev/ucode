/**
 * 首屏外观脚本守卫（见 DESIGN.md「运行时参数」）。
 *
 * 两份 `index.html` 的内联脚本必须与 `lib/appearance.ts` 的常量一致：字号区间与密度档位是同一份事实，
 * 分头维护迟早漂移——而漂移的表现是「首帧先按默认值渲染、随后被运行时纠正」的一次闪动，
 * 平时注意不到，只有把区间调大时才会暴露。脚本必须在构建前就能跑（不能引模块），所以这里比对文本。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = "packages/ui/src/lib/appearance.ts";
const HTML_FILES = ["apps/web/index.html", "apps/desktop/index.html"];

const scaleOf = (source: string, id: string): string | undefined =>
  source.match(new RegExp(`\\{ id: "${id}", scale: ([\\d.]+) \\}`))?.[1];

export const run = (root: string): string[] => {
  const problems: string[] = [];
  const source = readFileSync(join(root, SOURCE), "utf8");

  const min = source.match(/FONT_SIZE_MIN = (\d+)/)?.[1];
  const max = source.match(/FONT_SIZE_MAX = (\d+)/)?.[1];
  const compact = scaleOf(source, "compact");
  const cozy = scaleOf(source, "cozy");
  if (!min || !max || !compact || !cozy) {
    return [`${SOURCE}：读不到字号区间或密度档位，检查本校验的匹配规则是否与源码写法脱节`];
  }

  for (const file of HTML_FILES) {
    const html = readFileSync(join(root, file), "utf8");

    const range = html.match(/size >= (\d+) && size <= (\d+)/);
    if (!range) {
      problems.push(
        `${file}：首屏脚本缺少字号区间判断（应与 ${SOURCE} 的 FONT_SIZE_MIN/MAX 一致）`,
      );
    } else if (range[1] !== min || range[2] !== max) {
      problems.push(
        `${file}：字号区间 ${range[1]}–${range[2]} 与 ${SOURCE} 的 ${min}–${max} 不一致（改宽后首帧会用默认字号）`,
      );
    }

    const density = html.match(
      /prefs\.density === "compact" \? ([\d.]+) : prefs\.density === "cozy" \? ([\d.]+)/,
    );
    if (!density) {
      problems.push(`${file}：首屏脚本缺少密度映射（应与 ${SOURCE} 的 DENSITY_OPTIONS 一致）`);
    } else if (density[1] !== compact || density[2] !== cozy) {
      problems.push(
        `${file}：密度档位 ${density[1]} / ${density[2]} 与 ${SOURCE} 的 ${compact} / ${cozy} 不一致`,
      );
    }

    if (!html.includes("%BRAND_APPEARANCE_KEY%")) {
      problems.push(
        `${file}：首屏脚本没有用 %BRAND_APPEARANCE_KEY% 读偏好（存储键在品牌命名空间下）`,
      );
    }
    if (!html.includes("dataset.theme = prefs.theme")) {
      problems.push(`${file}：首屏脚本没有应用配色主题（切换过主题的用户会看到一帧默认配色）`);
    }
  }

  return problems;
};
