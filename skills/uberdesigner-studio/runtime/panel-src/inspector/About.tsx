import { useEffect, useRef } from "react";
import e from "./Editor.module.css";

// The About card, opened by the uberdesigner logo at the top left (the art director's design, 18 Nov 2026; the
// headline is Bogdan's: "Slop Ends Here."): the wordmark, a line about what this is, one violet way to the templates, and the community links (a tile whose
// address is empty would show greyed and inert). Escape, the close button or a click outside closes it.

const LINKS = {
  website: "https://uberdesigner.ai",
  templates: "https://uberdesigner.ai/library?utm_source=uberdesigner-skill&utm_medium=skill&utm_campaign=about-card",
  x: "https://x.com/uberdesigner_ai",
  github: "https://github.com/bogdan239/uberdesigner-studio",
  discord: "https://discord.gg/CuyTccfBg3",
};

const ICONS = {
  x: "M18.9 2H22l-6.8 7.8L23.2 22h-6.3L12 14.6 5.5 22H2.3l8.2-9.4L.8 2h6.5l4.4 6.7L18.9 2Zm-1.1 18h1.7L6.4 3.9H4.6L17.8 20Z",
  github:
    "M12 1.4a10.8 10.8 0 0 0-3.4 21.1c.5.1.7-.2.7-.5v-2.1c-2.8.6-3.4-1.2-3.4-1.2-.5-1.2-1.2-1.5-1.2-1.5-1-.7.1-.7.1-.7 1.1.1 1.7 1.1 1.7 1.1 1 1.7 2.6 1.2 3.2.9.1-.7.4-1.2.7-1.5-2.3-.3-4.7-1.2-4.7-5.3 0-1.2.4-2.1 1.1-2.9-.1-.3-.5-1.4.1-2.9 0 0 .9-.3 3 1.1a10.4 10.4 0 0 1 5.5 0c2.1-1.4 3-1.1 3-1.1.6 1.5.2 2.6.1 2.9.7.8 1.1 1.7 1.1 2.9 0 4.1-2.5 5-4.8 5.3.4.3.7 1 .7 2v3c0 .3.2.6.7.5A10.8 10.8 0 0 0 12 1.4Z",
  discord:
    "M19.7 4.5a18 18 0 0 0-4.4-1.4l-.5 1a16.4 16.4 0 0 0-5.6 0l-.5-1a18 18 0 0 0-4.4 1.4C1.5 8.7.7 12.7 1.1 16.7a18 18 0 0 0 5.4 2.7l1.1-1.8-1.7-.8.4-.3a13 13 0 0 0 11.4 0l.4.3-1.7.8 1.1 1.8a18 18 0 0 0 5.4-2.7c.5-4.6-.8-8.6-3.2-12.2ZM8.6 14.3c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Zm6.8 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Z",
};

// The uberdesigner mark, as in the site's own logo
export const MARK =
  "M23.9192 12.0006C23.9192 15.2466 22.6201 18.1893 20.5149 20.3383V13.9434C19.5375 14.626 18.3854 15.1914 17.1089 15.6063V22.7693C16.0506 23.272 14.9067 23.6242 13.7047 23.796V16.3085C13.1493 16.3628 12.5817 16.3922 12.0044 16.3923C11.4264 16.3923 10.8564 16.3629 10.3005 16.3085V23.796C9.09865 23.624 7.95431 23.2722 6.8963 22.7693V15.6063C5.62038 15.1915 4.46911 14.6258 3.49195 13.9434V20.3383C1.38689 18.1893 0.0877876 15.2466 0.0877876 12.0006C0.0881538 5.53647 5.23711 0.274989 11.6568 0.091173C11.772 0.0888332 11.8884 0.0876083 12.0044 0.0876083C12.1206 0.087614 12.2365 0.0888126 12.3519 0.091173C18.7712 0.275507 23.9188 5.53679 23.9192 12.0006Z";

function Tile({ id, title, note }: { id: keyof typeof ICONS; title: string; note: string }) {
  const inside = (
    <>
      <span className={e.aboutTileTop}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d={ICONS[id]} />
        </svg>
        <span className={e.aboutArrow} aria-hidden="true">
          ↗
        </span>
      </span>
      <span>
        <strong>{title}</strong>
        <small>{note}</small>
      </span>
    </>
  );
  return LINKS[id] ? (
    <a className={e.aboutTile} href={LINKS[id]} target="_blank" rel="noopener noreferrer">
      {inside}
    </a>
  ) : (
    <div className={e.aboutTile} data-pending="true" role="link" aria-disabled="true" aria-label={`${title}: not available yet`}>
      {inside}
    </div>
  );
}

export function About({ onClose }: { onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    box.current?.querySelector<HTMLElement>("button")?.focus();
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className={e.aboutBack} onClick={onClose}>
      <div ref={box} className={e.about} role="dialog" aria-modal="true" aria-labelledby="uberdesigner-about-title" onClick={(ev) => ev.stopPropagation()}>
        <button type="button" className={e.aboutClose} onClick={onClose} aria-label="Close">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m6 6 12 12M6 18 18 6" />
          </svg>
        </button>
        <a className={e.aboutWordmark} href={LINKS.website} target="_blank" rel="noopener noreferrer" aria-label="uberdesigner website">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d={MARK} />
          </svg>
          <span>uberdesigner</span>
        </a>
        <div className={e.aboutIntro}>
          <h2 id="uberdesigner-about-title">Slop Ends Here.</h2>
          <p>Templates, tools and people to build with.</p>
        </div>
        <a className={e.aboutTemplates} href={LINKS.templates} target="_blank" rel="noopener noreferrer">
          <span className={e.aboutTemplatesIcon} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>
            <strong>Explore Templates</strong>
            <small>A better starting point for your next website.</small>
          </span>
          <span className={e.aboutTemplatesArrow} aria-hidden="true">
            ↗
          </span>
        </a>
        <div className={e.aboutSocials}>
          <Tile id="x" title="Follow on X" note="Follow what’s next" />
          <Tile id="github" title="GitHub" note="Explore the project" />
          <Tile id="discord" title="Join Discord" note="Meet the community" />
        </div>
      </div>
    </div>
  );
}
