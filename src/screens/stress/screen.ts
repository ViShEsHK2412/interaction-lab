import type { ScreenManifest } from '../../lab/screen-manifest';
import { StressScreen } from './stress-screen';

/**
 * A screen is a folder with one of these in it. The folder name is the id
 * unless this says otherwise, and everything the canvas needs to place the
 * screen is here rather than in a central list, so adding one is adding a
 * folder.
 */
const manifest: ScreenManifest = {
  id: 'stress',
  name: 'The hard cases',
  width: 1440,
  height: 900,
  position: { x: 3280, y: 0 },
  component: StressScreen,
};

export default manifest;
