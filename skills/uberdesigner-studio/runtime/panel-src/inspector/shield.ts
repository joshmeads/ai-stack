import { useEffect, useRef, type RefObject } from "react";

// Keep the inspector's own keys, wheel and touches away from the site. Sites that turn Space, the arrow keys or the
// wheel into "next slide" listen for them on the whole window; without this, a space typed in the panel or in a card
// would move the site (and never reach the text field). Inside the inspector they still work as usual.
const KEPT = ["keydown", "keyup", "keypress", "wheel", "touchstart", "touchmove", "touchend"] as const;

export function useShield(ref: RefObject<HTMLElement | null>, on: boolean, onEscape?: () => void) {
  const escape = useRef(onEscape);
  escape.current = onEscape;
  useEffect(() => {
    const el = ref.current;
    if (!on || !el) return;
    const keep = (e: Event) => {
      e.stopPropagation();
      if (e instanceof KeyboardEvent && e.type === "keydown" && e.key === "Escape") {
        const t = e.target as HTMLElement;
        if (!t.closest("input, textarea, [contenteditable]")) escape.current?.();
      }
    };
    KEPT.forEach((type) => el.addEventListener(type, keep));
    return () => KEPT.forEach((type) => el.removeEventListener(type, keep));
  }, [ref, on]);
}
