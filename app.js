const SUPABASE_URL = "https://zcpdiudjhzgyqgcsawjc.supabase.co";
const SUPABASE_KEY = "sb_publishable_PYWvX53ZCnSqCDL5iGjDgQ_VD-KN85H";

const client = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentRoom = null;
let currentChannel = null;
let currentWorkerChannel = null;
const deviceName = "Gerät-" + Math.floor(Math.random() * 1000);

function setStatus(text) {
  const el = document.getElementById("status");
  if (el) el.innerText = text;
  console.log(text);
}

function getParticipantsBox() {
  return document.getElementById("participantsBox");
}

async function createRoom() {
  try {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();

    const { error } = await client.from("rooms").insert([{ code }]);

    if (error) {
      setStatus("Fehler beim Erstellen: " + error.message);
      return;
    }

    document.getElementById("roomInput").value = code;
    await joinRoom();
  } catch (err) {
    setStatus("JS-Fehler createRoom: " + err.message);
  }
}

async function joinRoom() {
  try {
    const code = document.getElementById("roomInput").value.trim();

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
    subscribeRealtime();
    await loadWorker();
    subscribeWorkerRealtime();
  } catch (err) {
    setStatus("JS-Fehler joinRoom: " + err.message);
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

  list.forEach((p) => {
    html += `<div>${p.name}</div>`;
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
        () => {
          loadParticipants();
        }
      )
      .subscribe();
  } catch (err) {
    setStatus("JS-Fehler realtime: " + err.message);
  }
}

async function workNow() {
  try {
    if (!currentRoom) {
      setStatus("Bitte erst einem Raum beitreten");
      return;
    }

    const { error: delError } = await client
      .from("active_worker")
      .delete()
      .eq("room_code", currentRoom);

    if (delError) {
      setStatus("Fehler beim Zurücksetzen: " + delError.message);
      return;
    }

    const { error } = await client.from("active_worker").insert([
      {
        room_code: currentRoom,
        worker_name: deviceName
      }
    ]);

    if (error) {
      setStatus("Fehler beim Setzen: " + error.message);
      return;
    }

    setStatus(deviceName + " arbeitet jetzt");
    await loadWorker();
  } catch (err) {
    setStatus("JS-Fehler workNow: " + err.message);
  }
}

async function loadWorker() {
  try {
    const box = document.getElementById("workerBox");
    if (!box || !currentRoom) return;

    const { data, error } = await client
      .from("active_worker")
      .select("*")
      .eq("room_code", currentRoom)
      .limit(1);

    if (error) {
      box.innerHTML = "<p>Arbeitsstatus konnte nicht geladen werden</p>";
      return;
    }

    if (!data || data.length === 0) {
      box.innerHTML = "<h3>Aktiv:</h3><p>Gerade arbeitet niemand</p>";
      return;
    }

    box.innerHTML = `<h3>Aktiv:</h3><p>${data[0].worker_name}</p>`;
  } catch (err) {
    setStatus("JS-Fehler loadWorker: " + err.message);
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
