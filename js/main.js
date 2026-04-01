import { setStatus } from "./utils.js";
import { createRoom } from "./room.js";

document.addEventListener("DOMContentLoaded", () => {
  setStatus("FaceProject gestartet");

  window.createRoom = () => {
    const name = document.getElementById("nameInput").value;
    createRoom(name);
  };
});
