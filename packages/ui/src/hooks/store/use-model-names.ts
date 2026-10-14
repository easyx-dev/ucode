/** 模型 / 供应商显示名的 React 绑定：订阅模型目录，目录还没到就一律回落原 ID */

import { useMemo } from "react";

import { type ModelNames, modelNamesOf } from "../../utils/model";
import { useModels } from "./use-models";

export function useModelNames(): ModelNames {
  const { data } = useModels();
  const providers = data?.providers;
  // 依赖取 `providers` 本身：目录未加载时它是稳定的 undefined，值到了才重算
  return useMemo(() => modelNamesOf(providers ?? []), [providers]);
}
