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

function setMessageBody(card, text) {
  const body = card.querySelector(".message-body");
  body.textContent = text;
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
    setMessageBody(card, typeof message.content === "string" ? message.content : JSON.stringify(message.content));
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
    const meta = data.selectedProvider || data.selectedModel
      ? `model: ${data.selectedProvider ?? "unknown"}/${data.selectedModel ?? "unknown"}`
      : data.summary ?? "";
    renderCitations(context.card, data.citations ?? [], meta);
    renderRetrieval(context.card, context.retrieval);
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
