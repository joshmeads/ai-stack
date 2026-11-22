// When the editor's window is too narrow, and whether to say so (NarrowCover.tsx).
//
// The cover shows in one place only: the Claude desktop app's own browser, the pane beside the chat. That pane is
// narrow by default, the editor's three columns don't fit it, and the person may not know that the same address
// opens in their browser. In an ordinary browser a narrow window is the person's own doing, and nothing is said.

// The app's browser names itself in its user agent ("… Claude/5.11492.5 Chrome/156.0.0.0 Safari/537.36"). Chrome,
// Safari, Firefox and Edge never do.
export const inClaudeApp = (userAgent: string): boolean => /\bClaude\/\d/.test(userAgent);

// The two side columns (--e-left 248 + --e-right 320 in Editor.module.css) and the narrowest frame the site is worth
// looking at in between: a phone, 390 wide.
export const EDITOR_MIN_WIDTH = 248 + 320 + 390;

export const coverDue = (userAgent: string, width: number): boolean => inClaudeApp(userAgent) && width < EDITOR_MIN_WIDTH;
