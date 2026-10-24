type NativeRequest = {
  id: string;
  action: string;
  payload?: unknown;
};

type NativeReply<T> = {
  id: string;
  ok: boolean;
  result?: T;
  error?: string;
};

type NativeMessageEvent = MessageEvent<string>;

type NativeWebMessage = {
  postMessage: (message: string) => void;
  addEventListener: (type: "message", listener: (event: NativeMessageEvent) => void) => void;
};

type NativeWindow = Window & {
  VellumNative?: NativeWebMessage;
};

const pending = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: number }
>();
let sequence = 0;
let listeningOn: NativeWebMessage | null = null;

function onNativeMessage(event: NativeMessageEvent) {
  let reply: NativeReply<unknown>;
  try {
    reply = JSON.parse(event.data) as NativeReply<unknown>;
  } catch {
    return;
  }
  if (!reply || typeof reply.id !== "string") return;
  const request = pending.get(reply.id);
  if (!request) return;
  window.clearTimeout(request.timer);
  pending.delete(reply.id);
  if (reply.ok) request.resolve(reply.result);
  else request.reject(new Error(reply.error || "The phone could not complete that action."));
}

function nativeMessage() {
  if (typeof window === "undefined") return null;
  const bridge = (window as NativeWindow).VellumNative;
  if (!bridge || typeof bridge.postMessage !== "function") return null;
  if (listeningOn !== bridge) {
    bridge.addEventListener("message", onNativeMessage);
    listeningOn = bridge;
  }
  return bridge;
}

export function hasNativeMessageBridge() {
  return nativeMessage() !== null;
}

export function callNative<T>(action: string, payload?: unknown, timeoutMs = 120_000) {
  const bridge = nativeMessage();
  if (!bridge) return Promise.resolve(null);
  const id = `web-${Date.now().toString(36)}-${(++sequence).toString(36)}`;
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(id);
      reject(new Error("The phone did not respond in time."));
    }, timeoutMs);
    pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
    try {
      const request: NativeRequest = { id, action, payload };
      bridge.postMessage(JSON.stringify(request));
    } catch (error) {
      window.clearTimeout(timer);
      pending.delete(id);
      reject(error instanceof Error ? error : new Error("The phone could not complete that action."));
    }
  });
}
