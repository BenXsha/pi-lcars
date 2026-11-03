import { agentDir } from "../pi/sdk.mjs";
import { listProviders, listProviderModels, testProvider, setDefaultModel, setProviderKey, addProvider, removeProvider, reloadProviders } from "../pi/providers.mjs";

/**
 * Provider list and writes (key, default model, custom endpoint).
 *
 * A factory, not a singleton: every module receives the same ctx the shell
 * built, so a station cannot reach around it for state.
 */
export function providersRoutes(ctx) {
  const { ok, fail, body, registry, sessionOf } = ctx;
  return {
  "GET /api/providers": async (req, res) => {
    const entry = sessionOf(req);
    ok(res, await listProviders({ session: entry?.session, agentDir: agentDir() }));
  },

  "POST /api/providers": async (req, res) => {
    const b = await body(req);
    const entry = registry.get(b.session);
    const ctx = { session: entry?.session, agentDir: agentDir() };
    switch (b.op) {
      case "test":
        ok(res, await testProvider({ ...ctx, providerId: b.provider }));
        break;
      case "models":
        ok(res, await listProviderModels({ ...ctx, providerId: b.provider }));
        break;
      case "default":
        ok(res, await setDefaultModel({ agentDir: ctx.agentDir, provider: b.provider, model: b.model }));
        break;
      case "key":
        ok(res, await setProviderKey({ agentDir: ctx.agentDir, provider: b.provider, key: b.key }));
        break;
      case "add":
        ok(res, await addProvider({
          agentDir: ctx.agentDir,
          id: b.id,
          name: b.name,
          baseUrl: b.baseUrl,
          api: b.api,
          apiKey: b.apiKey,
          models: b.models,
        }));
        break;
      case "remove":
        ok(res, await removeProvider({ agentDir: ctx.agentDir, id: b.id }));
        break;
      case "reload":
        ok(res, await reloadProviders({ session: ctx.session }));
        break;
      default:
        fail(res, 400, `unknown op: ${b.op}`, { code: "E_PROVIDERS" });
    }
  },
  };
}
