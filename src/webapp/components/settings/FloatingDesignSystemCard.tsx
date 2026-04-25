import React from "react";
import { createPortal } from "react-dom";

import { DesignSystemSettingsCard } from "./DesignSystemSettingsCard";

interface FloatingDesignSystemCardProps {
  open: boolean;
  userId: string | null;
  onClose: () => void;
}

type FloatingRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type DragState = {
  pointerX: number;
  pointerY: number;
  originX: number;
  originY: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function buildDefaultRect(): FloatingRect {
  if (typeof window === "undefined") {
    return { x: 48, y: 48, width: 1120, height: 760 };
  }

  const width = Math.min(1200, Math.max(900, window.innerWidth - 96));
  const height = Math.min(860, Math.max(620, window.innerHeight - 96));

  return {
    x: Math.max(24, Math.round((window.innerWidth - width) / 2)),
    y: Math.max(24, Math.round((window.innerHeight - height) / 2)),
    width,
    height,
  };
}

export function FloatingDesignSystemCard({ open, userId, onClose }: FloatingDesignSystemCardProps): React.JSX.Element | null {
  const [rect, setRect] = React.useState<FloatingRect>(() => buildDefaultRect());
  const [dragState, setDragState] = React.useState<DragState | null>(null);
  const dialogRef = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    if (!open) {
      return;
    }

    setRect(buildDefaultRect());
  }, [open]);

  React.useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  React.useEffect(() => {
    if (!dragState) {
      return;
    }

    const handlePointerMove = (event: MouseEvent) => {
      const nextX = dragState.originX + (event.clientX - dragState.pointerX);
      const nextY = dragState.originY + (event.clientY - dragState.pointerY);
      const viewportWidth = typeof window === "undefined" ? rect.width + 48 : window.innerWidth;
      const viewportHeight = typeof window === "undefined" ? rect.height + 48 : window.innerHeight;
      setRect((previous) => ({
        ...previous,
        x: clamp(nextX, 16, Math.max(16, viewportWidth - previous.width - 16)),
        y: clamp(nextY, 16, Math.max(16, viewportHeight - previous.height - 16)),
      }));
    };

    const handlePointerUp = () => {
      setDragState(null);
    };

    window.addEventListener("mousemove", handlePointerMove);
    window.addEventListener("mouseup", handlePointerUp);
    return () => {
      window.removeEventListener("mousemove", handlePointerMove);
      window.removeEventListener("mouseup", handlePointerUp);
    };
  }, [dragState, rect.height, rect.width]);

  React.useEffect(() => {
    const node = dialogRef.current;
    if (!node) {
      return;
    }

    node.style.left = `${rect.x}px`;
    node.style.top = `${rect.y}px`;
    node.style.width = `${rect.width}px`;
    node.style.height = `${rect.height}px`;
    node.style.zIndex = "1200";
  }, [rect]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="dsc-floating-card-layer">
      <button
        type="button"
        aria-label="Close Design System Controls"
        className="dsc-floating-card__backdrop"
        onClick={onClose}
      />
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Design System Controls"
        className="dsc-floating-card"
        data-floating-layer="highest"
        data-clip-root="viewport"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div
          className="dsc-floating-card__header"
          onMouseDown={(event) => {
            if (event.button !== 0) {
              return;
            }

            setDragState({
              pointerX: event.clientX,
              pointerY: event.clientY,
              originX: rect.x,
              originY: rect.y,
            });
          }}
        >
          <div>
            <strong>Design System Controls</strong>
            <p>Floating top-layer workspace. Drag the header to move and use the panel corner to resize.</p>
          </div>
          <div className="dsc-floating-card__header-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setRect(buildDefaultRect())}
            >
              Recenter
            </button>
            <button type="button" onClick={onClose}>Close</button>
          </div>
        </div>
        <div className="dsc-floating-card__body">
          <div onMouseDown={(event) => event.stopPropagation()}>
            <DesignSystemSettingsCard userId={userId} />
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}