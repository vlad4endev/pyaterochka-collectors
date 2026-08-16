export function getTelegramWebApp(): TelegramWebApp | null {
  const webApp = window.Telegram?.WebApp;
  if (!webApp) {
    return null;
  }
  if (webApp.initData.length > 0 || webApp.initDataUnsafe.user) {
    return webApp;
  }
  return null;
}

export function bootTelegramWebApp(): TelegramWebApp | null {
  const webApp = getTelegramWebApp();
  if (!webApp) {
    return null;
  }
  webApp.ready();
  webApp.expand();
  webApp.setHeaderColor("#ffffff");
  webApp.setBackgroundColor("#f5f5f7");
  document.documentElement.classList.add("tg-miniapp");
  document.body.classList.add("tg-miniapp");
  return webApp;
}
