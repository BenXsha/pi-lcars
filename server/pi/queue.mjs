/**
 * One global run queue.
 *
 * Agent runs mutate the same working directory, so the console allows exactly
 * one run at a time. A prompt submitted while another session is running waits
 * here and starts automatically when the slot frees up.
 * Prompts aimed at the *running* session do not queue — they are steered into
 * that run instead (see /api/prompt).
 */
export function createQueue({ onChange } = {}) {
  /** @type {{sessionId: string, text: string, run: () => Promise<any>}[]} */
  const jobs = [];
  let running = null;

  const notify = () => {
    try {
      if (process.env.LCARS_TRACE) console.log("[queue] notify", { running: running?.sessionId ?? null, depth: jobs.length });
      onChange?.();
    } catch {
      /* listener errors must not stall the queue */
    }
  };

  function pump() {
    if (running || !jobs.length) return;
    running = jobs.shift();
    notify();
    Promise.resolve()
      .then(() => running.run())
      .catch(() => {})
      .finally(() => {
        running = null;
        notify();
        pump();
      });
  }

  return {
    submit(job) {
      jobs.push(job);
      notify();
      pump();
    },
    /** drop queued work for one session (abort / delete) */
    cancel(sessionId) {
      let dropped = 0;
      for (let i = jobs.length - 1; i >= 0; i--) {
        if (jobs[i].sessionId === sessionId) {
          jobs.splice(i, 1);
          dropped++;
        }
      }
      if (dropped) notify();
      return dropped;
    },
    get runningId() {
      return running?.sessionId ?? null;
    },
    waiting(sessionId) {
      return jobs.some((j) => j.sessionId === sessionId);
    },
    get depth() {
      return jobs.length;
    },
    get snapshot() {
      return { running: running?.sessionId ?? null, waiting: jobs.map((j) => j.sessionId) };
    },
  };
}
