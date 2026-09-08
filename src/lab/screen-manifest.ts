import type { ComponentType } from 'react';

/**
 * What a screen's folder declares about itself.
 *
 * Everything is here rather than in a central list, so adding a screen is
 * adding a folder and nothing else. The lab's file operations target the
 * folder; the canvas keys everything to `id`, so renaming the folder keeps a
 * screen's saved position and size.
 */
interface ScreenManifestBase {
  /** Optional. Falls back to the folder name, which is usually what you want. */
  id?: string;
  name: string;
  /** Frame size in page units, which are canvas units at zoom 1. */
  width: number;
  height: number;
  /** Top-left, page units. The saved layout overrides this. */
  position: { x: number; y: number };
}

/** A screen written as a React component, which is what the contract is for. */
export interface ComponentScreenManifest extends ScreenManifestBase {
  component: ComponentType;
  src?: never;
  isolate?: never;
}

/**
 * A screen that is an HTML file in the same folder.
 *
 * The file is mounted into the lab's own document rather than an iframe, so
 * one measuring pass, one freeze and one annotation session cover every
 * screen on the canvas at once. An iframe would put a document boundary
 * through the middle of exactly the comparison the canvas exists to make.
 */
export interface HtmlScreenManifest extends ScreenManifestBase {
  /** A path relative to the screen's folder, e.g. `./index.html`. */
  src: string;
  component?: never;
  /**
   * Mount inside a shadow root, so the file's own CSS cannot reach the lab or
   * the other screens. Defaults to true.
   *
   * Turn it off when a tool you are inspecting with stops at the shadow
   * boundary: the cost is that the file's `body { }` rules and resets now
   * apply to everything, which is usually visible immediately.
   */
  isolate?: boolean;
}

export type ScreenManifest = ComponentScreenManifest | HtmlScreenManifest;
