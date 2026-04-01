// main.js

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
let webrtcChannel = null;

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
// WEBRTC STATE
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

  await client.from("participants").insert([{ room_code: code, name, status: "online" }]);

  setStatus("Verbunden mit: " + code);

  loadScreens();
  subscribeWebRTC();
}

// =============================
// WEBRTC REALTIME
// =============================

function subscribeWebRTC() {
  if (!state.currentRoom) return;

  if (webrtcChannel) client.removeChannel(webrtcChannel);

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
// SIGNAL HANDLER
// =============================

async function handleSignal(signal) {
  if (signal.target !== state.currentParticipantName) return;

  if (signal.type === "viewer_ready") await handleViewerReady(signal);
  if (signal.type === "offer") await handleOffer(signal);
  if (signal.type === "answer") await handleAnswer(signal);
  if (signal.type === "candidate") await handleCandidate(signal);
}

// =============================
// VIEWER → OWNER
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
// OWNER → SEND STREAM
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
// VIEWER EMPFÄNGT
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
// ANSWER
// =============================

async function handleAnswer(signal) {
  const viewer = signal.sender;
  const slot = signal.payload.slot;

  const pc = peerConnections[viewer + "_" + slot];
  if (!pc) return;

  await pc.setRemoteDescription(new RTCSessionDescription(signal.payload.answer));
}

// =============================
// ICE
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
// SCREEN LOGIK
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
// RENDER
// =============================

function renderScreens() {
  const boxes = [
    document.getElementById("primaryScreen"),
    document.getElementById("screenThumb1"),
    document.getElementById("screenThumb2"),
    document.getElementById("screenThumb3")
  ];

  boxes.forEach((box, i) => {
    if (!box) return;

    const body = box.querySelector(".screen-slot-body");
    body.innerHTML = "";

    const slot = screenSlots[i];

    if (slot.stream) {
      const video = document.createElement("video");
      video.srcObject = slot.stream;
      video.autoplay = true;
      video.playsInline = true;
      video.muted = false;
      video.style.width = "100%";
      video.style.height = "100%";

      body.appendChild(video);
    } else {
      body.innerHTML = "<p>Keine Freigabe aktiv</p>";
    }
  });
}

// =============================
// BUTTON
// =============================

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("shareScreenBtn")?.addEventListener("click", async () => {

    const input = prompt("Screen wählen (1-4)", "1");
    if (!input) return;

    const slot = parseInt(input) - 1;
    if (slot < 0 || slot > 3) return;

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

  setStatus("TableProject bereit");
});
