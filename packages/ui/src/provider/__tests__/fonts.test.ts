/** provider/fonts：终端字体档位的取值约定（回退、族名引号、清单自检） */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_TERMINAL_FONT_ID,
  TERMINAL_FONT_IDS,
  TERMINAL_FONTS,
  terminalFontFamilyOf,
  terminalFontOf,
} from "../fonts";

describe("终端字体档位", () => {
  it("未知或空 id 回落到跟随代码字体", () => {
    assert.equal(terminalFontOf("nope").id, DEFAULT_TERMINAL_FONT_ID);
    assert.equal(terminalFontOf("").id, DEFAULT_TERMINAL_FONT_ID);
  });

  it("默认档不追加族名，直接用等宽栈", () => {
    assert.equal(terminalFontFamilyOf(DEFAULT_TERMINAL_FONT_ID), "");
  });

  it("其余档位的族名都带引号（族名含空格，不引号会被当成多个族名）", () => {
    const others = TERMINAL_FONTS.filter((option) => option.id !== DEFAULT_TERMINAL_FONT_ID);
    assert.ok(others.length > 0);
    for (const option of others) {
      for (const family of option.family.split(", ")) {
        assert.match(family, /^".+"$/, `${option.id} 的族名要用引号包起来：${family}`);
      }
    }
  });

  it("一个档位可以并列多个来源的族名（同一款字体家族名不一）", () => {
    assert.equal(terminalFontFamilyOf("meslo-nerd").includes('"MesloLGS NF"'), true);
    assert.equal(terminalFontFamilyOf("meslo-nerd").includes('"MesloLGS Nerd Font"'), true);
  });

  it("档位 id 不重复，且默认档在清单里", () => {
    assert.equal(new Set(TERMINAL_FONT_IDS).size, TERMINAL_FONT_IDS.length);
    assert.ok(TERMINAL_FONT_IDS.includes(DEFAULT_TERMINAL_FONT_ID));
  });
});
