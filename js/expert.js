import { client } from "./supabase.js";
import { setStatus, generateToken } from "./utils.js";
import { currentRoom, currentParticipantName } from "./state.js";

export async function createExpertInvite() {
  if (!currentRoom || !currentParticipantName) {
    setStatus("Bitte zuerst Raum beitreten");
    return;
  }

  const token = generateToken();

  const { error } = await client.from("expert_invites").insert([{
    room_code: currentRoom,
    owner_name: currentParticipantName,
    token,
    active: true
  }]);

  if (error) {
    setStatus(error.message);
    return;
  }

  setStatus("Expertenlink erstellt");
}
