/** core/serialize：消息区块投影（图片区块） */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import { API_BASE_PATH } from "@ucode/contracts";

import { blocksOf } from "../serialize";

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
