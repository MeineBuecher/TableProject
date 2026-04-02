const SUPABASE_URL = "https://zcpdiudjhzgyqgcsawjc.supabase.co";
const SUPABASE_KEY = "sb_publishable_PYWvX53ZCnSqCDL5iGjDgQ_VD-KN85H";

const client = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const STORAGE_BUCKET = "faceproject-files";

let currentRoom = null;
let currentRoomOwner = null;
let currentParticipantName = null;
let currentParticipantStatus = null;
let currentChannel = null;
let currentWorkerChannel = null;
let currentChatChannel = null;
let currentStorageChannel = null;
let currentScreenChannel = null;
let currentWebRTCChannel = null;
let currentExpertChannel = null;

let localScreenStream = null;
let isSharingScreen = false;
let currentScreenOwner = null;

// Mehrfach-Screens
let localSharedScreens = {};
let remoteScreenStreams = {};

// Experten
let currentRole = "participant"; // owner | expert | participant
let currentExpertInviteToken = null;
let currentExpertInviteLink = "";
let currentExpertSession = null;
let currentExpertTimerInterval = null;

// WebRTC
let peerConnections = {};
let handledSignalIds = new Set();

const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },

    {
      urls: "turn:openrelay.metered.ca:80",
      username: "openrelayproject",
      credential: "openrelayproject"
    },
    {
      urls: "turn:openrelay.metered.ca:443",
      username: "openrelayproject",
      credential: "openrelayproject"
    }
  ]
};

const SAVED_NAME_KEY = "faceproject_name";
const SAVED_ROOM_KEY = "faceproject_room";

let screenSlots = [
  { title: "Hauptscreen", owner: null, stream: null, active: false },
  { title: "Screen 2", owner: null, stream: null, active: false },
  { title: "Screen 3", owner: null, stream: null, active: false },
  { title: "Screen 4", owner: null, stream: null, active: false }
];

function setStatus(text) {
  const el = document.getElementById("status");
  if (el) el.innerText = text;
  console.log(text);
}

function getParticipantsBox() {
  return document.getElementById("participantsBox");
}

function getWorkerBox() {
  return document.getElementById("workerBox");
}

function getOwnerBox() {
  return document.getElementById("ownerBox");
}

function getWorkNowButton() {
  return document.getElementById("workNowBtn");
}

function getPauseWorkButton() {
  return document.getElementById("pauseWorkBtn");
}

function getResumeWorkButton() {
  return document.getElementById("resumeWorkBtn");
}

function getStopWorkButton() {
  return document.getElementById("stopWorkBtn");
}

function getLeaveRoomButton() {
  return document.getElementById("leaveRoomBtn");
}

function getChatMessagesBox() {
  return document.getElementById("chatMessages");
}

function getChatInput() {
  return document.getElementById("chatInput");
}

function getFilesArea() {
  return document.getElementById("filesArea");
}

function getImagesArea() {
  return document.getElementById("imagesArea");
}

function getTextsArea() {
  return document.getElementById("textsArea");
}

function getShareScreenBtn() {
  return document.getElementById("shareScreenBtn");
}

function getExpertPanel() {
  return document.getElementById("expertPanel");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeStoredValue(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeUrl(value) {
  let url = normalizeStoredValue(value);
  if (!url) return "";

  if (
    (url.startsWith('"') && url.endsWith('"')) ||
    (url.startsWith("'") && url.endsWith("'"))
  ) {
    url = url.slice(1, -1).trim();
  }

  return url;
}

function isLikelyImageUrl(url) {
  const testUrl = normalizeUrl(url).toLowerCase();
  return (
    testUrl.startsWith("http://") ||
    testUrl.startsWith("https://") ||
    testUrl.startsWith("blob:") ||
    testUrl.startsWith("data:image/")
  );
}

function parseQueryParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    room: params.get("room") || "",
    expertInvite: params.get("expert_invite") || ""
  };
}

function applyUrlParametersToInputs() {
  const params = parseQueryParams();

  if (params.room) {
    const roomInput = document.getElementById("roomInput");
    if (roomInput) roomInput.value = params.room;
  }

  currentExpertInviteToken = params.expertInvite || null;
}

function buildAppUrlWithParams(roomCode, inviteToken) {
  const url = new URL(window.location.href);
  url.searchParams.set("room", roomCode);
  url.searchParams.set("expert_invite", inviteToken);
  return url.toString();
}

function generateToken(length = 24) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let token = "";
  for (let i = 0; i < length; i += 1) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

function formatCurrency(value) {
  const number = Number(value || 0);
  return number.toLocaleString("de-DE", {
    style: "currency",
    currency: "EUR"
  });
}

function formatDateTime(dateValue) {
  if (!dateValue) return "–";
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "–";
  return date.toLocaleString("de-DE", {
    dateStyle: "short",
    timeStyle: "short"
  });
}

function getMinutesBetween(startedAt, endedAt = null) {
  if (!startedAt) return 0;

  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();

  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 0;

  return Math.ceil((end - start) / 60000);
}

function calculateExpertAmount(hourlyRate, minutes) {
  const rate = Number(hourlyRate || 0);
  const mins = Number(minutes || 0);
  return Number(((rate / 60) * mins).toFixed(2));
}

function clearExpertTimer() {
  if (currentExpertTimerInterval) {
    clearInterval(currentExpertTimerInterval);
    currentExpertTimerInterval = null;
  }
}

function startExpertTimerIfNeeded() {
  clearExpertTimer();

  if (!currentExpertSession || currentExpertSession.status !== "läuft") {
    return;
  }

  currentExpertTimerInterval = setInterval(() => {
    renderExpertPanel();
  }, 1000);
}

function ensureExpertPanel() {
  let panel = getExpertPanel();
  if (panel) return panel;

  panel = document.createElement("div");
  panel.id = "expertPanel";
  panel.style.marginTop = "16px";
  panel.style.padding = "14px";
  panel.style.borderRadius = "14px";
  panel.style.background = "rgba(255,255,255,0.92)";
  panel.style.boxShadow = "0 4px 14px rgba(0,0,0,0.08)";
  panel.style.display = "none";

  const ownerBox = getOwnerBox();
  const participantsBox = getParticipantsBox();

  if (ownerBox && ownerBox.parentNode) {
    ownerBox.parentNode.insertBefore(panel, ownerBox.nextSibling);
  } else if (participantsBox && participantsBox.parentNode) {
    participantsBox.parentNode.insertBefore(panel, participantsBox);
  } else {
    document.body.appendChild(panel);
  }

  return panel;
}

function createExpertButton(text) {
  const btn = document.createElement("button");
  btn.textContent = text;
  btn.style.padding = "10px 14px";
  btn.style.border = "none";
  btn.style.borderRadius = "10px";
  btn.style.cursor = "pointer";
  btn.style.background = "#2f6df6";
  btn.style.color = "#fff";
  btn.style.marginRight = "8px";
  btn.style.marginTop = "8px";
  return btn;
}

function createExpertValueRow(label, value) {
  const row = document.createElement("div");
  row.style.marginBottom = "6px";
  row.innerHTML = `<strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}`;
  return row;
}

function getVisibleExpertSessionValues() {
  if (!currentExpertSession) return null;

  const session = currentExpertSession;
  const isRunning = session.status === "läuft";
  const minutes = isRunning
    ? getMinutesBetween(session.started_at)
    : Number(session.total_minutes || 0);
  const amount = isRunning
    ? calculateExpertAmount(session.hourly_rate, minutes)
    : Number(session.total_amount || 0);

  return {
    ...session,
    visible_minutes: minutes,
    visible_amount: amount
  };
}

function renderExpertPanel() {
  const panel = ensureExpertPanel();
  if (!panel) return;

  if (!currentRoom || !currentParticipantName) {
    panel.style.display = "none";
    panel.innerHTML = "";
    return;
  }

  const isOwner = currentRole === "owner";
  const isExpert = currentRole === "expert";

  if (!isOwner && !isExpert) {
    panel.style.display = "none";
    panel.innerHTML = "";
    return;
  }

  panel.style.display = "block";
  panel.innerHTML = "";

  const title = document.createElement("h3");
  title.textContent = isOwner ? "Expertenbereich" : "Meine Experten-Sitzung";
  title.style.marginTop = "0";
  title.style.marginBottom = "12px";
  panel.appendChild(title);

  if (isOwner) {
    const info = document.createElement("div");
    info.style.marginBottom = "10px";
    info.textContent = "Hier kannst du einen Experten per Link einladen und die Abrechnung live sehen.";
    panel.appendChild(info);

    const createInviteBtn = createExpertButton("Expertenlink erzeugen");
    createInviteBtn.addEventListener("click", async () => {
      await createExpertInvite();
    });
    panel.appendChild(createInviteBtn);

    if (currentExpertInviteLink) {
      const linkWrap = document.createElement("div");
      linkWrap.style.marginTop = "12px";
      linkWrap.style.padding = "10px";
      linkWrap.style.background = "#f5f7ff";
      linkWrap.style.borderRadius = "10px";

      const linkLabel = document.createElement("div");
      linkLabel.style.marginBottom = "6px";
      linkLabel.innerHTML = "<strong>Aktueller Expertenlink:</strong>";
      linkWrap.appendChild(linkLabel);

      const linkField = document.createElement("input");
      linkField.type = "text";
      linkField.readOnly = true;
      linkField.value = currentExpertInviteLink;
      linkField.style.width = "100%";
      linkField.style.boxSizing = "border-box";
      linkField.style.padding = "8px";
      linkField.style.borderRadius = "8px";
      linkField.style.border = "1px solid #d6dcff";
      linkWrap.appendChild(linkField);

      const copyBtn = createExpertButton("Link kopieren");
      copyBtn.style.background = "#2aa36b";
      copyBtn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(currentExpertInviteLink);
          setStatus("Expertenlink wurde kopiert");
        } catch {
          linkField.select();
          document.execCommand("copy");
          setStatus("Expertenlink wurde kopiert");
        }
      });
      linkWrap.appendChild(copyBtn);

      panel.appendChild(linkWrap);
    }
  }

  if (isExpert) {
    const expertInfo = document.createElement("div");
    expertInfo.style.marginBottom = "10px";
    expertInfo.textContent = "Nur du und der Raumersteller sehen deinen Stundensatz und die Sitzungsabrechnung.";
    panel.appendChild(expertInfo);
  }

  const visibleSession = getVisibleExpertSessionValues();

  if (!visibleSession) {
    if (isExpert) {
      const rateLabel = document.createElement("label");
      rateLabel.textContent = "Stundensatz in €";
      rateLabel.style.display = "block";
      rateLabel.style.marginTop = "10px";
      rateLabel.style.marginBottom = "6px";
      panel.appendChild(rateLabel);

      const rateInput = document.createElement("input");
      rateInput.id = "expertRateInput";
      rateInput.type = "number";
      rateInput.step = "0.01";
      rateInput.min = "0";
      rateInput.placeholder = "z. B. 120";
      rateInput.style.width = "100%";
      rateInput.style.boxSizing = "border-box";
      rateInput.style.padding = "10px";
      rateInput.style.borderRadius = "10px";
      rateInput.style.border = "1px solid #ccc";
      panel.appendChild(rateInput);

      const startBtn = createExpertButton("Sitzung starten");
      startBtn.style.background = "#2aa36b";
      startBtn.addEventListener("click", async () => {
        await startExpertSession();
      });
      panel.appendChild(startBtn);
    }

    const noSession = document.createElement("div");
    noSession.style.marginTop = "12px";
    noSession.textContent = "Noch keine Experten-Sitzung aktiv.";
    panel.appendChild(noSession);
    return;
  }

  const card = document.createElement("div");
  card.style.marginTop = "12px";
  card.style.padding = "12px";
  card.style.borderRadius = "12px";
  card.style.background = "#f7f7f7";

  card.appendChild(createExpertValueRow("Experte", visibleSession.expert_name || "–"));
  card.appendChild(createExpertValueRow("Stundensatz", formatCurrency(visibleSession.hourly_rate || 0)));
  card.appendChild(createExpertValueRow("Beginn", formatDateTime(visibleSession.started_at)));
  card.appendChild(createExpertValueRow("Ende", visibleSession.ended_at ? formatDateTime(visibleSession.ended_at) : "läuft"));
  card.appendChild(createExpertValueRow("Dauer", `${visibleSession.visible_minutes} Minuten`));
  card.appendChild(createExpertValueRow("Betrag", formatCurrency(visibleSession.visible_amount)));

  if (visibleSession.status === "beendet") {
    const note = document.createElement("div");
    note.style.marginTop = "8px";
    note.style.fontWeight = "bold";
    note.textContent = `Zu zahlen / in Rechnung zu stellen: ${formatCurrency(visibleSession.visible_amount)}`;
    card.appendChild(note);
  } else {
    const note = document.createElement("div");
    note.style.marginTop = "8px";
    note.style.fontWeight = "bold";
    note.textContent = `Aktueller Zwischenbetrag: ${formatCurrency(visibleSession.visible_amount)}`;
    card.appendChild(note);
  }

  panel.appendChild(card);

  if (isExpert && visibleSession.status === "läuft") {
    const stopBtn = createExpertButton("Sitzung beenden");
    stopBtn.style.background = "#e0573f";
    stopBtn.addEventListener("click", async () => {
      await stopExpertSession();
    });
    panel.appendChild(stopBtn);
  }

  if (isExpert && visibleSession.status === "beendet") {
    const newRateLabel = document.createElement("label");
    newRateLabel.textContent = "Neuen Stundensatz in €";
    newRateLabel.style.display = "block";
    newRateLabel.style.marginTop = "12px";
    newRateLabel.style.marginBottom = "6px";
    panel.appendChild(newRateLabel);

    const newRateInput = document.createElement("input");
    newRateInput.id = "expertRateInput";
    newRateInput.type = "number";
    newRateInput.step = "0.01";
    newRateInput.min = "0";
    newRateInput.value = String(visibleSession.hourly_rate || "");
    newRateInput.style.width = "100%";
    newRateInput.style.boxSizing = "border-box";
    newRateInput.style.padding = "10px";
    newRateInput.style.borderRadius = "10px";
    newRateInput.style.border = "1px solid #ccc";
    panel.appendChild(newRateInput);

    const startNewBtn = createExpertButton("Neue Sitzung starten");
    startNewBtn.style.background = "#2aa36b";
    startNewBtn.addEventListener("click", async () => {
      await startExpertSession();
    });
    panel.appendChild(startNewBtn);
  }
}

async function createExpertInvite() {
  try {
    if (!currentRoom || !currentParticipantName) {
      setStatus("Bitte zuerst Raum beitreten");
      return;
    }

    if (currentRole !== "owner") {
      setStatus("Nur der Raumersteller kann einen Expertenlink erzeugen");
      return;
    }

    const token = generateToken(24);

    const { error } = await client.from("expert_invites").insert([
      {
        room_code: currentRoom,
        owner_name: currentParticipantName,
        token,
        active: true
      }
    ]);

    if (error) {
      setStatus("Expertenlink-Fehler: " + error.message);
      return;
    }

    currentExpertInviteLink = buildAppUrlWithParams(currentRoom, token);
    renderExpertPanel();
    setStatus("Expertenlink wurde erstellt");
  } catch (err) {
    setStatus("JS-Fehler createExpertInvite: " + err.message);
  }
}

async function detectRoleForCurrentRoom() {
  currentRole = "participant";

  if (!currentRoom || !currentParticipantName) {
    return;
  }

  if (currentRoomOwner && currentParticipantName === currentRoomOwner) {
    currentRole = "owner";
    return;
  }

  if (!currentExpertInviteToken) {
    return;
  }

  const { data, error } = await client
    .from("expert_invites")
    .select("*")
    .eq("room_code", currentRoom)
    .eq("token", currentExpertInviteToken)
    .eq("active", true)
    .limit(1);

  if (error) {
    setStatus("Experteneinladung konnte nicht geprüft werden: " + error.message);
    return;
  }

  if (data && data.length > 0) {
    currentRole = "expert";

    const inviteRow = data[0];
    if (!inviteRow.used_at) {
      await client
        .from("expert_invites")
        .update({ used_at: new Date().toISOString() })
        .eq("id", inviteRow.id);
    }
  }
}

async function loadExpertSession() {
  try {
    if (!currentRoom || !currentParticipantName) {
      currentExpertSession = null;
      clearExpertTimer();
      renderExpertPanel();
      return;
    }

    if (currentRole !== "owner" && currentRole !== "expert") {
      currentExpertSession = null;
      clearExpertTimer();
      renderExpertPanel();
      return;
    }

    let query = client
      .from("expert_sessions")
      .select("*")
      .eq("room_code", currentRoom)
      .order("created_at", { ascending: false })
      .limit(1);

    if (currentRole === "expert") {
      query = client
        .from("expert_sessions")
        .select("*")
        .eq("room_code", currentRoom)
        .eq("expert_name", currentParticipantName)
        .order("created_at", { ascending: false })
        .limit(1);

      if (currentExpertInviteToken) {
        query = client
          .from("expert_sessions")
          .select("*")
          .eq("room_code", currentRoom)
          .eq("expert_name", currentParticipantName)
          .eq("invite_token", currentExpertInviteToken)
          .order("created_at", { ascending: false })
          .limit(1);
      }
    }

    const { data, error } = await query;

    if (error) {
      setStatus("Experten-Sitzung Fehler: " + error.message);
      return;
    }

    currentExpertSession = data && data.length > 0 ? data[0] : null;
    startExpertTimerIfNeeded();
    renderExpertPanel();
  } catch (err) {
    setStatus("JS-Fehler loadExpertSession: " + err.message);
  }
}

function subscribeExpertRealtime() {
  try {
    if (!currentRoom) return;

    if (currentExpertChannel) {
      client.removeChannel(currentExpertChannel);
    }

    currentExpertChannel = client
      .channel("expert-" + currentRoom)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "expert_sessions",
          filter: "room_code=eq." + currentRoom
        },
        () => {
          loadExpertSession();
        }
      )
      .subscribe();
  } catch (err) {
    setStatus("JS-Fehler expert realtime: " + err.message);
  }
}

async function startExpertSession() {
  try {
    if (currentRole !== "expert") {
      setStatus("Nur eingeladene Experten können eine Sitzung starten");
      return;
    }

    if (!currentRoom || !currentParticipantName) {
      setStatus("Bitte zuerst Raum beitreten");
      return;
    }

    if (currentExpertSession && currentExpertSession.status === "läuft") {
      setStatus("Deine Sitzung läuft bereits");
      return;
    }

    const rateInput = document.getElementById("expertRateInput");
    const hourlyRate = Number(rateInput ? rateInput.value : 0);

    if (!hourlyRate || hourlyRate <= 0) {
      setStatus("Bitte einen gültigen Stundensatz eingeben");
      return;
    }

    const { error } = await client.from("expert_sessions").insert([
      {
        room_code: currentRoom,
        expert_name: currentParticipantName,
        owner_name: currentRoomOwner || "",
        invite_token: currentExpertInviteToken,
        hourly_rate: hourlyRate,
        started_at: new Date().toISOString(),
        status: "läuft"
      }
    ]);

    if (error) {
      setStatus("Sitzung konnte nicht gestartet werden: " + error.message);
      return;
    }

    setStatus("Experten-Sitzung gestartet");
    await loadExpertSession();
  } catch (err) {
    setStatus("JS-Fehler startExpertSession: " + err.message);
  }
}

async function stopExpertSession() {
  try {
    if (currentRole !== "expert") {
      setStatus("Nur der Experte kann seine Sitzung beenden");
      return;
    }

    if (!currentExpertSession || currentExpertSession.status !== "läuft") {
      setStatus("Es läuft keine Experten-Sitzung");
      return;
    }

    const endedAt = new Date().toISOString();
    const totalMinutes = getMinutesBetween(currentExpertSession.started_at, endedAt);
    const totalAmount = calculateExpertAmount(currentExpertSession.hourly_rate, totalMinutes);

    const { error } = await client
      .from("expert_sessions")
      .update({
        ended_at: endedAt,
        total_minutes: totalMinutes,
        total_amount: totalAmount,
        status: "beendet"
      })
      .eq("id", currentExpertSession.id);

    if (error) {
      setStatus("Sitzung konnte nicht beendet werden: " + error.message);
      return;
    }

    setStatus(`Experten-Sitzung beendet. Betrag: ${formatCurrency(totalAmount)}`);
    await loadExpertSession();
  } catch (err) {
    setStatus("JS-Fehler stopExpertSession: " + err.message);
  }
}

function updateWorkButtons(activeWorkerName) {
  const workBtn = getWorkNowButton();
  const pauseBtn = getPauseWorkButton();
  const resumeBtn = getResumeWorkButton();
  const stopBtn = getStopWorkButton();
  const leaveBtn = getLeaveRoomButton();

  if (leaveBtn) {
    leaveBtn.disabled = !currentRoom || !currentParticipantName;
  }

  if (!workBtn || !pauseBtn || !resumeBtn || !stopBtn) return;

  if (!currentRoom || !currentParticipantName) {
    workBtn.disabled = true;
    pauseBtn.disabled = true;
    resumeBtn.disabled = true;
    stopBtn.disabled = true;
    return;
  }

  if (currentParticipantStatus === "pausiert") {
    workBtn.disabled = true;
    pauseBtn.disabled = true;
    resumeBtn.disabled = false;
    stopBtn.disabled = true;
    return;
  }

  if (!activeWorkerName) {
    workBtn.disabled = false;
    pauseBtn.disabled = false;
    resumeBtn.disabled = true;
    stopBtn.disabled = true;
    return;
  }

  if (activeWorkerName === currentParticipantName) {
    workBtn.disabled = true;
    pauseBtn.disabled = false;
    resumeBtn.disabled = true;
    stopBtn.disabled = false;
    return;
  }

  workBtn.disabled = true;
  pauseBtn.disabled = false;
  resumeBtn.disabled = true;
  stopBtn.disabled = true;
}

function updateShareButton() {
  const btn = getShareScreenBtn();
  if (!btn) return;

  if (!currentRoom || !currentParticipantName) {
    btn.disabled = true;
    btn.textContent = "Freigeben";
    return;
  }

  btn.disabled = false;
  btn.textContent = "Freigeben / Beenden";
}

function closeAllPeerConnections() {
  Object.values(peerConnections).forEach(pc => {
    try {
      pc.close();
    } catch {}
  });
  peerConnections = {};
}

function cleanupChannels() {
  if (currentChannel) {
    client.removeChannel(currentChannel);
    currentChannel = null;
  }

  if (currentWorkerChannel) {
    client.removeChannel(currentWorkerChannel);
    currentWorkerChannel = null;
  }

  if (currentChatChannel) {
    client.removeChannel(currentChatChannel);
    currentChatChannel = null;
  }

  if (currentStorageChannel) {
    client.removeChannel(currentStorageChannel);
    currentStorageChannel = null;
  }

  if (currentScreenChannel) {
    client.removeChannel(currentScreenChannel);
    currentScreenChannel = null;
  }

  if (currentWebRTCChannel) {
    client.removeChannel(currentWebRTCChannel);
    currentWebRTCChannel = null;
  }

  if (currentExpertChannel) {
    client.removeChannel(currentExpertChannel);
    currentExpertChannel = null;
  }

  closeAllPeerConnections();
  handledSignalIds.clear();
}

function loadSavedName() {
  const saved = localStorage.getItem(SAVED_NAME_KEY);
  const input = document.getElementById("nameInput");

  if (saved && input) {
    input.value = saved;
  }
}

function saveName() {
  const input = document.getElementById("nameInput");
  if (!input) return;

  const name = input.value.trim();

  if (name) {
    localStorage.setItem(SAVED_NAME_KEY, name);
  }
}

function clearSavedName() {
  localStorage.removeItem(SAVED_NAME_KEY);
}

function saveRoomSession(roomCode) {
  if (roomCode) {
    localStorage.setItem(SAVED_ROOM_KEY, roomCode);
  }
}

function loadSavedRoom() {
  const savedRoom = localStorage.getItem(SAVED_ROOM_KEY);
  const input = document.getElementById("roomInput");

  if (savedRoom && input) {
    input.value = savedRoom;
  }

  return savedRoom || "";
}

function clearSavedRoom() {
  localStorage.removeItem(SAVED_ROOM_KEY);
}

function getEnteredName() {
  const input = document.getElementById("nameInput");
  const name = input ? input.value.trim() : "";

  if (name) {
    localStorage.setItem(SAVED_NAME_KEY, name);
  }

  return name;
}

function getScreenTitleByIndex(index) {
  if (index === 0) return "Hauptscreen";
  return "Screen " + (index + 1);
}

function resetScreenSlots() {
  screenSlots = [
    { title: "Hauptscreen", owner: null, stream: null, active: false },
    { title: "Screen 2", owner: null, stream: null, active: false },
    { title: "Screen 3", owner: null, stream: null, active: false },
    { title: "Screen 4", owner: null, stream: null, active: false }
  ];
}

function getScreenBoxes() {
  return [
    document.getElementById("primaryScreen"),
    document.getElementById("screenThumb1"),
    document.getElementById("screenThumb2"),
    document.getElementById("screenThumb3")
  ];
}

function attachStreamToScreenBox(box, stream, labelText) {
  if (!box) return;

  const header = box.querySelector(".screen-slot-header");
  const body = box.querySelector(".screen-slot-body");

  if (header) {
    header.textContent = labelText || "";
  }

  if (!body) return;

  body.innerHTML = "";

  const video = document.createElement("video");
  video.srcObject = stream;
  video.autoplay = true;
  video.playsInline = true;
  video.muted = true;
  video.style.width = "100%";
  video.style.height = "100%";
  video.style.objectFit = "contain";
  video.style.borderRadius = "12px";

  body.appendChild(video);
}

function attachPlaceholderToScreenBox(box, title, text) {
  if (!box) return;

  const header = box.querySelector(".screen-slot-header");
  const body = box.querySelector(".screen-slot-body");

  if (header) {
    header.textContent = title;
  }

  if (body) {
    body.innerHTML = `<p>${escapeHtml(text)}</p>`;
  }
}

function renderScreens() {
  const boxes = getScreenBoxes();
  if (boxes.some(box => !box)) return;

  boxes.forEach((box, index) => {
    const slot = screenSlots[index];
    box.classList.remove("screen-active");

    if (slot.active && slot.stream) {
      const ownerText = slot.owner ? ` – ${slot.owner}` : "";
      attachStreamToScreenBox(box, slot.stream, `${slot.title}${ownerText}`);
    } else if (slot.active && !slot.stream) {
      const ownerText = slot.owner ? `${slot.owner} verbindet…` : "Verbindet…";
      attachPlaceholderToScreenBox(box, slot.title, ownerText);
    } else {
      attachPlaceholderToScreenBox(box, slot.title, "Keine Freigabe aktiv");
    }
  });

  boxes[0].classList.add("screen-active");
}

function promoteScreen(index) {
  if (index < 0 || index >= screenSlots.length) return;
  if (index === 0) return;

  const currentMain = screenSlots[0];
  screenSlots[0] = screenSlots[index];
  screenSlots[index] = currentMain;

  renderScreens();
}

function sanitizeFileName(name) {
  return name
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_+/g, "_");
}

function createStoragePath(file, kind) {
  const safeName = sanitizeFileName(file.name || `${kind}_${Date.now()}`);
  const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return `${currentRoom}/${kind}/${unique}_${safeName}`;
}

async function uploadToStorage(file, kind) {
  if (!currentRoom) {
    throw new Error("Kein Raum aktiv");
  }

  const path = createStoragePath(file, kind);

  const { error: uploadError } = await client.storage
    .from(STORAGE_BUCKET)
    .upload(path, file, {
      cacheControl: "3600",
      upsert: false
    });

  if (uploadError) {
    throw uploadError;
  }

  const { data: publicData } = client.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(path);

  if (!publicData || !publicData.publicUrl) {
    throw new Error("Public URL konnte nicht erzeugt werden");
  }

  return {
    path,
    url: publicData.publicUrl
  };
}

async function deleteStorageItem(itemId, storagePath) {
  try {
    if (!itemId) return;

    const confirmDelete = confirm("Diesen Eintrag wirklich löschen?");
    if (!confirmDelete) return;

    if (storagePath) {
      const { error: storageError } = await client.storage
        .from(STORAGE_BUCKET)
        .remove([storagePath]);

      if (storageError) {
        console.warn("Storage-Löschen fehlgeschlagen:", storageError.message);
      }
    }

    const { error: dbError } = await client
      .from("storage_items")
      .delete()
      .eq("id", itemId);

    if (dbError) {
      setStatus("Löschen fehlgeschlagen: " + dbError.message);
      return;
    }

    await loadStorageItems();
    setStatus("Eintrag gelöscht");
  } catch (err) {
    setStatus("JS-Fehler deleteStorageItem: " + err.message);
  }
}

async function upsertParticipantStatus(statusValue) {
  if (!currentRoom || !currentParticipantName) return;

  const { data: existing, error: selectError } = await client
    .from("participants")
    .select("*")
    .eq("room_code", currentRoom)
    .eq("name", currentParticipantName)
    .order("created_at", { ascending: true });

  if (selectError) {
    throw selectError;
  }

  if (existing && existing.length > 0) {
    const firstRow = existing[0];
    const { error: updateError } = await client
      .from("participants")
      .update({ status: statusValue })
      .eq("id", firstRow.id);

    if (updateError) {
      throw updateError;
    }

    if (existing.length > 1) {
      const duplicateIds = existing.slice(1).map((row) => row.id);
      if (duplicateIds.length > 0) {
        await client.from("participants").delete().in("id", duplicateIds);
      }
    }
  } else {
    const { error: insertError } = await client.from("participants").insert([
      {
        room_code: currentRoom,
        name: currentParticipantName,
        status: statusValue
      }
    ]);

    if (insertError) {
      throw insertError;
    }
  }

  currentParticipantStatus = statusValue;
}

async function createRoom() {
  try {
    const name = getEnteredName();

    if (!name) {
      setStatus("Bitte zuerst deinen Namen eingeben");
      return;
    }

    const code = Math.random().toString(36).substring(2, 8).toUpperCase();

    const { error } = await client.from("rooms").insert([
      {
        code: code,
        owner_name: name
      }
    ]);

    if (error) {
      setStatus("Fehler beim Erstellen: " + error.message);
      return;
    }

    const roomInput = document.getElementById("roomInput");
    if (roomInput) {
      roomInput.value = code;
    }

    await joinRoom({ restoring: false });
  } catch (err) {
    setStatus("JS-Fehler createRoom: " + err.message);
  }
}

async function joinRoom(options = {}) {
  const { restoring = false } = options;

  try {
    const roomInput = document.getElementById("roomInput");
    const code = roomInput ? roomInput.value.trim() : "";
    const name = getEnteredName();

    if (!name) {
      setStatus("Bitte zuerst deinen Namen eingeben");
      return;
    }

    if (!code) {
      setStatus("Bitte Raumcode eingeben");
      return;
    }

    const { data, error } = await client
      .from("rooms")
      .select("*")
      .eq("code", code)
      .limit(1);

    if (error) {
      setStatus("Fehler beim Prüfen: " + error.message);
      return;
    }

    if (!data || data.length === 0) {
      setStatus("Raum nicht gefunden");
      return;
    }

    cleanupChannels();

    currentRoom = code;
    currentParticipantName = name;
    currentRoomOwner = data[0].owner_name || null;

    saveRoomSession(code);

    await detectRoleForCurrentRoom();
    await upsertParticipantStatus("online");

    if (restoring) {
      setStatus("Wieder verbunden mit: " + code + " als " + name);
    } else {
      setStatus("Verbunden mit: " + code + " als " + name);
    }

    await loadOwner();
    await loadParticipants();
    await loadWorker();
    await loadChatMessages();
    await loadStorageItems();
    await loadScreenStatus();
    await loadExpertSession();

    subscribeRealtime();
    subscribeWorkerRealtime();
    subscribeChatRealtime();
    subscribeStorageRealtime();
    subscribeScreenRealtime();
    subscribeWebRTCSignals();
    subscribeExpertRealtime();

    updateShareButton();
    renderExpertPanel();
  } catch (err) {
    setStatus("JS-Fehler joinRoom: " + err.message);
  }
}

async function leaveRoom() {
  try {
    if (!currentRoom || !currentParticipantName) {
      setStatus("Du bist in keinem Raum");
      return;
    }

    const leavingRoom = currentRoom;
    const leavingName = currentParticipantName;

    const { data: active, error: activeError } = await client
      .from("active_worker")
      .select("*")
      .eq("room_code", leavingRoom)
      .order("created_at", { ascending: false });

    if (!activeError && active && active.length > 0) {
      const activeWorker = active[0];
      if (activeWorker.worker_name === leavingName) {
        await client
          .from("active_worker")
          .delete()
          .eq("room_code", leavingRoom);
      }
    }

    for (const key of Object.keys(localSharedScreens)) {
      await stopScreenShare(Number(key), true);
    }

    await upsertParticipantStatus("verlassen");

    cleanupChannels();
    clearExpertTimer();

    currentRoom = null;
    currentRoomOwner = null;
    currentParticipantName = null;
    currentParticipantStatus = null;
    currentScreenOwner = null;
    localScreenStream = null;
    isSharingScreen = false;
    localSharedScreens = {};
    remoteScreenStreams = {};
    currentRole = "participant";
    currentExpertSession = null;
    currentExpertInviteLink = "";
    resetScreenSlots();
    clearSavedRoom();

    const ownerBox = getOwnerBox();
    if (ownerBox) ownerBox.innerHTML = "";

    const participantsBox = getParticipantsBox();
    if (participantsBox) participantsBox.innerHTML = "";

    const workerBox = getWorkerBox();
    if (workerBox) workerBox.innerHTML = "<h3>Aktiv:</h3><p>Gerade arbeitet niemand</p>";

    const chatBox = getChatMessagesBox();
    if (chatBox) chatBox.innerHTML = "<p>Noch keine Nachrichten</p>";

    const filesArea = getFilesArea();
    if (filesArea) filesArea.innerHTML = "<p>Noch keine Dateien im Raum</p>";

    const imagesArea = getImagesArea();
    if (imagesArea) imagesArea.innerHTML = "<p>Noch keine Bilder im Raum</p>";

    const textsArea = getTextsArea();
    if (textsArea) textsArea.innerHTML = "<p>Noch keine Texte im Raum</p>";

    renderScreens();
    renderExpertPanel();
    updateWorkButtons(null);
    updateShareButton();
    setStatus("Du hast den Raum verlassen");
  } catch (err) {
    setStatus("JS-Fehler leaveRoom: " + err.message);
  }
}

async function loadOwner() {
  try {
    if (!currentRoom) return;

    const box = getOwnerBox();
    if (!box) return;

    const { data, error } = await client
      .from("rooms")
      .select("*")
      .eq("code", currentRoom)
      .limit(1);

    if (error || !data || data.length === 0) {
      box.innerHTML = "<strong>Raumersteller:</strong><br>Unbekannt";
      return;
    }

    currentRoomOwner = data[0].owner_name || null;
    box.innerHTML = `<strong>Raumersteller:</strong><br>${escapeHtml(data[0].owner_name || "Unbekannt")}`;
  } catch (err) {
    setStatus("JS-Fehler loadOwner: " + err.message);
  }
}

async function loadParticipants() {
  try {
    if (!currentRoom) return;

    const { data, error } = await client
      .from("participants")
      .select("*")
      .eq("room_code", currentRoom)
      .order("created_at", { ascending: true });

    if (error) {
      const box = getParticipantsBox();
      if (box) box.innerHTML = "<p>Fehler beim Laden der Teilnehmer</p>";
      return;
    }

    renderParticipants(data || []);
  } catch (err) {
    setStatus("JS-Fehler loadParticipants: " + err.message);
  }
}

function renderParticipants(list) {
  const box = getParticipantsBox();
  if (!box) return;

  let html = "<h3>Im Raum:</h3>";

  if (!list.length) {
    html += "<p>Noch keine Teilnehmer</p>";
    box.innerHTML = html;
    return;
  }

  const latestByName = new Map();

  list.forEach((p) => {
    latestByName.set(p.name, p);
  });

  latestByName.forEach((p) => {
    if (p.name === currentParticipantName) {
      currentParticipantStatus = p.status || "online";
    }

    const statusText = p.status ? ` – ${escapeHtml(p.status)}` : "";
    html += `<div>${escapeHtml(p.name)}${statusText}</div>`;
  });

  box.innerHTML = html;
}

function subscribeRealtime() {
  try {
    if (!currentRoom) return;

    if (currentChannel) {
      client.removeChannel(currentChannel);
    }

    currentChannel = client
      .channel("room-" + currentRoom)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "participants",
          filter: "room_code=eq." + currentRoom
        },
        async () => {
          await loadParticipants();
          await loadWorker();
        }
      )
      .subscribe();
  } catch (err) {
    setStatus("JS-Fehler realtime: " + err.message);
  }
}

async function workNow() {
  try {
    if (!currentRoom || !currentParticipantName) {
      setStatus("Bitte erst Raum und Namen festlegen");
      return;
    }

    if (currentParticipantStatus === "pausiert") {
      setStatus("Du hast den Raum pausiert. Bitte zuerst Raum fortsetzen.");
      await loadWorker();
      return;
    }

    const { data: active, error: activeError } = await client
      .from("active_worker")
      .select("*")
      .eq("room_code", currentRoom)
      .order("created_at", { ascending: false });

    if (activeError) {
      setStatus("Fehler beim Prüfen: " + activeError.message);
      return;
    }

    if (active && active.length > 0) {
      const currentWorker = active[0].worker_name;

      if (currentWorker !== currentParticipantName) {
        setStatus(currentWorker + " arbeitet gerade. Du kannst erst übernehmen, wenn die Arbeit beendet wurde.");
        await loadWorker();
        return;
      }

      setStatus("Du arbeitest bereits");
      await loadWorker();
      return;
    }

    const { error } = await client.from("active_worker").insert([
      {
        room_code: currentRoom,
        worker_name: currentParticipantName
      }
    ]);

    if (error) {
      setStatus("Fehler beim Setzen: " + error.message);
      return;
    }

    setStatus(currentParticipantName + " arbeitet jetzt");
    await loadWorker();
  } catch (err) {
    setStatus("JS-Fehler workNow: " + err.message);
  }
}

async function pauseWork() {
  try {
    if (!currentRoom || !currentParticipantName) {
      setStatus("Bitte erst Raum und Namen festlegen");
      return;
    }

    if (currentParticipantStatus === "pausiert") {
      setStatus("Du hast den Raum bereits pausiert");
      await loadParticipants();
      await loadWorker();
      return;
    }

    await upsertParticipantStatus("pausiert");

    const { data: active, error: activeError } = await client
      .from("active_worker")
      .select("*")
      .eq("room_code", currentRoom)
      .order("created_at", { ascending: false });

    if (!activeError && active && active.length > 0) {
      const activeWorker = active[0];
      if (activeWorker.worker_name === currentParticipantName) {
        await client
          .from("active_worker")
          .delete()
          .eq("room_code", currentRoom);
      }
    }

    setStatus(currentParticipantName + " hat den Raum pausiert");
    await loadParticipants();
    await loadWorker();
    await loadScreenStatus();
  } catch (err) {
    setStatus("JS-Fehler pauseWork: " + err.message);
  }
}

async function resumeWork() {
  try {
    if (!currentRoom || !currentParticipantName) {
      setStatus("Bitte erst Raum und Namen festlegen");
      return;
    }

    if (currentParticipantStatus !== "pausiert") {
      setStatus("Dein Raum ist nicht pausiert");
      await loadParticipants();
      await loadWorker();
      return;
    }

    await upsertParticipantStatus("online");

    setStatus(currentParticipantName + " ist wieder aktiv im Raum");
    await loadParticipants();
    await loadWorker();
  } catch (err) {
    setStatus("JS-Fehler resumeWork: " + err.message);
  }
}

async function stopWork() {
  try {
    if (!currentRoom || !currentParticipantName) {
      setStatus("Bitte erst Raum und Namen festlegen");
      return;
    }

    const { data, error } = await client
      .from("active_worker")
      .select("*")
      .eq("room_code", currentRoom)
      .order("created_at", { ascending: false });

    if (error) {
      setStatus("Fehler beim Prüfen: " + error.message);
      return;
    }

    if (!data || data.length === 0) {
      setStatus("Gerade arbeitet niemand");
      await loadWorker();
      return;
    }

    const currentWorker = data[0].worker_name;

    if (currentWorker !== currentParticipantName) {
      setStatus("Nur " + currentWorker + " kann die Arbeit beenden");
      await loadWorker();
      return;
    }

    const { error: deleteError } = await client
      .from("active_worker")
      .delete()
      .eq("room_code", currentRoom);

    if (deleteError) {
      setStatus("Fehler beim Beenden: " + deleteError.message);
      return;
    }

    setStatus(currentParticipantName + " hat die Arbeit beendet");
    await loadWorker();
    await loadScreenStatus();
  } catch (err) {
    setStatus("JS-Fehler stopWork: " + err.message);
  }
}

async function loadWorker() {
  try {
    const box = getWorkerBox();
    if (!box || !currentRoom) return;

    const { data, error } = await client
      .from("active_worker")
      .select("*")
      .eq("room_code", currentRoom)
      .order("created_at", { ascending: false });

    if (error) {
      box.innerHTML = "<h3>Aktiv:</h3><p>Arbeitsstatus konnte nicht geladen werden</p>";
      updateWorkButtons(null);
      return;
    }

    if (!data || data.length === 0) {
      box.innerHTML = "<h3>Aktiv:</h3><p>Gerade arbeitet niemand</p>";
      updateWorkButtons(null);
      return;
    }

    const activeWorkerName = data[0].worker_name;

    box.innerHTML = `<h3>Aktiv:</h3><p>${escapeHtml(activeWorkerName)}</p>`;
    updateWorkButtons(activeWorkerName);
  } catch (err) {
    setStatus("JS-Fehler loadWorker: " + err.message);
    updateWorkButtons(null);
  }
}

function subscribeWorkerRealtime() {
  try {
    if (!currentRoom) return;

    if (currentWorkerChannel) {
      client.removeChannel(currentWorkerChannel);
    }

    currentWorkerChannel = client
      .channel("worker-" + currentRoom)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "active_worker",
          filter: "room_code=eq." + currentRoom
        },
        () => {
          loadWorker();
        }
      )
      .subscribe();
  } catch (err) {
    setStatus("JS-Fehler worker realtime: " + err.message);
  }
}

async function sendChatMessage() {
  try {
    if (!currentRoom || !currentParticipantName) {
      setStatus("Bitte erst Raum beitreten");
      return;
    }

    const input = getChatInput();
    if (!input) return;

    const message = input.value.trim();

    if (!message) return;

    const { error } = await client.from("chat_messages").insert([
      {
        room_code: currentRoom,
        sender_name: currentParticipantName,
        message: message
      }
    ]);

    if (error) {
      setStatus("Chat-Fehler: " + error.message);
      return;
    }

    input.value = "";
    await loadChatMessages();
  } catch (err) {
    setStatus("JS-Fehler sendChatMessage: " + err.message);
  }
}

async function loadChatMessages() {
  try {
    if (!currentRoom) return;

    const box = getChatMessagesBox();
    if (!box) return;

    const { data, error } = await client
      .from("chat_messages")
      .select("*")
      .eq("room_code", currentRoom)
      .order("created_at", { ascending: true });

    if (error) {
      box.innerHTML = "<p>Chat konnte nicht geladen werden</p>";
      return;
    }

    if (!data || data.length === 0) {
      box.innerHTML = "<p>Noch keine Nachrichten</p>";
      return;
    }

    box.innerHTML = data.map(msg => `
      <div class="chat-message">
        <strong>${escapeHtml(msg.sender_name)}</strong>
        <div>${escapeHtml(msg.message)}</div>
      </div>
    `).join("");

    box.scrollTop = box.scrollHeight;
  } catch (err) {
    setStatus("JS-Fehler loadChatMessages: " + err.message);
  }
}

function subscribeChatRealtime() {
  try {
    if (!currentRoom) return;

    if (currentChatChannel) {
      client.removeChannel(currentChatChannel);
    }

    currentChatChannel = client
      .channel("chat-" + currentRoom)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "chat_messages",
          filter: "room_code=eq." + currentRoom
        },
        () => {
          loadChatMessages();
        }
      )
      .subscribe();
  } catch (err) {
    setStatus("JS-Fehler chat realtime: " + err.message);
  }
}

function createDeleteButton(itemId, storagePath) {
  const btn = document.createElement("button");
  btn.textContent = "Löschen";
  btn.style.marginTop = "8px";
  btn.style.padding = "8px 12px";
  btn.style.border = "none";
  btn.style.borderRadius = "10px";
  btn.style.background = "#ff5a3c";
  btn.style.color = "#fff";
  btn.style.cursor = "pointer";
  btn.addEventListener("click", async () => {
    await deleteStorageItem(itemId, storagePath);
  });
  return btn;
}

function renderFileItemsToDom(fileItems, container) {
  container.innerHTML = "";

  if (!fileItems.length) {
    container.innerHTML = "<p>Noch keine Dateien im Raum</p>";
    return;
  }

  fileItems.forEach(item => {
    const wrapper = document.createElement("div");
    wrapper.style.marginBottom = "12px";
    wrapper.style.padding = "12px";
    wrapper.style.background = "#fff";
    wrapper.style.borderRadius = "12px";

    const link = document.createElement("a");
    link.href = normalizeUrl(item.content || "#");
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = item.file_name || "Datei öffnen";

    wrapper.appendChild(link);
    wrapper.appendChild(createDeleteButton(item.id, item.storage_path || ""));
    container.appendChild(wrapper);
  });
}

function renderImageItemsToDom(imageItems, container) {
  container.innerHTML = "";

  if (!imageItems.length) {
    container.innerHTML = "<p>Noch keine Bilder im Raum</p>";
    return;
  }

  imageItems.forEach(item => {
    const wrapper = document.createElement("div");
    wrapper.style.marginBottom = "12px";
    wrapper.style.padding = "12px";
    wrapper.style.background = "#fff";
    wrapper.style.borderRadius = "12px";

    const url = normalizeUrl(item.content || "");

    if (!url || !isLikelyImageUrl(url)) {
      const msg = document.createElement("div");
      msg.textContent = "Bild-URL ungültig";
      msg.style.color = "#666";
      wrapper.appendChild(msg);
      wrapper.appendChild(createDeleteButton(item.id, item.storage_path || ""));
      container.appendChild(wrapper);
      return;
    }

    const img = document.createElement("img");
    img.src = url;
    img.alt = item.file_name || "Bild";
    img.style.maxWidth = "100%";
    img.style.width = "100%";
    img.style.borderRadius = "12px";
    img.style.display = "block";
    img.style.marginBottom = "8px";

    img.onerror = () => {
      wrapper.innerHTML = "";
      const msg = document.createElement("div");
      msg.textContent = "Bild konnte nicht geladen werden";
      msg.style.color = "#666";
      msg.style.marginBottom = "8px";
      wrapper.appendChild(msg);
      wrapper.appendChild(createDeleteButton(item.id, item.storage_path || ""));
    };

    wrapper.appendChild(img);
    wrapper.appendChild(createDeleteButton(item.id, item.storage_path || ""));
    container.appendChild(wrapper);
  });
}

function renderTextItemsToDom(textItems, container) {
  container.innerHTML = "";

  if (!textItems.length) {
    container.innerHTML = "<p>Noch keine Texte im Raum</p>";
    return;
  }

  textItems.forEach(item => {
    const wrapper = document.createElement("div");
    wrapper.style.marginBottom = "12px";
    wrapper.style.padding = "12px";
    wrapper.style.background = "#fff";
    wrapper.style.borderRadius = "12px";

    const text = document.createElement("div");
    text.style.whiteSpace = "pre-wrap";
    text.textContent = item.content || "";

    wrapper.appendChild(text);
    wrapper.appendChild(createDeleteButton(item.id, item.storage_path || ""));
    container.appendChild(wrapper);
  });
}

async function loadStorageItems() {
  try {
    if (!currentRoom) return;

    const { data, error } = await client
      .from("storage_items")
      .select("*")
      .eq("room_code", currentRoom)
      .order("created_at", { ascending: true });

    const files = getFilesArea();
    const images = getImagesArea();
    const texts = getTextsArea();

    if (!files || !images || !texts) return;

    if (error) {
      files.innerHTML = "<p>Fehler beim Laden</p>";
      images.innerHTML = "<p>Fehler beim Laden</p>";
      texts.innerHTML = "<p>Fehler beim Laden</p>";
      return;
    }

    const items = data || [];
    const fileItems = items.filter(item => item.type === "file");
    const imageItems = items.filter(item => item.type === "image");
    const textItems = items.filter(item => item.type === "text");

    renderFileItemsToDom(fileItems, files);
    renderImageItemsToDom(imageItems, images);
    renderTextItemsToDom(textItems, texts);
  } catch (err) {
    setStatus("JS-Fehler loadStorageItems: " + err.message);
  }
}

function subscribeStorageRealtime() {
  try {
    if (!currentRoom) return;

    if (currentStorageChannel) {
      client.removeChannel(currentStorageChannel);
    }

    currentStorageChannel = client
      .channel("storage-" + currentRoom)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "storage_items",
          filter: "room_code=eq." + currentRoom
        },
        () => {
          loadStorageItems();
        }
      )
      .subscribe();
  } catch (err) {
    setStatus("JS-Fehler storage realtime: " + err.message);
  }
}

/* ================= SCREEN SHARE ================= */

function syncLegacyScreenFlags() {
  const slotIndexes = Object.keys(localSharedScreens);
  isSharingScreen = slotIndexes.length > 0;
  if (isSharingScreen) {
    const firstSlot = Number(slotIndexes[0]);
    localScreenStream = localSharedScreens[firstSlot]?.stream || null;
    currentScreenOwner = currentParticipantName;
  } else {
    localScreenStream = null;
    currentScreenOwner = null;
  }
}

async function loadScreenStatus() {
  try {
    if (!currentRoom) return;

    const { data, error } = await client
      .from("screen_share")
      .select("*")
      .eq("room_code", currentRoom)
      .eq("active", true)
      .order("slot_index", { ascending: true });

    if (error) {
      setStatus("Screen-Status Fehler: " + error.message);
      return;
    }

    const activeShares = data || [];
    const activeKeys = new Set(activeShares.map(share => `${share.owner}_${share.slot_index}`));

    Object.keys(remoteScreenStreams).forEach(key => {
      if (!activeKeys.has(key)) {
        delete remoteScreenStreams[key];
      }
    });

    Object.keys(peerConnections).forEach(key => {
      const isLocalSenderConnection = Object.keys(localSharedScreens).some(slotIndex => key.endsWith(`_${slotIndex}`));
      if (!activeKeys.has(key) && !isLocalSenderConnection) {
        try {
          peerConnections[key].close();
        } catch {}
        delete peerConnections[key];
      }
    });

    resetScreenSlots();

    for (let i = 0; i < 4; i++) {
      const share = activeShares.find(row => Number(row.slot_index) === i);
      if (!share) continue;

      screenSlots[i].title = getScreenTitleByIndex(i);
      screenSlots[i].owner = share.owner;
      screenSlots[i].active = true;

      if (share.owner === currentParticipantName && localSharedScreens[i]?.stream) {
        screenSlots[i].stream = localSharedScreens[i].stream;
      } else {
        const remoteKey = `${share.owner}_${i}`;
        screenSlots[i].stream = remoteScreenStreams[remoteKey] || null;
      }
    }

    renderScreens();

    for (let i = 0; i < 4; i++) {
      const share = activeShares.find(row => Number(row.slot_index) === i);
      if (!share) continue;

      if (share.owner !== currentParticipantName) {
        const key = `${share.owner}_${i}`;
        if (!peerConnections[key]) {
          setTimeout(() => {
            announceViewerReady(share.owner, i);
          }, 300);
        }
      }
    }

    syncLegacyScreenFlags();
    updateShareButton();
  } catch (err) {
    setStatus("JS-Fehler loadScreenStatus: " + err.message);
  }
}

function subscribeScreenRealtime() {
  try {
    if (!currentRoom) return;

    if (currentScreenChannel) {
      client.removeChannel(currentScreenChannel);
    }

    currentScreenChannel = client
      .channel("screen-" + currentRoom)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "screen_share",
          filter: "room_code=eq." + currentRoom
        },
        () => {
          loadScreenStatus();
        }
      )
      .subscribe();
  } catch (err) {
    setStatus("JS-Fehler screen realtime: " + err.message);
  }
}

/* ================= WEBRTC ================= */

function createPeerConnectionKey(name, slotIndex) {
  return `${name}_${slotIndex}`;
}

async function announceViewerReady(ownerName, slotIndex) {
  if (!currentRoom || !currentParticipantName || !ownerName) return;
  if (ownerName === currentParticipantName) return;
  if (peerConnections[createPeerConnectionKey(ownerName, slotIndex)]) return;

  const { error } = await client.from("webrtc_signals").insert([
    {
      room_code: currentRoom,
      sender: currentParticipantName,
      target: ownerName,
      type: "viewer_ready",
      payload: {
        viewer: currentParticipantName,
        slot_index: slotIndex
      }
    }
  ]);

  if (error) {
    setStatus("Viewer-Signal Fehler: " + error.message);
  }
}

function createSenderPeerConnection(viewerName, slotIndex) {
  const pc = new RTCPeerConnection(RTC_CONFIG);
  const key = createPeerConnectionKey(viewerName, slotIndex);
  const localEntry = localSharedScreens[slotIndex];

  if (localEntry && localEntry.stream) {
    localEntry.stream.getTracks().forEach(track => {
      pc.addTrack(track, localEntry.stream);
    });
  }

  pc.onicecandidate = async (event) => {
    if (!event.candidate) return;

    await client.from("webrtc_signals").insert([
      {
        room_code: currentRoom,
        sender: currentParticipantName,
        target: viewerName,
        type: "candidate",
        payload: {
          candidate: event.candidate,
          slot_index: slotIndex
        }
      }
    ]);
  };

  peerConnections[key] = pc;
  return pc;
}

function createViewerPeerConnection(ownerName, slotIndex) {
  const pc = new RTCPeerConnection(RTC_CONFIG);
  const key = createPeerConnectionKey(ownerName, slotIndex);

  pc.ontrack = (event) => {
    const stream = event.streams && event.streams[0] ? event.streams[0] : null;
    if (stream) {
      remoteScreenStreams[key] = stream;

      if (screenSlots[slotIndex]) {
        screenSlots[slotIndex].stream = stream;
        screenSlots[slotIndex].active = true;
        screenSlots[slotIndex].owner = ownerName;
        screenSlots[slotIndex].title = getScreenTitleByIndex(slotIndex);
      }

      renderScreens();
    }
  };

  pc.onicecandidate = async (event) => {
    if (!event.candidate) return;

    await client.from("webrtc_signals").insert([
      {
        room_code: currentRoom,
        sender: currentParticipantName,
        target: ownerName,
        type: "candidate",
        payload: {
          candidate: event.candidate,
          slot_index: slotIndex
        }
      }
    ]);
  };

  peerConnections[key] = pc;
  return pc;
}

async function handleViewerReadySignal(signal) {
  if (signal.target !== currentParticipantName) return;

  const viewerName = signal.sender;
  const slotIndex = signal.payload?.slot_index;

  if (slotIndex === undefined || slotIndex === null) return;
  if (!localSharedScreens[slotIndex]?.stream) return;

  let pc = peerConnections[createPeerConnectionKey(viewerName, slotIndex)];

  if (!pc) {
    pc = createSenderPeerConnection(viewerName, slotIndex);
  }

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  await client.from("webrtc_signals").insert([
    {
      room_code: currentRoom,
      sender: currentParticipantName,
      target: viewerName,
      type: "offer",
      payload: {
        offer,
        slot_index: slotIndex
      }
    }
  ]);
}

async function handleOfferSignal(signal) {
  if (signal.target !== currentParticipantName) return;
  if (signal.sender === currentParticipantName) return;

  const slotIndex = signal.payload?.slot_index;
  const offer = signal.payload?.offer;

  if (slotIndex === undefined || !offer) return;

  currentScreenOwner = signal.sender;

  let pc = peerConnections[createPeerConnectionKey(signal.sender, slotIndex)];
  if (!pc) {
    pc = createViewerPeerConnection(signal.sender, slotIndex);
  }

  await pc.setRemoteDescription(new RTCSessionDescription(offer));

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  await client.from("webrtc_signals").insert([
    {
      room_code: currentRoom,
      sender: currentParticipantName,
      target: signal.sender,
      type: "answer",
      payload: {
        answer,
        slot_index: slotIndex
      }
    }
  ]);
}

async function handleAnswerSignal(signal) {
  if (signal.target !== currentParticipantName) return;

  const slotIndex = signal.payload?.slot_index;
  const answer = signal.payload?.answer;
  const viewerName = signal.sender;

  if (slotIndex === undefined || !answer) return;

  const pc = peerConnections[createPeerConnectionKey(viewerName, slotIndex)];
  if (!pc) return;

  await pc.setRemoteDescription(new RTCSessionDescription(answer));
}

async function handleCandidateSignal(signal) {
  if (signal.target !== currentParticipantName) return;

  const slotIndex = signal.payload?.slot_index;
  const candidate = signal.payload?.candidate;
  const peerName = signal.sender;

  if (slotIndex === undefined || !candidate) return;

  const pc = peerConnections[createPeerConnectionKey(peerName, slotIndex)];
  if (!pc) return;

  try {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (err) {
    setTimeout(async () => {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {}
    }, 300);
  }
}

async function handleWebRTCSignal(signal) {
  if (!signal || handledSignalIds.has(signal.id)) return;
  handledSignalIds.add(signal.id);

  if (signal.type === "viewer_ready") {
    await handleViewerReadySignal(signal);
    return;
  }

  if (signal.type === "offer") {
    await handleOfferSignal(signal);
    return;
  }

  if (signal.type === "answer") {
    await handleAnswerSignal(signal);
    return;
  }

  if (signal.type === "candidate") {
    await handleCandidateSignal(signal);
  }
}

function subscribeWebRTCSignals() {
  try {
    if (!currentRoom) return;

    if (currentWebRTCChannel) {
      client.removeChannel(currentWebRTCChannel);
    }

    client
      .from("webrtc_signals")
      .delete()
      .eq("room_code", currentRoom);

    currentWebRTCChannel = client
      .channel("webrtc-" + currentRoom)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "webrtc_signals",
          filter: "room_code=eq." + currentRoom
        },
        async (payload) => {
          const signal = payload.new;
          await handleWebRTCSignal(signal);
        }
      )
      .subscribe();
  } catch (err) {
    setStatus("JS-Fehler webrtc realtime: " + err.message);
  }
}

async function startScreenShare(slotIndex = null) {
  try {
    if (!currentRoom || !currentParticipantName) {
      setStatus("Bitte erst Raum und Namen festlegen");
      return;
    }

    if (slotIndex === null) {
      const input = prompt("Welchen Screen belegen? 1 bis 4", "1");
      if (!input) return;

      const parsed = parseInt(input, 10);
      if (isNaN(parsed) || parsed < 1 || parsed > 4) {
        setStatus("Bitte 1 bis 4 eingeben");
        return;
      }

      slotIndex = parsed - 1;
    }

    const existingLocal = localSharedScreens[slotIndex];
    if (existingLocal?.stream) {
      setStatus("Dieser Slot wird von dir bereits geteilt");
      return;
    }

    const localStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false
    });

    localSharedScreens[slotIndex] = {
      stream: localStream
    };

    screenSlots[slotIndex] = {
      title: getScreenTitleByIndex(slotIndex),
      owner: currentParticipantName,
      stream: localStream,
      active: true
    };

    renderScreens();
    syncLegacyScreenFlags();
    updateShareButton();

    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.addEventListener("ended", () => {
        stopScreenShare(slotIndex, true);
      });
    }

    await client
      .from("screen_share")
      .delete()
      .eq("room_code", currentRoom)
      .eq("owner", currentParticipantName)
      .eq("slot_index", slotIndex);

    const { error: insertError } = await client
      .from("screen_share")
      .insert([
        {
          room_code: currentRoom,
          owner: currentParticipantName,
          slot_index: slotIndex,
          active: true
        }
      ]);

    if (insertError) {
      setStatus("Fehler beim Starten der Freigabe: " + insertError.message);
      return;
    }

    setStatus(`Bildschirm auf Slot ${slotIndex + 1} wird geteilt`);
  } catch (err) {
    setStatus("Screen Fehler: " + err.message);
  }
}

async function stopScreenShare(slotIndex = null, silent = false) {
  try {
    if (slotIndex === null) {
      const input = prompt("Welchen Screen beenden? 1 bis 4", "1");
      if (!input) return;

      const parsed = parseInt(input, 10);
      if (isNaN(parsed) || parsed < 1 || parsed > 4) {
        setStatus("Bitte 1 bis 4 eingeben");
        return;
      }

      slotIndex = parsed - 1;
    }

    const localEntry = localSharedScreens[slotIndex];
    if (localEntry?.stream) {
      localEntry.stream.getTracks().forEach(track => track.stop());
      delete localSharedScreens[slotIndex];
    }

    screenSlots[slotIndex] = {
      title: getScreenTitleByIndex(slotIndex),
      owner: null,
      stream: null,
      active: false
    };

    Object.keys(peerConnections).forEach(key => {
      if (key.endsWith(`_${slotIndex}`)) {
        try {
          peerConnections[key].close();
        } catch {}
        delete peerConnections[key];
      }
    });

    Object.keys(remoteScreenStreams).forEach(key => {
      if (key.endsWith(`_${slotIndex}`)) {
        delete remoteScreenStreams[key];
      }
    });

    if (currentRoom && currentParticipantName) {
      await client
        .from("screen_share")
        .delete()
        .eq("room_code", currentRoom)
        .eq("owner", currentParticipantName)
        .eq("slot_index", slotIndex);
    }

    renderScreens();
    syncLegacyScreenFlags();
    await loadScreenStatus();
    updateShareButton();

    if (!silent) {
      setStatus(`Bildschirmfreigabe auf Slot ${slotIndex + 1} beendet`);
    }
  } catch (err) {
    setStatus("JS-Fehler stopScreenShare: " + err.message);
  }
}

async function toggleScreenShare() {
  const input = prompt("Screen wählen: 1 bis 4", "1");
  if (!input) return;

  const parsed = parseInt(input, 10);
  if (isNaN(parsed) || parsed < 1 || parsed > 4) {
    setStatus("Bitte 1 bis 4 eingeben");
    return;
  }

  const slotIndex = parsed - 1;

  if (localSharedScreens[slotIndex]?.stream) {
    await stopScreenShare(slotIndex);
  } else {
    await startScreenShare(slotIndex);
  }
}

function clearNameOnly() {
  clearSavedName();
  const input = document.getElementById("nameInput");
  if (input) input.value = "";
  setStatus("Gespeicherter Name wurde gelöscht");
}

async function restorePreviousSession() {
  try {
    loadSavedName();
    loadSavedRoom();
    applyUrlParametersToInputs();

    const savedRoom = document.getElementById("roomInput")?.value?.trim() || "";
    const savedName = localStorage.getItem(SAVED_NAME_KEY);

    if (!savedRoom || !savedName) {
      updateWorkButtons(null);
      updateShareButton();
      renderExpertPanel();
      return;
    }

    const roomInput = document.getElementById("roomInput");
    if (roomInput) {
      roomInput.value = savedRoom;
    }

    const nameInput = document.getElementById("nameInput");
    if (nameInput) {
      nameInput.value = savedName;
    }

    await joinRoom({ restoring: true });
  } catch (err) {
    setStatus("JS-Fehler restorePreviousSession: " + err.message);
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  loadSavedName();
  loadSavedRoom();
  applyUrlParametersToInputs();
  renderScreens();
  ensureExpertPanel();
  renderExpertPanel();

  const nameInput = document.getElementById("nameInput");
  if (nameInput) {
    nameInput.addEventListener("input", saveName);
  }

  const uploadFileBtn = document.getElementById("uploadFileBtn");
  if (uploadFileBtn) {
    uploadFileBtn.addEventListener("click", async () => {
      try {
        if (!currentRoom) {
          setStatus("Bitte erst einem Raum beitreten");
          return;
        }

        const input = document.createElement("input");
        input.type = "file";

        input.onchange = async () => {
          const file = input.files[0];
          if (!file) return;

          setStatus("Datei wird hochgeladen...");

          const uploaded = await uploadToStorage(file, "file");

          const { error } = await client.from("storage_items").insert([{
            room_code: currentRoom,
            type: "file",
            content: uploaded.url,
            file_name: file.name,
            storage_path: uploaded.path
          }]);

          if (error) {
            setStatus("Datei-Fehler: " + error.message);
            return;
          }

          await loadStorageItems();
          setStatus("Datei hochgeladen");
        };

        input.click();
      } catch (err) {
        setStatus("Datei-Fehler: " + err.message);
      }
    });
  }

  const uploadImageBtn = document.getElementById("uploadImageBtn");
  if (uploadImageBtn) {
    uploadImageBtn.addEventListener("click", async () => {
      try {
        if (!currentRoom) {
          setStatus("Bitte erst einem Raum beitreten");
          return;
        }

        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.capture = "environment";

        input.onchange = async () => {
          const file = input.files[0];
          if (!file) return;

          setStatus("Bild wird hochgeladen...");

          const uploaded = await uploadToStorage(file, "image");

          const { error } = await client.from("storage_items").insert([{
            room_code: currentRoom,
            type: "image",
            content: uploaded.url,
            file_name: file.name,
            storage_path: uploaded.path
          }]);

          if (error) {
            setStatus("Bild-Fehler: " + error.message);
            return;
          }

          await loadStorageItems();
          setStatus("Bild hochgeladen");
        };

        input.click();
      } catch (err) {
        setStatus("Bild-Fehler: " + err.message);
      }
    });
  }

  const addTextBtn = document.getElementById("addTextBtn");
  if (addTextBtn) {
    addTextBtn.addEventListener("click", async () => {
      if (!currentRoom) {
        setStatus("Bitte erst einem Raum beitreten");
        return;
      }

      const text = prompt("Text eingeben:");

      if (!text) return;

      const { error } = await client.from("storage_items").insert([{
        room_code: currentRoom,
        type: "text",
        content: text
      }]);

      if (error) {
        setStatus("Text-Fehler: " + error.message);
        return;
      }

      await loadStorageItems();
    });
  }

  const shareScreenBtn = getShareScreenBtn();
  if (shareScreenBtn) {
    shareScreenBtn.addEventListener("click", async () => {
      if (!currentRoom) {
        setStatus("Bitte erst einem Raum beitreten");
        return;
      }

      await toggleScreenShare();
    });
  }

  updateWorkButtons(null);
  updateShareButton();

  await restorePreviousSession();
});
