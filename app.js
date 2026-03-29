const SUPABASE_URL = "DEINE_SUPABASE_URL";
const SUPABASE_KEY = "DEIN_ANON_KEY";

const client = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentRoom = null;
let currentChannel = null;
let roomChannel = null;
const deviceName = "Gerät-" + Math.floor(Math.random() * 1000);

function setStatus(text) {
  const el = document.getElementById("status");
  if (el) el.innerText = text;
  console.log(text);
}

function getParticipantsBox() {
  return document.getElementById("participantsBox");
}

function getActiveBox() {
  return document.getElementById("activeBox");
}

// Raum erstellen
async function createRoom() {
  try {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();

    const { error } = await client.from("rooms").insert([
      {
        code,
        active_name: null
      }
    ]);

    if (error) {
      setStatus("Fehler beim Erstellen: " + error.message);
      return;
    }

    const input = document.getElementById("roomInput");
    if (input) input.value = code;

    await joinRoom();
  } catch (err) {
    setStatus("JS-Fehler createRoom: " + err.message);
  }
}

// Raum beitreten
async function joinRoom() {
  try {
    const input = document.getElementById("roomInput");
    const code = input ? input.value.trim() : "";

    if (!code) {
      setStatus("Bitte Raumcode eingeben");
      return;
    }

    const { data, error } = await client
      .from("rooms")
      .select("*")
      .eq("code", code);

    if (error) {
      setStatus("Fehler beim Prüfen: " + error.message);
      return;
    }

    if (!data || data.length === 0) {
      setStatus("Raum nicht gefunden");
      return;
    }

    currentRoom = code;

    const { error: insertError } = await client.from("participants").insert([
      {
        room_code: code,
        name: deviceName
      }
    ]);

    if (insertError) {
      setStatus("Teilnehmer-Fehler: " + insertError.message);
      return;
    }

    setStatus("Verbunden mit: " + code + " als " + deviceName);

    await loadParticipants();
    await loadActive();
    subscribeRealtime();
    subscribeRoomRealtime();
  } catch (err) {
    setStatus("JS-Fehler joinRoom: " + err.message);
  }
}

// Teilnehmer laden
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
      setStatus("Ladefehler: " + error.message);
      return;
    }

    renderParticipants(data || []);
  } catch (err) {
    setStatus("JS-Fehler loadParticipants: " + err.message);
  }
}

// Teilnehmer anzeigen
function renderParticipants(list) {
  const box = getParticipantsBox();
  if (!box) return;

  if (!list.length) {
    box.innerHTML = "<h3>Im Raum:</h3><p>Noch keine Teilnehmer</p>";
    return;
  }

  let html = "<h3>Im Raum:</h3>";
  list.forEach((p) => {
    html += `<div>${p.name}</div>`;
  });

  box.innerHTML = html;
}

// Aktiven laden
async function loadActive() {
  try {
    if (!currentRoom) return;

    const { data, error } = await client
      .from("rooms")
      .select("active_name")
      .eq("code", currentRoom)
      .single();

    if (error) {
      const box = getActiveBox();
      if (box) box.innerHTML = "<p>Aktivstatus konnte nicht geladen werden</p>";
      return;
    }

    renderActive(data?.active_name || null);
  } catch (err) {
    setStatus("JS-Fehler loadActive: " + err.message);
  }
}

// Aktiven anzeigen
function renderActive(name) {
  const box = getActiveBox();
  if (!box) return;

  if (!name) {
    box.innerHTML = "<h3>Aktiv:</h3><p>Niemand arbeitet gerade</p>";
    return;
  }

  box.innerHTML = `<h3>Aktiv:</h3><div>${name}</div>`;
}

// Mich aktiv setzen
async function setMeActive() {
  try {
    if (!currentRoom) {
      setStatus("Bitte zuerst einem Raum beitreten");
      return;
    }

    const { error } = await client
      .from("rooms")
      .update({ active_name: deviceName })
      .eq("code", currentRoom);

    if (error) {
      setStatus("Aktiv-Fehler: " + error.message);
      return;
    }

    setStatus(deviceName + " arbeitet jetzt");
    await loadActive();
  } catch (err) {
    setStatus("JS-Fehler setMeActive: " + err.message);
  }
}

// Live Updates participants
function subscribeRealtime() {
  try {
    if (!currentRoom) return;

    if (currentChannel) {
      client.removeChannel(currentChannel);
    }

    currentChannel = client
      .channel("room-" + currentRoom + "-participants")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "participants",
          filter: "room_code=eq." + currentRoom
        },
        () => {
          loadParticipants();
        }
      )
      .subscribe();
  } catch (err) {
    setStatus("JS-Fehler realtime participants: " + err.message);
  }
}

// Live Updates rooms
function subscribeRoomRealtime() {
  try {
    if (!currentRoom) return;

    if (roomChannel) {
      client.removeChannel(roomChannel);
    }

    roomChannel = client
      .channel("room-" + currentRoom + "-active")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "rooms",
          filter: "code=eq." + currentRoom
        },
        () => {
          loadActive();
        }
      )
      .subscribe();
  } catch (err) {
    setStatus("JS-Fehler realtime room: " + err.message);
  }
}
