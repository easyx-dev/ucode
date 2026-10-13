/** panel-layout：默认宽度按窗口夹取（展开工作台时不能让对话区被压破） */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CHAT_MIN_WIDTH,
  fitPanelDefault,
  SIDEBAR_PANEL,
  WORKBENCH_PANEL,
  workbenchAvailableWidth,
} from "../panel-layout";

describe("fitPanelDefault", () => {
  it("空间够时用默认宽度", () => {
    assert.equal(fitPanelDefault(WORKBENCH_PANEL, 900), WORKBENCH_PANEL.default);
  });

  it("空间不够时按可用宽度收窄", () => {
    assert.equal(fitPanelDefault(WORKBENCH_PANEL, 520), 520);
  });

  it("再窄也不低于面板下限", () => {
    assert.equal(fitPanelDefault(WORKBENCH_PANEL, 120), WORKBENCH_PANEL.min);
  });
});

describe("workbenchAvailableWidth", () => {
  it("窗口减去会话侧栏与对话区下限", () => {
    assert.equal(
      workbenchAvailableWidth(1440, SIDEBAR_PANEL.default),
      1440 - SIDEBAR_PANEL.default - CHAT_MIN_WIDTH,
    );
  });

  it("夹取后的宽度至少给对话区留下下限", () => {
    const available = workbenchAvailableWidth(1200, SIDEBAR_PANEL.default);
    const fitted = fitPanelDefault(WORKBENCH_PANEL, available);
    assert.ok(
      SIDEBAR_PANEL.default + fitted + CHAT_MIN_WIDTH <= 1200,
      "侧栏 + 工作台 + 对话区下限不超过窗口宽度",
    );
  });
});
