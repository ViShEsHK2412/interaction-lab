import type { ComponentType } from 'react';
import { PlaygroundScreen } from '../screens/playground/playground-screen';
import { FeedScreen } from '../screens/feed/feed-screen';
import { StressScreen } from '../screens/stress/stress-screen';

/**
 * The registry. Adding a screen is a component plus one entry here, and
 * nothing else.
 *
 * A screen is a fixed-size viewport, like a device frame, not a page that
 * grows to fit its content. Content taller than the frame scrolls inside the
 * frame's own scroll container, which is what lets a screen keep any
 * scroll-driven behaviour it has.
 */
export interface ScreenDef {
  id: string;
  /** Shown on the frame label. */
  name: string;
  /** Frame size in page units, which are canvas units at zoom 1. */
  width: number;
  height: number;
  /** Top-left, page units. The saved layout overrides this. */
  defaultPosition: { x: number; y: number };
  component: ComponentType;
}

/**
 * Keep widths at 1000 or more if a screen branches on width: a frame is its
 * own viewport, so a 400px frame really is a 400px viewport to the screen
 * inside it, and it will render its mobile layout.
 */
export const SCREENS: ScreenDef[] = [
  {
    id: 'feed',
    name: 'Feed',
    width: 1440,
    height: 900,
    defaultPosition: { x: 0, y: 0 },
    component: FeedScreen,
  },
  {
    id: 'playground',
    name: 'Playground',
    width: 1440,
    height: 900,
    defaultPosition: { x: 1640, y: 0 },
    component: PlaygroundScreen,
  },
  {
    id: 'stress',
    name: 'The hard cases',
    width: 1440,
    height: 900,
    defaultPosition: { x: 3280, y: 0 },
    component: StressScreen,
  },
];
