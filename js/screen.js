import { screenSlots } from "./state.js";

export function resetScreens() {
  screenSlots.forEach(s => {
    s.owner = null;
    s.stream = null;
    s.active = false;
  });
}
