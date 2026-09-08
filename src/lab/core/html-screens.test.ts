import { describe, expect, it } from 'vitest';
import {
  BODY_SCOPE, DEFAULT_HTML_SIZE, htmlScreenId, orderHtmlFiles,
  scopeCss, scopeSelectorList, tilePosition, titleFromSlug,
} from './html-screens';

/** Whitespace is free in CSS and the scoper adds some. Compare on shape. */
const tidy = (css: string) => css.replace(/\s+/g, ' ').trim();

describe('titleFromSlug', () => {
  it('reads a slug as a sentence, not a heading', () => {
    expect(titleFromSlug('chapter-card-lab')).toBe('Chapter card lab');
  });

  it('takes underscores as well as hyphens', () => {
    expect(titleFromSlug('card_elite_v2')).toBe('Card elite v2');
  });

  it('drops the extension, in either spelling and any case', () => {
    expect(titleFromSlug('index.html')).toBe('Index');
    expect(titleFromSlug('recommended.HTM')).toBe('Recommended');
  });

  it('splits camel case, which is how a file copied from code arrives', () => {
    expect(titleFromSlug('cardElite.html')).toBe('Card Elite');
  });

  it('collapses a run of separators rather than leaving gaps', () => {
    expect(titleFromSlug('a--__b')).toBe('A b');
  });

  it('hands back a slug it cannot improve, rather than an empty label', () => {
    expect(titleFromSlug('---')).toBe('---');
    expect(titleFromSlug('')).toBe('');
  });
});

describe('tilePosition', () => {
  it('starts at the origin', () => {
    expect(tilePosition(0)).toEqual({ x: 0, y: 0 });
  });

  it('runs across before it wraps', () => {
    const w = DEFAULT_HTML_SIZE.width + 120;
    expect(tilePosition(3)).toEqual({ x: w * 3, y: 0 });
  });

  it('wraps to a new row at the column count', () => {
    expect(tilePosition(4).x).toBe(0);
    expect(tilePosition(4).y).toBe(DEFAULT_HTML_SIZE.height + 120);
  });

  it('is deterministic, so yesterday’s screens do not move', () => {
    expect(tilePosition(7)).toEqual(tilePosition(7));
  });

  it('survives a nonsense column count rather than dividing by zero', () => {
    expect(tilePosition(3, DEFAULT_HTML_SIZE, 0)).toEqual({
      x: 0, y: (DEFAULT_HTML_SIZE.height + 120) * 3,
    });
  });
});

describe('htmlScreenId', () => {
  it('gives index.html the folder’s own id, so file operations still fit', () => {
    expect(htmlScreenId('feed', 'index.html')).toBe('feed');
    expect(htmlScreenId('feed', 'INDEX.HTML')).toBe('feed');
  });

  it('qualifies a variant with the file it came from', () => {
    expect(htmlScreenId('cards', 'card-elite.html')).toBe('cards/card-elite');
  });

  it('takes .htm as readily as .html', () => {
    expect(htmlScreenId('cards', 'old.htm')).toBe('cards/old');
  });

  it('does not mistake a file merely containing "index"', () => {
    expect(htmlScreenId('cards', 'reindex.html')).toBe('cards/reindex');
  });
});

describe('orderHtmlFiles', () => {
  it('puts index first and the rest in alphabetical order', () => {
    expect(orderHtmlFiles(['soft.html', 'index.html', 'loud.html']))
      .toEqual(['index.html', 'loud.html', 'soft.html']);
  });

  it('ignores everything that is not a page', () => {
    expect(orderHtmlFiles(['a.html', 'render.png', 'notes.md', 'b.htm']))
      .toEqual(['a.html', 'b.htm']);
  });

  it('is stable with no index present', () => {
    expect(orderHtmlFiles(['c.html', 'a.html', 'b.html']))
      .toEqual(['a.html', 'b.html', 'c.html']);
  });

  it('returns nothing for a folder with no pages', () => {
    expect(orderHtmlFiles(['screenshot.png'])).toEqual([]);
  });
});

describe('scopeSelectorList', () => {
  it('turns the document root into the screen root', () => {
    expect(tidy(scopeSelectorList(':root'))).toBe(BODY_SCOPE);
    expect(tidy(scopeSelectorList('body'))).toBe(BODY_SCOPE);
    expect(tidy(scopeSelectorList('html'))).toBe(BODY_SCOPE);
  });

  it('keeps what follows the root, so body.dark still themes', () => {
    expect(tidy(scopeSelectorList('body.themed'))).toBe(`${BODY_SCOPE}.themed`);
  });

  it('nests every other selector under the screen', () => {
    expect(tidy(scopeSelectorList('h1'))).toBe(`${BODY_SCOPE} h1`);
    expect(tidy(scopeSelectorList('*'))).toBe(`${BODY_SCOPE} *`);
  });

  it('handles each half of a list independently', () => {
    expect(tidy(scopeSelectorList('html, body, .card')))
      .toBe(`${BODY_SCOPE}, ${BODY_SCOPE}, ${BODY_SCOPE} .card`);
  });

  it('does not scope a rule that is already scoped', () => {
    const once = scopeSelectorList('h1');
    expect(tidy(scopeSelectorList(once))).toBe(tidy(once));
  });

  it('leaves a class that merely starts with the word body alone', () => {
    expect(tidy(scopeSelectorList('.body-copy'))).toBe(`${BODY_SCOPE} .body-copy`);
    expect(tidy(scopeSelectorList('bodyguard'))).toBe(`${BODY_SCOPE} bodyguard`);
  });

  it('scopes a descendant selector at its head only', () => {
    expect(tidy(scopeSelectorList('body > .card p')))
      .toBe(`${BODY_SCOPE} > .card p`);
  });
});

describe('scopeCss', () => {
  it('rewrites custom properties onto the screen root', () => {
    expect(tidy(scopeCss(':root { --bg: #000; }')))
      .toBe(`${BODY_SCOPE} { --bg: #000; }`);
  });

  it('scopes an ordinary rule', () => {
    expect(tidy(scopeCss('h1 { font-size: 26px; }')))
      .toBe(`${BODY_SCOPE} h1 { font-size: 26px; }`);
  });

  it('leaves keyframe percentages alone', () => {
    const css = '@keyframes pulse { 0% { opacity: 0; } 100% { opacity: 1; } }';
    expect(tidy(scopeCss(css))).toBe(tidy(css));
  });

  it('leaves @font-face alone', () => {
    const css = '@font-face { font-family: "X"; src: local("X"); }';
    expect(tidy(scopeCss(css))).toBe(tidy(css));
  });

  it('scopes inside @media but not the preamble', () => {
    const out = tidy(scopeCss('@media (min-width: 40em) { h1 { color: red; } }'));
    expect(out).toBe(`@media (min-width: 40em) { ${BODY_SCOPE} h1 { color: red; } }`);
  });

  it('handles @supports nested inside @media', () => {
    const out = tidy(scopeCss(
      '@media screen { @supports (display: grid) { .g { display: grid; } } }',
    ));
    expect(out).toBe(
      `@media screen { @supports (display: grid) { ${BODY_SCOPE} .g { display: grid; } } }`,
    );
  });

  it('passes a statement at-rule straight through', () => {
    const css = '@import url("x.css"); h1 { color: red; }';
    expect(tidy(scopeCss(css)))
      .toBe(`@import url("x.css"); ${BODY_SCOPE} h1 { color: red; }`);
  });

  it('does not read a brace inside a string as a block', () => {
    const out = tidy(scopeCss('[data-note="{not a block}"] { color: red; }'));
    expect(out).toBe(`${BODY_SCOPE} [data-note="{not a block}"] { color: red; }`);
  });

  it('does not read a brace inside a declaration string as a block', () => {
    const out = tidy(scopeCss('.a::after { content: "}"; } .b { color: red; }'));
    expect(out).toContain(`${BODY_SCOPE} .b`);
    expect(out).toContain('content: "}"');
  });

  it('does not read a brace inside a comment as a block', () => {
    const out = tidy(scopeCss('/* } not a block */ h1 { color: red; }'));
    expect(out).toContain(`${BODY_SCOPE} h1 { color: red; }`);
  });

  it('still finds body when a comment sits in front of it', () => {
    // Without stripping the comment, this `body` becomes a descendant
    // selector that can never match, and the file loses its theme.
    const out = tidy(scopeCss('.a, /* note */ body { color: red; }'));
    expect(out).toBe(`${BODY_SCOPE} .a, ${BODY_SCOPE} { color: red; }`);
  });

  it('survives an unterminated block rather than throwing', () => {
    expect(() => scopeCss('h1 { color: red;')).not.toThrow();
  });

  it('survives an unterminated string rather than hanging', () => {
    expect(() => scopeCss('.a { content: "oops')).not.toThrow();
  });

  it('survives an unterminated comment', () => {
    expect(() => scopeCss('/* h1 { color: red; }')).not.toThrow();
  });

  it('returns empty for empty, and does not invent a rule', () => {
    expect(scopeCss('')).toBe('');
    expect(tidy(scopeCss('   '))).toBe('');
  });

  it('is idempotent, so a re-mount cannot double-scope', () => {
    const css = 'body { margin: 0; } h1 { color: red; } @media screen { .a { top: 0; } }';
    const once = scopeCss(css);
    expect(tidy(scopeCss(once))).toBe(tidy(once));
  });

  it('scopes every rule in a realistic sheet', () => {
    const css = `
      :root { --a: 1px; }
      * { box-sizing: border-box; }
      html, body { height: 100%; }
      body.dark { background: #000; }
      .card > .title { color: red; }
      @media (prefers-color-scheme: dark) { :root { --a: 2px; } }
      @keyframes spin { from { transform: rotate(0); } to { transform: rotate(1turn); } }
    `;
    const out = scopeCss(css);
    // Nothing escapes: every selector that reaches the document does so
    // through the scope, and the keyframe steps are untouched.
    expect(out).toContain(`${BODY_SCOPE} { --a: 1px; }`);
    expect(out).toContain(`${BODY_SCOPE} *`);
    expect(out).toContain(`${BODY_SCOPE}.dark`);
    expect(out).toContain(`${BODY_SCOPE} .card > .title`);
    expect(out).toContain('from { transform: rotate(0); }');
    expect(out).not.toMatch(/(^|[{;}])\s*html\s*[,{]/);
  });

  it('takes a custom scope, so two screens could be told apart', () => {
    expect(tidy(scopeCss('h1 { color: red; }', '#screen-a')))
      .toBe('#screen-a h1 { color: red; }');
  });
});
