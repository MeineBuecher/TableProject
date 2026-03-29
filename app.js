const SUPABASE_URL = "https://zcpdiudjhzgyqgcsawjc.supabase.co";
const SUPABASE_KEY = "sb_publishable_PYWvX53ZCnSqCDL5iGjDgQ_VD-KN85H";

const client = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentRoom = null;
let currentParticipantsChannel = null;
let currentWorkerChannel = null;
const deviceName = "Gerät-" + Math.floor(Math.random() * 1000);

function setStatus(text) {
  const el = document.getElementById("status");
  if (el) el.innerText = text;
  console.log(text);
}

function getOwnerBox() {
  return document.getElementById("ownerBox");
}

function getParticipantsBox() {
  return document.getElementById("participantsBox");
}

function getWorkerBox() {
  return document.getElementById("workerBox");
}

function getLockBox() {
  return document.getElementById("lockBox");
}

async function createRoom() {
  try {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();

    const { error } = await client.from("rooms").insert([
      {
        code: code,
        owner_name: deviceName
      }
    ]);

    if (error) {
      setStatus("Fehler beim Erstellen: " + error.message);
      return;
    }

    document.getElementById("roomInput").value = code;
    await joinRoom(true);
  } catch (err) {
    setStatus("JS-Fehler createRoom: " + err.message);
  }
}

async function joinRoom(isCreator = false) {
  try {
    const code = document.getElementById("roomInput").value.trim();

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

    const room = data[0];

    const { data: existingParticipant } = await client
      .from("participants")
      .select("*")
      .eq("room_code", code)
      .eq("name", deviceName)
      .limit(1);

    if (!existingParticipant || existingParticipant.length === 0) {
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
    }

    setStatus(
      isCreator
        ? "Raum erstellt und verbunden: " + code + " als " + deviceName
        : "Verbunden mit: " + code + " als " + deviceName
    );

    renderOwner(room.owner_name || "Unbekannt");
    await loadParticipants();
    await loadWorker();
    subscribeParticipantsRealtime();
    subscribeWorkerRealtime();
  } catch (err) {
    setStatus("JS-Fehler joinRoom: " + err.message);
  }
}

function renderOwner(ownerName) {
  const box = getOwnerBox();
  if (!box) return;

  box.innerHTML = `<h3>Raumersteller:</h3><p>${ownerName}</p>`;
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

function subscribeParticipantsRealtime() {
  try {
    if (!currentRoom) return;

    if (currentParticipantsChannel) {
      client.removeChannel(currentParticipantsChannel);
    }

    currentParticipantsChannel = client
      .channel("participants-" + currentRoom)
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
    setStatus("JS-Fehler participants realtime: " + err.message);
  }
}

async function workNow() {
  try {
    if (!currentRoom) {
      setStatus("Bitte erst einem Raum beitreten");
      return;
    }

    const { data, error } = await client
      .from("active_worker")
      .select("*")
      .eq("room_code", currentRoom)
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) {
      setStatus("Fehler beim Prüfen des Arbeitsstatus: " + error.message);
      return;
    }

    if (data && data.length > 0) {
      const activeName = data[0].worker_name;

      if (activeName === deviceName) {
        setStatus("Du arbeitest bereits");
      } else {
        setStatus(activeName + " arbeitet gerade");
      }

      await loadWorker();
      return;
    }

    const { error: insertError } = await client.from("active_worker").insert([
      {
        room_code: currentRoom,
        worker_name: deviceName
      }
    ]);

    if (insertError) {
      setStatus("Fehler beim Setzen: " + insertError.message);
      return;
    }

    setStatus(deviceName + " arbeitet jetzt");
    await loadWorker();
  } catch (err) {
    setStatus("JS-Fehler workNow: " + err.message);
  }
}

async function stopWork() {
  try {
    if (!currentRoom) {
      setStatus("Bitte erst einem Raum beitreten");
      return;
    }

    const { data, error } = await client
      .from("active_worker")
      .select("*")
      .eq("room_code", currentRoom)
      .order("created_at", { ascending: false })
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

    const activeName = data[0].worker_name;

    if (activeName !== deviceName) {
      setStatus(activeName + " muss die Arbeit selbst beenden");
      await loadWorker();
      return;
    }

    const { error: deleteError } = await client
      .from("active_worker")
      .delete()
      .eq("room_code", currentRoom)
      .eq("worker_name", deviceName);

    if (deleteError) {
      setStatus("Fehler beim Beenden: " + deleteError.message);
      return;
    }

    setStatus("Arbeit wurde freigegeben");
    await loadWorker();
  } catch (err) {
    setStatus("JS-Fehler stopWork: " + err.message);
  }
}

async function loadWorker() {
  try {
    const box = getWorkerBox();
    const lockBox = getLockBox();

    if (!box || !lockBox) return;

    if (!currentRoom) {
      box.innerHTML = "";
      lockBox.innerHTML = "";
      lockBox.className = "";
      return;
    }

    const { data, error } = await client
      .from("active_worker")
      .select("*")
      .eq("room_code", currentRoom)
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) {
      box.innerHTML = "<h3>Aktiv arbeitet:</h3><p>Fehler beim Laden</p>";
      lockBox.innerHTML = "";
      lockBox.className = "";
      return;
    }

    if (!data || data.length === 0) {
      box.innerHTML = "<h3>Aktiv arbeitet:</h3><p>Gerade niemand</p>";
      lockBox.innerHTML = "Der Raum ist frei. Jeder Teilnehmer kann die Arbeit übernehmen.";
      lockBox.className = "lock-open";
      return;
    }

    const activeName = data[0].worker_name;

    box.innerHTML = `<h3>Aktiv arbeitet:</h3><p>${activeName}</p>`;

    if (activeName === deviceName) {
      lockBox.innerHTML = "Du arbeitest gerade. Beende deine Arbeit aktiv, bevor jemand anders übernehmen kann.";
      lockBox.className = "lock-open";
    } else {
      lockBox.innerHTML = `${activeName} arbeitet gerade. Du kannst erst übernehmen, wenn die Arbeit aktiv beendet wurde.`;
      lockBox.className = "lock-closed";
    }
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
