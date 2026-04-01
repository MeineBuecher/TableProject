// main.js (FINAL TABLEPROJECT)

import { setStatus } from "./utils.js";
import { client } from "./supabase.js";
import * as state from "./state.js";

// 🔥 NEU – MODULE
import { loadScreens, toggleScreen, renderScreens } from "./screen.js";
import { handleSignal, notifyViewer } from "./webrtc.js";

// =============================
// REALTIME CHANNELS
// =============================

let participantChannel = null;
let chatChannel = null;
let storageChannel = null;
let screenChannel = null;
let webrtcChannel = null;

// =============================
// BASIS
// =============================

function getName() {
  return document.getElementById("nameInput")?.value.trim() || "";
}

function getRoom() {
  return document.getElementById("roomInput")?.value.trim().toUpperCase() || "";
}

// =============================
// RAUM
// =============================

async function createRoom() {
  const name = getName();
  if (!name) return setStatus("Bitte Namen eingeben");

  const code = Math.random().toString(36).substring(2, 8).toUpperCase();

  const { error } = await client.from("rooms").insert([{ code, owner_name: name }]);
  if (error) return setStatus(error.message);

  document.getElementById("roomInput").value = code;
  setStatus("Raum erstellt: " + code);

  await joinRoom();
}

async function joinRoom() {
  const name = getName();
  const code = getRoom();

  if (!name) return setStatus("Bitte Namen eingeben");
  if (!code) return setStatus("Bitte Raumcode eingeben");

  const { data } = await client.from("rooms").select("*").eq("code", code).limit(1);
  if (!data || !data.length) return setStatus("Raum nicht gefunden");

  state.currentRoom = code;
  state.currentParticipantName = name;
  state.currentRoomOwner = data[0].owner_name;

  await client.from("participants").insert([
    { room_code: code, name, status: "online" }
  ]);

  setStatus("Verbunden mit: " + code);

  loadParticipants();
  loadChat();
  loadStorageItems();
  loadScreens();

  subscribeParticipants();
  subscribeChat();
  subscribeStorage();
  subscribeScreens();
  subscribeWebRTC();
}

// =============================
// TEILNEHMER
// =============================

async function loadParticipants() {
  const { data } = await client
    .from("participants")
    .select("*")
    .eq("room_code", state.currentRoom);

  const box = document.getElementById("participantsBox");
  if (!box) return;

  if (!data || !data.length) {
    box.innerHTML = "<p>Keine Teilnehmer</p>";
    return;
  }

  box.innerHTML =
    "<h3>Im Raum:</h3>" +
    data.map(p => `<div>${p.name}</div>`).join("");
}

function subscribeParticipants() {
  if (participantChannel) client.removeChannel(participantChannel);

  participantChannel = client
    .channel("participants-" + state.currentRoom)
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "participants",
      filter: "room_code=eq." + state.currentRoom
    }, loadParticipants)
    .subscribe();
}

// =============================
// CHAT
// =============================

async function sendChatMessage() {
  const input = document.getElementById("chatInput");
  const text = input.value.trim();
  if (!text) return;

  await client.from("chat_messages").insert([
    {
      room_code: state.currentRoom,
      sender_name: state.currentParticipantName,
      message: text
    }
  ]);

  input.value = "";
}

async function loadChat() {
  const { data } = await client
    .from("chat_messages")
    .select("*")
    .eq("room_code", state.currentRoom)
    .order("created_at", { ascending: true });

  const box = document.getElementById("chatMessages");

  if (!data || !data.length) {
    box.innerHTML = "<p>Noch keine Nachrichten</p>";
    return;
  }

  box.innerHTML = data
    .map(m => `<div><strong>${m.sender_name}</strong><br>${m.message}</div>`)
    .join("");

  box.scrollTop = box.scrollHeight;
}

function subscribeChat() {
  if (chatChannel) client.removeChannel(chatChannel);

  chatChannel = client
    .channel("chat-" + state.currentRoom)
    .on("postgres_changes", {
      event: "INSERT",
      schema: "public",
      table: "chat_messages",
      filter: "room_code=eq." + state.currentRoom
    }, loadChat)
    .subscribe();
}

// =============================
// STORAGE
// =============================

async function loadStorageItems() {
  const { data } = await client
    .from("storage_items")
    .select("*")
    .eq("room_code", state.currentRoom);

  const files = document.getElementById("filesArea");
  const images = document.getElementById("imagesArea");
  const texts = document.getElementById("textsArea");

  files.innerHTML = "";
  images.innerHTML = "";
  texts.innerHTML = "";

  (data || []).forEach(item => {
    if (item.type === "file") {
      files.innerHTML += `<a href="${item.content}" target="_blank">${item.file_name}</a><br>`;
    }

    if (item.type === "image") {
      images.innerHTML += `<img src="${item.content}" style="width:100%;margin-bottom:10px;">`;
    }

    if (item.type === "text") {
      texts.innerHTML += `<div>${item.content}</div>`;
    }
  });
}

function subscribeStorage() {
  if (storageChannel) client.removeChannel(storageChannel);

  storageChannel = client
    .channel("storage-" + state.currentRoom)
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "storage_items",
      filter: "room_code=eq." + state.currentRoom
    }, loadStorageItems)
    .subscribe();
}

// =============================
// SCREEN REALTIME
// =============================

function subscribeScreens() {
  if (screenChannel) client.removeChannel(screenChannel);

  screenChannel = client
    .channel("screen-" + state.currentRoom)
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "screen_share",
      filter: "room_code=eq." + state.currentRoom
    }, async () => {
      await loadScreens();

      // 🔥 WICHTIG: Viewer automatisch verbinden
      document.querySelectorAll(".screen-slot-body").forEach((_, i) => {
        const slot = i;
        const owner = state.currentParticipantName;

        // wenn nicht eigener Screen → Verbindung starten
        if (owner !== state.currentParticipantName) {
          notifyViewer(owner, slot);
        }
      });
    })
    .subscribe();
}

// =============================
// 🔥 WEBRTC REALTIME
// =============================

function subscribeWebRTC() {
  if (webrtcChannel) client.removeChannel(webrtcChannel);

  webrtcChannel = client
    .channel("webrtc-" + state.currentRoom)
    .on("postgres_changes", {
      event: "INSERT",
      schema: "public",
      table: "webrtc_signals",
      filter: "room_code=eq." + state.currentRoom
    }, async (payload) => {
      await handleSignal(payload.new, window.localScreens || {});
    })
    .subscribe();
}

// =============================
// SCREEN BUTTON
// =============================

document.addEventListener("DOMContentLoaded", () => {

  document.getElementById("shareScreenBtn")
    ?.addEventListener("click", toggleScreen);

  // 🔥 GLOBAL RENDER für WebRTC
  window.renderRemoteStream = (slot, stream) => {
    const ids = [
      "primaryScreen",
      "screenThumb1",
      "screenThumb2",
      "screenThumb3"
    ];

    const box = document.getElementById(ids[slot]);
    if (!box) return;

    const body = box.querySelector(".screen-slot-body");
    if (!body) return;

    body.innerHTML = "";

    const video = document.createElement("video");
    video.srcObject = stream;
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    video.style.width = "100%";
    video.style.height = "100%";

    body.appendChild(video);
  };

  setStatus("TableProject bereit");
});

// =============================
// GLOBAL
// =============================

window.createRoom = createRoom;
window.joinRoom = joinRoom;
window.sendChatMessage = sendChatMessage;
