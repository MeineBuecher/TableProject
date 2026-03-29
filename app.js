const SUPABASE_URL = "https://zcpdiudjhzgyqgcsawjc.supabase.co";
const SUPABASE_KEY = "sb_publishable_PYWvX53ZCnSqCDL5iGjDgQ_VD-KN85H";

const client = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentRoom = null;
let currentParticipantName = null;
let currentChannel = null;
let currentWorkerChannel = null;

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

function getEnteredName() {
  const input = document.getElementById("nameInput");
  return input ? input.value.trim() : "";
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

    document.getElementById("roomInput").value = code;
    await joinRoom();
  } catch (err) {
    setStatus("JS-Fehler createRoom: " + err.message);
  }
}

async function joinRoom() {
  try {
    const code = document.getElementById("roomInput").value.trim();
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

    currentRoom = code;
    currentParticipantName = name;

    const { data: existingParticipant } = await client
      .from("participants")
      .select("*")
      .eq("room_code", code)
      .eq("name", name)
      .limit(1);

    if (!existingParticipant || existingParticipant.length === 0) {
      const { error: insertError } = await client.from("participants").insert([
        {
          room_code: code,
          name: name
        }
      ]);

      if (insertError) {
        setStatus("Teilnehmer-Fehler: " + insertError.message);
        return;
      }
    }

    setStatus("Verbunden mit: " + code + " als " + name);

    await loadOwner();
    await loadParticipants();
    await loadWorker();

    subscribeRealtime();
    subscribeWorkerRealtime();
  } catch (err) {
    setStatus("JS-Fehler joinRoom: " + err.message);
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
    if (!currentRoom || !currentParticipantName) {
      setStatus("Bitte erst Raum und Namen festlegen");
      return;
    }

    const { data: active, error: activeError } = await client
      .from("active_worker")
      .select("*")
      .eq("room_code", currentRoom)
      .limit(1);

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
      .limit(1);

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
      .eq("room_code", currentRoom)
      .eq("worker_name", currentParticipantName);

    if (deleteError) {
      setStatus("Fehler beim Beenden: " + deleteError.message);
      return;
    }

    setStatus(currentParticipantName + " hat die Arbeit beendet");
    await loadWorker();
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
      .limit(1);

    if (error) {
      box.innerHTML = "<h3>Aktiv:</h3><p>Arbeitsstatus konnte nicht geladen werden</p>";
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
