// A fixed bar docked to the bottom of the viewport (the conversation audio
// mini-player) publishes its height as `--bottom-dock-height` on the root, so
// other floating UI — the mobile capture button — can sit above it instead of
// covering its controls. Unset means no bar, and readers fall back to 0px.

const BOTTOM_DOCK_HEIGHT_VAR = "--bottom-dock-height";

/** Callback ref for the docked bar. Relies on React 19 ref cleanup. */
export function registerBottomDock(node: HTMLElement | null) {
  if (!node) return;
  const root = document.documentElement;
  const update = () =>
    root.style.setProperty(BOTTOM_DOCK_HEIGHT_VAR, `${node.offsetHeight}px`);
  update();
  const observer = new ResizeObserver(update);
  observer.observe(node);
  return () => {
    observer.disconnect();
    root.style.removeProperty(BOTTOM_DOCK_HEIGHT_VAR);
  };
}
