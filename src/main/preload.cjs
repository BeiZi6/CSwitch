"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cswitch", {
  listProfiles: () => ipcRenderer.invoke("profiles:list"),
  saveProfile: (profile) => ipcRenderer.invoke("profiles:save", profile),
  deleteProfile: (id) => ipcRenderer.invoke("profiles:delete", id),
  setCurrent: (id) => ipcRenderer.invoke("profiles:current", id),
  start: () => ipcRenderer.invoke("gateway:start"),
  stop: () => ipcRenderer.invoke("gateway:stop"),
  status: () => ipcRenderer.invoke("gateway:status"),
});
