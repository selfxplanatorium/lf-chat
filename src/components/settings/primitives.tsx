import React from 'react';
import { motion } from 'motion/react';
import { cn } from '../../lib/utils';

/**
 * Shared vocabulary for the settings surface.
 *
 * Fundamental tension: a settings page is a long list of unrelated controls,
 * and the obvious rendering — one bordered card per option — makes every option
 * look equally important and turns the page into a wall of boxes. The answer
 * here is the grouped-list idiom: a section owns one container, and the rows
 * inside it are separated by hairlines. Grouping carries the meaning; the box
 * only carries the group. Every control in this file is therefore a *row*, and
 * a row is never nested inside another row.
 *
 * The second tension is motion. Everything animates from an already-visible
 * default so a slow frame never hides a control, and nothing here animates
 * layout properties. `MotionConfig reducedMotion="user"` in main.tsx already
 * neutralises these for users who ask for it.
 */

export const EASE = [0.16, 1, 0.3, 1] as const;
export const QUICK = { duration: 0.18, ease: EASE } as const;

export const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base';

/** Rows enter as one short cascade when a section is opened, not one by one. */
export const listVariants = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.035, delayChildren: 0.02 } },
};

export const itemVariants = {
  hidden: { opacity: 0, y: 6 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.24, ease: EASE } },
};

export const SectionHeading: React.FC<{ title: string; description?: string }> = ({ title, description }) => (
  <motion.header variants={itemVariants} className="space-y-1.5">
    <h2 className="text-[22px] font-semibold leading-tight tracking-[-0.02em] text-text-primary">{title}</h2>
    {description && <p className="max-w-[58ch] text-sm leading-6 text-text-tertiary">{description}</p>}
  </motion.header>
);

/** Label for a run of rows inside a section (e.g. "Password" under Account). */
export const GroupLabel: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <h3 className={cn('px-1 text-[13px] font-medium text-text-secondary', className)}>{children}</h3>
);

export const Group: React.FC<{ children: React.ReactNode; className?: string; tone?: 'default' | 'danger' }> = ({
  children,
  className,
  tone = 'default',
}) => (
  <motion.div
    variants={itemVariants}
    className={cn(
      'overflow-hidden rounded-2xl border bg-bg-surface',
      tone === 'danger' ? 'border-danger/25' : 'border-border-light',
      className,
    )}
  >
    {children}
  </motion.div>
);

/**
 * One setting. `control` sits at the trailing edge on desktop and wraps under
 * the label on narrow screens rather than squeezing the text to two words.
 */
export const Row: React.FC<{
  label: React.ReactNode;
  description?: React.ReactNode;
  control?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  labelFor?: string;
}> = ({ label, description, control, children, className, labelFor }) => (
  <div className={cn('border-b border-border-light px-4 py-3.5 last:border-b-0 sm:px-5', className)}>
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0 space-y-1">
        {labelFor ? (
          <label htmlFor={labelFor} className="block text-sm font-medium text-text-primary">
            {label}
          </label>
        ) : (
          <div className="text-sm font-medium text-text-primary">{label}</div>
        )}
        {description && <div className="max-w-[52ch] text-xs leading-5 text-text-tertiary">{description}</div>}
      </div>
      {control && <div className="shrink-0 sm:pl-2">{control}</div>}
    </div>
    {children && <div className="mt-3">{children}</div>}
  </div>
);

export const Toggle: React.FC<{
  checked: boolean;
  onChange: () => void;
  label: string;
  disabled?: boolean;
}> = ({ checked, onChange, label, disabled }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={onChange}
    className={cn(
      'relative flex h-[26px] w-[46px] shrink-0 items-center rounded-full px-[3px] transition-colors',
      focusRing,
      checked ? 'bg-accent' : 'bg-bg-element',
      disabled && 'cursor-not-allowed opacity-50',
    )}
  >
    <motion.span
      // Spring, not a duration: a switch is a physical object and the overshoot
      // is what makes the state change register at this size.
      animate={{ x: checked ? 20 : 0 }}
      transition={{ type: 'spring', stiffness: 620, damping: 34, mass: 0.7 }}
      className="h-5 w-5 rounded-full bg-white shadow-sm"
    />
  </button>
);

/** Row whose whole surface toggles — the standard target for a boolean. */
export const ToggleRow: React.FC<{
  checked: boolean;
  onChange: () => void;
  label: string;
  description?: string;
  disabled?: boolean;
}> = ({ checked, onChange, label, description, disabled }) => (
  <div
    className={cn(
      'group border-b border-border-light transition-colors last:border-b-0',
      !disabled && 'hover:bg-bg-element/40',
    )}
  >
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
      className={cn(
        'flex w-full items-center justify-between gap-6 px-4 py-3.5 text-left sm:px-5',
        focusRing,
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <span className="min-w-0 space-y-1">
        <span className="block text-sm font-medium text-text-primary">{label}</span>
        {description && <span className="block max-w-[52ch] text-xs leading-5 text-text-tertiary">{description}</span>}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          'relative flex h-[26px] w-[46px] shrink-0 items-center rounded-full px-[3px] transition-colors',
          checked ? 'bg-accent' : 'bg-bg-element',
        )}
      >
        <motion.span
          animate={{ x: checked ? 20 : 0 }}
          transition={{ type: 'spring', stiffness: 620, damping: 34, mass: 0.7 }}
          className="h-5 w-5 rounded-full bg-white shadow-sm"
        />
      </span>
    </button>
  </div>
);

export const inputClass = cn(
  'min-h-11 w-full rounded-xl border border-border-light bg-bg-base px-3.5 text-sm text-text-primary outline-none transition-colors',
  'placeholder:text-text-tertiary hover:border-text-tertiary/60 focus:border-accent/60 focus:ring-2 focus:ring-accent/15',
);

export const buttonClass = {
  primary: cn(
    'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-medium text-white transition-[filter,transform] hover:brightness-110 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50',
    focusRing,
  ),
  secondary: cn(
    'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border-light bg-bg-base px-4 text-sm font-medium text-text-primary transition-colors hover:border-text-tertiary hover:bg-bg-element disabled:pointer-events-none disabled:opacity-50',
    focusRing,
  ),
  danger: cn(
    'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-danger px-4 text-sm font-medium text-white transition-[filter,transform] hover:brightness-110 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50',
    focusRing,
  ),
};

/** Status pill used for read-only facts (role, registration state). */
export const Pill: React.FC<{ children: React.ReactNode; tone?: 'neutral' | 'accent' | 'success' }> = ({
  children,
  tone = 'neutral',
}) => (
  <span
    className={cn(
      'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium',
      tone === 'accent' && 'bg-accent/10 text-accent',
      tone === 'success' && 'bg-success/10 text-success',
      tone === 'neutral' && 'bg-bg-element text-text-secondary',
    )}
  >
    {children}
  </span>
);
