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
  body {
    font-family: "SF Mono", "Cascadia Code", "Fira Code", "JetBrains Mono", Menlo, Consolas, monospace;
    background: #0d0d0d; color: #d4d4d4;
    height: 100dvh; display: flex; flex-direction: column;
  }

  /* Top bar */
  #topbar {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 16px; background: #161616; border-bottom: 1px solid #2a2a2a;
    font-size: 13px; flex-shrink: 0;
  }
  #topbar .left { display: flex; align-items: center; gap: 10px; }
  #topbar .right { display: flex; align-items: center; gap: 12px; }
  #topbar .dot {
    width: 7px; height: 7px; border-radius: 50%; background: #555;
    flex-shrink: 0;
  }
  #topbar .dot.connected { background: #5fad78; }
  #topbar .conn-label { color: #777; }
  #topbar .plugin { color: #c79753; font-weight: 600; }

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

  .msg {
    max-width: 85%; padding: 8px 12px; border-radius: 4px;
    white-space: pre-wrap; word-break: break-word; font-size: 13px; line-height: 1.6;
  }
  .msg.user {
    align-self: flex-end; background: #1e3a5f; color: #d4d4d4;
  }
  .msg.bot {
    align-self: flex-start; background: #1a1a1a; color: #d4d4d4;
    border: 1px solid #2a2a2a;
  }
  .msg.system {
    align-self: center; background: transparent; color: #666;
    font-size: 12px; font-style: italic; padding: 4px 0;
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
  .msg.bot .tool {
    color: #888; font-size: 11px; background: #111;
    border-radius: 3px; padding: 3px 7px; margin: 4px 0;
    display: inline-block;
  }
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
    <div class="dot" id="connDot"></div>
    <span class="conn-label" id="connLabel">connecting</span>
    <div id="working"><div class="spinner"></div><span>working...</span></div>
  </div>
  <div class="right">
    <button id="ttsToggle" class="active">TTS</button>
    <span class="plugin" id="pluginLabel">no conversation</span>
  </div>
</div>

<div id="transcript"></div>

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
  // -- Session --
  let session = sessionStorage.getItem("jakebot_session");
  if (!session) {
    session = crypto.randomUUID();
    sessionStorage.setItem("jakebot_session", session);
  }

  // -- DOM refs --
  const transcript = document.getElementById("transcript");
  const preview = document.getElementById("preview");
  const micBtn = document.getElementById("mic");
  const connDot = document.getElementById("connDot");
  const connLabel = document.getElementById("connLabel");
  const pluginLabel = document.getElementById("pluginLabel");
  const textfield = document.getElementById("textfield");
  const textform = document.getElementById("textform");
  const ttsToggle = document.getElementById("ttsToggle");
  const working = document.getElementById("working");

  // -- State --
  let listening = false;
  let busy = false;
  let speaking = false;
  let ttsEnabled = true;
  const messages = new Map(); // messageId -> DOM element

  // -- SSE connection --
  let sse;
  function connectSSE() {
    sse = new EventSource("/api/stream?session=" + encodeURIComponent(session));

    sse.onopen = () => {
      connDot.classList.add("connected");
      connLabel.textContent = "connected";
    };

    sse.onerror = () => {
      connDot.classList.remove("connected");
      connLabel.textContent = "reconnecting";
    };

    sse.addEventListener("event", (e) => {
      const data = JSON.parse(e.data);
      handlePlatformEvent(data);
    });

    sse.addEventListener("system", (e) => {
      const data = JSON.parse(e.data);
      if (data.plugin) {
        pluginLabel.textContent = data.plugin;
      }
      if (data.type === "ready") {
        setBusy(false);
      }
      if (data.type === "started") {
        pluginLabel.textContent = data.plugin || "active";
        addSystemMessage("Started " + (data.plugin || "") + " conversation.");
        setBusy(false);
      }
      if (data.type === "ended") {
        pluginLabel.textContent = "no conversation";
        addSystemMessage("Conversation ended.");
        setBusy(false);
      }
      if (data.type === "status") {
        addSystemMessage("Plugin: " + data.plugin + " | Workdir: " + data.workdir + " | Session: " + data.sessionId);
        setBusy(false);
      }
      if (data.type === "error") {
        addSystemMessage("Error: " + (data.message || "Unknown error"));
        setBusy(false);
      }
    });
  }
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

    while (i < lines.length) {
      const line = lines[i];

      // Fenced code block
      if (line.startsWith("\`\`\`")) {
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
        out.push('<div class="thinking">' + inlineMd(line.slice(10).trim()) + '</div>');
        i++; continue;
      }

      // Tool
      if (line.startsWith("Tool:")) {
        out.push('<div class="tool">' + esc(line) + '</div>');
        i++; continue;
      }

      // Duration footer
      if (/^Duration:\\s/.test(line)) {
        out.push('<div class="footer">' + esc(line) + '</div>');
        i++; continue;
      }

      // Headers
      const hMatch = line.match(/^(#{1,3})\\s+(.+)/);
      if (hMatch) {
        const level = hMatch[1].length;
        out.push('<h' + level + '>' + inlineMd(hMatch[2]) + '</h' + level + '>');
        i++; continue;
      }

      // Unordered list items (collect consecutive)
      if (/^[-*]\\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^[-*]\\s+/.test(lines[i])) {
          items.push('<li>' + inlineMd(lines[i].replace(/^[-*]\\s+/, '')) + '</li>');
          i++;
        }
        out.push('<ul>' + items.join('') + '</ul>');
        continue;
      }

      // Ordered list items (collect consecutive)
      if (/^\\d+\\.\\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\\d+\\.\\s+/.test(lines[i])) {
          items.push('<li>' + inlineMd(lines[i].replace(/^\\d+\\.\\s+/, '')) + '</li>');
          i++;
        }
        out.push('<ol>' + items.join('') + '</ol>');
        continue;
      }

      // Regular line
      out.push(inlineMd(line));
      i++;
    }

    return out.join("\\n");
  }

  function handlePlatformEvent(ev) {
    if (ev.type === "message") {
      const el = document.createElement("div");
      el.className = "msg bot";
      el.innerHTML = renderBotHtml(ev.text);
      transcript.appendChild(el);
      messages.set(ev.messageId, el);
      scrollDown();
    } else if (ev.type === "update") {
      const el = messages.get(ev.messageId);
      if (el) {
        el.innerHTML = renderBotHtml(ev.text);
        scrollDown();
      }
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
  }

  function addSystemMessage(text) {
    const el = document.createElement("div");
    el.className = "msg system";
    el.textContent = text;
    transcript.appendChild(el);
    scrollDown();
  }

  // -- Send message --
  async function send(text) {
    if (!text.trim() || busy) return;
    addUserMessage(text.trim());
    setBusy(true);

    try {
      const res = await fetch("/api/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session, text: text.trim() }),
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

})();
</script>
</body>
</html>`;
