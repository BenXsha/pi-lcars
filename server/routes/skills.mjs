import { listSkills, reloadSkills } from "../pi/skills.mjs";

/**
 * Skills and prompt templates, plus the live reload.
 *
 * A factory, not a singleton: every module receives the same ctx the shell
 * built, so a station cannot reach around it for state.
 */
export function skillsRoutes(ctx) {
  const { ok, fail, body, registry, sessionOf } = ctx;
  return {
  "GET /api/skills": async (req, res) => {
    const entry = sessionOf(req);
    ok(res, await listSkills({ entry }));
  },

  "POST /api/skills": async (req, res) => {
    const b = await body(req);
    const entry = registry.get(b.session);
    if (b.op === "reload") return ok(res, await reloadSkills({ entry }));
    fail(res, 400, `unknown op: ${b.op}`, { code: "E_SKILLS" });
  },
  };
}
