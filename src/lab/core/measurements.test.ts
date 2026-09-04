import { describe, expect, it } from 'vitest';
import { distanceLines, extensionFor, formatDistance } from './measurements';

const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

describe('distanceLines, disjoint', () => {
  it('measures the gap between the nearest edges', () => {
    // Selected on the left, hovered on the right, 100 apart.
    const lines = distanceLines(box(0, 0, 100, 100), box(200, 0, 100, 100));
    const x = lines.filter((l) => l.axis === 'x');
    expect(x).toHaveLength(1);
    expect(x[0]).toMatchObject({ from: 100, to: 200, value: 100 });
  });

  it('measures the same gap whichever side the hovered box is on', () => {
    const lines = distanceLines(box(200, 0, 100, 100), box(0, 0, 100, 100));
    expect(lines.find((l) => l.axis === 'x')).toMatchObject({ from: 100, to: 200, value: 100 });
  });

  it('measures both axes when the boxes are diagonal to each other', () => {
    const lines = distanceLines(box(0, 0, 100, 100), box(200, 300, 100, 100));
    expect(lines.filter((l) => l.axis === 'x')).toHaveLength(1);
    expect(lines.filter((l) => l.axis === 'y')).toHaveLength(1);
  });
});

describe('distanceLines, overlapping', () => {
  it('measures only the protruding side', () => {
    // Selected runs 0..100, hovered 50..150: they overlap on x.
    const lines = distanceLines(box(0, 0, 100, 100), box(50, 0, 100, 100));
    const x = lines.filter((l) => l.axis === 'x');
    // The selected box's right edge is inside the hovered one, so that end
    // measures; its left edge protrudes, so that end does not.
    expect(x).toHaveLength(1);
    expect(x[0]).toMatchObject({ from: 100, to: 150 });
  });
});

describe('distanceLines, contained', () => {
  it('measures the padding at both ends', () => {
    // Selected 40..140 sits inside hovered 0..200 on x.
    const lines = distanceLines(box(40, 40, 100, 100), box(0, 0, 200, 200));
    const x = lines.filter((l) => l.axis === 'x');
    expect(x).toHaveLength(2);
    expect(x.map((l) => l.value)).toEqual([40, 60]);
  });

  it('gives four segments when contained on both axes, which is Figma padding', () => {
    const lines = distanceLines(box(40, 30, 100, 100), box(0, 0, 200, 200));
    expect(lines).toHaveLength(4);
    expect(lines.filter((l) => l.axis === 'x')).toHaveLength(2);
    expect(lines.filter((l) => l.axis === 'y')).toHaveLength(2);
  });

  it('anchors to the selected box when it is inside on the cross axis', () => {
    // Contained on y, so the x measurements sit on the SELECTED box's centre,
    // which keeps a padding line inside the thing it measures inside of.
    const selected = box(40, 80, 100, 40);
    const lines = distanceLines(selected, box(0, 0, 200, 200));
    const x = lines.filter((l) => l.axis === 'x');
    expect(x[0]?.at).toBe(100);           // 80 + 40/2
  });

  it('anchors to the hovered box when the selected one protrudes', () => {
    const lines = distanceLines(box(40, -50, 100, 400), box(0, 0, 200, 200));
    const x = lines.filter((l) => l.axis === 'x');
    expect(x[0]?.at).toBe(100);           // the hovered box's centre, 0 + 200/2
  });
});

describe('distanceLines, edge cases', () => {
  it('says nothing about two boxes flush against each other', () => {
    // A zero-width gap is not a measurement worth drawing.
    const lines = distanceLines(box(0, 0, 100, 100), box(100, 0, 100, 100));
    expect(lines.filter((l) => l.axis === 'x')).toHaveLength(0);
  });

  it('says nothing at all about a box measured against itself', () => {
    expect(distanceLines(box(0, 0, 100, 100), box(0, 0, 100, 100))).toEqual([]);
  });

  it('handles identical spans on one axis and a gap on the other', () => {
    const lines = distanceLines(box(0, 0, 100, 100), box(0, 300, 100, 100));
    expect(lines.filter((l) => l.axis === 'x')).toHaveLength(0);
    expect(lines.filter((l) => l.axis === 'y')).toHaveLength(1);
  });
});

describe('extensionFor', () => {
  const selected = box(0, 0, 100, 100);

  it('needs none when the segment already crosses the selected box', () => {
    expect(extensionFor({ axis: 'x', from: 100, to: 200, at: 50, value: 100 }, selected))
      .toBeNull();
  });

  it('reaches down to the box when the segment sits above it', () => {
    expect(extensionFor({ axis: 'x', from: 100, to: 200, at: -40, value: 100 }, selected))
      .toEqual([-40, 0]);
  });

  it('reaches up to the box when the segment sits below it', () => {
    expect(extensionFor({ axis: 'x', from: 100, to: 200, at: 260, value: 100 }, selected))
      .toEqual([100, 260]);
  });
});

describe('formatDistance', () => {
  it('keeps two decimals and drops the trailing zeros', () => {
    expect(formatDistance(24)).toBe('24');
    expect(formatDistance(24.5)).toBe('24.5');
    expect(formatDistance(24.567)).toBe('24.57');
  });
});
