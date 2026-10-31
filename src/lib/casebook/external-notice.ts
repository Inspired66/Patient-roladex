// The one-time "this opens outside Vellum" notice. Only a boolean is stored.
export const EXTERNAL_NOTICE_KEY = "vellum-external-open-accepted";
export const EXTERNAL_NOTICE_TITLE = "Open in another app?";
export const EXTERNAL_NOTICE_BODY =
  "This file will open in another app on your phone. That app is outside Vellum's protections: it may keep a copy, show it in recent apps, or sync it online. Vellum deletes its temporary copy afterwards.";

type NoticeStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): NoticeStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function hasAcceptedExternalNotice(storage: NoticeStorage | null = defaultStorage()) {
  try {
    return storage?.getItem(EXTERNAL_NOTICE_KEY) === "1";
  } catch {
    return false;
  }
}

export function rememberExternalNotice(storage: NoticeStorage | null = defaultStorage()) {
  try {
    storage?.setItem(EXTERNAL_NOTICE_KEY, "1");
  } catch {
    // Without storage the notice simply shows again next time.
  }
}

// Shows the notice again on the next open.
export function resetExternalNotice(storage: NoticeStorage | null = defaultStorage()) {
  try {
    storage?.removeItem(EXTERNAL_NOTICE_KEY);
  } catch {
    // Nothing to reset.
  }
}

type NoticeHost = (answer: (accepted: boolean) => void) => void;
let host: NoticeHost | null = null;
let waiting = false;

export function registerExternalNoticeHost(next: NoticeHost) {
  host = next;
  return () => {
    if (host === next) host = null;
  };
}

// Resolves true only when the person taps Open. Without a mounted host, or while another notice
// is showing, it resolves false so nothing opens unasked.
export function requestExternalNotice(): Promise<boolean> {
  if (!host || waiting) return Promise.resolve(false);
  const show = host;
  waiting = true;
  return new Promise<boolean>((resolve) => {
    show((accepted) => {
      waiting = false;
      resolve(accepted);
    });
  });
}
