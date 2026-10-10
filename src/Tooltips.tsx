import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const SELECTOR =
  "[data-tooltip],button.icon-btn[aria-label],button.play-btn[aria-label],button.swatch[aria-label],button.card-favorite[aria-label],.view-toggle button[aria-label]";
const ID = "shelf-control-tooltip";

export default function Tooltips() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0, ready: false });
  const bubble = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let candidate: HTMLElement | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const hide = () => {
      clearTimeout(timer);
      candidate = null;
      setTarget(null);
    };
    const find = (node: EventTarget | null) =>
      node instanceof Element ? node.closest<HTMLElement>(SELECTOR) : null;
    const show = (element: HTMLElement | null, immediate = false) => {
      if (
        !element ||
        element === candidate ||
        document.body.classList.contains("resizing-preview")
      )
        return;
      hide();
      candidate = element;
      timer = setTimeout(
        () => {
          if (!element.isConnected) return;
          setPosition({ left: 0, top: 0, ready: false });
          setTarget(element);
        },
        immediate ? 0 : 260,
      );
    };
    const over = (event: PointerEvent) => {
      if (event.pointerType !== "touch") show(find(event.target));
    };
    const out = (event: PointerEvent) => {
      if (find(event.relatedTarget) !== candidate) hide();
    };
    const focus = (event: FocusEvent) => show(find(event.target), true);
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    document.addEventListener("pointerover", over);
    document.addEventListener("pointerout", out);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", hide);
    document.addEventListener("pointerdown", hide);
    document.addEventListener("scroll", hide, true);
    document.addEventListener("keydown", key);
    window.addEventListener("resize", hide);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerout", out);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("pointerdown", hide);
      document.removeEventListener("scroll", hide, true);
      document.removeEventListener("keydown", key);
      window.removeEventListener("resize", hide);
    };
  }, []);

  useLayoutEffect(() => {
    if (!target || !bubble.current) return;
    const anchor = target.getBoundingClientRect();
    const box = bubble.current.getBoundingClientRect();
    const margin = 10,
      gap = 9;
    let left = anchor.left + (anchor.width - box.width) / 2;
    let top = anchor.top - box.height - gap;
    if (
      target.dataset.tooltipSide === "left" ||
      target.closest(".stage-toolbar")
    ) {
      left = anchor.left - box.width - gap;
      top = anchor.top + (anchor.height - box.height) / 2;
    } else if (top < margin) top = anchor.bottom + gap;
    setPosition({
      left: Math.max(
        margin,
        Math.min(left, window.innerWidth - box.width - margin),
      ),
      top: Math.max(
        margin,
        Math.min(top, window.innerHeight - box.height - margin),
      ),
      ready: true,
    });
    const previous = target.getAttribute("aria-describedby");
    target.setAttribute(
      "aria-describedby",
      [previous, ID].filter(Boolean).join(" "),
    );
    return () => {
      if (previous) target.setAttribute("aria-describedby", previous);
      else target.removeAttribute("aria-describedby");
    };
  }, [target]);

  if (!target) return null;
  return createPortal(
    <div
      ref={bubble}
      id={ID}
      role="tooltip"
      className="control-tooltip"
      style={{
        left: position.left,
        top: position.top,
        visibility: position.ready ? "visible" : "hidden",
      }}
    >
      {target.dataset.tooltip || target.getAttribute("aria-label")}
    </div>,
    document.body,
  );
}
