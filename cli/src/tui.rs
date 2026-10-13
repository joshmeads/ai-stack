//! ratatui review screen for an install plan.

use std::io::{self, stdout};
use std::path::Path;

use anyhow::Result;
use crossterm::cursor;
use crossterm::event::{self, Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use crossterm::execute;
use crossterm::terminal::{
    EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode,
};
use ratatui::backend::CrosstermBackend;
use ratatui::layout::{Constraint, Layout};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Paragraph, Wrap};
use ratatui::{DefaultTerminal, Frame, Terminal};

use crate::models::{ModelReport, Status};
use crate::plan::Plan;

const PAGE: u16 = 10;

/// Shows the plan and model statuses. `c` toggles `--clean` and calls `replan` with the new
/// setting. Returns the plan to apply, or `None` when the user cancelled.
pub fn review(
    plan: Plan,
    clean: bool,
    models: &[ModelReport],
    home: &Path,
    replan: &mut dyn FnMut(bool) -> Result<Plan>,
) -> Result<Option<Plan>> {
    if plan.is_empty() {
        return Ok(None);
    }
    let mut app = App::new(models.iter().map(model_row).collect());
    app.load(&plan, home, clean);
    let mut plan = plan;
    install_panic_hook();
    let mut terminal = setup_terminal()?;
    let result = run(&mut terminal, &mut app, &mut |app: &mut App| {
        let clean = !app.clean;
        match replan(clean) {
            Ok(next) => {
                app.load(&next, home, clean);
                plan = next;
            }
            Err(err) => app.status = Some(format!("re-plan failed: {err:#}")),
        }
    });
    restore_terminal();
    result?;
    Ok((app.outcome == Some(true)).then_some(plan))
}

/// One selectable line in the action list and the text shown beside it.
struct Entry {
    summary: String,
    diff: String,
}

/// Pure review state. Rendering and key handling read and write only this.
struct App {
    /// Regular entries first, then the `--clean` entries from `clean_start` on.
    entries: Vec<Entry>,
    clean_start: usize,
    /// File actions plus commands; zero means there is nothing to apply.
    changes: usize,
    conflicts: Vec<String>,
    /// (alias, id, status text)
    models: Vec<(String, String, String)>,
    clean: bool,
    /// Set by `c`; the run loop re-plans and clears it.
    toggle_clean: bool,
    status: Option<String>,
    selected: usize,
    scroll: u16,
    outcome: Option<bool>,
}

impl App {
    fn new(models: Vec<(String, String, String)>) -> Self {
        Self {
            entries: Vec::new(),
            clean_start: 0,
            changes: 0,
            conflicts: Vec::new(),
            models,
            clean: false,
            toggle_clean: false,
            status: None,
            selected: 0,
            scroll: 0,
            outcome: None,
        }
    }

    /// Replaces the entries with `plan`'s: its regular lines and warnings, then its clean lines.
    fn load(&mut self, plan: &Plan, home: &Path, clean: bool) {
        let entry = |index: usize, summary: String| {
            let diff = match plan.diff(index) {
                diff if diff.is_empty() => format!("Runs `{}` after the file changes.", plan.commands[index - plan.actions.len()]),
                diff => diff,
            };
            Entry { summary, diff }
        };
        let (mut regular, mut cleaning) = (Vec::new(), Vec::new());
        for (index, summary) in plan.summary_lines(home).into_iter().enumerate() {
            if plan.is_clean(index) { &mut cleaning } else { &mut regular }.push(entry(index, summary));
        }
        regular.extend(plan.warnings.iter().map(|warning| Entry { summary: warning.clone(), diff: warning.clone() }));
        self.clean_start = regular.len();
        regular.append(&mut cleaning);
        self.entries = regular;
        self.changes = plan.len();
        self.conflicts = plan.conflicts.clone();
        self.clean = clean;
        self.status = None;
        self.selected = 0;
        self.scroll = 0;
    }

    fn can_apply(&self) -> bool {
        self.conflicts.is_empty() && self.changes > 0
    }

    fn max_scroll(&self) -> u16 {
        let lines = self
            .entries
            .get(self.selected)
            .map_or(0, |e| e.diff.lines().count());
        u16::try_from(lines.saturating_sub(1)).unwrap_or(u16::MAX)
    }

    fn select(&mut self, index: usize) {
        if index != self.selected {
            self.selected = index;
            self.scroll = 0;
        }
    }

    fn handle_key(&mut self, code: KeyCode) {
        match code {
            KeyCode::Up | KeyCode::Char('k') => self.select(self.selected.saturating_sub(1)),
            KeyCode::Down | KeyCode::Char('j') => {
                let last = self.entries.len().saturating_sub(1);
                self.select((self.selected + 1).min(last));
            }
            KeyCode::PageDown | KeyCode::Char('d') => {
                self.scroll = self.scroll.saturating_add(PAGE).min(self.max_scroll());
            }
            KeyCode::PageUp | KeyCode::Char('u') => self.scroll = self.scroll.saturating_sub(PAGE),
            KeyCode::Char('c') => self.toggle_clean = true,
            KeyCode::Char('a') => {
                if self.can_apply() {
                    self.outcome = Some(true);
                }
            }
            KeyCode::Char('q') | KeyCode::Esc => self.outcome = Some(false),
            _ => {}
        }
    }
}

fn model_row(report: &ModelReport) -> (String, String, String) {
    let status = match &report.status {
        Status::Current => "current".to_owned(),
        Status::Newer { latest } => format!("newer: {latest}"),
        Status::Missing => "missing".to_owned(),
        Status::Unknown(reason) => format!("unknown: {reason}"),
    };
    (report.alias.clone(), report.id.clone(), status)
}

fn status_color(status: &str) -> Color {
    if status.starts_with("current") {
        Color::Green
    } else if status.starts_with("newer") {
        Color::Yellow
    } else if status.starts_with("missing") {
        Color::Red
    } else {
        Color::DarkGray
    }
}

fn draw(frame: &mut Frame, app: &App) {
    let [bar, body, help] = Layout::vertical([
        Constraint::Length(1),
        Constraint::Min(0),
        Constraint::Length(1),
    ])
    .areas(frame.area());

    let mut spans = Vec::new();
    for (i, (alias, id, status)) in app.models.iter().enumerate() {
        if i > 0 {
            spans.push(Span::raw("  "));
        }
        spans.push(Span::raw(format!("{alias} {id} ")));
        spans.push(Span::styled(
            status.as_str(),
            Style::new().fg(status_color(status)),
        ));
    }
    frame.render_widget(Paragraph::new(Line::from(spans)), bar);

    let [left, right] =
        Layout::horizontal([Constraint::Percentage(40), Constraint::Percentage(60)]).areas(body);

    let list_area = if app.conflicts.is_empty() {
        left
    } else {
        let height = u16::try_from(app.conflicts.len())
            .unwrap_or(u16::MAX)
            .saturating_add(2);
        let [conflicts, list] =
            Layout::vertical([Constraint::Length(height), Constraint::Min(0)]).areas(left);
        let lines: Vec<Line> = app
            .conflicts
            .iter()
            .map(|c| Line::from(c.as_str()))
            .collect();
        let block = Block::bordered()
            .title("Conflicts")
            .border_style(Style::new().fg(Color::Red));
        frame.render_widget(
            Paragraph::new(lines)
                .style(Style::new().fg(Color::Red))
                .wrap(Wrap { trim: false })
                .block(block),
            conflicts,
        );
        list
    };

    let list = |range: std::ops::Range<usize>, title: String, area: ratatui::layout::Rect, frame: &mut Frame| {
        let items: Vec<Line> = app.entries[range.clone()]
            .iter()
            .zip(range.clone())
            .map(|(entry, i)| {
                let style = if i == app.selected { Style::new().add_modifier(Modifier::REVERSED) } else { Style::new() };
                Line::styled(entry.summary.as_str(), style)
            })
            .collect();
        // Keep the selected line in view.
        let visible = usize::from(area.height.saturating_sub(2)).max(1);
        let offset = if range.contains(&app.selected) { (app.selected - range.start + 1).saturating_sub(visible) } else { 0 };
        frame.render_widget(
            Paragraph::new(items).block(Block::bordered().title(title)).scroll((u16::try_from(offset).unwrap_or(u16::MAX), 0)),
            area,
        );
    };
    let (regular, cleaning) = (0..app.clean_start, app.clean_start..app.entries.len());
    if app.clean {
        let [top, bottom] = Layout::vertical([Constraint::Fill(1), Constraint::Fill(1)]).areas(list_area);
        list(regular, "Actions".to_owned(), top, frame);
        let title = format!("Clean ({}): skills moved into the backup, plugins removed", cleaning.len());
        list(cleaning, title, bottom, frame);
    } else {
        list(regular, "Actions".to_owned(), list_area, frame);
    }

    let diff = app.entries.get(app.selected).map_or("", |entry| entry.diff.as_str());
    let diff_lines: Vec<Line> = diff.lines().map(diff_line).collect();
    frame.render_widget(
        Paragraph::new(diff_lines)
            .block(Block::bordered().title("Diff"))
            .scroll((app.scroll, 0)),
        right,
    );

    let clean = if app.clean { "on" } else { "off" };
    let apply = if app.can_apply() { "  a apply" } else { "" };
    let mut help_text = format!("↑/↓ select  PgUp/PgDn scroll  c clean: {clean}{apply}  q cancel");
    if let Some(status) = &app.status {
        help_text.push_str(&format!("  {status}"));
    }
    frame.render_widget(Paragraph::new(help_text), help);
}

fn diff_line(line: &str) -> Line<'_> {
    let color = if line.starts_with("@@") {
        Some(Color::Cyan)
    } else if line.starts_with('+') {
        Some(Color::Green)
    } else if line.starts_with('-') {
        Some(Color::Red)
    } else {
        None
    };
    Line::styled(line, color.map_or_else(Style::new, |c| Style::new().fg(c)))
}

fn run(terminal: &mut DefaultTerminal, app: &mut App, toggle_clean: &mut dyn FnMut(&mut App)) -> Result<()> {
    while app.outcome.is_none() {
        terminal.draw(|frame| draw(frame, &*app))?;
        if let Event::Key(key) = event::read()? {
            on_key(app, key);
        }
        if std::mem::take(&mut app.toggle_clean) {
            toggle_clean(app);
        }
    }
    Ok(())
}

fn on_key(app: &mut App, key: KeyEvent) {
    if key.kind != KeyEventKind::Press {
        return;
    }
    // Raw mode disables SIGINT, so Ctrl-C must cancel explicitly or the user is trapped.
    if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c') {
        app.outcome = Some(false);
        return;
    }
    app.handle_key(key.code);
}

fn setup_terminal() -> io::Result<DefaultTerminal> {
    enable_raw_mode()?;
    let mut out = stdout();
    if let Err(err) = execute!(out, EnterAlternateScreen) {
        restore_terminal();
        return Err(err);
    }
    Terminal::new(CrosstermBackend::new(out)).inspect_err(|_| restore_terminal())
}

/// Best effort: every step runs even if an earlier one fails.
fn restore_terminal() {
    let _ = disable_raw_mode();
    let _ = execute!(stdout(), LeaveAlternateScreen, cursor::Show);
}

fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        restore_terminal();
        previous(info);
    }));
}

#[cfg(test)]
mod tests {
    use ratatui::backend::TestBackend;

    use super::*;

    fn app(actions: usize, conflicts: Vec<String>) -> App {
        let diff = (1..=30)
            .map(|n| format!("+line {n}"))
            .collect::<Vec<_>>()
            .join("\n");
        let mut app = App::new(Vec::new());
        app.entries = (0..actions)
            .map(|i| Entry { summary: format!("write  ~/.claude/agents/worker{i}.md"), diff: diff.clone() })
            .collect();
        app.clean_start = actions;
        app.changes = actions;
        app.conflicts = conflicts;
        app
    }

    #[test]
    fn selection_clamps_and_moves_reset_scroll() {
        let mut app = app(2, Vec::new());
        app.handle_key(KeyCode::Up);
        assert_eq!(app.selected, 0);
        app.handle_key(KeyCode::Down);
        app.handle_key(KeyCode::Down);
        assert_eq!(app.selected, 1);
        app.handle_key(KeyCode::Char('d'));
        assert_eq!(app.scroll, 10);
        app.handle_key(KeyCode::Char('k'));
        assert_eq!((app.selected, app.scroll), (0, 0));
        app.handle_key(KeyCode::PageUp);
        assert_eq!(app.scroll, 0);
    }

    #[test]
    fn apply_is_ignored_with_conflicts_or_no_actions() {
        let mut blocked = app(1, vec!["conflict".to_owned()]);
        blocked.handle_key(KeyCode::Char('a'));
        assert_eq!(blocked.outcome, None);

        let mut empty = app(0, Vec::new());
        empty.handle_key(KeyCode::Char('a'));
        assert_eq!(empty.outcome, None);

        let mut ready = app(1, Vec::new());
        ready.handle_key(KeyCode::Char('a'));
        assert_eq!(ready.outcome, Some(true));
    }

    #[test]
    fn q_cancels() {
        let mut app = app(1, Vec::new());
        app.handle_key(KeyCode::Char('q'));
        assert_eq!(app.outcome, Some(false));
    }

    #[test]
    fn draw_shows_summary_and_diff_lines() {
        let app = app(2, Vec::new());
        let mut terminal = Terminal::new(TestBackend::new(100, 12)).unwrap();
        terminal.draw(|frame| draw(frame, &app)).unwrap();
        let text: String = terminal
            .backend()
            .buffer()
            .content()
            .iter()
            .map(|c| c.symbol())
            .collect();
        assert!(text.contains("write  ~/.claude/agents/worker0.md"));
        assert!(text.contains("+line 1"));
        assert!(text.contains("c clean: off"));
    }

    #[test]
    fn c_requests_a_clean_replan_and_clean_entries_get_their_own_section() {
        let mut app = app(1, Vec::new());
        app.handle_key(KeyCode::Char('c'));
        assert!(app.toggle_clean);
        app.entries.push(Entry { summary: "move    ~/.claude/skills/old -> backup".into(), diff: String::new() });
        app.changes = 2;
        app.clean = true;
        let mut terminal = Terminal::new(TestBackend::new(120, 14)).unwrap();
        terminal.draw(|frame| draw(frame, &app)).unwrap();
        let text: String = terminal.backend().buffer().content().iter().map(|c| c.symbol()).collect();
        assert!(text.contains("Clean (1)"), "{text}");
        assert!(text.contains("move    ~/.claude/skills/old"));
        assert!(text.contains("c clean: on"));
    }
}
