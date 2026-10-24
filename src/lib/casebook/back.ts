import { useEffect, useRef } from "react";

const stack: Array<() => void> = [];

export function useBackLayer(active: boolean, close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!active) return;
    const closeLayer = () => closeRef.current();
    stack.unshift(closeLayer);
    return () => {
      const index = stack.indexOf(closeLayer);
      if (index >= 0) stack.splice(index, 1);
    };
  }, [active]);
}

export function popBackLayer() {
  const closeLayer = stack[0];
  if (!closeLayer) return false;
  closeLayer();
  return true;
}

export function installBackBridge() {
  const host = window as Window & { __vellumBack?: () => boolean };
  host.__vellumBack = () => popBackLayer();
  return () => {
    if (host.__vellumBack) delete host.__vellumBack;
  };
}
