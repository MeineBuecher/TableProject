// main.js

import { handleSignal, notifyViewer } from "./webrtc.js";
import { setStatus } from "./utils.js";
import { client } from "./supabase.js";
import * as state from "./state.js";

// =============================
// REALTIME CHANNELS
// =============================

let participantChannel = null;
let chatChannel = null;
let storageChannel = null;
let screenChannel = null;
let webrtcChannel = null; // 🔥 NEU

// =============================
// SCREEN STATE
// =============================

let screenSlots = [
  { owner: null, stream: null },
  { owner: null, stream: null },
  { owner: null, stream: null },
  { owner: null, stream: null }
];

let localScreens = {};

// =============================
// 🔥 WEBRTC STATE
// =============================

let peerConnections = {};
let handledSignals = new Set();

const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
  ]
};

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
  loadStorageItems();
  loadScreens();

  subscribeParticipantsRealtime();
  subscribeChatRealtime();
  subscribeStorageRealtime();
  subscribeScreenRealtime();
  subscribeWebRTC(); // 🔥 NEU
}

// =============================
// 🔥 WEBRTC REALTIME
// =============================

function subscribeWebRTC() {
  if (!state.currentRoom) return;

  if (webrtcChannel) {
    client.removeChannel(webrtcChannel);
  }

  webrtcChannel = client
    .channel("webrtc-" + state.currentRoom)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "webrtc_signals",
        filter: "room_code=eq." + state.currentRoom
      },
      async (payload) => {
        const signal = payload.new;
        if (handledSignals.has(signal.id)) return;

        handledSignals.add(signal.id);
        await handleSignal(signal);
      }
    )
    .subscribe();
}

// =============================
// 🔥 SIGNAL HANDLER
// =============================

async function handleSignal(signal) {
  if (signal.target !== state.currentParticipantName) return;

  if (signal.type === "viewer_ready") await handleViewerReady(signal);
  if (signal.type === "offer") await handleOffer(signal);
  if (signal.type === "answer") await handleAnswer(signal);
  if (signal.type === "candidate") await handleCandidate(signal);
}

// =============================
// 🔥 VIEWER MELDET SICH
// =============================

async function announceViewer(owner, slot) {
  await client.from("webrtc_signals").insert([{
    room_code: state.currentRoom,
    sender: state.currentParticipantName,
    target: owner,
    type: "viewer_ready",
    payload: { slot }
  }]);
}

// =============================
// 🔥 OWNER SEND STREAM
// =============================

async function handleViewerReady(signal) {
  const viewer = signal.sender;
  const slot = signal.payload.slot;

  const stream = localScreens[slot]?.stream;
  if (!stream) return;

  const pc = new RTCPeerConnection(RTC_CONFIG);

  stream.getTracks().forEach(track => pc.addTrack(track, stream));

  pc.onicecandidate = async (e) => {
    if (!e.candidate) return;

    await client.from("webrtc_signals").insert([{
      room_code: state.currentRoom,
      sender: state.currentParticipantName,
      target: viewer,
      type: "candidate",
      payload: { candidate: e.candidate, slot }
    }]);
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  peerConnections[viewer + "_" + slot] = pc;

  await client.from("webrtc_signals").insert([{
    room_code: state.currentRoom,
    sender: state.currentParticipantName,
    target: viewer,
    type: "offer",
    payload: { offer, slot }
  }]);
}

// =============================
// 🔥 VIEWER EMPFÄNGT
// =============================

async function handleOffer(signal) {
  const owner = signal.sender;
  const slot = signal.payload.slot;

  const pc = new RTCPeerConnection(RTC_CONFIG);

  pc.ontrack = (e) => {
    screenSlots[slot].stream = e.streams[0];
    renderScreens();
  };

  pc.onicecandidate = async (e) => {
    if (!e.candidate) return;

    await client.from("webrtc_signals").insert([{
      room_code: state.currentRoom,
      sender: state.currentParticipantName,
      target: owner,
      type: "candidate",
      payload: { candidate: e.candidate, slot }
    }]);
  };

  await pc.setRemoteDescription(new RTCSessionDescription(signal.payload.offer));

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  peerConnections[owner + "_" + slot] = pc;

  await client.from("webrtc_signals").insert([{
    room_code: state.currentRoom,
    sender: state.currentParticipantName,
    target: owner,
    type: "answer",
    payload: { answer, slot }
  }]);
}

// =============================
// 🔥 ANSWER
// =============================

async function handleAnswer(signal) {
  const viewer = signal.sender;
  const slot = signal.payload.slot;

  const pc = peerConnections[viewer + "_" + slot];
  if (!pc) return;

  await pc.setRemoteDescription(
    new RTCSessionDescription(signal.payload.answer)
  );
}

// =============================
// 🔥 ICE
// =============================

async function handleCandidate(signal) {
  const peer = signal.sender;
  const slot = signal.payload.slot;

  const pc = peerConnections[peer + "_" + slot];
  if (!pc) return;

  try {
    await pc.addIceCandidate(signal.payload.candidate);
  } catch {}
}

// =============================
// 🔥 SCREEN ERWEITERT
// =============================

async function loadScreens() {
  if (!state.currentRoom) return;

  const { data } = await client
    .from("screen_share")
    .select("*")
    .eq("room_code", state.currentRoom)
    .eq("active", true);

  screenSlots = [
    { owner: null, stream: null },
    { owner: null, stream: null },
    { owner: null, stream: null },
    { owner: null, stream: null }
  ];

  (data || []).forEach(s => {
    screenSlots[s.slot_index] = {
      owner: s.owner,
      stream: localScreens[s.slot_index]?.stream || null
    };

    if (s.owner !== state.currentParticipantName) {
      announceViewer(s.owner, s.slot_index);
    }
  });

  renderScreens();
}

// =============================
// BUTTON
// =============================

document.getElementById("shareScreenBtn")?.addEventListener("click", async () => {
  const input = prompt("Screen wählen (1-4)", "1");
  if (!input) return;

  const slot = parseInt(input) - 1;

  if (localScreens[slot]) {
    localScreens[slot].stream.getTracks().forEach(t => t.stop());
    delete localScreens[slot];
  } else {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    localScreens[slot] = { stream };

    await client.from("screen_share").insert([{
      room_code: state.currentRoom,
      owner: state.currentParticipantName,
      slot_index: slot,
      active: true
    }]);
  }
});

// =============================
// START
// =============================

document.addEventListener("DOMContentLoaded", () => {
  setStatus("TableProject bereit");
});
