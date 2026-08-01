export const PEDIR_SET_NAME = "Pedir Set";
export const PEDIR_SET_REQUEST_LABEL = "Solicitar Set";

export function createPedirSetChannelName(username: string) {
  return `set-${username}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .slice(0, 90);
}
