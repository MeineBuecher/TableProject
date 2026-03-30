const SUPABASE_URL = "https://zcpdiudjhzgyqgcsawjc.supabase.co";
const SUPABASE_KEY = "sb_publishable_PYWvX53ZCnSqCDL5iGjDgQ_VD-KN85H";

const client = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const STORAGE_BUCKET = "faceproject-files";

let currentRoom = null;
let currentParticipantName = null;
let currentParticipantStatus = null;
let currentChannel = null;
let currentWorkerChannel = null;
let currentChatChannel = null;
let currentStorageChannel = null;
let currentScreenChannel = null;
let currentWebRTCChannel = null;

let localScreenStream = null;
let isSharingScreen = false;
let currentScreenOwner = null;

// WebRTC
let peerConnections = {};
let handledSignalIds = new Set();

const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
  ]
};

const SAVED_NAME_KEY = "faceproject_name";
const SAVED_ROOM_KEY = "faceproject_room";

let screenSlots = [
  { title: "Hauptscreen", content: "Keine Freigabe aktiv" },
  { title: "Screen 2", content: "Keine Freigabe aktiv" },
  { title: "Screen 3", content: "Keine Freigabe aktiv" },
  { title: "Screen 4", content: "Keine Freigabe aktiv" }
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
  btn.textContent = isSharingScreen ? "Freigabe beenden" : "Freigeben";
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

function renderScreens() {
  const primary = document.getElementById("primaryScreen");
  const thumb1 = document.getElementById("screenThumb1");
  const thumb2 = document.getElementById("screenThumb2");
  const thumb3 = document.getElementById("screenThumb3");

  if (!primary || !thumb1 || !thumb2 || !thumb3) return;

  const boxes = [primary, thumb1, thumb2, thumb3];

  boxes.forEach((box, index) => {
    const header = box.querySelector(".screen-slot-header");
    const body = box.querySelector(".screen-slot-body");

    if (header) {
      header.textContent = screenSlots[index].title;
    }

    if (body) {
      body.innerHTML = `<p>${screenSlots[index].content}</p>`;
    }

    box.classList.remove("screen-active");
  });

  primary.classList.add("screen-active");
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

    saveRoomSession(code);

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

    subscribeRealtime();
    subscribeWorkerRealtime();
    subscribeChatRealtime();
    subscribeStorageRealtime();
    subscribeScreenRealtime();
    subscribeWebRTCSignals();

    updateShareButton();
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

    if (isSharingScreen) {
      await stopScreenShare(true);
    }

    await upsertParticipantStatus("verlassen");

    cleanupChannels();

    currentRoom = null;
    currentParticipantName = null;
    currentParticipantStatus = null;
    currentScreenOwner = null;
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

    box.innerHTML = `<strong>Raumersteller:</strong><br>${data[0].owner_name || "Unbekannt"}`;
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

    const statusText = p.status ? ` – ${p.status}` : "";
    html += `<div>${p.name}${statusText}</div>`;
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

    if (isSharingScreen) {
      await stopScreenShare(true);
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

    if (isSharingScreen) {
      await stopScreenShare(true);
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

    box.innerHTML = `<h3>Aktiv:</h3><p>${activeWorkerName}</p>`;
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
        <strong>${msg.sender_name}</strong>
        <div>${msg.message}</div>
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

function renderFileItems(fileItems) {
  if (!fileItems.length) {
    return "<p>Noch keine Dateien im Raum</p>";
  }

  return fileItems.map(item => {
    const safeUrl = item.content || "#";
    const label = item.file_name || "Datei öffnen";
    return `
      <div style="margin-bottom:10px;">
        <a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${label}</a>
      </div>
    `;
  }).join("");
}

function renderImageItems(imageItems) {
  if (!imageItems.length) {
    return "<p>Noch keine Bilder im Raum</p>";
  }

  return imageItems.map(item => {
    const safeUrl = item.content || "";
    const altText = item.file_name || "Bild";
    return `
      <div style="margin-bottom:12px;">
        <img src="${safeUrl}" alt="${altText}" style="max-width:100%; border-radius:12px; display:block;">
      </div>
    `;
  }).join("");
}

function renderTextItems(textItems) {
  if (!textItems.length) {
    return "<p>Noch keine Texte im Raum</p>";
  }

  return textItems.map(item => {
    const text = item.content || "";
    return `<div style="margin-bottom:10px; white-space:pre-wrap;">${text}</div>`;
  }).join("");
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

    files.innerHTML = renderFileItems(fileItems);
    images.innerHTML = renderImageItems(imageItems);
    texts.innerHTML = renderTextItems(textItems);
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

function showLocalScreen(stream) {
  const primary = document.getElementById("primaryScreen");
  if (!primary) return;

  const body = primary.querySelector(".screen-slot-body");
  if (!body) return;

  const video = document.createElement("video");
  video.srcObject = stream;
  video.autoplay = true;
  video.playsInline = true;
  video.muted = true;
  video.style.width = "100%";
  video.style.height = "100%";
  video.style.objectFit = "contain";
  video.style.borderRadius = "12px";

  body.innerHTML = "";
  body.appendChild(video);
}

function showRemoteScreen(stream) {
  const primary = document.getElementById("primaryScreen");
  if (!primary) return;

  const body = primary.querySelector(".screen-slot-body");
  if (!body) return;

  const video = document.createElement("video");
  video.srcObject = stream;
  video.autoplay = true;
  video.playsInline = true;
  video.muted = true;
  video.style.width = "100%";
  video.style.height = "100%";
  video.style.objectFit = "contain";
  video.style.borderRadius = "12px";

  body.innerHTML = "";
  body.appendChild(video);
}

async function loadScreenStatus() {
  try {
    if (!currentRoom) return;

    if (isSharingScreen && localScreenStream) {
      currentScreenOwner = currentParticipantName;
      updateShareButton();
      return;
    }

    const { data, error } = await client
      .from("screen_share")
      .select("*")
      .eq("room_code", currentRoom)
      .eq("active", true)
      .order("created_at", { ascending: false });

    if (error) {
      setStatus("Screen-Status Fehler: " + error.message);
      return;
    }

    const activeShare = data && data.length > 0 ? data[0] : null;

    if (!activeShare) {
      currentScreenOwner = null;
      renderScreens();
      closeAllPeerConnections();
      updateShareButton();
      return;
    }

    currentScreenOwner = activeShare.owner;

    if (activeShare.owner === currentParticipantName && isSharingScreen && localScreenStream) {
      showLocalScreen(localScreenStream);
      updateShareButton();
      return;
    }

    const primary = document.getElementById("primaryScreen");
    if (!primary) return;

    const body = primary.querySelector(".screen-slot-body");
    if (!body) return;

    if (!peerConnections[activeShare.owner]) {
      body.innerHTML = `<p>${activeShare.owner} verbindet…</p>`;
      setTimeout(() => {
        announceViewerReady(activeShare.owner);
      }, 500);
    } else {
      body.innerHTML = `<p>${activeShare.owner} verbunden</p>`;
    }

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

function createPeerConnectionKey(name) {
  return name;
}

async function announceViewerReady(ownerName) {
  if (!currentRoom || !currentParticipantName || !ownerName) return;
  if (ownerName === currentParticipantName) return;
  if (peerConnections[createPeerConnectionKey(ownerName)]) return;

  const { error } = await client.from("webrtc_signals").insert([
    {
      room_code: currentRoom,
      sender: currentParticipantName,
      target: ownerName,
      type: "viewer_ready",
      payload: { viewer: currentParticipantName }
    }
  ]);

  if (error) {
    setStatus("Viewer-Signal Fehler: " + error.message);
  }
}

function createSenderPeerConnection(viewerName) {
  const pc = new RTCPeerConnection(RTC_CONFIG);

  if (localScreenStream) {
    localScreenStream.getTracks().forEach(track => {
      pc.addTrack(track, localScreenStream);
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
        payload: event.candidate
      }
    ]);
  };

  peerConnections[createPeerConnectionKey(viewerName)] = pc;
  return pc;
}

function createViewerPeerConnection(ownerName) {
  const pc = new RTCPeerConnection(RTC_CONFIG);

  pc.ontrack = (event) => {
    const stream = event.streams && event.streams[0] ? event.streams[0] : null;
    if (stream) {
      showRemoteScreen(stream);
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
        payload: event.candidate
      }
    ]);
  };

  peerConnections[createPeerConnectionKey(ownerName)] = pc;
  return pc;
}

async function handleViewerReadySignal(signal) {
  if (!isSharingScreen || !localScreenStream) return;
  if (signal.target !== currentParticipantName) return;

  const viewerName = signal.sender;
  let pc = peerConnections[createPeerConnectionKey(viewerName)];

  if (!pc) {
    pc = createSenderPeerConnection(viewerName);
  }

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  await client.from("webrtc_signals").insert([
    {
      room_code: currentRoom,
      sender: currentParticipantName,
      target: viewerName,
      type: "offer",
      payload: offer
    }
  ]);
}

async function handleOfferSignal(signal) {
  if (signal.target !== currentParticipantName) return;
  if (signal.sender === currentParticipantName) return;

  currentScreenOwner = signal.sender;

  let pc = peerConnections[createPeerConnectionKey(signal.sender)];
  if (!pc) {
    pc = createViewerPeerConnection(signal.sender);
  }

  await pc.setRemoteDescription(new RTCSessionDescription(signal.payload));

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  await client.from("webrtc_signals").insert([
    {
      room_code: currentRoom,
      sender: currentParticipantName,
      target: signal.sender,
      type: "answer",
      payload: answer
    }
  ]);
}

async function handleAnswerSignal(signal) {
  if (signal.target !== currentParticipantName) return;

  const viewerName = signal.sender;
  const pc = peerConnections[createPeerConnectionKey(viewerName)];
  if (!pc) return;

  await pc.setRemoteDescription(new RTCSessionDescription(signal.payload));
}

async function handleCandidateSignal(signal) {
  if (signal.target !== currentParticipantName) return;

  const peerName = signal.sender;
  const pc = peerConnections[createPeerConnectionKey(peerName)];
  if (!pc) return;

  try {
    await pc.addIceCandidate(new RTCIceCandidate(signal.payload));
  } catch (err) {
    setTimeout(async () => {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(signal.payload));
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

async function startScreenShare() {
  try {
    if (!currentRoom || !currentParticipantName) {
      setStatus("Bitte erst Raum und Namen festlegen");
      return;
    }

    if (currentParticipantStatus === "pausiert") {
      setStatus("Du hast den Raum pausiert. Bitte zuerst Raum fortsetzen.");
      return;
    }

    const { data: activeWorkerRows, error: workerError } = await client
      .from("active_worker")
      .select("*")
      .eq("room_code", currentRoom)
      .order("created_at", { ascending: false });

    if (workerError) {
      setStatus("Fehler beim Prüfen: " + workerError.message);
      return;
    }

    if (!activeWorkerRows || activeWorkerRows.length === 0) {
      setStatus("Nur der aktive Bearbeiter darf den Bildschirm teilen");
      return;
    }

    const activeWorkerName = activeWorkerRows[0].worker_name;
    if (activeWorkerName !== currentParticipantName) {
      setStatus("Nur " + activeWorkerName + " darf den Bildschirm teilen");
      return;
    }

    localScreenStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false
    });

    isSharingScreen = true;
    currentScreenOwner = currentParticipantName;
    updateShareButton();
    showLocalScreen(localScreenStream);

    const videoTrack = localScreenStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.addEventListener("ended", () => {
        stopScreenShare(true);
      });
    }

    await client
      .from("screen_share")
      .delete()
      .eq("room_code", currentRoom);

    const { error: insertError } = await client
      .from("screen_share")
      .insert([
        {
          room_code: currentRoom,
          owner: currentParticipantName,
          active: true
        }
      ]);

    if (insertError) {
      setStatus("Fehler beim Starten der Freigabe: " + insertError.message);
      return;
    }

    setStatus("Bildschirm wird geteilt");
  } catch (err) {
    setStatus("Screen Fehler: " + err.message);
  }
}

async function stopScreenShare(silent = false) {
  try {
    if (localScreenStream) {
      localScreenStream.getTracks().forEach(track => track.stop());
      localScreenStream = null;
    }

    isSharingScreen = false;
    currentScreenOwner = null;

    closeAllPeerConnections();

    if (currentRoom) {
      await client
        .from("screen_share")
        .delete()
        .eq("room_code", currentRoom)
        .eq("owner", currentParticipantName);
    }

    renderScreens();
    await loadScreenStatus();
    updateShareButton();

    if (!silent) {
      setStatus("Bildschirmfreigabe beendet");
    }
  } catch (err) {
    setStatus("JS-Fehler stopScreenShare: " + err.message);
  }
}

async function toggleScreenShare() {
  if (isSharingScreen) {
    await stopScreenShare();
  } else {
    await startScreenShare();
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
    const savedRoom = loadSavedRoom();
    const savedName = localStorage.getItem(SAVED_NAME_KEY);

    if (!savedRoom || !savedName) {
      updateWorkButtons(null);
      updateShareButton();
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
  renderScreens();

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
