export type MaxWebAppUser = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
};

export type MaxWebApp = {
  initData: string;
  initDataUnsafe: { user?: MaxWebAppUser };
  ready?: () => void;
  close?: () => void;
};

function getMaxBridge(): MaxWebApp | undefined {
  return window.WebApp;
}

export function getMaxWebApp(): MaxWebApp | null {
  const webApp = getMaxBridge();
  if (!webApp || typeof webApp.initData !== "string") {
    return null;
  }
  if (webApp.initData.length > 0 || webApp.initDataUnsafe?.user) {
    return webApp;
  }
  return null;
}

export function bootMaxWebApp(): MaxWebApp | null {
  const webApp = getMaxWebApp();
  if (!webApp) {
    return null;
  }
  webApp.ready?.();
  document.documentElement.classList.add("max-miniapp");
  document.body.classList.add("max-miniapp");
  return webApp;
}
