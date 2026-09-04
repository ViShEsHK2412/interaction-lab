import type { ScreenManifest } from '../../lab/screen-manifest';
import { FeedScreen } from './feed-screen';

/**
 * A screen is a folder with one of these in it. The folder name is the id
 * unless this says otherwise, and everything the canvas needs to place the
 * screen is here rather than in a central list, so adding one is adding a
 * folder.
 */
const manifest: ScreenManifest = {
  id: 'feed',
  name: 'Feed',
  width: 1440,
  height: 900,
  position: { x: 0, y: 0 },
  component: FeedScreen,
};

export default manifest;
