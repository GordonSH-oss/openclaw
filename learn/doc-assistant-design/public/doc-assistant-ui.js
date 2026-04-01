const storageKeys = {
  userId: "learn-doc-assistant.userId",
  sessionKey: "learn-doc-assistant.sessionKey",
};

const dom = {
  modeSelect: document.querySelector("#mode-select"),
  maxResultsInput: document.querySelector("#max-results-input"),
  questionInput: document.querySelector("#question-input"),
  askButton: document.querySelector("#ask-button"),
  newSessionButton: document.querySelector("#new-session-button"),
  connectionStatus: document.querySelector("#connection-status"),
  userIdLabel: document.querySelector("#user-id-label"),
  sessionKeyLabel: document.querySelector("#session-key-label"),
  messageList: document.querySelector("#message-list"),
  messageTemplate: document.querySelector("#message-template"),
};

const state = {
  requestId: 0,
  ws: null,
  pendingRequests: new Map(),
  pendingRuns: new Map(),
  connected: false,
  userId: localStorage.getItem(storageKeys.userId) ?? "",
  sessionKey: localStorage.getItem(storageKeys.sessionKey) ?? "",
};

function applyQueryPreferences() {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode");
  if (mode === "extractive" || mode === "agent") {
    dom.modeSelect.value = mode;
  }
  const question = params.get("question");
  if (question && !dom.questionInput.value.trim()) {
    dom.questionInput.value = question;
  }
  if (params.get("embed") === "1" || window.location.pathname === "/embed") {
    document.body.classList.add("embed-mode");
  }
}

function setConnectionStatus(label, isConnected) {
  state.connected = isConnected;
  dom.connectionStatus.textContent = label;
  dom.connectionStatus.style.color = isConnected ? "var(--accent-strong)" : "var(--danger)";
}

function updateIdentityLabels() {
  dom.userIdLabel.textContent = state.userId || "-";
  dom.sessionKeyLabel.textContent = state.sessionKey || "-";
}

function nextRequestId() {
  state.requestId += 1;
  return String(state.requestId);
}

function createWebSocketUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws?clientId=doc-assistant-ui`;
}

function rpc(method, params) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error("WebSocket is not connected."));
  }

  const id = nextRequestId();
  return new Promise((resolve, reject) => {
    state.pendingRequests.set(id, { resolve, reject });
    state.ws.send(JSON.stringify({ id, method, params }));
  });
}

function scrollMessagesToTop() {
  dom.messageList.scrollTop = 0;
}

function formatNow() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function createMessageCard(role, extra = "") {
  const fragment = dom.messageTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".message-card");
  card.classList.add(`role-${role}`);
  card.querySelector(".message-role").textContent = role;
  card.querySelector(".message-extra").textContent = extra;
  dom.messageList.prepend(fragment);
  scrollMessagesToTop();
  return card;
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(text) {
  return escapeHtml(text);
}

function sanitizeHref(rawHref) {
  const href = rawHref.trim().replace(/^<|>$/g, "");
  if (!href) {
    return null;
  }
  if (/^(https?:|mailto:|tel:)/i.test(href)) {
    return escapeAttribute(href);
  }
  if (/^(#|\/|\.\/|\.\.\/|\?)/.test(href)) {
    return escapeAttribute(href);
  }
  return null;
}

function normalizeCodeLanguage(info) {
  const language = info.trim().split(/\s+/, 1)[0] ?? "";
  return language.replace(/[^a-z0-9#+.-]/gi, "").toLowerCase();
}

function renderInlineMarkdown(text) {
  const codeSpans = [];
  const codeToken = "\u0000doc-assistant-code\u0000";
  let html = escapeHtml(text);

  html = html.replace(/`([^`\n]+)`/g, (_match, code) => {
    const token = `${codeToken}${codeSpans.length}${codeToken}`;
    codeSpans.push(`<code>${code}</code>`);
    return token;
  });

  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label, rawHref) => {
    const href = sanitizeHref(rawHref);
    const content = label;
    if (!href) {
      return content;
    }
    return `<a href="${href}" target="_blank" rel="noreferrer">${content}</a>`;
  });

  html = html
    .replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/___([^_]+)___/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>")
    .replace(/_([^_\n]+)_/g, "<em>$1</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>")
    .replace(/\n/g, "<br>");

  return html.replace(
    new RegExp(`${codeToken}(\\d+)${codeToken}`, "g"),
    (_match, index) => codeSpans[Number(index)] ?? "",
  );
}

function parseListMarker(line) {
  const unorderedMatch = /^(\s*)([-*+])\s+(.*)$/.exec(line);
  if (unorderedMatch) {
    return {
      ordered: false,
      indent: unorderedMatch[1].length,
      content: unorderedMatch[3],
    };
  }

  const orderedMatch = /^(\s*)(\d+)\.\s+(.*)$/.exec(line);
  if (orderedMatch) {
    return {
      ordered: true,
      indent: orderedMatch[1].length,
      content: orderedMatch[3],
    };
  }

  return null;
}

function isTableSeparator(line) {
  const trimmed = line.trim();
  if (!trimmed.includes("-")) {
    return false;
  }
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(trimmed);
}

function splitTableRow(line) {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function isTableStart(lines, index) {
  if (index + 1 >= lines.length) {
    return false;
  }
  const current = lines[index]?.trim() ?? "";
  const next = lines[index + 1]?.trim() ?? "";
  return current.includes("|") && isTableSeparator(next);
}

function consumeTable(lines, startIndex) {
  const header = splitTableRow(lines[startIndex]);
  let index = startIndex + 2;
  const rows = [];

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim() || !line.includes("|")) {
      break;
    }
    rows.push(splitTableRow(line));
    index += 1;
  }

  const headerHtml = header.map((cell) => `<th>${renderInlineMarkdown(cell)}</th>`).join("");
  const bodyHtml = rows
    .map(
      (row) => `<tr>${row.map((cell) => `<td>${renderInlineMarkdown(cell)}</td>`).join("")}</tr>`,
    )
    .join("");

  return {
    html: `<table><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`,
    nextIndex: index,
  };
}

function consumeList(lines, startIndex) {
  const first = parseListMarker(lines[startIndex]);
  if (!first) {
    return null;
  }

  const tagName = first.ordered ? "ol" : "ul";
  const items = [];
  let index = startIndex;

  while (index < lines.length) {
    const marker = parseListMarker(lines[index]);
    if (!marker || marker.ordered !== first.ordered || marker.indent !== first.indent) {
      break;
    }

    const itemLines = [marker.content];
    index += 1;

    while (index < lines.length) {
      const line = lines[index];
      const nextMarker = parseListMarker(line);
      if (
        nextMarker &&
        nextMarker.indent === first.indent &&
        nextMarker.ordered === first.ordered
      ) {
        break;
      }
      if (nextMarker && nextMarker.indent <= first.indent) {
        break;
      }
      if (!line.trim()) {
        itemLines.push("");
        index += 1;
        continue;
      }
      if (line.trimStart().startsWith(">")) {
        itemLines.push(line.trimStart());
        index += 1;
        continue;
      }
      if (line.length > first.indent) {
        itemLines.push(line.slice(Math.min(line.length, first.indent + 2)));
        index += 1;
        continue;
      }
      break;
    }

    items.push(`<li>${renderMarkdown(itemLines.join("\n"))}</li>`);
  }

  return {
    html: `<${tagName}>${items.join("")}</${tagName}>`,
    nextIndex: index,
  };
}

function isBlockBoundary(lines, index) {
  const line = lines[index] ?? "";
  const trimmed = line.trim();
  return (
    !trimmed ||
    /^ {0,3}#{1,6}\s+/.test(line) ||
    /^ {0,3}(```|~~~)/.test(line) ||
    /^ {0,3}> ?/.test(line) ||
    /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line) ||
    Boolean(parseListMarker(line)) ||
    isTableStart(lines, index)
  );
}

function renderMarkdown(source) {
  const text = source.replace(/\r\n?/g, "\n").trim();
  if (!text) {
    return "";
  }

  const lines = text.split("\n");
  const parts = [];

  for (let index = 0; index < lines.length; ) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    const fenceMatch = /^ {0,3}(```|~~~)\s*(.*)$/.exec(line);
    if (fenceMatch) {
      const fence = fenceMatch[1];
      const language = normalizeCodeLanguage(fenceMatch[2] ?? "");
      const codeLines = [];
      index += 1;
      while (index < lines.length && !new RegExp(`^ {0,3}${fence}\\s*$`).test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      const languageAttr = language ? ` data-language="${escapeAttribute(language)}"` : "";
      const codeClass = language ? ` class="language-${escapeAttribute(language)}"` : "";
      parts.push(
        `<pre${languageAttr}><code${codeClass}>${escapeHtml(codeLines.join("\n"))}</code></pre>`,
      );
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (headingMatch) {
      const level = headingMatch[1].length;
      parts.push(`<h${level}>${renderInlineMarkdown(headingMatch[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      parts.push("<hr>");
      index += 1;
      continue;
    }

    if (isTableStart(lines, index)) {
      const table = consumeTable(lines, index);
      parts.push(table.html);
      index = table.nextIndex;
      continue;
    }

    const list = consumeList(lines, index);
    if (list) {
      parts.push(list.html);
      index = list.nextIndex;
      continue;
    }

    if (/^ {0,3}> ?/.test(line)) {
      const quoteLines = [];
      while (index < lines.length && /^ {0,3}> ?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^ {0,3}> ?/, ""));
        index += 1;
      }
      parts.push(`<blockquote>${renderMarkdown(quoteLines.join("\n"))}</blockquote>`);
      continue;
    }

    const paragraphLines = [line];
    index += 1;
    while (index < lines.length && !isBlockBoundary(lines, index)) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    parts.push(`<p>${renderInlineMarkdown(paragraphLines.join("\n"))}</p>`);
  }

  return parts.join("");
}

function setMessageBody(card, text) {
  const body = card.querySelector(".message-body");
  body.innerHTML = renderMarkdown(text);
  body.classList.toggle("is-empty", !text.trim());
}

function renderRetrieval(card, hits) {
  const container = card.querySelector(".message-retrieval");
  container.innerHTML = "";
  if (!hits || hits.length === 0) {
    return;
  }

  const title = document.createElement("div");
  title.className = "retrieval-title";
  title.textContent = "Retrieved";
  container.appendChild(title);

  const list = document.createElement("div");
  list.className = "retrieval-list";
  for (const hit of hits) {
    const item = document.createElement("div");
    item.className = "retrieval-item";
    item.innerHTML = `
      <strong>${hit.heading ?? "Relevant chunk"}</strong>
      <code>${hit.path}:${hit.startLine}-${hit.endLine}</code>
      <div>${hit.snippet ?? ""}</div>
    `;
    list.appendChild(item);
  }
  container.appendChild(list);
}

function shouldShowRetrieval(result) {
  return result?.summary !== "no relevant documentation found";
}

function renderCitations(card, citations, meta = "") {
  const container = card.querySelector(".message-citations");
  container.innerHTML = "";
  if ((!citations || citations.length === 0) && !meta) {
    return;
  }

  const title = document.createElement("div");
  title.className = "citations-title";
  title.textContent = "Sources";
  container.appendChild(title);

  if (meta) {
    const metaNode = document.createElement("div");
    metaNode.className = "citation-item";
    metaNode.textContent = meta;
    container.appendChild(metaNode);
  }

  if (!citations || citations.length === 0) {
    return;
  }

  const list = document.createElement("div");
  list.className = "citations-list";
  for (const citation of citations) {
    const item = document.createElement("div");
    item.className = "citation-item";
    item.innerHTML = `
      <strong>${citation.heading ?? "Citation"}</strong>
      <code>${citation.path}:${citation.startLine}-${citation.endLine}</code>
      <div>${citation.snippet ?? ""}</div>
    `;
    list.appendChild(item);
  }
  container.appendChild(list);
}

function appendSystemMessage(text) {
  const card = createMessageCard("assistant", formatNow());
  setMessageBody(card, text);
  return card;
}

async function ensureUser() {
  if (state.userId) {
    try {
      await rpc("docs.session.transcript.get", { userId: state.userId });
      updateIdentityLabels();
      return;
    } catch {
      localStorage.removeItem(storageKeys.userId);
      localStorage.removeItem(storageKeys.sessionKey);
      state.userId = "";
      state.sessionKey = "";
    }
  }

  const response = await rpc("docs.user.create");
  if (!response.ok) {
    throw new Error(response.error?.message ?? "Failed to create temp user.");
  }

  state.userId = response.result.userId;
  state.sessionKey = response.result.sessionKey;
  localStorage.setItem(storageKeys.userId, state.userId);
  localStorage.setItem(storageKeys.sessionKey, state.sessionKey);
  updateIdentityLabels();
}

async function loadTranscript() {
  if (!state.userId) {
    return;
  }
  const response = await rpc("docs.session.transcript.get", { userId: state.userId });
  if (!response.ok) {
    return;
  }

  dom.messageList.innerHTML = "";
  for (const message of response.result.messages) {
    const role = message.role === "user" ? "user" : "assistant";
    const card = createMessageCard(role, formatNow());
    setMessageBody(
      card,
      typeof message.content === "string" ? message.content : JSON.stringify(message.content),
    );
  }
}

function ensureRunContext(runId) {
  const runContext = state.pendingRuns.get(runId);
  if (runContext) {
    return runContext;
  }
  const card = createMessageCard("assistant", formatNow());
  const context = {
    card,
    text: "",
    retrieval: [],
  };
  setMessageBody(card, "");
  state.pendingRuns.set(runId, context);
  return context;
}

function handleEvent(frame) {
  if (frame.event === "docs.connected") {
    setConnectionStatus("Connected", true);
    return;
  }

  const data = frame.data ?? {};
  if (!data.runId) {
    return;
  }

  const context = ensureRunContext(data.runId);
  if (frame.event === "docs.retrieval") {
    context.retrieval = data.hits ?? [];
    renderRetrieval(context.card, context.retrieval);
    return;
  }

  if (frame.event === "docs.delta") {
    context.text = data.text ?? "";
    setMessageBody(context.card, context.text);
    scrollMessagesToTop();
    return;
  }

  if (frame.event === "docs.completed") {
    context.text = data.answer ?? context.text;
    setMessageBody(context.card, context.text);
    const meta =
      data.selectedProvider || data.selectedModel
        ? `model: ${data.selectedProvider ?? "unknown"}/${data.selectedModel ?? "unknown"}`
        : (data.summary ?? "");
    renderCitations(context.card, data.citations ?? [], meta);
    renderRetrieval(context.card, shouldShowRetrieval(data) ? context.retrieval : []);
    state.pendingRuns.delete(data.runId);
    dom.askButton.disabled = false;
    dom.newSessionButton.disabled = false;
  }
}

function connect() {
  setConnectionStatus("Connecting", false);
  state.ws = new WebSocket(createWebSocketUrl());

  state.ws.addEventListener("open", async () => {
    setConnectionStatus("Connected", true);
    try {
      await ensureUser();
      await loadTranscript();
    } catch (error) {
      appendSystemMessage(`Failed to initialize temp user: ${String(error)}`);
    }
  });

  state.ws.addEventListener("message", (event) => {
    const frame = JSON.parse(event.data);
    if (frame.id) {
      const pending = state.pendingRequests.get(frame.id);
      if (!pending) {
        return;
      }
      state.pendingRequests.delete(frame.id);
      pending.resolve(frame);
      return;
    }
    handleEvent(frame);
  });

  state.ws.addEventListener("close", () => {
    setConnectionStatus("Disconnected", false);
    window.setTimeout(connect, 1200);
  });

  state.ws.addEventListener("error", () => {
    setConnectionStatus("Connection error", false);
  });
}

async function askQuestion() {
  const question = dom.questionInput.value.trim();
  if (!question) {
    dom.questionInput.focus();
    return;
  }
  if (!state.connected) {
    appendSystemMessage("The WebSocket is still reconnecting. Wait a moment and try again.");
    return;
  }

  await ensureUser();

  const userCard = createMessageCard("user", formatNow());
  setMessageBody(userCard, question);

  dom.askButton.disabled = true;
  dom.newSessionButton.disabled = true;

  const response = await rpc("docs.ask", {
    userId: state.userId,
    question,
    idempotencyKey: globalThis.crypto?.randomUUID?.() ?? `run-${Date.now()}`,
    mode: dom.modeSelect.value,
    maxResults: Number(dom.maxResultsInput.value) || 4,
  });

  if (!response.ok) {
    dom.askButton.disabled = false;
    dom.newSessionButton.disabled = false;
    const errorCard = createMessageCard("assistant", formatNow());
    setMessageBody(errorCard, response.error?.message ?? "The request failed.");
    errorCard.querySelector(".message-body").classList.add("message-error");
    return;
  }

  const runId = response.result.runId;
  ensureRunContext(runId);
  dom.questionInput.value = "";
}

async function startNewSession() {
  localStorage.removeItem(storageKeys.userId);
  localStorage.removeItem(storageKeys.sessionKey);
  state.userId = "";
  state.sessionKey = "";
  state.pendingRuns.clear();
  dom.messageList.innerHTML = "";
  updateIdentityLabels();
  await ensureUser();
}

dom.askButton.addEventListener("click", () => {
  void askQuestion();
});

dom.newSessionButton.addEventListener("click", () => {
  void startNewSession();
});

dom.questionInput.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    void askQuestion();
  }
});

applyQueryPreferences();
updateIdentityLabels();
connect();
