import type { ComponentType } from 'react';

/**
 * What a screen's folder declares about itself.
 *
 * Everything is here rather than in a central list, so adding a screen is
 * adding a folder and nothing else. The lab's file operations target the
 * folder; the canvas keys everything to `id`, so renaming the folder keeps a
 * screen's saved position and size.
 */
export interface ScreenManifest {
  /** Optional. Falls back to the folder name, which is usually what you want. */
  id?: string;
  name: string;
  /** Frame size in page units, which are canvas units at zoom 1. */
  width: number;
  height: number;
  /** Top-left, page units. The saved layout overrides this. */
  position: { x: number; y: number };
  component: ComponentType;
}
