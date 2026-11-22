import type { PartKind } from "./parts";
import e from "./Editor.module.css";

// A layer's icon by what it is, drawn in the editor's 16 × 16 line style (as Figma marks frames, text and images)

export type IconKind = PartKind | "site" | "group";

const PATHS: Record<IconKind, React.ReactNode> = {
  site: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M2.5 8h11M8 2.5c1.8 1.6 2.6 3.4 2.6 5.5S9.8 11.9 8 13.5M8 2.5C6.2 4.1 5.4 5.9 5.4 8s.8 3.9 2.6 5.5" />
    </>
  ),
  group: <path d="M2.5 4.5h4l1.2 1.5h5.8v6.5h-11z" />,
  section: <path d="M5 2v12M11 2v12M2 5h12M2 11h12" />,
  frame: <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" strokeDasharray="2 1.6" />,
  text: <path d="M3.5 3.5h9M8 3.5v9.5M6.3 13h3.4" />,
  image: (
    <>
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
      <circle cx="6" cy="6.5" r="1.1" />
      <path d="m2.5 11.5 3.5-3.2 2.5 2.2 2-1.6 3 2.6" />
    </>
  ),
  video: (
    <>
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
      <path d="M6.8 5.8v4.4L10.3 8z" />
    </>
  ),
  button: (
    <>
      <rect x="1.8" y="4.8" width="12.4" height="6.4" rx="3.2" />
      <path d="M5.5 8h5" />
    </>
  ),
  icon: <path d="m8 2.5 1.6 3.6 3.9.4-2.9 2.6.8 3.9L8 11l-3.4 2 .8-3.9-2.9-2.6 3.9-.4z" />,
  scene: <path d="m8 2 5.5 3v6L8 14l-5.5-3V5zM2.5 5 8 8l5.5-3M8 8v6" />,
  list: (
    <>
      <path d="M6 4.5h7.5M6 8h7.5M6 11.5h7.5" />
      <circle cx="3.3" cy="4.5" r=".6" />
      <circle cx="3.3" cy="8" r=".6" />
      <circle cx="3.3" cy="11.5" r=".6" />
    </>
  ),
};

const TITLES: Record<IconKind, string> = {
  site: "Whole site",
  group: "Group",
  section: "Section",
  frame: "Frame",
  text: "Text",
  image: "Image",
  video: "Video",
  button: "Button",
  icon: "Icon",
  scene: "3D or canvas scene",
  list: "List",
};

export function LayerIcon({ kind }: { kind: IconKind }) {
  return (
    <svg className={e.icon} viewBox="0 0 16 16" role="img" aria-label={TITLES[kind]} data-kind={kind}>
      <title>{TITLES[kind]}</title>
      {PATHS[kind]}
    </svg>
  );
}
