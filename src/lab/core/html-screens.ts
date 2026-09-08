/**
 * The rules that turn loose `.html` files into screens.
 *
 * A React screen declares everything about itself in a `screen.ts`. An HTML
 * file declares nothing — it is a file someone dropped in a folder — so the
 * lab has to invent an id, a name and a position for it. Those rules live
 * here, as pure functions, because "where does the third variant land" is
 * exactly the kind of thing that is obvious until it is wrong.
 */

/** The frame a screen gets when nothing says otherwise. */
export const DEFAULT_HTML_SIZE = { width: 1440, height: 900 } as const;

/** Auto-placement: four across, then wrap. */
export const TILE_COLUMNS = 4;
export const TILE_GAP = 120;

/**
 * A readable name from a file or folder slug.
 *
 * `chapter-card-lab` becomes `Chapter card lab`, not `Chapter Card Lab`:
 * these are sentences describing a thing, and title case on a slug that was
 * never title case to begin with reads like a heading in a brochure.
 */
export function titleFromSlug(slug: string): string {
  const words = slug
    .replace(/\.html?$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
  if (!words) return slug;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Where the nth auto-placed screen goes.
 *
 * Deterministic in the index alone, so the canvas looks the same on every
 * reload and a screen added today does not move the ones added yesterday.
 * The saved layout overrides all of this the moment anything is dragged.
 */
export function tilePosition(
  index: number,
  size: { width: number; height: number } = DEFAULT_HTML_SIZE,
  columns = TILE_COLUMNS,
  gap = TILE_GAP,
  startY = 0,
): { x: number; y: number } {
  const cols = Math.max(1, Math.floor(columns));
  const col = index % cols;
  const row = Math.floor(index / cols);
  return {
    x: col * (size.width + gap),
    y: startY + row * (size.height + gap),
  };
}

/**
 * The first free row under everything that declared its own position.
 *
 * Auto-placed screens start at the origin, and so do the screens that name a
 * position in a manifest, so tiling from zero drops the new frames on top of
 * the old ones — overlapping frames, overlapping labels, and a canvas that
 * looks broken the moment a second kind of screen exists.
 */
export function firstFreeRow(
  placed: readonly { position: { x: number; y: number }; height: number }[],
  gap = TILE_GAP,
): number {
  if (placed.length === 0) return 0;
  const bottom = Math.max(...placed.map((p) => p.position.y + p.height));
  return bottom + gap;
}

/**
 * The id for an HTML file inside a screen folder.
 *
 * `index.html` *is* the folder, so it takes the folder's own id and a folder
 * holding one page keeps the plain id that file operations already use.
 * Anything else is a variant living beside it and gets a qualified id, which
 * is stable across reloads and unique by construction.
 */
export function htmlScreenId(dir: string, file: string): string {
  const base = file.replace(/\.html?$/i, '');
  return base.toLowerCase() === 'index' ? dir : `${dir}/${base}`;
}

/**
 * Which file a folder's `screen.ts`-less contents should open.
 *
 * Returns every candidate in the order they should appear on the canvas:
 * `index.html` first when there is one, then the rest alphabetically. A
 * folder of ten variants becomes ten frames, which is the entire point of
 * putting them on a canvas instead of opening them one at a time.
 */
export function orderHtmlFiles(files: readonly string[]): string[] {
  const html = files.filter((f) => /\.html?$/i.test(f));
  return html.sort((a, b) => {
    const ai = a.replace(/\.html?$/i, '').toLowerCase() === 'index';
    const bi = b.replace(/\.html?$/i, '').toLowerCase() === 'index';
    if (ai !== bi) return ai ? -1 : 1;
    return a.localeCompare(b);
  });
}

/**
 * The attribute the mount puts on a screen's root, and the selector that
 * every rule in that screen's stylesheet is rewritten to sit under.
 */
export const BODY_ATTR = 'data-lab-body';
export const BODY_SCOPE = `[${BODY_ATTR}]`;

/**
 * The selector for one screen's root.
 *
 * Every screen carries the same attribute, so scoping them all to
 * `[data-lab-body]` scopes them to *each other*: one screen's `:root` tokens
 * land on every screen's root, and the last stylesheet to load wins. The
 * attribute carries the screen's id and the selector matches on it.
 */
export function scopeFor(screenId: string): string {
  return `[${BODY_ATTR}="${screenId.replace(/["\\]/g, '\\$&')}"]`;
}

/** A screen id, reduced to something legal in a CSS identifier. */
export function cssSuffix(screenId: string): string {
  return screenId.replace(/[^\w-]+/g, '-');
}

/** At-rules whose contents are not selectors and must be copied untouched. */
const VERBATIM_AT = /^@(keyframes|-webkit-keyframes|font-face|property|counter-style|page|import|charset|namespace|font-feature-values)\b/i;
/** At-rules that wrap ordinary rules, so their contents still need scoping. */
const NESTED_AT = /^@(media|supports|container|layer|scope)\b/i;

/**
 * Rewrite one selector list so it applies inside a screen instead of globally.
 *
 * `body`, `html` and `:root` all mean "the top of the document" to a file that
 * expects to be the whole page. Inside the lab the top of that screen is its
 * root element, so those three become the scope itself rather than a
 * descendant of it — otherwise a prototype's custom properties, which are
 * almost always declared on `:root`, land nowhere and every colour in the file
 * falls back to its initial value.
 */
/**
 * Split a selector list on its own commas.
 *
 * `:is(h1, h2)` holds a comma that belongs to the `:is`, and splitting on it
 * produces `:is(h1` and `h2)` — two selectors, both nonsense, and the rule is
 * dropped. The same goes for a comma inside `[title="a,b"]`.
 */
export function splitSelectorList(selectors: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  let quote: string | null = null;

  for (let i = 0; i < selectors.length; i += 1) {
    const c = selectors[i];
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[') depth += 1;
    else if (c === ')' || c === ']') depth = Math.max(0, depth - 1);
    else if (c === ',' && depth === 0) {
      out.push(selectors.slice(start, i));
      start = i + 1;
    }
  }
  out.push(selectors.slice(start));
  return out;
}

/** The head of a selector, when that head is the document root. */
const ROOT_HEAD = /^(?::root|html|body)(?![\w-])((?:\.[\w-]+|#[\w-]+|\[[^\]]*\]|:{1,2}[\w-]+(?:\([^)]*\))?)*)/;

export function scopeSelectorList(selectors: string, scope = BODY_SCOPE): string {
  return splitSelectorList(selectors)
    .map((raw) => {
      // A comment is legal inside a selector and means nothing there, but it
      // would sit in front of the `body` this function is looking for and stop
      // the root rewrite matching. `.a, /* note */ body` is the case: without
      // this, that `body` becomes a descendant selector that never matches.
      const sel = raw.replace(/\/\*[\s\S]*?\*\//g, '').trim();
      if (!sel) return raw.includes('/*') ? '' : raw;
      // A rule already written against the scope needs no second one.
      if (sel.startsWith(scope)) return ' ' + sel;

      /*
       * `body`, `html` and `:root` at the head of a selector are the document
       * root, which is this screen's root.
       *
       * They can also stack: `html body` and `html > body` both name the same
       * one element, and rewriting only the first leaves a `body` descendant
       * that can never match, so the whole run is consumed together.
       */
      let head = ROOT_HEAD.exec(sel);
      if (head) {
        let rest = sel.slice(head[0].length);
        let suffix = head[1] ?? '';
        for (;;) {
          const next = /^\s*>?\s*(?::root|html|body)(?![\w-])((?:\.[\w-]+|#[\w-]+|\[[^\]]*\]|:{1,2}[\w-]+(?:\([^)]*\))?)*)/
            .exec(rest);
          if (!next) break;
          suffix += next[1] ?? '';
          rest = rest.slice(next[0].length);
        }
        return ' ' + scope + suffix + rest;
      }
      head = null;

      // A bare `*` would otherwise reach out of the screen entirely.
      return ' ' + scope + ' ' + sel;
    })
    .join(',');
}

/**
 * Confine a stylesheet to one screen.
 *
 * The lab mounts HTML into its own document rather than an iframe, which is
 * what lets one measuring pass cover every screen at once — but it also means
 * a prototype's `h1 { }` would restyle the lab's own chrome and every other
 * screen beside it. Every rule is rewritten to sit under the screen's root.
 *
 * A shadow root would do this for free. It would also put a boundary between
 * the file's scripts and `document.getElementById`, which is how essentially
 * every hand-written prototype finds its own elements, so the file would stop
 * working the moment it was hosted. Scoping the CSS is the version that keeps
 * the file running.
 */
export function scopeCss(css: string, scope = BODY_SCOPE): string {
  let out = '';
  let i = 0;

  const block = (from: number): number => {
    // Returns the index just past the matching close brace.
    let depth = 0;
    for (let j = from; j < css.length; j += 1) {
      const c = css[j];
      if (c === '{') depth += 1;
      else if (c === '}') {
        depth -= 1;
        if (depth === 0) return j + 1;
      } else if (c === '"' || c === "'") {
        j = skipString(css, j);
      } else if (c === '/' && css[j + 1] === '*') {
        j = skipComment(css, j);
      }
    }
    return css.length;
  };

  while (i < css.length) {
    // Anything before the next brace or semicolon is a selector or a preamble.
    let j = i;
    while (j < css.length && css[j] !== '{' && css[j] !== '}' && css[j] !== ';') {
      // A comment can hold a brace, and a scanner that does not know that
      // will end the rule in the middle of a sentence.
      if (css[j] === '/' && css[j + 1] === '*') j = skipComment(css, j);
      else if (css[j] === '"' || css[j] === "'") j = skipString(css, j);
      j += 1;
    }

    const head = css.slice(i, j);
    const ch = css[j];

    if (ch === undefined) { out += head; break; }

    if (ch === ';') {
      // A statement at-rule (`@import`, `@charset`) or stray text.
      out += head + ';';
      i = j + 1;
      continue;
    }

    if (ch === '}') {
      // Closing a nested block the caller opened.
      out += head + '}';
      i = j + 1;
      continue;
    }

    /*
     * Comments come off before the at-rule test.
     *
     * `VERBATIM_AT` is anchored, and the head runs from the end of the last
     * rule, so a comment written above `@keyframes` — which is where anyone
     * would write one — left the head starting with slash-star. The at-rule
     * was not recognised, `@keyframes` was scoped as though it were a
     * selector, and the whole block was dropped by the parser. The animation
     * then referred to keyframes that did not exist, so no animation was
     * created at all and there was nothing for a freeze to pause.
     */
    const trimmed = stripComments(head).trim();

    if (VERBATIM_AT.test(trimmed)) {
      const end = block(j);
      out += head + css.slice(j, end);
      i = end;
      continue;
    }

    if (NESTED_AT.test(trimmed)) {
      // Keep the preamble, scope what is inside it.
      const end = block(j);
      const inner = css.slice(j + 1, end - 1);
      out += head + '{' + scopeCss(inner, scope) + '}';
      i = end;
      continue;
    }

    if (trimmed.startsWith('@')) {
      // An at-rule we do not recognise: copy it rather than mangle it.
      const end = block(j);
      out += head + css.slice(j, end);
      i = end;
      continue;
    }

    const end = block(j);
    // One space before the brace: the rewrite trims each selector, and a
    // sheet that reads `h1{...}` in devtools is harder to scan than it needs
    // to be for no gain.
    out += scopeSelectorList(head, scope) + ' ' + css.slice(j, end);
    i = end;
  }

  return out;
}

/** Comments carry no meaning outside a string, and hide the text that does. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Give a screen's keyframes a name of their own.
 *
 * `@keyframes` is document-global whatever selector its rules carry, so two
 * variants of one file both declaring `@keyframes pulse` collide: the last one
 * mounted defines it for both, and the difference you were comparing quietly
 * disappears. That is the exact case this canvas exists for, so the names are
 * qualified per screen and the declarations that reference them follow.
 */
export function renameKeyframes(css: string, suffix: string): string {
  const names = new Set<string>();
  const declaration = /@(?:-webkit-)?keyframes\s+("[^"]*"|'[^']*'|[\w-]+)/g;
  for (const match of css.matchAll(declaration)) {
    const raw = match[1] ?? '';
    names.add(raw.replace(/^['"]|['"]$/g, ''));
  }
  if (names.size === 0) return css;

  let out = css;
  for (const name of names) {
    if (!/^[\w-]+$/.test(name)) continue;
    const renamed = `${name}--${suffix}`;
    // The declaration itself.
    out = out.replace(
      new RegExp(`(@(?:-webkit-)?keyframes\\s+)${name}\\b`, 'g'),
      `$1${renamed}`,
    );
    // And every animation that asks for it by name.
    out = out.replace(
      new RegExp(`(animation(?:-name)?\\s*:[^;{}]*?)\\b${name}\\b`, 'g'),
      `$1${renamed}`,
    );
  }
  return out;
}

/** Index of the closing `/` of a comment, so the caller's `+= 1` clears it. */
function skipComment(css: string, at: number): number {
  const end = css.indexOf('*/', at + 2);
  return end === -1 ? css.length - 1 : end + 1;
}

function skipString(css: string, at: number): number {
  const quote = css[at];
  for (let k = at + 1; k < css.length; k += 1) {
    if (css[k] === '\\') { k += 1; continue; }
    if (css[k] === quote) return k;
  }
  return css.length - 1;
}

/**
 * Does this markup wire anything up with an inline handler?
 *
 * `onclick="save()"` resolves `save` as a global, so a script wrapped in a
 * function to give it its own `document` would put that function out of reach
 * and the button would stop working. A file written that way keeps the raw
 * global scope, and pays for it with the shared-id problem instead.
 */
export function usesInlineHandlers(markup: string): boolean {
  return /<[^>]+\son[a-z]+\s*=/i.test(markup);
}

/**
 * Wrap a script so `document` means "this screen" inside it.
 *
 * Two variants of one card, mounted side by side, both contain `id="title"`,
 * and `document.getElementById('title')` returns whichever mounted first — so
 * the second variant's script silently drives the first variant's DOM. That is
 * the real cost of one shared document, and it lands hardest on exactly the
 * case the canvas is for: the same file, ten times, slightly different.
 *
 * The wrapper shadows `document` with a proxy scoped to the screen's own root.
 * Everything else about it falls through, so `document.body`, `createElement`
 * and `currentScript` all behave.
 */
export function wrapScript(text: string, screenId: string): string {
  return `;(function(document){
${text}
})(window.__labScope(${JSON.stringify(screenId)}));`;
}

/**
 * A full HTML document, split into the parts a shadow root can take.
 *
 * `innerHTML` on a shadow root drops `<html>`, `<head>` and `<body>` on the
 * floor along with everything in the head, which is where a prototype keeps
 * its stylesheet. Parsing properly and re-homing the head is the difference
 * between a screen and an unstyled pile of divs.
 */
export interface ParsedHtml {
  /** `<style>` text and `<link rel=stylesheet>` hrefs, in document order. */
  styles: { kind: 'text' | 'href'; value: string }[];
  /** Scripts, in document order. `innerHTML` never runs these; the mount re-creates them. */
  scripts: { src: string | null; text: string; type: string | null; module: boolean }[];
  /** Everything else, as markup, ready for `innerHTML`. */
  body: string;
  /** The document's own `<title>`, when it has one. */
  title: string | null;
  /** Attributes on `<body>`, which is where a prototype often puts its theme class. */
  bodyClass: string | null;
}

/**
 * Parse without executing.
 *
 * `DOMParser` builds an inert document: scripts do not run, images do not
 * load, and nothing reaches the page until the mount decides it should. That
 * inertness is the whole reason to parse rather than assign `innerHTML` and
 * hope.
 */
export function parseHtmlDocument(html: string, doc: Document): ParsedHtml {
  const parsed = new DOMParser().parseFromString(html, 'text/html');

  const styles: ParsedHtml['styles'] = [];
  for (const el of parsed.querySelectorAll('style, link[rel~="stylesheet" i]')) {
    if (el.tagName === 'STYLE') {
      styles.push({ kind: 'text', value: el.textContent ?? '' });
    } else {
      const href = el.getAttribute('href');
      if (href) styles.push({ kind: 'href', value: href });
    }
    el.remove();
  }

  const scripts: ParsedHtml['scripts'] = [];
  for (const el of parsed.querySelectorAll('script')) {
    const type = el.getAttribute('type');
    scripts.push({
      src: el.getAttribute('src'),
      text: el.textContent ?? '',
      type,
      module: (type ?? '').toLowerCase() === 'module',
    });
    el.remove();
  }

  // A fragment, so the caller can adopt it without a second parse.
  const body = parsed.body ? parsed.body.innerHTML : '';
  void doc;

  return {
    styles,
    scripts,
    body,
    title: parsed.title || null,
    bodyClass: parsed.body?.getAttribute('class') || null,
  };
}
