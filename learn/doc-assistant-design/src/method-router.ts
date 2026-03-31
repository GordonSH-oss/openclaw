import {
  makeError,
  type ConnectedClient,
  type DocAssistantError,
  type DocAssistantRequest,
} from "./protocol.js";
import type { DocAssistantRuntimeState } from "./runtime-state.js";

export type HandlerContext = {
  request: DocAssistantRequest;
  respond: (ok: boolean, result?: unknown, error?: DocAssistantError) => void;
  client: ConnectedClient;
  state: DocAssistantRuntimeState;
};

export type MethodHandler = (ctx: HandlerContext) => void | Promise<void>;

type RegisteredMethod = {
  handler: MethodHandler;
  requiredScopes?: string[];
  description?: string;
};

export class MethodRouter {
  private methods = new Map<string, RegisteredMethod>();

  register(
    method: string,
    handler: MethodHandler,
    opts?: { requiredScopes?: string[]; description?: string },
  ): this {
    this.methods.set(method, {
      handler,
      requiredScopes: opts?.requiredScopes,
      description: opts?.description,
    });
    return this;
  }

  async dispatch(ctx: HandlerContext): Promise<void> {
    const { request, respond, client } = ctx;
    const registered = this.methods.get(request.method);
    if (!registered) {
      respond(false, undefined, makeError("NOT_FOUND", `未知方法: "${request.method}"`));
      return;
    }
    if (registered.requiredScopes?.length) {
      const hasScope = registered.requiredScopes.every((scope) => client.scopes.includes(scope));
      if (!hasScope) {
        respond(
          false,
          undefined,
          makeError(
            "UNAUTHORIZED",
            `方法 "${request.method}" 需要权限: ${registered.requiredScopes.join(", ")}`,
          ),
        );
        return;
      }
    }
    try {
      await registered.handler(ctx);
    } catch (error) {
      console.error(`[doc-router] 方法 ${request.method} 执行出错:`, error);
      respond(false, undefined, makeError("UNAVAILABLE", String(error)));
    }
  }

  listMethods(): Array<{ method: string; requiredScopes?: string[]; description?: string }> {
    return Array.from(this.methods.entries()).map(([method, info]) => ({
      method,
      requiredScopes: info.requiredScopes,
      description: info.description,
    }));
  }
}
