"use client";

/**
 * A dialog for drill-in detail.
 *
 * Built on the native `<dialog>` element rather than a div-and-portal, because
 * the browser already does the hard parts properly: it traps focus, closes on
 * Escape, makes the rest of the page inert to screen readers, and paints in the
 * top layer so no z-index on the page can ever cover it. Every one of those is
 * a thing a hand-rolled modal gets subtly wrong.
 *
 * The reason this exists at all: detail that does not fit. A full league's
 * standings or a game's box score inside a 380px column is a cramped table
 * nobody can read. Given its own surface it can be laid out properly, and the
 * page underneath stays a clean overview instead of growing accordions.
 */
import { X } from "lucide-react";
import { useEffect, useRef } from "react";

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  size = "regular",
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  /** "wide" for box scores and anything tabular. */
  size?: "regular" | "wide";
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // `showModal()` is what buys the top layer, the focus trap and the inert
    // background — opening it by toggling an attribute gets none of that.
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  /*
   * The browser fires `close` for Escape as well as for our own button, so
   * this is what keeps React's state honest when the user hits Esc.
   */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onNativeClose = () => onClose();
    el.addEventListener("close", onNativeClose);
    return () => el.removeEventListener("close", onNativeClose);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      className={`sc-modal${size === "wide" ? " sc-modal-wide" : ""}`}
      // Clicking the backdrop is the dialog element itself; clicking the panel
      // is a descendant. Comparing the target tells the two apart without a
      // wrapper element that would break the native centring.
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="sc-modal-panel">
        <header className="sc-modal-head">
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{title}</div>
            {subtitle && (
              <div style={{ fontSize: 11, color: "var(--sc-text-muted)" }}>{subtitle}</div>
            )}
          </div>
          <button
            type="button"
            className="sc-btn"
            onClick={onClose}
            aria-label="Close"
            style={{
              marginLeft: "auto",
              minHeight: 44,
              minWidth: 44,
              display: "grid",
              placeItems: "center",
            }}
          >
            <X size={15} />
          </button>
        </header>

        <div className="sc-modal-body">{children}</div>
      </div>
    </dialog>
  );
}
