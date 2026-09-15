import { screenFiles, whereAt } from './where';

/**
 * Stamp an annotation with the file it was made on.
 *
 * agentation reports an element as a path like `. > div > div > .stage`. That
 * is correct and, on a canvas holding ten variants of one file, useless: the
 * path fits all ten. It has no way to know better — every screen is in one
 * document, which is exactly the arrangement that makes the canvas worth
 * having.
 *
 * So the lab answers the question agentation cannot. These are shaped to drop
 * into its callbacks, and deliberately know as little about it as possible:
 * anything with a bounding box gets a file, and anything else is left alone.
 */

/** The part of an annotation this needs. Anything else is passed through. */
interface Boxed {
  boundingBox?: { x: number; y: number; width: number; height: number } | undefined;
  x?: number | undefined;
  y?: number | undefined;
}

/**
 * The file an annotation was made on, or null.
 *
 * From the centre of its box, because that is the one coordinate an annotation
 * always has and it is in viewport space — the lab's root is fixed and never
 * scrolls, so page and viewport are the same number here.
 */
export function fileForAnnotation(annotation: Boxed): string | null {
  const box = annotation.boundingBox;
  if (box) {
    const at = whereAt(box.x + box.width / 2, box.y + box.height / 2);
    if (at) return at.file;
  }
  if (typeof annotation.x === 'number' && typeof annotation.y === 'number') {
    const at = whereAt(annotation.x, annotation.y);
    if (at) return at.file;
  }
  return null;
}

/**
 * Put the canvas's own map at the top of whatever is about to be copied.
 *
 * The agent reading this gets told which file each screen id is, once, instead
 * of guessing from a path that cannot say. Cheap, and it survives however
 * agentation chooses to format the rest.
 */
export function withScreenMap(markdown: string): string {
  const files = screenFiles();
  const ids = Object.keys(files);
  if (ids.length === 0) return markdown;

  const lines = [
    '<!-- Annotated on an interaction-lab canvas. Every screen below is a',
    '     separate file, all mounted in one document, so an element path alone',
    '     cannot say which. This is the mapping. -->',
    '',
    '## Screens on this canvas',
    '',
    ...ids.map((id) => `- \`${id}\` — \`${files[id]}\``),
    '',
    '---',
    '',
  ];
  return lines.join('\n') + markdown;
}
