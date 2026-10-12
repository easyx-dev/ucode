/**
 * localStorage 的读写：隐私模式 / 存储被禁用时读不到也写不进去，这里一律静默降级
 * （读回落 `null`、写当无事发生），调用方不必各自兜异常，也不必各自判断键是否存在。
 */

/** 读一个键；存储不可用或没写过时回落 `null` */
export const readStorage = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

/** 写一个键；存储不可用时当无事发生（偏好只在本次会话生效） */
export const writeStorage = (key: string, value: string): void => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 写不进去不影响本次会话
  }
};
