import { callNative, hasNativeMessageBridge } from "./native-bridge.ts";

export async function openRestorePicker(input: Pick<HTMLInputElement, "click"> | null) {
  if (!input) throw new Error("The restore file picker is unavailable.");
  if (hasNativeMessageBridge()) {
    const result = await callNative<{ armed: boolean }>("armRestorePicker", {
      purpose: "casebookRestore",
    });
    if (!result?.armed) throw new Error("The phone could not open the restore file picker.");
  }
  input.click();
}
