// main.js

import { setStatus } from "./utils.js";
import { client } from "./supabase.js";
import * as state from "./state.js";

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

  // Teilnehmer speichern
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
}

// =============================
// TEILNEHMER LADEN
// =============================

async function loadParticipants() {
  if (!state.currentRoom) return;

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

  let html = "<h3>Im Raum:</h3>";

  data.forEach(p => {
    html += `<div>${p.name}</div>`;
  });

  box.innerHTML = html;
}

// =============================
// CHAT
// =============================

async function sendChatMessage() {
  if (!state.currentRoom) return;

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

  loadChat();
}

async function loadChat() {
  if (!state.currentRoom) return;

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
    .map(
      msg => `
      <div>
        <strong>${msg.sender_name}</strong><br>
        ${msg.message}
      </div>
    `
    )
    .join("");

  box.scrollTop = box.scrollHeight;
}

// =============================
// ARBEIT STATUS (MINIMAL)
// =============================

async function workNow() {
  setStatus("Du arbeitest jetzt");
}

async function pauseWork() {
  setStatus("Raum pausiert");
}

async function resumeWork() {
  setStatus("Raum fortgesetzt");
}

async function stopWork() {
  setStatus("Arbeit beendet");
}

async function leaveRoom() {
  state.currentRoom = null;
  state.currentParticipantName = null;

  setStatus("Raum verlassen");

  document.getElementById("participantsBox").innerHTML = "";
  document.getElementById("chatMessages").innerHTML =
    "<p>Noch keine Nachrichten</p>";
}

// =============================
// SCREEN (Platzhalter)
// =============================

function promoteScreen(index) {
  console.log("Screen wechseln:", index);
}

// =============================
// GLOBAL (WICHTIG für HTML)
// =============================

window.createRoom = createRoom;
window.joinRoom = joinRoom;
window.sendChatMessage = sendChatMessage;

window.workNow = workNow;
window.pauseWork = pauseWork;
window.resumeWork = resumeWork;
window.stopWork = stopWork;
window.leaveRoom = leaveRoom;

window.promoteScreen = promoteScreen;

// =============================
// START
// =============================

document.addEventListener("DOMContentLoaded", () => {
  setStatus("TableProject bereit");
});
