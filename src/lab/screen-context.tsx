import { createContext, useContext, type ReactNode } from 'react';

/**
 * The contract between the lab and a screen.
 *
 * A screen lives inside a frame that is being translated and scaled by an
 * ancestor, so every instinct a normal page has about coordinates is wrong
 * here. `clientX` is not where you think it is. `window.innerWidth` is the
 * window, not the frame. `scrollY` is always zero, because the window never
 * scrolls. This object is how a screen gets the answers it actually needs.
 */
export interface ScreenState {
  screenId: string;
  /** Locked into right now: the only time a screen owns the keyboard. */
  active: boolean;
  /** False when culled offscreen. Anything expensive must stop when this is false. */
  visible: boolean;
  /** The frame's size in page units. This is the screen's viewport. */
  frameSize: { width: number; height: number };
  /** Camera zoom, coarse and throttled. For deciding things, not for maths. */
  zoom: number;
  /**
   * A pointer event's position in frame-local page units.
   *
   * The one function every screen must route pointer maths through. It undoes
   * the canvas rect and the zoom, which is exactly the part that is impossible
   * to get right from inside a screen.
   */
  clientToFrame: (p: { clientX: number; clientY: number }) => { x: number; y: number };
  /**
   * Claim Escape while locked in.
   *
   * Return true to say the screen consumed it and the lab should stay locked
   * in. A screen with a dialog or an edit mode open has a better claim on
   * Escape than the lab does, and it gets first refusal.
   */
  setEscapeInterceptor: (fn: (() => boolean) | null) => void;
}

const ScreenCtx = createContext<ScreenState | null>(null);

export function ScreenProvider({ value, children }: { value: ScreenState; children: ReactNode }) {
  return <ScreenCtx.Provider value={value}>{children}</ScreenCtx.Provider>;
}

/**
 * Throws outside a frame rather than handing back a plausible default. A
 * screen that silently measures the window instead of its frame is a bug you
 * find much later, from the wrong end.
 */
export function useScreen(): ScreenState {
  const ctx = useContext(ScreenCtx);
  if (!ctx) throw new Error('useScreen must be called inside a screen frame');
  return ctx;
}
