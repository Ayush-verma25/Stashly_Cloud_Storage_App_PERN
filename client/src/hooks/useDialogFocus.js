import { useEffect, useRef, useState } from "react";

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "video[controls]",
  "audio[controls]",
  "iframe",
  '[tabindex]:not([tabindex="-1"]):not([data-dialog-focus-end])',
].join(", ");

const captureOpener = () => {
  const opener = typeof document === "undefined" ? null : document.activeElement;
  const trigger = opener?.closest("[data-item-actions]")
    ?.querySelector("[data-item-actions-trigger]");
  return { opener, trigger };
};

export function useDialogFocus(isOpen, onClose) {
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const [openSnapshot, setOpenSnapshot] = useState(() => ({
    isOpen,
    focusReturn: isOpen ? captureOpener() : null,
  }));

  if (openSnapshot.isOpen !== isOpen) {
    setOpenSnapshot({ isOpen, focusReturn: isOpen ? captureOpener() : null });
  }

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const { opener, trigger } = openSnapshot.focusReturn;
    const getFocusableElements = () =>
      Array.from(dialog.querySelectorAll(focusableSelector));

    if (!dialog.contains(document.activeElement)) {
      (getFocusableElements()[0] || dialog).focus();
    }

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusableElements = getFocusableElements();
      if (!focusableElements.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === dialog ||
          !dialog.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        ((document.activeElement === last && !dialog.querySelector("[data-dialog-focus-end]")) ||
          document.activeElement === dialog ||
          !dialog.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    const handleFocusIn = (event) => {
      if (event.target.matches("[data-dialog-focus-end]")) {
        (getFocusableElements()[0] || dialog).focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    dialog.addEventListener("focusin", handleFocusIn);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      dialog.removeEventListener("focusin", handleFocusIn);
      const target = opener?.isConnected ? opener : trigger;
      if (target instanceof HTMLElement && target.isConnected) target.focus();
    };
  }, [isOpen, openSnapshot.focusReturn]);

  return dialogRef;
}
