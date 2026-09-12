export function requireBridge<T>(api: T | undefined): T {
  if (!api) {
    throw new Error("桌面桥接未加载。请从安装目录启动 CSwitch.exe，不要用浏览器直接打开页面。");
  }
  return api;
}
