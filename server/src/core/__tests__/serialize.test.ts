/** core/serialize：消息区块与界面标记条目的投影 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { API_BASE_PATH, PLAN_IGNORED_CUSTOM_TYPE } from "@ucode/contracts";

import { blocksOf, entryToDTO } from "../serialize";

describe("blocksOf 的 image 分支", () => {
  it("投影为 { id, mimeType, url }，id 与附件库的 sha256 一致", () => {
    const data = Buffer.from("abc").toString("base64");
    const id = createHash("sha256").update(Buffer.from(data, "base64")).digest("hex");

    assert.deepEqual(blocksOf([{ type: "image", data, mimeType: "image/png" }]), [
      { type: "image", id, mimeType: "image/png", url: `${API_BASE_PATH}/attachments/${id}` },
    ]);
  });

  it("缺 data 时回落为文字占位", () => {
    assert.deepEqual(blocksOf([{ type: "image", mimeType: "image/png" }]), [
      { type: "text", text: "[图片]" },
    ]);
  });
});

describe("entryToDTO 的 custom 分支", () => {
  const customEntry = (customType: string): SessionEntry => ({
    type: "custom",
    id: "entry-1",
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    customType,
    data: { at: "2026-01-01T00:00:00.000Z" },
  });

  it("忽略计划的标记投影为 role custom + customType，且无正文", () => {
    assert.deepEqual(entryToDTO(customEntry(PLAN_IGNORED_CUSTOM_TYPE)), {
      id: "entry-1",
      role: "custom",
      blocks: [],
      customType: PLAN_IGNORED_CUSTOM_TYPE,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("其它 customType 的扩展条目不展示", () => {
    assert.equal(entryToDTO(customEntry("other.extension")), null);
  });
});
