import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("cswitch", {
  listProfiles: () => ipcRenderer.invoke("profiles:list"),
  saveProfile: (profile: unknown) => ipcRenderer.invoke("profiles:save", profile),
  deleteProfile: (id: string) => ipcRenderer.invoke("profiles:delete", id),
  setCurrent: (id: string) => ipcRenderer.invoke("profiles:current", id),
  start: () => ipcRenderer.invoke("gateway:start"),
  stop: () => ipcRenderer.invoke("gateway:stop"),
  status: () => ipcRenderer.invoke("gateway:status"),
});
