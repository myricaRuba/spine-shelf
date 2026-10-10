import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

const STORAGE_KEY = "spine-shelf.preview-width";
const MIN_WIDTH = 320;
const MAX_WIDTH = 860;
const MIN_LIBRARY_WIDTH = 420;
function readWidth(): number | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const value = Number(stored);
    return stored &&
      Number.isFinite(value) &&
      value >= MIN_WIDTH &&
      value <= MAX_WIDTH
      ? value
      : null;
  } catch {
    return null;
  }
}

export default function PreviewPane({ children }: { children: ReactNode }) {
  const pane = useRef<HTMLDivElement>(null);
  const [preferred, setPreferred] = useState(readWidth);
  const [bounds, setBounds] = useState({ max: MAX_WIDTH, defaultWidth: 395 });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{
    pointer: number;
    x: number;
    width: number;
    preferred: number | null;
  } | null>(null);
  const width = Math.min(
    bounds.max,
    Math.max(MIN_WIDTH, preferred ?? bounds.defaultWidth),
  );
  const currentWidth = useRef(width);
  currentWidth.current = width;
  const clamp = (value: number) =>
    Math.round(Math.min(bounds.max, Math.max(MIN_WIDTH, value)));
  const save = (value: number | null) => {
    setPreferred(value);
    try {
      if (value === null) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, String(value));
    } catch {
      /* Width changes still work if local storage is unavailable. */
    }
  };

  useLayoutEffect(() => {
    const parent = pane.current?.parentElement;
    const sidebar = parent?.querySelector(".sidebar");
    if (!parent || !sidebar) return;
    const measure = () => {
      const total = parent.clientWidth;
      const max = Math.max(
        MIN_WIDTH,
        Math.min(
          MAX_WIDTH,
          total - sidebar.getBoundingClientRect().width - MIN_LIBRARY_WIDTH,
        ),
      );
      const defaultWidth = total >= 1600 ? 450 : total <= 1330 ? 352 : 395;
      setBounds((previous) =>
        previous.max === max && previous.defaultWidth === defaultWidth
          ? previous
          : { max, defaultWidth },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    observer.observe(sidebar);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!dragging) return;
    document.body.classList.add("resizing-preview");
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (drag.current) setPreferred(drag.current.preferred);
        drag.current = null;
        setDragging(false);
      }
    };
    window.addEventListener("keydown", cancel);
    return () => {
      document.body.classList.remove("resizing-preview");
      window.removeEventListener("keydown", cancel);
    };
  }, [dragging]);

  const finish = (cancel = false) => {
    if (!drag.current) return;
    if (cancel) setPreferred(drag.current.preferred);
    else save(currentWidth.current);
    drag.current = null;
    setDragging(false);
  };

  return (
    <div
      ref={pane}
      id="preview-pane"
      className={`preview-pane ${dragging ? "is-resizing" : ""}`}
      style={{ width }}
    >
      <div
        role="separator"
        aria-label="调整预览面板宽度"
        aria-orientation="vertical"
        aria-controls="preview-pane"
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={bounds.max}
        aria-valuenow={width}
        aria-valuetext={`预览宽度 ${Math.round(width)} 像素`}
        data-tooltip="左右拖动调整预览宽度 · 双击恢复默认"
        data-tooltip-side="left"
        tabIndex={0}
        className="preview-resizer"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus();
          drag.current = {
            pointer: event.pointerId,
            x: event.clientX,
            width,
            preferred,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (!start || start.pointer !== event.pointerId) return;
          const value = clamp(start.width + start.x - event.clientX);
          currentWidth.current = value;
          setPreferred(value);
        }}
        onPointerUp={(event) => {
          finish();
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => finish(true)}
        onLostPointerCapture={() => finish()}
        onDoubleClick={() => save(null)}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 50 : 16;
          if (
            !["ArrowLeft", "ArrowRight", "Home", "End", "Enter"].includes(
              event.key,
            )
          )
            return;
          event.preventDefault();
          if (event.key === "Enter") save(null);
          else
            save(
              clamp(
                event.key === "Home"
                  ? MIN_WIDTH
                  : event.key === "End"
                    ? bounds.max
                    : width + (event.key === "ArrowLeft" ? step : -step),
              ),
            );
        }}
      >
        <span className="resizer-grip" />
        {dragging && (
          <span className="resizer-value">{Math.round(width)} px</span>
        )}
      </div>
      {children}
    </div>
  );
}
