import assert from "node:assert/strict";
import test from "node:test";
import { openRestorePicker } from "./restore-picker.ts";

test("opens the web picker directly when there is no native bridge", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Reflect.deleteProperty(globalThis, "window");
  let clicked = false;
  try {
    await openRestorePicker({ click: () => (clicked = true) });
    assert.equal(clicked, true);
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
  }
});

test("arms the native restore picker before opening the file input", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  let request: { id: string; action: string; payload: unknown } | undefined;
  let reply: ((event: MessageEvent<string>) => void) | undefined;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      VellumNative: {
        postMessage: (message: string) => {
          request = JSON.parse(message);
        },
        addEventListener: (_type: "message", listener: (event: MessageEvent<string>) => void) => {
          reply = listener;
        },
      },
    },
  });
  let clicked = false;
  try {
    const pending = openRestorePicker({ click: () => (clicked = true) });
    assert.equal(request?.action, "armRestorePicker");
    assert.deepEqual(request?.payload, { purpose: "casebookRestore" });
    assert.equal(clicked, false);
    reply?.({
      data: JSON.stringify({ id: request?.id, ok: true, result: { armed: true } }),
    } as MessageEvent<string>);
    await pending;
    assert.equal(clicked, true);
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("does not open the file input when the native picker arm fails", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  let requestId = "";
  let reply: ((event: MessageEvent<string>) => void) | undefined;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      VellumNative: {
        postMessage: (message: string) => {
          requestId = (JSON.parse(message) as { id: string }).id;
        },
        addEventListener: (_type: "message", listener: (event: MessageEvent<string>) => void) => {
          reply = listener;
        },
      },
    },
  });
  let clicked = false;
  try {
    const pending = openRestorePicker({ click: () => (clicked = true) });
    reply?.({
      data: JSON.stringify({ id: requestId, ok: true, result: { armed: false } }),
    } as MessageEvent<string>);
    await assert.rejects(pending, /could not open the restore file picker/);
    assert.equal(clicked, false);
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
