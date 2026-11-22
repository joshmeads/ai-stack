// Typing over the site's text, in the editor: double-click a text inside a part to change its words. Enter (or
// clicking away) keeps it, Escape puts it back. What's sent is each text piece before and after (the page keeps a text
// with a <br> or an <em> in it as several pieces), so the dev server can find those exact words in the source; if the
// edit changed the formatting inside the text (deleted across an <em>, say), that's said too, and Claude does it.
//
// Two ways to type:
// - In place: the text itself becomes editable, so the words keep their font, size and colour while you type. Only the
//   words of its text pieces change; the page's own code (React, say) keeps the same nodes.
// - In a box over the text: when the words are split into letters for an animation, editing them in place would
//   remove the page's own letter elements and break the code that animates them. The box leaves the page alone; the
//   new words go to Claude, who changes them where they're written.

import { isPickedObject } from "./parts";
import { layerAround, layerIdOf } from "./resolve";

export type TextEdit = {
  partId: string;
  changes: { from: string; to: string }[]; // each text piece that changed: all of it before, and after
  whole: { from: string; to: string }; // the whole text, for Claude when it can't be done directly
  structural: boolean; // the pieces or the formatting around them changed, not only the words
  revert: () => void; // put the old words back on the page (when the change goes to Claude instead)
};
// A box over split text, drawn by the editor in the site's coordinates
type FontKey = "fontFamily" | "fontSize" | "fontWeight" | "fontStyle" | "lineHeight" | "letterSpacing" | "textAlign" | "textTransform";
export type TextBox = { partId: string; text: string; rect: { x: number; y: number; w: number; h: number }; font: Record<FontKey, string> };
export type Started = { partId: string; root: Element; box?: TextBox }; // root: the element whose words are typed over

// The box is drawn by the editor, which doesn't have the site's fonts: its stand-in letters are usually wider, so the
// words wrapped and the box grew past the text it covers. Here they are sized to fill the box the page's words do: a
// single line stays a single line, as wide as the original; several lines shrink until they are as tall. Typing more
// than was there widens a single line and lengthens several.
export function fitTextBox(el: HTMLTextAreaElement, box: TextBox, pad: number) {
  const size = parseFloat(box.font.fontSize) || 16;
  const line = parseFloat(box.font.lineHeight) || size * 1.2;
  const oneLine = box.rect.h < line * 1.6;
  el.style.letterSpacing = `${(parseFloat(box.font.letterSpacing) || 0) / size}em`; // follows the size
  if (oneLine) {
    el.style.whiteSpace = "nowrap";
    el.style.lineHeight = `${box.rect.h}px`; // as tall as the words on the page, also when the page trims their line box
    el.style.width = "auto";
    el.style.minWidth = `${box.rect.w + pad}px`;
  } else el.style.lineHeight = String(line / size);
  const over = () => (oneLine ? Math.max(el.scrollWidth, el.offsetWidth) > box.rect.w + pad + 1 : el.scrollHeight > box.rect.h + pad + 1);
  if (!over()) return;
  let fits = size * 0.2;
  let tooBig = size;
  for (let i = 0; i < 8; i++) {
    const mid = (fits + tooBig) / 2;
    el.style.fontSize = `${mid}px`;
    if (over()) tooBig = mid;
    else fits = mid;
  }
  el.style.fontSize = `${fits}px`;
}

// Inline formatting stays inside one editable text; anything else is where it stops
const INLINE = new Set(["inline", "inline-block", "contents"]);

// The words to type over at a point, inside the block of words that is under the pointer there (`within`: the tree
// says which thing that is, so words lying behind a card are never typed over through it). Where the caret lands when
// it lands inside it; else the piece of its text whose box holds the point (text under pointer-events: none, which
// the caret can't reach); else its first words.
function textAt(doc: Document, x: number, y: number, within: Element): Text | null {
  type CaretDoc = Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node } | null };
  const node = (doc as CaretDoc).caretPositionFromPoint?.(x, y)?.offsetNode ?? doc.caretRangeFromPoint?.(x, y)?.startContainer ?? null;
  if (node && node.nodeType === Node.TEXT_NODE && node.textContent?.trim() && within.contains(node)) return node as Text;
  const inside = (r: DOMRect) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  const range = doc.createRange();
  const walk = doc.createTreeWalker(within, NodeFilter.SHOW_TEXT);
  let first: Text | null = null;
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (!n.textContent?.trim()) continue;
    first ??= n as Text;
    range.selectNodeContents(n);
    if (Array.from(range.getClientRects()).some(inside)) return n as Text;
  }
  return first;
}

const texts = (root: Element) => {
  const out: Text[] = [];
  const walk = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) out.push(n as Text);
  return out;
};
// The shape of a text: its tags and where its pieces of text sit, without the words
const shapeOf = (root: Element) => {
  const out: string[] = [];
  const walk = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) out.push(n.nodeType === Node.TEXT_NODE ? "#" : (n as Element).tagName);
  return out.join(" ");
};
// Words split into letters (or single words) by an animation: mostly one-character pieces
const isSplit = (pieces: Text[]) => {
  const words = pieces.filter((t) => t.data.trim());
  return words.length >= 4 && words.filter((t) => t.data.trim().length <= 1).length >= words.length / 2;
};
// The whole text as a reader sees it (white space folded)
const read = (s: string) => s.replace(/[ \t\r\n\f]+/g, " ").trim();

// Start editing the words of a block of words at a point of the site's page (`within`: that block's element). Returns
// null when it has no words, or they aren't in a part.
export function beginTextEdit(doc: Document, x: number, y: number, within: Element, onEnd: (edit: TextEdit | null) => void): Started | null {
  const node = textAt(doc, x, y, within);
  // Words belong to the layer of the map they sit in: an object that was only picked isn't one, and typing over its
  // words doesn't make it one
  let partEl = layerAround(node?.parentElement);
  while (partEl && isPickedObject(layerIdOf(partEl))) partEl = layerAround(partEl.parentElement);
  const partId = layerIdOf(partEl);
  const view = doc.defaultView;
  if (!node || !partEl || !partId || !view) return null;

  // The text: up from the words through inline formatting (an <em>, a link, letter spans), never past the part
  let root = node.parentElement as HTMLElement;
  while (root !== partEl && root.parentElement && INLINE.has(view.getComputedStyle(root).display)) root = root.parentElement;
  const pieces = texts(root);

  if (isSplit(pieces)) {
    const r = root.getBoundingClientRect();
    const cs = view.getComputedStyle(root);
    const text = read(root.textContent ?? "");
    return {
      partId,
      root,
      box: {
        partId,
        text,
        rect: { x: r.left, y: r.top, w: r.width, h: r.height },
        font: { fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight, fontStyle: cs.fontStyle, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing, textAlign: cs.textAlign, textTransform: cs.textTransform },
      },
    };
  }

  const before = pieces.map((t) => t.data);
  const shape = shapeOf(root);
  const wholeBefore = root.textContent ?? "";

  // Editable, marked, and selectable even on sites that switch selection off
  const saved = { editable: root.getAttribute("contenteditable"), style: root.getAttribute("style") };
  try {
    root.contentEditable = "plaintext-only"; // no bold or pasted formatting, only words
  } catch {
    root.contentEditable = "true";
  }
  root.style.outline = "2px solid #ffcc33";
  root.style.outlineOffset = "3px";
  root.style.userSelect = "text";
  root.style.webkitUserSelect = "text";
  root.style.cursor = "text";
  root.spellcheck = false;
  root.focus({ preventScroll: true });
  // The double-clicked word is selected, so typing replaces it. The caret lands before or after the letter under the
  // pointer; one letter back puts it inside that word (or at its start), then the word's end, then back to its start.
  const sel = view.getSelection();
  const at = doc.caretRangeFromPoint?.(x, y);
  if (sel && at) {
    sel.removeAllRanges();
    sel.addRange(at);
    type Modifiable = Selection & { modify?: (alter: string, direction: string, granularity: string) => void };
    const modify = (sel as Modifiable).modify?.bind(sel);
    if (at.startOffset > 0) modify?.("move", "backward", "character");
    modify?.("move", "forward", "word");
    modify?.("extend", "backward", "word");
  }

  let done = false;
  // The old words back: in the same text pieces when the shape held, so the page's own code keeps its nodes; if the
  // shape changed (formatting deleted), the page is reloaded rather than rebuilt under that code
  const putBack = () => {
    const now = texts(root);
    if (shapeOf(root) === shape && now.length === before.length) now.forEach((t, i) => t.data !== before[i] && (t.data = before[i]));
    else view.location.reload();
  };
  const finish = (keep: boolean) => {
    if (done) return;
    done = true;
    root.removeEventListener("keydown", onKey, true);
    root.removeEventListener("keyup", stop, true);
    root.removeEventListener("keypress", stop, true);
    root.removeEventListener("blur", onBlur);
    if (saved.editable === null) root.removeAttribute("contenteditable");
    else root.setAttribute("contenteditable", saved.editable);
    if (saved.style === null) root.removeAttribute("style");
    else root.setAttribute("style", saved.style);
    view.getSelection()?.removeAllRanges();
    if (!keep) {
      putBack();
      return onEnd(null);
    }
    const after = texts(root);
    // A no-break space the browser put in while typing is an ordinary space, unless the text had one before
    const plain = (s: string, was: string) => (was.includes(" ") ? s : s.replace(/ /g, " "));
    const wholeAfter = plain(root.textContent ?? "", wholeBefore);
    if (wholeAfter === wholeBefore) return onEnd(null);
    const structural = shapeOf(root) !== shape || after.length !== before.length;
    const changes = structural ? [] : after.map((t, i) => ({ from: before[i], to: plain(t.data, before[i]) })).filter((c) => c.from !== c.to);
    onEnd({ partId, changes, whole: { from: read(wholeBefore), to: read(wholeAfter) }, structural, revert: putBack });
  };
  // Keys typed here are for the text: the site's own shortcuts and the editor's don't hear them
  const stop = (ev: Event) => ev.stopPropagation();
  const onKey = (ev: KeyboardEvent) => {
    ev.stopPropagation();
    if (ev.key === "Enter") {
      ev.preventDefault();
      finish(true);
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      finish(false);
    }
  };
  const onBlur = () => finish(true);
  root.addEventListener("keydown", onKey, true);
  root.addEventListener("keyup", stop, true);
  root.addEventListener("keypress", stop, true);
  root.addEventListener("blur", onBlur);
  return { partId, root };
}
