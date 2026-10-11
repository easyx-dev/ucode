/** /api/v1/service：服务级配置（监听地址等需重启生效的开关） */
import {
  type ServiceHostInput,
  type ServiceHostResponse,
  type ServiceInfoResponse,
  serviceHostInputSchema,
} from "@ucode/contracts";
import { Hono } from "hono";
import { env } from "../../env";
import { ok } from "../../platform/response";
import { writeServiceRegistration } from "../../platform/service-registration";
import { jsonBody } from "../../platform/validate";
import type { Services } from "../../services";

export const createServiceRoute = (services: Services) => {
  const router = new Hono();

  /** 注册文件里的 host 与进程启动时的 env.host 不一致，就说明要重启才生效 */
  const restartRequired = (): boolean => services.auth.registration.host !== env.host;

  router.get("/info", (c) =>
    c.json(
      ok({
        host: services.auth.registration.host,
        restartRequired: restartRequired(),
      } satisfies ServiceInfoResponse),
    ),
  );

  router.post("/host", jsonBody(serviceHostInputSchema), (c) => {
    const input = c.req.valid("json") satisfies ServiceHostInput;
    services.auth.registration.host = input.host;
    writeServiceRegistration(env.servicePath, services.auth.registration);
    return c.json(
      ok({
        host: input.host,
        restartRequired: restartRequired(),
      } satisfies ServiceHostResponse),
    );
  });

  return router;
};
