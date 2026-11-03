import { useEffect, useRef, useState } from "preact/hooks";
import { api, type ImageAttachment } from "../../api";
import { actions } from "../../store";
import { getSettings } from "../../settings";
import { t } from "../../i18n";
import { fmtSize } from "../../format";
import { Icon } from "../../components/Icon";
import { askDeck, onComposerRequest } from "../../composer";
import { clearDraft, loadDraft, loadHistory, pushHistory, saveDraft } from "../../drafts";
import { loadQuick, onQuickChange, type QuickPrompt } from "../../quick";
import { BarButton } from "../../components/ui";
import { imeBusy } from "../../ime";

/* -------------------------------------------------------------- composer */
const UI_COMMANDS = [
  { name: "/compact", description: "compact the context now", kind: "ui" },
  { name: "/fork", description: "fork this session", kind: "ui" },
  { name: "/new", description: "start a session in a workspace", kind: "ui" },
  { name: "/model", description: "switch the model for the next turn", kind: "ui" },
  { name: "/stop", description: "stop the current run", kind: "ui" },
];

/** Queue payloads have been both counts and texts — never trust the shape. */
function textList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.length > 0);
}

const PLAIN_COMPOSER = new URLSearchParams(location.search).has("plain");

const MAX_IMAGES = 6;

/** A pasted or dropped image, still in memory — nothing is uploaded until RUN. */
type Attachment = ImageAttachment & { id: string; name: string; bytes: number };

/** File input → the base64 shape /api/prompt accepts. */
function readImage(file: File): Promise<Attachment | null> {
  return new Promise((resolve) => {
    if (!file.type.startsWith("image/")) return resolve(null);
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = () => {
      const url = String(reader.result || "");
      const data = url.slice(url.indexOf(",") + 1);
      if (!data) return resolve(null);
      resolve({
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        name: file.name || "pasted image",
        mimeType: file.type,
        bytes: file.size,
        data,
      });
    };
    reader.readAsDataURL(file);
  });
}

export function Composer({
  session,
  running,
  disabled,
  queue,
}: {
  session: string | null;
  running: boolean;
  disabled: boolean;
  queue?: { steering: string[]; followUp: string[] };
}) {
  const plainRef = useRef<HTMLTextAreaElement>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  /** last height written to the field — writes are skipped when it is unchanged */
  const grownRef = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const histDraft = useRef("");
  /** true between compositionstart and compositionend — the IME owns `value` */
  const composing = useRef(false);
  const [text, setText] = useState("");
  const [flashQuote, setFlashQuote] = useState(false);
  const [images, setImages] = useState<Attachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const [cmds, setCmds] = useState<{ name: string; description: string; kind: string; hint?: string }[]>(UI_COMMANDS);
  const [pick, setPick] = useState(0);
  const [caret, setCaret] = useState(0);
  const [files, setFiles] = useState<{ rel: string; base: string; dir: string }[]>([]);
  const [filesBusy, setFilesBusy] = useState(false);
  const [histPick, setHistPick] = useState<number | null>(null);
  // operator macro pad: rebuilt whenever the editor saves
  const [quick, setQuick] = useState<QuickPrompt[]>(loadQuick);
  useEffect(() => onQuickChange(() => setQuick(loadQuick())), []);

  useEffect(() => {
    api
      .commands()
      .then((r) => setCmds([...UI_COMMANDS, ...r.commands]))
      .catch(() => {});
  }, []);

  const slash = text.startsWith("/") && !text.includes(" ") ? text.toLowerCase() : null;
  const matches = slash
    ? cmds.filter((c) => c.name.toLowerCase().startsWith(slash) || c.name.toLowerCase().includes(slash.slice(1))).slice(0, 8)
    : [];

  /** `@token` right before the caret opens the file palette instead. */
  const atMatch = slash ? null : /(?:^|\s)@([^\s@]*)$/.exec(text.slice(0, caret));
  const atQuery = atMatch ? atMatch[1] : null;

  /** Run a console-side command; returns true when it consumed the text. */
  const runUi = (cmd: string) => {
    const name = cmd.trim().toLowerCase();
    if (name === "/compact") return actions.compact(), true;
    if (name === "/fork") return actions.fork(), true;
    if (name === "/stop") return actions.abort(), true;
    if (name === "/new") return askDeck("new"), true;
    if (name === "/model") return askDeck("model"), true;
    return false;
  };

  // quote appends, recall replaces — both arrive from the transcript
  useEffect(
    () =>
      onComposerRequest((intent) => {
        if (intent.kind === "replace") setText(intent.text);
        else
          setText((prev) => {
            const quoted = intent.text
              .trim()
              .split("\n")
              .map((l) => `> ${l}`)
              .join("\n");
            return prev.trim() ? `${prev.trim()}\n\n${quoted}\n\n` : `${quoted}\n\n`;
          });
        setFlashQuote(intent.kind === "quote");
        requestAnimationFrame(() => {
          ref.current?.focus();
          ref.current?.setSelectionRange(9999, 9999);
        });
        setTimeout(() => setFlashQuote(false), 1200);
      }),
    [],
  );
  /* The draft and the sent-history belong to the conversation, not the tab:
     switching sessions must not carry text across — and the outgoing draft is
     flushed first, so a switch less than one debounce after a keystroke is safe. */
  const sessionRef = useRef(session);
  const textRef = useRef(text);
  useEffect(() => {
    textRef.current = text;
  }, [text]);
  useEffect(() => {
    const outgoing = sessionRef.current;
    if (outgoing && outgoing !== session) saveDraft(outgoing, textRef.current);
    sessionRef.current = session;
    setText(loadDraft(session));
    setImages([]);
    setFiles([]);
    setHistPick(null);
  }, [session]);

  useEffect(() => {
    if (!session) return;
    const id = setTimeout(() => saveDraft(session, text), 400);
    return () => clearTimeout(id);
  }, [session, text]);

  /* Auto-grow: the field rises with the draft, then scrolls inside its cap.
     Measured on an off-screen mirror, never by collapsing the real box —
     `height:auto` on the textarea made the composer jump 44 → 64 → 44 on every
     keystroke and re-laid out the whole transcript (see .grow-mirror).
     Also called from `input`/`compositionupdate`, because an IME grows the field
     before it commits anything to `text`. */
  const grow = () => {
    const el = ref.current;
    const m = mirrorRef.current;
    if (!el || !m) return;
    const w = el.clientWidth;
    if (!w) return;
    const width = `${w}px`;
    if (m.style.width !== width) m.style.width = width;
    // the trailing newline keeps a final empty line in the count
    m.textContent = `${el.value}\n`;
    const cap = Math.min(240, Math.max(96, Math.round(window.innerHeight * 0.26)));
    const want = Math.min(Math.max(m.scrollHeight, 44), cap);
    if (want === grownRef.current) return;
    grownRef.current = want;
    el.style.height = `${want}px`;
  };

  useEffect(grow, [text]);

  /** A pad appends to the draft (never sends): the operator keeps the last word. */
  const useQuick = (q: QuickPrompt) => {
    setText((prev) => {
      const base = prev.replace(/\s+$/, "");
      return base ? `${base}\n${q.text}` : q.text;
    });
    setHistPick(null);
    requestAnimationFrame(() => {
      const el = ref.current;
      el?.focus();
      if (el) {
        el.setSelectionRange(el.value.length, el.value.length);
        setCaret(el.value.length);
      }
      grow();
    });
  };

  /* File palette: debounced, because a walk per keystroke is wasteful. */
  useEffect(() => {
    setPick(0);
    if (atQuery === null) {
      setFiles([]);
      setFilesBusy(false);
      return;
    }
    let live = true;
    setFilesBusy(true);
    const id = setTimeout(() => {
      api
        .files(atQuery, 12)
        .then((r) => {
          if (live) setFiles(r.files);
        })
        .catch(() => {
          if (live) setFiles([]);
        })
        .finally(() => {
          if (live) setFilesBusy(false);
        });
    }, 120);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [atQuery]);

  /** Swap the `@token` for the picked path; the model reads it with `read`. */
  const pickFile = (rel: string) => {
    const before = /(?:^|\s)@([^\s@]*)$/.exec(text.slice(0, caret));
    if (!before) return;
    const start = caret - before[1].length - 1;
    const insert = `\`${rel}\` `;
    const next = text.slice(0, start) + insert + text.slice(caret);
    setText(next);
    setFiles([]);
    setFilesBusy(false);
    requestAnimationFrame(() => {
      const pos = start + insert.length;
      ref.current?.focus();
      ref.current?.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  };

  const addFiles = async (list: FileList | File[] | null) => {
    if (!list) return;
    const picked = Array.from(list).filter((f) => f.type.startsWith("image/"));
    const room = MAX_IMAGES - images.length;
    if (!picked.length || room <= 0) return;
    const read = await Promise.all(picked.slice(0, room).map(readImage));
    const ok = read.filter((a): a is Attachment => !!a);
    if (ok.length) setImages((prev) => [...prev, ...ok].slice(0, MAX_IMAGES));
  };

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed && !images.length) return;
    stopVoice();
    if (trimmed && runUi(trimmed)) {
      setText("");
      clearDraft(session);
      return;
    }
    const payload = images.map((im) => ({ data: im.data, mimeType: im.mimeType }));
    setText("");
    setImages([]);
    setFiles([]);
    setHistPick(null);
    clearDraft(session);
    if (trimmed) pushHistory(session, trimmed);
    actions.send(trimmed, payload);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Esc in front of an IME candidate window dismisses the candidate — it is
      // not an interrupt, and stopping the run on it loses the operator's input
      if (imeBusy(e, composing)) return;
      if (e.key === "Escape" && running) {
        e.preventDefault();
        actions.abort();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [running]);

  const [focused, setFocused] = useState(false);
  const chars = text.length;

  /* ---------------------------------------------------------- dictation
     The browser's own recogniser, feature-detected. Nothing goes through this
     app: the recognition (and its network hop, if the browser has one) belongs
     to the browser, and the transcript lands in the same draft the keys write
     to. Unsupported browsers get a disabled button, never a silent no-op. */
  const [listening, setListening] = useState(false);
  const recRef = useRef<{ stop: () => void } | null>(null);
  const speechSupported =
    typeof window !== "undefined" &&
    !!((window as unknown as Record<string, unknown>).SpeechRecognition ||
      (window as unknown as Record<string, unknown>).webkitSpeechRecognition);

  const stopVoice = () => {
    recRef.current?.stop?.();
    recRef.current = null;
    setListening(false);
  };

  const toggleVoice = () => {
    if (!speechSupported) return;
    if (listening) return stopVoice();
    const w = window as unknown as Record<string, any>;
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    const rec = new SR();
    const base = textRef.current.trim() ? `${textRef.current.trim()} ` : "";
    let final = "";
    rec.lang = getSettings().locale === "zh" ? "zh-CN" : "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      setText(base + final + interim);
      requestAnimationFrame(() => {
        grow();
        const el = ref.current;
        if (el) {
          el.setSelectionRange(el.value.length, el.value.length);
          setCaret(el.value.length);
        }
      });
    };
    rec.onerror = () => stopVoice();
    rec.onend = () => {
      recRef.current = null;
      setListening(false);
    };
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      stopVoice();
    }
  };

  useEffect(() => () => recRef.current?.stop?.(), []);

  const queued = [...textList(queue?.steering), ...textList(queue?.followUp)];

  if (PLAIN_COMPOSER) {
    return (
      <div class="cmdwrap">
        <div class="cmdbar">
          <div class="cmd-field" data-state={disabled ? "off" : "idle"}>
            <div class="cmd-help">
              <span>PLAIN MODE · NO HANDLERS</span>
            </div>
            <label class="inputline">
              <span class="caret" />
              <textarea
                ref={plainRef}
                rows={2}
                defaultValue=""
                disabled={disabled}
                placeholder="uncontrolled textarea — for bisecting the composer"
                onKeyDown={(e) => {
                  if (imeBusy(e)) return;
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    const value = plainRef.current?.value.trim();
                    if (!value) return;
                    if (plainRef.current) plainRef.current.value = "";
                    actions.send(value);
                  }
                }}
              />
            </label>
          </div>
          <div class="btns">
            <BarButton
              label={running ? t("cmd.steer") : t("cmd.run")}
              hint="ENTER"
              tone="ok"
              disabled={disabled}
              icon="act-send"
              onClick={() => {
                const value = plainRef.current?.value.trim();
                if (!value) return;
                if (plainRef.current) plainRef.current.value = "";
                actions.send(value);
              }}
            />
            <BarButton label={t("cmd.stop")} hint="ESC" tone="stop" disabled={!running} onClick={() => actions.abort()} icon="act-stop" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      class="cmdwrap"
      data-drop={dragging ? "1" : "0"}
      data-flash={flashQuote ? "1" : "0"}
      onDragOver={(e) => {
        if (!e.dataTransfer?.types?.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        addFiles(e.dataTransfer?.files ?? null);
      }}
    >
      {queued.length ? (
        <div class="qstrip">
          <span class="q-lb">QUEUED {queued.length}</span>
          {queued.map((q, i) => (
            <span class="q-item" key={i} title={q}>
              {q.replace(/\s+/g, " ")}
            </span>
          ))}
          <span class="q-note">delivered after the current turn</span>
        </div>
      ) : null}
    {matches.length ? (
      <div class="cpal">
        {matches.map((c, i) => (
          <button
            type="button"
            key={c.name}
            class="cp"
            data-on={i === pick ? "1" : "0"}
            onMouseEnter={() => setPick(i)}
            onClick={() => {
              if (c.hint || c.kind !== "ui") setText(`${c.name} `);
              else {
                setText("");
                runUi(c.name);
              }
            }}
          >
            <span class="cn">{c.name}</span>
            <span class="cd">{c.description || c.kind}</span>
            {c.hint ? <span class="ch">{c.hint}</span> : null}
          </button>
        ))}
      </div>
    ) : null}

    {/* `@` palette: same row language as the command palette, but the pick is a
        path — it lands in the draft as a code span, which pi's read tool owns. */}
    {atQuery !== null ? (
      <div class="cpal" data-kind="file">
        {filesBusy && !files.length ? <span class="cp-empty">{t("cmd.scanning")}</span> : null}
        {!filesBusy && !files.length ? <span class="cp-empty">{t("cmd.noFile")}</span> : null}
        {files.map((f, i) => (
          <button
            type="button"
            key={f.rel}
            class="cp"
            data-on={i === pick ? "1" : "0"}
            title={f.rel}
            onMouseEnter={() => setPick(i)}
            onClick={() => pickFile(f.rel)}
          >
            <span class="cn">{f.base}</span>
            <span class="cd">{f.dir || "."}</span>
            <span class="ch">REF</span>
          </button>
        ))}
      </div>
    ) : null}

    <div class="cmdbar" data-run={running ? "1" : "0"}>
      {/* ENTRY is the input console's control block: label, the two input modes
          (image attach, dictation) and the live mode line. Keeping the buttons
          here means the field needs only one auxiliary row — the chips. */}
      <div class="entry-block">
        <span class="el">{t("cmd.entry")}</span>
        <div class="entry-acts">
          <button
            type="button"
            class="iact"
            title={t("cmd.attach")}
            aria-label={t("cmd.attach")}
            disabled={disabled || images.length >= MAX_IMAGES}
            onClick={() => fileRef.current?.click()}
          >
            <Icon name="fld-image" size={12} />
          </button>
          <button
            type="button"
            class="iact"
            data-on={listening ? "1" : "0"}
            title={!speechSupported ? t("cmd.voiceNA") : listening ? t("cmd.voiceStop") : t("cmd.voice")}
            aria-label={listening ? t("cmd.voiceStop") : t("cmd.voice")}
            aria-pressed={listening ? "true" : "false"}
            disabled={disabled || !speechSupported}
            onClick={toggleVoice}
          >
            <Icon name={listening ? "act-mic-off" : "act-mic"} size={12} />
          </button>
        </div>
        <span class="eh" data-live={listening ? "1" : "0"}>
          {images.length
            ? `${images.length}/${MAX_IMAGES} IMG`
            : listening
              ? t("cmd.listening")
              : running
                ? t("cmd.steer")
                : "CTRL K"}
        </span>
      </div>

      <div class="cmd-field" data-state={disabled ? "off" : running ? "live" : "idle"}>
        <div class="cmd-help">
          {/* one row, two tenants: the chips take it over while something is
              attached, so an attachment never costs a second line */}
          {images.length ? (
            <div class="attach-strip">
              {images.map((a) => (
                <span class="achip" key={a.id} title={`${a.name} · ${a.mimeType} · ${fmtSize(a.bytes)}`}>
                  <img src={`data:${a.mimeType};base64,${a.data}`} alt="" />
                  <span class="an">{a.name}</span>
                  <span class="asz">{fmtSize(a.bytes)}</span>
                  <button
                    type="button"
                    class="ax"
                    title={t("cmd.drop")}
                    aria-label={t("cmd.drop")}
                    onClick={() => setImages((prev) => prev.filter((x) => x.id !== a.id))}
                  >
                    <Icon name="act-close" size={10} />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <span class={`hint${running ? " live" : ""}`}>{running ? t("cmd.live") : t("cmd.send")}</span>
          )}
          <span class="cnt">{chars ? `${chars} CHARS` : "INPUT"}</span>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const input = e.currentTarget;
            addFiles(input.files);
            input.value = "";
          }}
        />
        <label class="inputline" data-focused={focused ? "1" : "0"}>
          <span class="caret" />
          {/* autosize probe — see .grow-mirror in the stylesheet */}
          <div class="grow-mirror" ref={mirrorRef} aria-hidden="true" />
          <textarea
            ref={ref}
            rows={2}
            placeholder={running ? t("cmd.placeholderLive") : t("cmd.placeholder")}
            value={text}
            disabled={disabled}
            onFocus={() => setFocused(true)}
            onBlur={() => {
              // an IME that never sent compositionend (blur cancels it) must not
              // leave the composer thinking a candidate window is still open
              composing.current = false;
              setFocused(false);
            }}
            /* An IME (fcitx5/ibus) owns the text between compositionstart and
               compositionend. The field stays *controlled*, so `value` has to
               track the DOM exactly: Preact re-applies the prop whenever it
               differs from `dom.value` (diff/index.js), which is precisely what
               eats a half-composed candidate. Mirroring every input keeps the
               two equal, so nothing is ever written back over the IME. */
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionUpdate={grow}
            onCompositionEnd={(e) => {
              composing.current = false;
              const el = e.target as HTMLTextAreaElement;
              grow();
              setText(el.value);
              setCaret(el.selectionStart ?? 0);
            }}
            onInput={(e) => {
              const el = e.target as HTMLTextAreaElement;
              // grow before the commit too: composing text already occupies rows
              grow();
              setText(el.value);
              setCaret(el.selectionStart ?? 0);
              setHistPick(null);
            }}
            onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
            onPaste={(e) => {
              const picks = Array.from(e.clipboardData?.items ?? [])
                .filter((i) => i.kind === "file" && i.type.startsWith("image/"))
                .map((i) => i.getAsFile())
                .filter((f): f is File => !!f);
              // plain text keeps the browser's own paste path
              if (!picks.length) return;
              e.preventDefault();
              addFiles(picks);
            }}
            onKeyDown={(e) => {
              // while a candidate window is open every key belongs to the IME:
              // Enter commits, arrows/space pick, Esc dismisses. Swallow nothing,
              // act on nothing — sending a half-composed prompt is the bug.
              if (imeBusy(e, composing)) return;
              if (files.length && atQuery !== null) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setPick((p) => (p + 1) % files.length);
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setPick((p) => (p - 1 + files.length) % files.length);
                  return;
                }
                if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
                  e.preventDefault();
                  const f = files[Math.min(pick, files.length - 1)];
                  if (f) pickFile(f.rel);
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setFiles([]);
                  return;
                }
              }
              if (matches.length) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setPick((p) => (p + 1) % matches.length);
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setPick((p) => (p - 1 + matches.length) % matches.length);
                  return;
                }
                if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
                  const cmd = matches[Math.min(pick, matches.length - 1)];
                  e.preventDefault();
                  if (cmd && (cmd.hint || cmd.kind !== "ui")) {
                    setText(`${cmd.name} `);
                    setPick(0);
                    return;
                  }
                  if (cmd) setText(cmd.name);
                  if (cmd) runUi(cmd.name);
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setText("");
                  return;
                }
              }
              /* Sent-history walk: only from the very start of the draft, so
                 ArrowUp still moves between lines of a paragraph. */
              const atStart = e.currentTarget.selectionStart === 0 && e.currentTarget.selectionEnd === 0;
              if (e.key === "ArrowUp" && (histPick !== null || atStart)) {
                const hist = loadHistory(session);
                if (!hist.length) return;
                e.preventDefault();
                if (histPick === null) {
                  histDraft.current = text;
                  setHistPick(hist.length - 1);
                  setText(hist[hist.length - 1]);
                } else if (histPick > 0) {
                  setHistPick(histPick - 1);
                  setText(hist[histPick - 1]);
                }
                return;
              }
              if (e.key === "ArrowDown" && histPick !== null) {
                e.preventDefault();
                const hist = loadHistory(session);
                if (histPick < hist.length - 1) {
                  setHistPick(histPick + 1);
                  setText(hist[histPick + 1]);
                } else {
                  setHistPick(null);
                  setText(histDraft.current);
                }
                return;
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
        </label>
      </div>

      <div class="cmd-aux">
        <div class="aux-primary">
          <BarButton label={running ? t("cmd.steer") : t("cmd.run")} hint="ENTER" tone="ok" disabled={disabled} onClick={submit} icon="act-send" />
          <BarButton label={t("cmd.stop")} hint="ESC" tone="stop" disabled={!running} onClick={() => actions.abort()} icon="act-stop" />
        </div>
        {/* quick prompts: a 3x2 pad matrix, corner key last. A pad appends its
            text to the draft instead of sending — the operator still owns RUN. */}
        <div class="aux-matrix" role="group" aria-label={t("qp.title")}>
          {quick.map((q) => (
            <button type="button" class="qp" key={q.id} title={q.text} onClick={() => useQuick(q)}>
              <span class="lb">{q.label}</span>
            </button>
          ))}
          <button
            type="button"
            class="qp is-edit"
            title={t("qp.edit")}
            aria-label={t("qp.edit")}
            onClick={() => askDeck("quick")}
          >
            <Icon name="act-new" size={11} />
            <span class="lb">{t("qp.editKey")}</span>
          </button>
        </div>
      </div>
    </div>
    </div>
  );
}
