// main.js

import { setStatus } from "./utils.js";
import { client } from "./supabase.js";
import * as state from "./state.js";

// =============================
// REALTIME CHANNELS
// =============================

let participantChannel = null;
let chatChannel = null;
let storageChannel = null; // 🔥 NEU

// =============================
// BASIS FUNKTIONEN
// =============================

function getName() {
  const input = document.getElementById("nameInput");
  return input ? input.value.trim() : "";
}

function getRoom() {
  const input = document.getElementById("roomInput");
  return input ? input.value.trim().toUpperCase() : "";
}

// =============================
// 🔥 STORAGE UPLOAD CORE
// =============================

async function uploadToStorage(file, type) {
  if (!state.currentRoom) throw new Error("Kein Raum aktiv");

  const fileName =
    Date.now() +
    "_" +
    Math.random().toString(36).substring(2, 8) +
    "_" +
    file.name;

  const path = `${state.currentRoom}/${type}/${fileName}`;

  const { error } = await client.storage
    .from("faceproject-files")
    .upload(path, file);

  if (error) throw error;

  const { data } = client.storage
    .from("faceproject-files")
    .getPublicUrl(path);

  return {
    path,
    url: data.publicUrl
  };
}

// =============================
// RAUM ERSTELLEN
// =============================

async function createRoom() {
  const name = getName();
  if (!name) {
    setStatus("Bitte Namen eingeben");
    return;
  }

  const code = Math.random().toString(36).substring(2, 8).toUpperCase();

  const { error } = await client.from("rooms").insert([
    {
      code,
      owner_name: name
    }
  ]);

  if (error) {
    setStatus(error.message);
    return;
  }

  document.getElementById("roomInput").value = code;

  setStatus("Raum erstellt: " + code);

  await joinRoom();
}

// =============================
// RAUM BEITRETEN
// =============================

async function joinRoom() {
  const name = getName();
  const code = getRoom();

  if (!name) {
    setStatus("Bitte Namen eingeben");
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

  if (error || !data.length) {
    setStatus("Raum nicht gefunden");
    return;
  }

  state.currentRoom = code;
  state.currentParticipantName = name;
  state.currentRoomOwner = data[0].owner_name;

  await client.from("participants").insert([
    {
      room_code: code,
      name: name,
      status: "online"
    }
  ]);

  setStatus("Verbunden mit: " + code);

  loadParticipants();
  loadChat();
  loadStorageItems(); // 🔥 NEU

  subscribeParticipantsRealtime();
  subscribeChatRealtime();
  subscribeStorageRealtime(); // 🔥 NEU
}

// =============================
// REALTIME TEILNEHMER
// =============================

function subscribeParticipantsRealtime() {
  if (!state.currentRoom) return;

  if (participantChannel) {
    client.removeChannel(participantChannel);
  }

  participantChannel = client
    .channel("participants-" + state.currentRoom)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "participants",
        filter: "room_code=eq." + state.currentRoom
      },
      () => {
        loadParticipants();
      }
    )
    .subscribe();
}

// =============================
// REALTIME CHAT
// =============================

function subscribeChatRealtime() {
  if (!state.currentRoom) return;

  if (chatChannel) {
    client.removeChannel(chatChannel);
  }

  chatChannel = client
    .channel("chat-" + state.currentRoom)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "chat_messages",
        filter: "room_code=eq." + state.currentRoom
      },
      (payload) => {
        appendChatMessage(payload.new);
      }
    )
    .subscribe();
}

function appendChatMessage(msg) {
  const box = document.getElementById("chatMessages");
  if (!box) return;

  const div = document.createElement("div");
  div.innerHTML = `<strong>${msg.sender_name}</strong><br>${msg.message}`;

  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

// =============================
// 🔥 REALTIME STORAGE
// =============================

function subscribeStorageRealtime() {
  if (!state.currentRoom) return;

  if (storageChannel) {
    client.removeChannel(storageChannel);
  }

  storageChannel = client
    .channel("storage-" + state.currentRoom)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "storage_items",
        filter: "room_code=eq." + state.currentRoom
      },
      () => {
        loadStorageItems();
      }
    )
    .subscribe();
}

// =============================
// STORAGE LADEN
// =============================

async function loadStorageItems() {
  if (!state.currentRoom) return;

  const { data } = await client
    .from("storage_items")
    .select("*")
    .eq("room_code", state.currentRoom)
    .order("created_at", { ascending: true });

  const files = document.getElementById("filesArea");
  const images = document.getElementById("imagesArea");
  const texts = document.getElementById("textsArea");

  if (!files || !images || !texts) return;

  files.innerHTML = "";
  images.innerHTML = "";
  texts.innerHTML = "";

  (data || []).forEach(item => {
    if (item.type === "file") {
      files.innerHTML += `<a href="${item.content}" target="_blank">${item.file_name}</a><br>`;
    }

    if (item.type === "image") {
      images.innerHTML += `<img src="${item.content}" style="width:100%;border-radius:10px;margin-bottom:10px;">`;
    }

    if (item.type === "text") {
      texts.innerHTML += `<div>${item.content}</div>`;
    }
  });
}

// =============================
// UPLOAD BUTTONS
// =============================

document.addEventListener("DOMContentLoaded", () => {
  // FILE
  document.getElementById("uploadFileBtn")?.addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";

    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;

      const uploaded = await uploadToStorage(file, "file");

      await client.from("storage_items").insert([{
        room_code: state.currentRoom,
        type: "file",
        content: uploaded.url,
        file_name: file.name,
        storage_path: uploaded.path
      }]);
    };

    input.click();
  });

  // IMAGE (📱 FIX)
  document.getElementById("uploadImageBtn")?.addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.capture = "environment";

    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;

      const uploaded = await uploadToStorage(file, "image");

      await client.from("storage_items").insert([{
        room_code: state.currentRoom,
        type: "image",
        content: uploaded.url,
        file_name: file.name,
        storage_path: uploaded.path
      }]);
    };

    input.click();
  });

  // TEXT
  document.getElementById("addTextBtn")?.addEventListener("click", async () => {
    const text = prompt("Text eingeben:");
    if (!text) return;

    await client.from("storage_items").insert([{
      room_code: state.currentRoom,
      type: "text",
      content: text
    }]);
  });

  setStatus("TableProject bereit");
});
