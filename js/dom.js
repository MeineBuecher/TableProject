export function getEl(id) {
  return document.getElementById(id);
}

export const getParticipantsBox = () => getEl("participantsBox");
export const getWorkerBox = () => getEl("workerBox");
export const getOwnerBox = () => getEl("ownerBox");
export const getChatMessagesBox = () => getEl("chatMessages");
export const getChatInput = () => getEl("chatInput");
export const getFilesArea = () => getEl("filesArea");
export const getImagesArea = () => getEl("imagesArea");
export const getTextsArea = () => getEl("textsArea");
export const getShareScreenBtn = () => getEl("shareScreenBtn");
export const getExpertPanel = () => getEl("expertPanel");
