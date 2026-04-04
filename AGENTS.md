# Demos Faucet - Project Context

## Design Context

### Users
Developers and users needing test DEMOS tokens for the Demos Network testnet. They arrive with a wallet address ready, wanting to quickly get tokens and continue building/testing. The job to be done is fast, frictionless token acquisition.

### Brand Personality
**Simple, Accessible, Human**

Demos Network prioritizes clarity over complexity. The interface should feel approachable to newcomers while maintaining credibility with experienced blockchain developers. Avoid technical jargon where simple language suffices.

### Aesthetic Direction
- **Visual Tone**: Dark, modern, technical but not intimidating. Glassmorphism with subtle cyan/purple accents.
- **Reference**: The `../minting_app` is the gold standard - same fonts, colors, glass effects, and component patterns.
- **Theme**: Dark mode only. No light mode.
- **Colors to use**: Cyan (#00d4ff), purple (#7c4dff) as accents on deep dark backgrounds (#02060f).
- **Colors to avoid**: Saturated primary colors, anything that feels "playful" or "corporate".

### Design System

#### Typography
```css
/* Display/Headings */
font-family: 'Neue Machina', 'Inter', system-ui, sans-serif;
/* Weights: 300 (Light), 400 (Regular), 800 (Ultrabold) */

/* Body text */
font-family: 'Inter', 'Neue Machina', sans-serif;
/* Variable weight 100-900 */
```

#### Color Tokens
```css
:root {
  /* Backgrounds */
  --background: #02060f;
  --background-secondary: #050a16;
  --glass-surface: rgba(7, 12, 23, 0.8);
  --glass-border: rgba(255, 255, 255, 0.08);
  
  /* Accents */
  --accent-primary: #00d4ff;    /* Cyan */
  --accent-secondary: #7c4dff;  /* Purple */
  
  /* Text */
  --text-primary: #f5f8ff;
  --text-secondary: #a6b4ce;
  --text-muted: #7c88a1;
  
  /* Status */
  --success-green: #19f3a2;
  --warning-yellow: #ffcb57;
  --error-red: #ff4d6d;
  
  /* Radius */
  --radius-lg: 32px;
  --radius-md: 18px;
  --radius-sm: 10px;
}
```

#### Component Patterns (from minting_app)
```css
/* Glass card */
.glass-morphism {
  background: rgba(255, 255, 255, 0.02);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

/* Primary button */
.btn-primary {
  background: linear-gradient(135deg, #00d4ff, #7c4dff);
  color: #000;
  padding: 1.1rem 1.5rem;
  border-radius: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

/* Input */
.input {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  padding: 1rem 1.1rem;
  color: #f5f8ff;
}
```

### Design Principles

1. **Speed First** - Every interaction should feel instant. Minimize steps, show progress clearly, avoid unnecessary animations that slow perception.

2. **One Action Per Screen** - The faucet has one job: give tokens. Don't distract with secondary features. Form → Button → Result. Done.

3. **Glass, Not Glitz** - Use glassmorphism for depth, but keep it subtle. The blurred logo background adds brand presence without competing for attention.

4. **Status Always Visible** - Users need to know: Is the faucet online? What's the balance? Did my transaction succeed? Show connection status, balances, and transaction results prominently.

5. **Accessible by Default** - WCAG 2.1 AA compliance. Sufficient contrast ratios (cyan on dark works well), focus states on all interactive elements, keyboard navigation support.

### Files to Reference
- `src/styles/main.css` - Current faucet styles (follows the pattern)
- `../minting_app/frontend/src/styles/index.css` - Tailwind + base styles
- `../minting_app/frontend/tailwind.config.js` - Color/token definitions
- `../minting_app/frontend/src/App.tsx` - Layout patterns, component usage


## Project Management with Mycelium

This project uses [Mycelium](https://github.com/tcsenpai/mycelium) (`myc`) for task and epic management.

### Quick Reference

```bash
# Initialize mycelium in this project (creates .mycelium/ directory)
myc init

# Create an epic (a large body of work)
myc epic create --title "Feature X" --description "Build feature X"

# Create tasks within an epic
myc task create --title "Implement Y" --description "Build the implementation for Y" --epic 1 --priority high --due 2025-12-31

# Task priorities: low, medium, high, critical
# Task status: open, closed

# List tasks
myc task list
myc task list --epic 1
myc task list --overdue
myc task list --blocked

# Manage dependencies (task 1 blocks task 2)
myc task link blocks --task 1 2
myc deps show 2

# Close tasks (blocked tasks cannot be closed without --force)
myc task close 1

# Assign tasks
myc assignee create --name "Alice" --github "alice"
myc task assign 1 1

# Link to external resources
myc task link github-issue --task 1 "owner/repo#123"
myc task link github-pr --task 1 "owner/repo#456"
myc task link url --task 1 "https://example.com"

# Project overview
myc summary

# Export data
myc export json
myc export csv
```

### Data Model

- **Epic**: A large body of work with a title and optional description (e.g., a feature or milestone)
- **Task**: A unit of work with a title and optional description, optionally linked to an epic
- **Dependency**: Task A blocks Task B (B cannot close until A is closed)
- **Assignee**: Person assigned to a task (can have GitHub username)
- **External Ref**: Link to GitHub issues/PRs or URLs

### Git Tracking

The `.mycelium/` directory contains the SQLite database and should be committed to git:

```bash
git add .mycelium/
git commit -m "Add mycelium project tracking"
```

### For AI Agents

When working on this project:

1. Check existing tasks: `myc task list`
2. Check blocked tasks: `myc task list --blocked`
3. Create tasks for new work: `myc task create --title "..." --description "..." --epic N`
4. Mark tasks complete when done: `myc task close N`
5. Use `--format json` for machine-readable output: `myc task list --format json`

<!-- TEAM_MODE:START -->
## Team Mode is ACTIVE
IMPORTANT: Read `TEAM.md` in the project root IN FULL before processing any task.
You are operating as Tech Lead of a multi-agent team, not as a solo developer.
If you don't remember Team Mode being activated, re-read `TEAM.md` NOW — it contains all instructions.
<!-- TEAM_MODE:END -->

## Mental Frameworks for Mycelium Usage

### 1. INVEST — Task Quality Gate

Before creating or updating any task, validate it against these criteria.
A task that fails more than one is not ready to be written.

| Criterion | Rule |
|---|---|
| **Independent** | Can be completed without unblocking other tasks first |
| **Negotiable** | The *what* is fixed; the *how* remains open |
| **Valuable** | Produces a verifiable, concrete outcome |
| **Estimable** | If you cannot size it, it is too vague or too large |
| **Small** | If it spans more than one work cycle, split it |
| **Testable** | Has an explicit, binary done condition |

> If a task fails **Estimable** or **Testable**, convert it to an Epic and decompose.

---

### 2. DAG — Dependency Graph Thinking

Before scheduling or prioritizing, model the implicit dependency graph.

**Rules:**
- No task moves to `in_progress` if it has an unresolved upstream blocker
- Priority is a function of both urgency **and fan-out** (how many tasks does completing this one unlock?)
- Always work the **critical path** first — not the task that feels most urgent

**Prioritization heuristic:**
```
score = urgency + (blocked_tasks_count × 1.5)
```

When creating a task, explicitly ask: *"What does this block, and what blocks this?"*
Set dependency links in Mycelium before touching status.

---

### 3. Principle of Minimal Surprise (PMS)

Mycelium's state must remain predictable and auditable at all times.

**Rules:**
- **Prefer idempotent operations** — update before you create; never duplicate
- **Check before write** — search for an equivalent item before creating a new one
- **Always annotate mutations** — every status change, priority shift, or reassignment must carry an explicit `reason` field
- **No orphan tasks** — every task must be linked to an Epic; every Epic to a strategic goal
- Deletions are a last resort; prefer `cancelled` status with a reason

> The state of Mycelium after any operation must be explainable to another agent with zero context.
