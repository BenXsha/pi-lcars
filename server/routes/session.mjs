import {resolve} from "node:path";
import { now, summaryOf } from "../pi/format.mjs";

// attachments travel as base64 inside the JSON body, so this route needs a
// far larger buffer than the rest of the API
const PROMPT_MAX_BYTES = 32_000_000;
const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const MAX_IMAGES = 6;

/** Validate attachments before they reach pi: bad input must not become a notice. */
function normalizeImages(raw) {
  if (!Array.isArray(raw) || !raw.length) return { images: [], error: null };
  if (raw.length > MAX_IMAGES) return { images: [], error: `too many images (max ${MAX_IMAGES})` };
  const images = [];
  for (const item of raw) {
    const mimeType = String(item?.mimeType ?? "");
    const data = String(item?.data ?? "").replace(/^data:[^;]+;base64,/, "");
    if (!IMAGE_MIMES.has(mimeType)) return { images: [], error: `unsupported image type: ${mimeType || "unknown"}` };
    if (!data || data.length > 16_000_000) return { images: [], error: "image data missing or too large" };
    images.push({ type: "image", data, mimeType });
  }
  return { images, error: null };
}

/** What the transcript shows about an attachment: counts only, never the bytes. */
const attachmentMeta = (images) =>
  images.map((im) => ({ mimeType: im.mimeType, bytes: Math.round((im.data.length * 3) / 4) }));

/**
 * The turn itself: create/open/fork, prompt or steer, answer a dialog, decide an approval.
 *
 * A factory, not a singleton: every module receives the same ctx the shell
 * built, so a station cannot reach around it for state.
 */
export function sessionRoutes(ctx) {
  const { ok, fail, body, cfg, sink, payload, sdk, registry, queue, approvals, dialogs } = ctx;
  return {
  "POST /api/session": async (req, res) => {
    const b = await body(req);
    let entry;
    switch (b.op) {
      case "new":
        entry = await registry.create({ cwd: b.cwd ? resolve(b.cwd) : cfg.cwd });
        break;
      case "open":
        entry = await registry.open(b.path);
        break;
      case "fork":
        entry = await registry.fork(b.id, b.path);
        break;
      case "activate":
        entry = registry.setActive(b.id);
        break;
      case "compact": {
        const target = registry.get(b.id);
        if (!target?.session) return fail(res, 404, "no session", { code: "E_NO_SESSION" });
        // manual compaction; start/end still arrive as session events
        // errors surface through compaction_end; logging here avoids a duplicate notice
        target.session.compact(b.instructions).catch((e) => console.error("[compact]", e.message));
        ok(res, { started: true });
        break;
      }
      case "goto":
        entry = await registry.goto(b.id ?? registry.activeId, b.entryId);
        break;
      case "tree":
        return ok(res, registry.tree(b.id ?? registry.activeId));
      case "rewind":
        entry = await registry.rewind(b.id ?? registry.activeId, b.turn);
        break;
      case "rename":
        await registry.rename(b.id, b.name);
        entry = registry.get(b.id);
        break;
      case "delete":
        await registry.remove(b.id);
        entry = registry.get();
        break;
      default:
        return fail(res, 400, `unknown op: ${b.op}`);
    }
    sink({ seq: 0, e: "sessions", sessions: registry.list() });
    ok(res, payload(entry));
  },

  "POST /api/prompt": async (req, res) => {
    const b = await body(req, PROMPT_MAX_BYTES);
    const entry = registry.get(b.session);
    if (!entry) return fail(res, 404, "no session");
    const text = String(b.text || "").trim();
    const { images, error: imageError } = normalizeImages(b.images);
    if (imageError) return fail(res, 400, imageError, { code: "E_IMAGE" });
    // an attachment-only turn is legal: the operator drops a screenshot and hits
    // RUN without typing anything
    if (!text && !images.length) return fail(res, 400, "empty prompt");
    // dialog-based tools (ask_user_question) and MCP tools only exist once the
    // extensions are bound; do it before the first turn rather than at boot
    if (!entry.bound) await entry.bind?.().catch(() => {});

    const steerable = queue.runningId === entry.id;
    // running but not the queue's current job (settling / aborting) → reject
    if (entry.meta.running && !steerable) return fail(res, 409, "session is busy, try again in a moment");
    // a "/skill" invocation arrives as <skill name location>…</skill> + the
    // operator's own words; keep both so the transcript can show them apart
    let skill = null;
    try {
      const parsed = sdk.parseSkillBlock?.(text);
      if (parsed) {
        skill = {
          name: parsed.name,
          location: parsed.location,
          lines: (parsed.content.match(/\n/g)?.length ?? 0) + 1,
          chars: parsed.content.length,
          head: parsed.content.split("\n").slice(0, 3).join("\n"),
        };
      }
    } catch {
      skill = null;
    }

    entry.emit({
      kind: "user",
      id: `u${++registry.counter}-${Math.random().toString(36).slice(2, 5)}`,
      text: skill ? text.split("</skill>")[1]?.trim() || "" : text,
      skill,
      attachments: images.length ? attachmentMeta(images) : undefined,
      steer: steerable,
      queued: !steerable && (queue.depth > 0 || queue.runningId !== null),
      ts: now(),
    });

    if (!entry.title) {
      entry.title = summaryOf(text) || (images.length ? `${images.length} image${images.length === 1 ? "" : "s"}` : "");
      entry.pushMeta();
    }

    if (steerable) {
      entry.session.steer(text, images.length ? images : undefined).catch((e) => {
        entry.emit({ kind: "notice", id: `e${now()}`, tone: "error", label: "ERROR", text: String(e.message || e), ts: now() });
      });
      entry.pushMeta();
      return ok(res, { mode: "steer" });
    }

    queue.submit({
      sessionId: entry.id,
      text,
      run: () => entry.session.prompt(text, images.length ? { images } : undefined),
    });
    entry.pushMeta();
    ok(res, { mode: queue.runningId === entry.id ? "started" : "queued" });
  },

  "POST /api/answer": async (req, res) => {
    const b = await body(req);
    const okd = dialogs.answer(String(b.id || ""), b.value === undefined ? null : b.value);
    if (!okd) return fail(res, 404, "no such pending question", { code: "E_NO_DIALOG" });
    ok(res, { answered: true });
  },

  "POST /api/approve": async (req, res) => {
    const b = await body(req);
    const decision = ["approve", "deny", "always"].includes(b.decision) ? b.decision : "deny";
    const settled = approvals.settle(String(b.id || ""), decision);
    if (!settled) return fail(res, 404, "no such pending approval");
    for (const entry of registry.sessions.values()) entry.pushMeta();
    ok(res, { decision });
  },
  };
}
