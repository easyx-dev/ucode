/**
 * @ucode/hub-protocol：hub 与 UCode 中继客户端之间的隧道协议。
 *
 * 控制帧结构（zod）、数据帧编解码、协议版本与限额；两端各持一份内容相同的副本，改协议要同时改两处。
 * 纯类型 + 纯函数，不做 IO、不依赖运行时环境。
 */
export * from "./constants";
export * from "./control";
export * from "./frames";
