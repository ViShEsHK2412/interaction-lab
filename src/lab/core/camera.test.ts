import { describe, expect, it } from 'vitest';
import {
  boundsOf, boxesIntersect, cameraCentredOn, clamp, createCameraStore, easeOutQuint,
  lerpCamera, MAX_ZOOM, MIN_ZOOM, pageToScreen, screenToPage, snapToDevicePixels,
  stepZoom, toDomPrecision, viewportCentre, visibleBounds, wheelZoom, zoomAbout,
  zoomToBounds, type Camera,
  playButtonAt,
} from './camera';

const VIEWPORT = { width: 1200, height: 800 };

describe('screenToPage and pageToScreen', () => {
  it('are inverses of each other', () => {
    for (const z of [0.05, 0.3, 1, 2.5, 4]) {
      const page = screenToPage(437, -120, z);
      expect(pageToScreen(page, -120, z)).toBeCloseTo(437, 9);
    }
  });

  it('put the viewport origin at the negated camera', () => {
    expect(screenToPage(0, -250, 2)).toBe(250);
  });
});

describe('zoomAbout', () => {
  it('leaves the page point under the cursor exactly where it was', () => {
    // The one property the whole gesture rests on.
    const before: Camera = { x: -300, y: -150, z: 0.8 };
    const [sx, sy] = [512, 377];
    const pageX = screenToPage(sx, before.x, before.z);
    const pageY = screenToPage(sy, before.y, before.z);
    for (const z2 of [0.2, 1, 3.9]) {
      const after = zoomAbout(before, sx, sy, z2);
      expect(screenToPage(sx, after.x, after.z)).toBeCloseTo(pageX, 9);
      expect(screenToPage(sy, after.y, after.z)).toBeCloseTo(pageY, 9);
    }
  });

  it('clamps to the interactive range rather than letting a gesture escape', () => {
    const c: Camera = { x: 0, y: 0, z: 1 };
    expect(zoomAbout(c, 0, 0, 99).z).toBe(MAX_ZOOM);
    expect(zoomAbout(c, 0, 0, 0.0001).z).toBe(MIN_ZOOM);
  });
});

describe('wheelZoom', () => {
  it('is multiplicative, so a notch feels the same at every scale', () => {
    // The same delta must change zoom by the same *ratio*, not the same amount.
    const a = wheelZoom(0.2, -100) / 0.2;
    const b = wheelZoom(2, -100) / 2;
    expect(a).toBeCloseTo(b, 9);
  });

  it('zooms in on a negative delta and out on a positive one', () => {
    expect(wheelZoom(1, -100)).toBeGreaterThan(1);
    expect(wheelZoom(1, 100)).toBeLessThan(1);
  });

  it('tames a hi-resolution wheel that reports hundreds per notch', () => {
    expect(wheelZoom(1, -100)).toBe(wheelZoom(1, -4000));
  });

  it('reads line-mode deltas as pixels', () => {
    // Three lines is about 48px, which the clamp then caps like any other.
    expect(wheelZoom(1, 3, 1)).toBe(wheelZoom(1, 48, 0));
  });
});

describe('stepZoom', () => {
  it('walks the stops in both directions', () => {
    expect(stepZoom(1, 1)).toBe(2);
    expect(stepZoom(1, -1)).toBe(0.5);
  });

  it('lands on the next stop from between two of them', () => {
    expect(stepZoom(0.7, 1)).toBe(1);
    expect(stepZoom(0.7, -1)).toBe(0.5);
  });

  it('stops at the ends rather than running off', () => {
    expect(stepZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
    expect(stepZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM);
  });
});

describe('boundsOf', () => {
  it('has nothing to say about nothing', () => {
    expect(boundsOf([])).toBeNull();
  });

  it('wraps every box', () => {
    expect(boundsOf([
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 300, y: -50, width: 100, height: 100 },
    ])).toEqual({ x: 0, y: -50, width: 400, height: 150 });
  });
});

describe('zoomToBounds', () => {
  const box = { x: 0, y: 0, width: 1440, height: 900 };

  it('centres the box in the viewport', () => {
    const c = zoomToBounds(box, VIEWPORT);
    const centre = viewportCentre(c, VIEWPORT);
    expect(centre.x).toBeCloseTo(720, 6);
    expect(centre.y).toBeCloseTo(450, 6);
  });

  it('never zooms past 100%, because fit is not magnify', () => {
    const tiny = { x: 0, y: 0, width: 40, height: 30 };
    expect(zoomToBounds(tiny, VIEWPORT).z).toBe(1);
  });

  it('fits below the interactive floor when it has to', () => {
    // A wide canvas in a narrow window: seeing everything beats the gesture floor.
    const wide = { x: 0, y: 0, width: 200000, height: 900 };
    const z = zoomToBounds(wide, { width: 400, height: 800 }).z;
    expect(z).toBeLessThan(MIN_ZOOM);
    expect(z).toBeGreaterThanOrEqual(0.02);
  });

  it('leaves the inset it was asked for on the tighter axis', () => {
    const c = zoomToBounds(box, VIEWPORT, 50);
    const left = pageToScreen(box.x, c.x, c.z);
    const right = pageToScreen(box.x + box.width, c.x, c.z);
    const top = pageToScreen(box.y, c.y, c.z);
    const bottom = pageToScreen(box.y + box.height, c.y, c.z);
    const slackX = Math.min(left, VIEWPORT.width - right);
    const slackY = Math.min(top, VIEWPORT.height - bottom);
    expect(Math.min(slackX, slackY)).toBeCloseTo(50, 6);
  });
});

describe('lerpCamera', () => {
  const from: Camera = { x: 0, y: 0, z: 0.1 };
  const to: Camera = { x: -500, y: -200, z: 1 };

  it('starts and ends exactly where it was told to', () => {
    expect(lerpCamera(from, to, 0, VIEWPORT).z).toBeCloseTo(from.z, 9);
    const end = lerpCamera(from, to, 1, VIEWPORT);
    expect(end.z).toBeCloseTo(to.z, 9);
    expect(end.x).toBeCloseTo(to.x, 6);
    expect(end.y).toBeCloseTo(to.y, 6);
  });

  it('interpolates zoom in log space, so each step feels the same size', () => {
    // Measured at the t where the easing is exactly halfway, since the easing
    // otherwise dominates and hides which space the zoom travelled in. Halfway
    // between 0.1 and 1 geometrically is 0.316; linearly it would be 0.55.
    const half = 1 - 0.5 ** (1 / 5);
    expect(easeOutQuint(half)).toBeCloseTo(0.5, 9);
    const mid = lerpCamera(from, to, half, VIEWPORT).z;
    expect(mid).toBeCloseTo(Math.sqrt(from.z * to.z), 6);
  });

  it('covers equal ratios in equal eased steps', () => {
    // The point of log space: 0 -> half and half -> end multiply zoom by the
    // same factor, so no part of the animation lurches.
    const half = 1 - 0.5 ** (1 / 5);
    const mid = lerpCamera(from, to, half, VIEWPORT).z;
    expect(mid / from.z).toBeCloseTo(to.z / mid, 6);
  });

  it('travels the viewport centre, not the raw offsets', () => {
    const a = viewportCentre(from, VIEWPORT);
    const b = viewportCentre(to, VIEWPORT);
    const mid = viewportCentre(lerpCamera(from, to, 0.5, VIEWPORT), VIEWPORT);
    const eased = easeOutQuint(0.5);
    expect(mid.x).toBeCloseTo(a.x + (b.x - a.x) * eased, 6);
  });

  it('clamps a t outside the unit range instead of overshooting', () => {
    expect(lerpCamera(from, to, 2, VIEWPORT).z).toBeCloseTo(to.z, 9);
    expect(lerpCamera(from, to, -1, VIEWPORT).z).toBeCloseTo(from.z, 9);
  });
});

describe('cameraCentredOn', () => {
  it('round-trips through viewportCentre', () => {
    const c = cameraCentredOn({ x: 640, y: 360 }, 0.75, VIEWPORT);
    const back = viewportCentre(c, VIEWPORT);
    expect(back.x).toBeCloseTo(640, 9);
    expect(back.y).toBeCloseTo(360, 9);
  });
});

describe('visibleBounds', () => {
  it('covers exactly the viewport at zero margin', () => {
    const b = visibleBounds({ x: -100, y: -50, z: 2 }, VIEWPORT, 0);
    expect(b).toEqual({ x: 100, y: 50, width: 600, height: 400 });
  });

  it('grows by the margin on every side', () => {
    const b = visibleBounds({ x: 0, y: 0, z: 1 }, VIEWPORT, 0.25);
    expect(b.x).toBe(-300);
    expect(b.width).toBe(1800);
  });
});

describe('boxesIntersect', () => {
  const a = { x: 0, y: 0, width: 100, height: 100 };

  it('sees an overlap', () => {
    expect(boxesIntersect(a, { x: 50, y: 50, width: 100, height: 100 })).toBe(true);
  });

  it('does not count a shared edge as an overlap', () => {
    expect(boxesIntersect(a, { x: 100, y: 0, width: 10, height: 10 })).toBe(false);
  });

  it('sees a box that is entirely inside', () => {
    expect(boxesIntersect(a, { x: 10, y: 10, width: 10, height: 10 })).toBe(true);
  });
});

describe('pixel helpers', () => {
  it('snaps to whole device pixels', () => {
    expect(snapToDevicePixels(10.3, 1)).toBe(10);
    expect(snapToDevicePixels(10.3, 2)).toBe(10.5);
  });

  it('trims transform values to four decimals', () => {
    expect(toDomPrecision(1.23456789)).toBe(1.2346);
  });
});

describe('clamp', () => {
  it('holds a value inside its range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(50, 0, 10)).toBe(10);
  });
});

describe('createCameraStore', () => {
  it('hands every subscriber the new value synchronously', () => {
    const store = createCameraStore({ x: 0, y: 0, z: 1 });
    const seen: number[] = [];
    store.subscribe((c) => seen.push(c.z));
    store.set({ x: 0, y: 0, z: 2 });
    expect(seen).toEqual([2]);
    expect(store.get().z).toBe(2);
  });

  it('stops notifying once unsubscribed', () => {
    const store = createCameraStore({ x: 0, y: 0, z: 1 });
    let calls = 0;
    const off = store.subscribe(() => { calls += 1; });
    store.set({ x: 0, y: 0, z: 2 });
    off();
    store.set({ x: 0, y: 0, z: 3 });
    expect(calls).toBe(1);
  });
});

describe('playButtonAt', () => {
  const box = { x: 200, y: 300, width: 1440, height: 900 };

  it('sits at the frame’s top-right corner in page space', () => {
    const at = playButtonAt(box, { x: -200, y: -300, z: 1 }, null, 34);
    // The frame's origin is at screen 0,0, so its right edge is its width.
    expect(at.x).toBe(1440);
  });

  it('follows the zoom, because the corner is a screen position', () => {
    const at = playButtonAt(box, { x: -200, y: -300, z: 0.5 }, null, 34);
    expect(at.x).toBe(720);
  });

  it('tucks inside when the frame’s top is above the reach', () => {
    const at = playButtonAt(box, { x: -200, y: -300, z: 1 }, null, 34);
    expect(at.inside).toBe(true);
    expect(at.y).toBe(34);
  });

  it('hangs above the frame when there is room', () => {
    const at = playButtonAt(box, { x: -200, y: -200, z: 1 }, null, 34);
    expect(at.inside).toBe(false);
    expect(at.y).toBe(100);
  });

  it('uses the window, not the layout, while filling', () => {
    // The bug: a 1440-wide frame filling a 1262-wide window put the button at
    // 1440 — off the right edge, where it could not be clicked. Entering fill
    // worked and leaving it did not.
    const at = playButtonAt(box, { x: -200, y: -300, z: 1 }, { width: 1262, height: 624 }, 34);
    expect(at.x).toBe(1262);
    expect(at.y).toBe(34);
    expect(at.inside).toBe(true);
  });

  it('stays inside a window wider than the frame too', () => {
    const at = playButtonAt(box, { x: -200, y: -300, z: 1 }, { width: 1920, height: 1080 }, 34);
    expect(at.x).toBe(1920);
  });
});
