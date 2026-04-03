/**
 * Self-contained HTML page for the voice-controlled web adapter.
 * No build step, no external files — everything is inlined.
 *
 * Styled to match Claude Code's dark terminal aesthetic.
 */

export const WEB_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>jake-bot</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { background: #111111; }
  body {
    font-family: "SF Mono", "Cascadia Code", "Fira Code", "JetBrains Mono", Menlo, Consolas, monospace;
    background: #0d0d0d; color: #d4d4d4;
    height: 100dvh; display: flex; flex-direction: column;
    max-width: 900px; margin: 0 auto; width: 100%;
    border-left: 1px solid #1e1e1e; border-right: 1px solid #1e1e1e;
  }

  /* Top bar */
  #topbar {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 16px; background: #161616; border-bottom: 1px solid #2a2a2a;
    font-size: 13px; flex-shrink: 0;
  }
  #topbar .left { display: flex; align-items: center; gap: 10px; }
  #topbar .right { display: flex; align-items: center; gap: 12px; }
  #topbar .app-name { color: #c79753; font-weight: 600; font-size: 14px; }

  /* Working indicator */
  #working {
    display: none; align-items: center; gap: 6px;
    font-size: 12px; color: #888;
  }
  #working.active { display: flex; }
  .spinner {
    width: 14px; height: 14px; border: 2px solid #333;
    border-top-color: #c79753; border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* Transcript */
  #transcript {
    flex: 1; overflow-y: auto; padding: 16px;
    display: flex; flex-direction: column; gap: 10px;
  }
  #transcript::-webkit-scrollbar { width: 6px; }
  #transcript::-webkit-scrollbar-track { background: transparent; }
  #transcript::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }

  /* Status bar (between transcript and input) */
  #statusbar {
    display: flex; align-items: center; justify-content: space-between;
    padding: 4px 16px; background: #131313;
    border-top: 1px solid #2a2a2a; border-bottom: 1px solid #2a2a2a;
    font-size: 12px; color: #666; flex-shrink: 0; min-height: 26px;
  }
  #statusbar .left { display: flex; align-items: center; gap: 8px; }
  #statusbar .right { display: flex; align-items: center; gap: 8px; }
  #statusbar .plugin { color: #8a7043; font-weight: 600; }
  #statusbar .hint { color: #555; font-style: italic; }
  #statusbar .workdir {
    color: #777; font-size: 12px;
    max-width: 300px; overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap;
  }
  #statusbar .disconnect-msg { display: none; color: #a05050; font-style: italic; }
  #statusbar.disconnected {
    justify-content: center;
    border-top-color: #6b3333; border-bottom-color: #6b3333;
  }
  #statusbar.disconnected .left,
  #statusbar.disconnected .right { display: none; }
  #statusbar.disconnected .disconnect-msg { display: inline; }

  .msg {
    max-width: 85%; padding: 8px 12px; border-radius: 4px;
    white-space: pre-wrap; word-break: break-word; font-size: 13px; line-height: 1.6;
  }
  .msg.user {
    align-self: flex-end; background: #1e3a5f; color: #d4d4d4;
  }
  .msg.bot {
    align-self: flex-start; background: #1a1a1a; color: #d4d4d4;
    border: 1px solid #2a2a2a; min-width: 60%;
  }
  .msg.system {
    align-self: center; background: transparent; color: #666;
    font-size: 12px; font-style: italic; padding: 4px 0;
  }
  .msg.command {
    align-self: flex-end; background: transparent; color: #666;
    font-size: 11px; padding: 3px 10px;
    border: 1px solid #333; border-radius: 12px;
    max-width: fit-content; white-space: nowrap;
  }
  /* Markdown elements */
  .msg.bot code {
    background: #111; padding: 1px 5px; border-radius: 3px;
    font-size: 12px; color: #c9a87c;
  }
  .msg.bot pre {
    background: #111; border: 1px solid #2a2a2a; border-radius: 4px;
    padding: 8px 10px; margin: 6px 0; overflow-x: auto;
    font-size: 12px; line-height: 1.5;
  }
  .msg.bot pre code {
    background: none; padding: 0; color: #d4d4d4;
  }
  .msg.bot h1, .msg.bot h2, .msg.bot h3 {
    color: #e0e0e0; margin: 8px 0 4px; font-size: 14px; font-weight: 600;
  }
  .msg.bot h1 { font-size: 16px; }
  .msg.bot ul, .msg.bot ol {
    padding-left: 20px; margin: 4px 0;
  }
  .msg.bot li { margin: 2px 0; }

  .msg.bot .thinking {
    color: #777; font-style: italic; font-size: 12px;
    border-left: 2px solid #333; padding-left: 8px; margin: 4px 0;
  }
  .msg.bot .input-request {
    margin: 8px 0; padding: 8px 10px;
    background: #111; border: 1px solid #2a2a2a; border-radius: 4px;
  }
  .msg.bot .input-request .ir-question {
    color: #c79753; font-weight: 600; margin-bottom: 6px; font-size: 13px;
  }
  .msg.bot .input-request .ir-options {
    display: flex; flex-wrap: wrap; gap: 6px;
  }
  .msg.bot .ir-opt-btn {
    background: #1a2a1a; border: 1px solid #5fad78; color: #5fad78;
    padding: 5px 12px; border-radius: 4px; cursor: pointer;
    font-family: inherit; font-size: 12px; transition: all 0.15s;
  }
  .msg.bot .ir-opt-btn:hover:not(:disabled) { background: #243a24; border-color: #7cc795; }
  .msg.bot .ir-opt-btn:disabled { opacity: 0.4; cursor: default; }
  .msg.bot .ir-opt-btn.selected:disabled {
    opacity: 1; background: #1a2a1a; border-color: #3a7a4a; color: #3a7a4a;
  }
  .msg.bot .mode-plan {
    color: #c79753; font-size: 11px; background: #1c1810;
    border-radius: 3px; padding: 4px 8px; margin: 6px 0;
    display: inline-block;
  }
  .msg.bot .tool {
    color: #888; font-size: 11px; background: #111;
    border-radius: 3px; padding: 3px 7px; margin: 2px 0;
    display: inline-block;
  }
  .msg.bot .tool-first { margin-top: 10px; }
  .msg.bot .tool-last { margin-bottom: 10px; }
  .msg.bot .footer {
    color: #555; font-size: 11px; margin-top: 6px;
    border-top: 1px solid #222; padding-top: 4px;
  }

  /* Bottom bar */
  #bottombar {
    display: flex; flex-direction: column; align-items: center;
    padding: 10px 16px 16px; background: #161616;
    border-top: 1px solid #2a2a2a; flex-shrink: 0; gap: 8px;
  }
  #preview {
    font-size: 12px; color: #666; min-height: 18px;
    text-align: center; width: 100%;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }

  /* Input row */
  #inputrow {
    display: flex; align-items: center; gap: 10px;
    width: 100%; max-width: 700px;
  }

  /* Mic button — flat SVG icon */
  #mic {
    width: 40px; height: 40px; border-radius: 6px; border: 1px solid #333;
    background: #1a1a1a; color: #888; cursor: pointer; transition: all 0.15s;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
  }
  #mic svg { width: 18px; height: 18px; fill: currentColor; }
  #mic:hover { border-color: #555; color: #bbb; }
  #mic.listening {
    border-color: #c75050; color: #e05555; background: #2a1515;
  }
  #mic.busy { border-color: #333; color: #444; cursor: not-allowed; }

  .no-speech #mic { display: none; }

  /* Text input */
  #textinput { flex: 1; }
  #textinput form { display: flex; gap: 8px; }
  #textinput input {
    flex: 1; padding: 9px 12px; border-radius: 6px; border: 1px solid #333;
    background: #1a1a1a; color: #d4d4d4; font-size: 13px;
    font-family: inherit; outline: none; transition: border-color 0.15s;
  }
  #textinput input:focus { border-color: #555; }
  #textinput input::placeholder { color: #555; }
  #textinput button {
    padding: 9px 16px; border-radius: 6px; border: 1px solid #333;
    background: #1a1a1a; color: #888; font-size: 13px;
    font-family: inherit; cursor: pointer; transition: all 0.15s;
  }
  #textinput button:hover { border-color: #555; color: #bbb; }

  /* TTS toggle */
  #ttsToggle {
    background: none; border: 1px solid #333; border-radius: 4px;
    color: #555; font-size: 11px; padding: 3px 8px; cursor: pointer;
    font-family: inherit; transition: all 0.15s; letter-spacing: 0.5px;
  }
  #ttsToggle.active { color: #c79753; border-color: #c79753; }
  #ttsToggle:hover { border-color: #555; }
</style>
</head>
<body>

<div id="topbar">
  <div class="left">
    <span class="app-name">Jake</span>
  </div>
  <div class="right">
    <button id="ttsToggle" class="active">TTS</button>
  </div>
</div>

<div id="transcript"></div>

<div id="statusbar">
  <div class="left">
    <span class="hint" id="pluginLabel">Type /claude to start</span>
    <div id="working"><div class="spinner"></div></div>
  </div>
  <div class="right">
    <span class="workdir" id="workdirLabel"></span>
  </div>
  <span class="disconnect-msg">Reconnecting...</span>
</div>

<div id="bottombar">
  <div id="preview"></div>
  <div id="inputrow">
    <button id="mic">
      <svg viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
    </button>
    <div id="textinput">
      <form id="textform">
        <input type="text" id="textfield" placeholder="Type a message or /claude workdir..." autocomplete="off">
        <button type="submit">Send</button>
      </form>
    </div>
  </div>
</div>

<script>
(function() {
  // -- Session (localStorage so it survives refresh / tab close) --
  let session = localStorage.getItem("jakebot_session");
  if (!session) {
    session = crypto.randomUUID();
    localStorage.setItem("jakebot_session", session);
  }

  // -- History persistence --
  const HISTORY_KEY = "jakebot_history_" + session;
  const MAX_HISTORY = 200;
  let history = [];

  function loadHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (raw) history = JSON.parse(raw);
      if (!Array.isArray(history)) history = [];
    } catch { history = []; }
  }

  function saveHistory() {
    while (history.length > MAX_HISTORY) history.shift();
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch { /* localStorage full — degrade gracefully */ }
  }

  function clearHistory() {
    history = [];
    responseParts = new Map();
    responseOrder = [];
    currentResponseEl = null;
    try { localStorage.removeItem(HISTORY_KEY); } catch {}
  }

  // -- DOM refs --
  const transcript = document.getElementById("transcript");
  const preview = document.getElementById("preview");
  const micBtn = document.getElementById("mic");
  const statusbar = document.getElementById("statusbar");
  const pluginLabel = document.getElementById("pluginLabel");
  const workdirLabel = document.getElementById("workdirLabel");
  const textfield = document.getElementById("textfield");
  const textform = document.getElementById("textform");
  const ttsToggle = document.getElementById("ttsToggle");
  const working = document.getElementById("working");

  // -- State --
  let listening = false;
  let busy = false;
  let speaking = false;
  let ttsEnabled = localStorage.getItem("jakebot_tts") !== "off";
  let lastSendWasCommand = false;
  const COMMAND_RE = /^\\/(claude|gemini|codex|end|status|clear)(\\s|$)/i;

  function shortenPath(p) {
    if (!p) return "";
    return p.replace(/^\\/(?:Users|home)\\/[^/]+\\//, "~/");
  }

  function setPluginLabel(name) {
    if (name) {
      pluginLabel.textContent = name;
      pluginLabel.className = "plugin";
    } else {
      pluginLabel.textContent = "Type /claude to start";
      pluginLabel.className = "hint";
    }
  }

  // Response accumulator — all events for a single response render in one bubble
  let currentResponseEl = null;
  let responseParts = new Map();  // messageId -> latest text for that part
  let responseOrder = [];         // ordered messageIds

  // Sync TTS toggle class with persisted state
  ttsToggle.classList.toggle("active", ttsEnabled);

  // -- Restore history from localStorage --
  function restoreHistory() {
    loadHistory();
    for (const entry of history) {
      if (entry.role === "user") {
        const el = document.createElement("div");
        el.className = "msg user";
        el.textContent = entry.text;
        transcript.appendChild(el);
      } else if (entry.role === "bot") {
        const el = document.createElement("div");
        el.className = "msg bot";
        el.innerHTML = renderBotHtml(entry.text);
        transcript.appendChild(el);
      } else if (entry.role === "system") {
        const el = document.createElement("div");
        el.className = "msg system";
        el.textContent = entry.text;
        transcript.appendChild(el);
      } else if (entry.role === "command") {
        const el = document.createElement("div");
        el.className = "msg command";
        el.textContent = entry.text;
        transcript.appendChild(el);
      }
    }
    scrollDown();
  }

  // -- SSE connection --
  let sse;
  function connectSSE() {
    sse = new EventSource("/api/stream?session=" + encodeURIComponent(session));

    sse.onopen = () => {
      statusbar.classList.remove("disconnected");
      // Reset busy state — if server restarted, in-flight work is lost
      setBusy(false);
      // Persist any partial response before clearing (done event never fired)
      if (responseOrder.length > 0) {
        const combinedText = responseOrder.map(id => responseParts.get(id)).join("\\n").trim();
        if (combinedText) {
          history.push({ role: "bot", text: combinedText, ts: Date.now() });
          saveHistory();
        }
      }
      responseParts = new Map();
      responseOrder = [];
      currentResponseEl = null;
    };

    sse.onerror = () => {
      statusbar.classList.add("disconnected");
    };

    sse.addEventListener("event", (e) => {
      const data = JSON.parse(e.data);
      handlePlatformEvent(data);
    });

    sse.addEventListener("system", (e) => {
      const data = JSON.parse(e.data);
      // System events mean the command was handled without LLM invocation —
      // discard the placeholder "Working..." bubble if it's still pending.
      discardPendingResponse();
      if (data.plugin) {
        setPluginLabel(data.plugin);
      }
      if (data.type === "ready") {
        setBusy(false);
      }
      if (data.type === "started") {
        if (data.cleared) {
          clearHistory();
          transcript.innerHTML = "";
          addSystemMessage("Context cleared. Fresh " + (data.plugin || "") + " conversation.");
        } else if (!lastSendWasCommand) {
          addSystemMessage("Started " + (data.plugin || "") + " conversation.");
        }
        setPluginLabel(data.plugin || "active");
        workdirLabel.textContent = shortenPath(data.workdir || "");
        lastSendWasCommand = false;
        setBusy(false);
      }
      if (data.type === "ended") {
        setPluginLabel(null);
        workdirLabel.textContent = "";
        if (!lastSendWasCommand) {
          addSystemMessage("Conversation ended.");
        }
        lastSendWasCommand = false;
        setBusy(false);
      }
      if (data.type === "status") {
        addSystemMessage("Plugin: " + data.plugin + " | Workdir: " + data.workdir + " | Session: " + data.sessionId);
        lastSendWasCommand = false;
        setBusy(false);
      }
      if (data.type === "error") {
        addSystemMessage("Error: " + (data.message || "Unknown error"));
        lastSendWasCommand = false;
        setBusy(false);
      }
      if (data.type === "restored") {
        setPluginLabel(data.plugin || "active");
        workdirLabel.textContent = shortenPath(data.workdir || "");
        setBusy(false);
      }
    });
  }
  restoreHistory();
  connectSSE();

  function renderBotHtml(raw) {
    const esc = (s) => s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

    // Inline markdown: bold, italic, inline code
    function inlineMd(s) {
      s = esc(s);
      // inline code (must come first to protect contents)
      s = s.replace(/\`([^\`]+?)\`/g, '<code>$1</code>');
      // bold
      s = s.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
      // italic (single *)
      s = s.replace(/(?<!\\*)\\*(?!\\*)(.+?)(?<!\\*)\\*(?!\\*)/g, '<em>$1</em>');
      return s;
    }

    const text = raw || "";
    const lines = text.split("\\n");
    const out = [];
    let i = 0;
    let prevKind = "other"; // track "tool" vs "other" for spacing

    while (i < lines.length) {
      const line = lines[i];

      // Transition out of tool group — mark last tool with tool-last
      if (prevKind === "tool" && !line.startsWith("Tool:")) {
        for (let j = out.length - 1; j >= 0; j--) {
          if (out[j].startsWith('<div class="tool')) {
            out[j] = out[j].replace('class="tool', 'class="tool tool-last');
            break;
          }
        }
      }

      // Fenced code block
      if (line.startsWith("\`\`\`")) {
        prevKind = "other";
        const lang = line.slice(3).trim();
        const codeLines = [];
        i++;
        while (i < lines.length && !lines[i].startsWith("\`\`\`")) {
          codeLines.push(esc(lines[i]));
          i++;
        }
        i++; // skip closing fence
        out.push('<pre><code>' + codeLines.join("\\n") + '</code></pre>');
        continue;
      }

      // Thinking
      if (line.startsWith("[thinking]")) {
        prevKind = "other";
        out.push('<div class="thinking">' + inlineMd(line.slice(10).trim()) + '</div>');
        i++; continue;
      }

      // Input request (question with options)
      if (line.startsWith("[input_request] ")) {
        prevKind = "other";
        const raw = line.slice(16);
        // Options JSON follows the question text after the first [ character
        const jsonStart = raw.indexOf("[");
        let question, opts;
        if (jsonStart >= 0) {
          question = raw.slice(0, jsonStart).trim();
          try { opts = JSON.parse(raw.slice(jsonStart)); } catch { opts = []; }
        } else {
          question = raw.trim();
          opts = [];
        }
        let html = '<div class="input-request"><div class="ir-question">' + inlineMd(question) + '</div>';
        if (opts.length > 0) {
          html += '<div class="ir-options">';
          for (const o of opts) {
            const lbl = esc(o.label || "");
            const title = o.description ? ' title="' + esc(o.description) + '"' : "";
            html += '<button class="ir-opt-btn" data-reply="' + lbl + '"' + title + '>' + lbl + '</button>';
          }
          html += '</div>';
        }
        html += '</div>';
        out.push(html);
        i++; continue;
      }

      // Plan mode entering
      if (line.startsWith("[mode:plan]")) {
        prevKind = "other";
        out.push('<div class="mode-plan">' + esc(line.slice(11).trim() || "Entering plan mode") + '</div>');
        i++; continue;
      }

      // Tool
      if (line.startsWith("Tool:")) {
        const cls = prevKind !== "tool" ? "tool tool-first" : "tool";
        prevKind = "tool";
        out.push('<div class="' + cls + '">' + esc(line) + '</div>');
        i++; continue;
      }

      // Duration footer
      if (/^Duration:\\s/.test(line)) {
        prevKind = "other";
        out.push('<div class="footer">' + esc(line) + '</div>');
        i++; continue;
      }

      // Headers
      const hMatch = line.match(/^(#{1,3})\\s+(.+)/);
      if (hMatch) {
        prevKind = "other";
        const level = hMatch[1].length;
        out.push('<h' + level + '>' + inlineMd(hMatch[2]) + '</h' + level + '>');
        i++; continue;
      }

      // Unordered list items (collect consecutive, allowing blank lines between)
      if (/^[-*]\\s+/.test(line)) {
        prevKind = "other";
        const items = [];
        while (i < lines.length) {
          if (/^[-*]\\s+/.test(lines[i])) {
            items.push('<li>' + inlineMd(lines[i].replace(/^[-*]\\s+/, '')) + '</li>');
            i++;
          } else if (lines[i].trim() === '' && i + 1 < lines.length && /^[-*]\\s+/.test(lines[i + 1])) {
            i++; // skip blank line between list items
          } else {
            break;
          }
        }
        out.push('<ul>' + items.join('') + '</ul>');
        continue;
      }

      // Ordered list items (collect consecutive, allowing blank lines between)
      if (/^\\d+\\.\\s+/.test(line)) {
        prevKind = "other";
        const items = [];
        while (i < lines.length) {
          if (/^\\d+\\.\\s+/.test(lines[i])) {
            items.push('<li>' + inlineMd(lines[i].replace(/^\\d+\\.\\s+/, '')) + '</li>');
            i++;
          } else if (lines[i].trim() === '' && i + 1 < lines.length && /^\\d+\\.\\s+/.test(lines[i + 1])) {
            i++; // skip blank line between list items
          } else {
            break;
          }
        }
        out.push('<ol>' + items.join('') + '</ol>');
        continue;
      }

      // Regular line
      prevKind = "other";
      out.push(inlineMd(line));
      i++;
    }

    return out.join("\\n");
  }

  function renderCurrentResponse() {
    if (!currentResponseEl) return;
    const combined = responseOrder.map(id => responseParts.get(id)).join("\\n").trim();
    currentResponseEl.innerHTML = renderBotHtml(combined);
    scrollDown();
  }

  /** Remove the "Working..." placeholder bubble if no real content arrived. */
  function discardPendingResponse() {
    if (currentResponseEl && currentResponseEl.querySelector(".thinking")) {
      currentResponseEl.remove();
      currentResponseEl = null;
      responseParts = new Map();
      responseOrder = [];
    }
  }

  function handlePlatformEvent(ev) {
    if (ev.type === "message") {
      // If no active response bubble (e.g. server-initiated), create one
      if (!currentResponseEl) {
        currentResponseEl = document.createElement("div");
        currentResponseEl.className = "msg bot";
        transcript.appendChild(currentResponseEl);
        responseParts = new Map();
        responseOrder = [];
      }
      responseParts.set(ev.messageId, ev.text);
      responseOrder.push(ev.messageId);
      renderCurrentResponse();
    } else if (ev.type === "update") {
      responseParts.set(ev.messageId, ev.text);
      renderCurrentResponse();
    } else if (ev.type === "typing") {
      // Handled by busy/working indicator
    } else if (ev.type === "audio") {
      if (ttsEnabled && ev.audio) enqueueAudio(ev.audio);
    } else if (ev.type === "audio_done") {
      audioDone = true;
      // If nothing is playing (all chunks already finished), clean up
      if (!audioPlaying) { speaking = false; resumeRecognition(); }
    } else if (ev.type === "done") {
      setBusy(false);
      // Persist the combined response as a single history entry
      const combinedText = responseOrder.map(id => responseParts.get(id)).join("\\n").trim();
      if (combinedText) {
        history.push({ role: "bot", text: combinedText, ts: Date.now() });
      }
      responseParts = new Map();
      responseOrder = [];
      currentResponseEl = null;
      saveHistory();
      speakLast();
    }
  }

  function scrollDown() {
    transcript.scrollTop = transcript.scrollHeight;
  }

  function addUserMessage(text) {
    const el = document.createElement("div");
    el.className = "msg user";
    el.textContent = text;
    transcript.appendChild(el);
    scrollDown();
    history.push({ role: "user", text, ts: Date.now() });
    saveHistory();
  }

  function addSystemMessage(text) {
    const el = document.createElement("div");
    el.className = "msg system";
    el.textContent = text;
    transcript.appendChild(el);
    scrollDown();
    history.push({ role: "system", text, ts: Date.now() });
    saveHistory();
  }

  function addCommandMessage(text) {
    const el = document.createElement("div");
    el.className = "msg command";
    el.textContent = text;
    transcript.appendChild(el);
    scrollDown();
    history.push({ role: "command", text, ts: Date.now() });
    saveHistory();
  }

  // -- Send message --
  async function send(text) {
    if (!text.trim() || busy) return;
    const trimmed = text.trim();
    const isCommand = COMMAND_RE.test(trimmed);
    lastSendWasCommand = isCommand;

    if (isCommand) {
      addCommandMessage(trimmed);
    } else {
      addUserMessage(trimmed);
      // Create response bubble with placeholder as visual feedback
      currentResponseEl = document.createElement("div");
      currentResponseEl.className = "msg bot";
      currentResponseEl.innerHTML = '<span class="thinking">Working...</span>';
      transcript.appendChild(currentResponseEl);
      responseParts = new Map();
      responseOrder = [];
      scrollDown();
    }
    setBusy(true);

    try {
      const res = await fetch("/api/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session, text: trimmed }),
      });
      if (res.status === 409) {
        addSystemMessage("Still processing, please wait...");
        setBusy(false);
      } else if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        addSystemMessage("Error: " + (body.error || res.statusText));
        setBusy(false);
      }
    } catch (err) {
      addSystemMessage("Network error: " + err.message);
      setBusy(false);
    }
  }

  function setBusy(b) {
    busy = b;
    micBtn.classList.toggle("busy", b);
    working.classList.toggle("active", b);
  }

  // -- TTS (server-side via Google Cloud TTS) --
  const audioQueue = [];
  let audioPlaying = false;
  let audioDone = false; // true once all chunks received for current response

  // -- TTS toggle --
  ttsToggle.addEventListener("click", () => {
    ttsEnabled = !ttsEnabled;
    ttsToggle.classList.toggle("active", ttsEnabled);
    localStorage.setItem("jakebot_tts", ttsEnabled ? "on" : "off");
    if (!ttsEnabled) {
      cancelAudio();
    }
  });

  function cancelAudio() {
    // Stop current playback and clear queue
    for (const url of audioQueue) URL.revokeObjectURL(url);
    audioQueue.length = 0;
    audioPlaying = false;
    audioDone = false;
    speaking = false;
    // Stop any currently playing audio element
    const playing = document.querySelector("audio[data-tts]");
    if (playing) {
      playing.pause();
      playing.remove();
    }
    resumeRecognition();
  }

  function enqueueAudio(base64) {
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: "audio/mpeg" });
    const url = URL.createObjectURL(blob);
    audioQueue.push(url);
    if (!audioPlaying) playNext();
  }

  function playNext() {
    if (audioQueue.length === 0) {
      audioPlaying = false;
      if (audioDone) {
        speaking = false;
        resumeRecognition();
      }
      return;
    }
    audioPlaying = true;
    speaking = true;
    pauseRecognition();
    const url = audioQueue.shift();
    const audio = new Audio(url);
    audio.setAttribute("data-tts", "1");
    audio.onended = () => {
      URL.revokeObjectURL(url);
      audio.remove();
      playNext();
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      audio.remove();
      playNext();
    };
    audio.play().catch(() => {
      URL.revokeObjectURL(url);
      audio.remove();
      playNext();
    });
  }

  function speakLast() {
    if (!ttsEnabled) return;
    const botMsgs = transcript.querySelectorAll(".msg.bot");
    if (botMsgs.length === 0) return;
    const last = botMsgs[botMsgs.length - 1];
    let text = last.textContent || "";

    // Strip tool lines and footer for cleaner TTS
    text = text.split("\\n").filter(line => {
      if (line.startsWith("Tool:")) return false;
      if (line.startsWith("[thinking]")) return false;
      if (line.startsWith("Duration:")) return false;
      return true;
    }).join(". ").trim();

    if (!text || text.length < 2) return;
    if (text.length > 4000) text = text.slice(0, 4000);

    // Reset audio state for new response
    cancelAudio();
    speaking = true;
    pauseRecognition();

    fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session, text }),
    }).catch(() => {
      speaking = false;
      resumeRecognition();
    });
  }

  // -- Speech Recognition --
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition;

  if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) {
          const text = r[0].transcript;
          preview.textContent = "";
          send(text);
        } else {
          interim += r[0].transcript;
        }
      }
      if (interim) preview.textContent = interim;
    };

    recognition.onerror = (event) => {
      if (event.error === "no-speech" || event.error === "aborted") return;
      console.warn("Speech recognition error:", event.error);
    };

    recognition.onend = () => {
      if (listening && !speaking) {
        try { recognition.start(); } catch(e) {}
      }
    };
  } else {
    document.body.classList.add("no-speech");
  }

  function startListening() {
    if (!recognition || listening) return;
    listening = true;
    micBtn.classList.add("listening");
    try { recognition.start(); } catch(e) {}
  }

  function stopListening() {
    if (!recognition) return;
    listening = false;
    micBtn.classList.remove("listening");
    try { recognition.stop(); } catch(e) {}
    preview.textContent = "";
  }

  function pauseRecognition() {
    if (!recognition || !listening) return;
    try { recognition.stop(); } catch(e) {}
  }

  function resumeRecognition() {
    if (!recognition || !listening || speaking) return;
    try { recognition.start(); } catch(e) {}
  }

  // -- Mic button --
  micBtn.addEventListener("click", () => {
    if (busy) return;
    if (listening) stopListening();
    else startListening();
  });

  // -- Keyboard shortcuts --
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT") return;
    if (e.code === "Space") {
      e.preventDefault();
      if (busy) return;
      if (listening) stopListening();
      else startListening();
    }
    if (e.code === "Escape") {
      cancelAudio();
    }
  });

  // -- Text input --
  textform.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = textfield.value;
    textfield.value = "";
    send(text);
  });

  // -- Input request option buttons --
  transcript.addEventListener("click", (e) => {
    const btn = e.target.closest(".ir-opt-btn");
    if (!btn || busy || btn.disabled) return;
    const reply = btn.dataset.reply;
    if (!reply) return;
    // Disable all sibling option buttons and highlight the selected one
    const container = btn.closest(".ir-options");
    if (container) {
      for (const b of container.querySelectorAll(".ir-opt-btn")) {
        b.disabled = true;
      }
    }
    btn.classList.add("selected");
    send(reply);
  });

})();
</script>
</body>
</html>`;
