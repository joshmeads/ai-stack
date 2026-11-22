import type { Stale } from "./jobs";

// Over the page when something needs a reload to show. The page is reloaded only by this button (or by the click
// that asked for an Undo or a restore), never at a moment the person didn't choose.
export function ReloadBar({ stale, onReload, className }: { stale: Stale; onReload: () => void; className: string }) {
  const what = stale.files.length === 1 ? stale.files[0] : `${stale.files.length} files`;
  return (
    <div className={className} role="status">
      <span>{stale.asked ? "Your change is in the code. Reload the page to see it." : `${what} changed: reload the page to see it`}</span>
      <button type="button" onClick={onReload}>
        Reload page
      </button>
    </div>
  );
}
