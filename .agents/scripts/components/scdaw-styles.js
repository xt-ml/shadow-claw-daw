/**
 * .agents/scripts/components/scdaw-styles.js
 *
 * Shared CSS stylesheet tokens and utility classes for ShadowClaw DAW components.
 * Matches openDAW dark-studio aesthetic (cyan accents, dark slate elevated surfaces).
 */

export const SHARED_STYLES = `
:host {
  display: block;
  box-sizing: border-box;
  font-family: var(--shadow-claw-font-sans, system-ui, -apple-system, sans-serif);
  color: var(--shadow-claw-text-primary, #dde4e4);
  --bg-app: #0e1415;
  --bg-card: var(--shadow-claw-bg-secondary, rgb(26, 33, 33));
  --bg-elevated: var(--shadow-claw-bg-tertiary, rgb(37, 43, 44));
  --border: var(--shadow-claw-border-color, rgb(63, 72, 73));
  --border-subtle: rgba(255, 255, 255, 0.08);
  --accent: var(--shadow-claw-accent-primary, rgb(128, 212, 219));
  --accent-hover: var(--shadow-claw-accent-hover, rgb(157, 240, 248));
  --on-accent: var(--shadow-claw-on-primary, rgb(0, 54, 58));
  --success: var(--shadow-claw-success-color, rgb(92, 219, 167));
  --warning: #f59e0b;
  --danger: var(--shadow-claw-error-color, rgb(255, 180, 171));
  --mono: var(--shadow-claw-font-mono, "JetBrains Mono", ui-monospace, monospace);
}

*, *::before, *::after {
  box-sizing: inherit;
}

.hidden,
[hidden] {
  display: none !important;
}

:focus-visible {
  outline: 2px solid var(--accent, rgb(128, 212, 219)) !important;
  outline-offset: 2px !important;
}

.daw-panel {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.25);
  box-sizing: border-box;
  max-width: 100%;
}

.daw-panel-header {
  padding: 0.5rem 0.75rem;
  background: rgba(0, 0, 0, 0.2);
  border-bottom: 1px solid var(--border);
  font-size: 0.8rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: space-between;
  box-sizing: border-box;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.btn {
  background: var(--bg-elevated);
  color: var(--shadow-claw-text-primary, #dde4e4);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.35rem 0.65rem;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  line-height: 1;
  transition: all 0.12s ease;
  user-select: none;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  box-sizing: border-box;
}

.btn:hover {
  background: var(--border);
  color: #ffffff;
}

.btn:disabled,
.btn[disabled],
.btn[aria-disabled="true"] {
  opacity: 0.45;
  cursor: not-allowed;
  pointer-events: none;
}

.btn-primary {
  background: var(--accent);
  color: var(--on-accent);
  border-color: var(--accent);
}

.btn-primary:hover {
  background: var(--accent-hover);
}

.btn-danger {
  background: rgba(255, 180, 171, 0.15);
  color: var(--danger);
  border-color: rgba(255, 180, 171, 0.35);
}

.btn-icon {
  padding: 0.25rem 0.45rem;
  font-size: 0.75rem;
  line-height: 1;
}

.badge {
  display: inline-flex;
  align-items: center;
  padding: 0.15rem 0.45rem;
  border-radius: 999px;
  font-size: 0.72rem;
  font-family: var(--mono);
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  line-height: 1.2;
}

.badge-active {
  background: rgba(128, 212, 219, 0.15);
  color: var(--accent);
  border-color: var(--accent);
}

.drop-target-active {
  outline: 2px dashed var(--accent, rgb(128, 212, 219)) !important;
  outline-offset: -2px;
  background: rgba(128, 212, 219, 0.12) !important;
}
`;
