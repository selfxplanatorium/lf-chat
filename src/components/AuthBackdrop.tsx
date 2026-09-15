import React from 'react';

/**
 * Ambient backdrop for the sign-in screen: slow red orbs under film grain.
 *
 * Pure CSS on purpose. This layer runs for as long as someone sits on the login
 * screen, so a JS/rAF loop would burn a frame budget forever for decoration; CSS
 * keyframes on `transform` alone stay on the compositor and cost nothing per
 * frame. See `.auth-orb` / `.auth-grain` in index.css for the trade-offs behind
 * the diffusion and the static grain.
 *
 * `aria-hidden` throughout — none of this carries meaning, and a screen reader
 * announcing decorative divs before the login form is pure noise.
 */
export const AuthBackdrop: React.FC = () => (
  <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
    {/* Sizes are vmax so the composition holds from phone to ultrawide instead
        of the orbs shrinking into distinct dots on large screens. */}
    <div className="auth-orb auth-orb-a" style={{ width: '62vmax', height: '62vmax', top: '-22vmax', left: '-16vmax' }} />
    <div className="auth-orb auth-orb-b" style={{ width: '54vmax', height: '54vmax', bottom: '-24vmax', right: '-14vmax' }} />
    <div className="auth-orb auth-orb-c" style={{ width: '40vmax', height: '40vmax', top: '32%', right: '4%' }} />
    <div className="auth-orb auth-orb-d" style={{ width: '34vmax', height: '34vmax', bottom: '6%', left: '10%' }} />
    <div className="auth-grain" />
    <div className="auth-grain-hard" />
  </div>
);
