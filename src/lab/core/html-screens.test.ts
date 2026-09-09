import { describe, expect, it } from 'vitest';
import {
  BODY_SCOPE, DEFAULT_HTML_SIZE, htmlScreenId, orderHtmlFiles,
  scopeCss, scopeSelectorList, tilePosition, titleFromSlug,
  usesInlineHandlers, wrapScript, firstFreeRow,
  splitSelectorList, scopeFor, cssSuffix, renameKeyframes,
  resolveAssetUrl, resolveSrcset, rewriteCssUrls,
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

describe('firstFreeRow', () => {
  it('is the origin when nothing is placed yet', () => {
    expect(firstFreeRow([])).toBe(0);
  });

  it('clears the lowest edge, not the first one it sees', () => {
    expect(firstFreeRow([
      { position: { x: 0, y: 0 }, height: 900 },
      { position: { x: 0, y: 2000 }, height: 100 },
      { position: { x: 0, y: 500 }, height: 200 },
    ])).toBe(2100 + 120);
  });

  it('handles a screen placed at a negative coordinate', () => {
    expect(firstFreeRow([{ position: { x: 0, y: -500 }, height: 100 }])).toBe(-400 + 120);
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

describe('usesInlineHandlers', () => {
  it('spots a handler attribute', () => {
    expect(usesInlineHandlers('<button onclick="go()">x</button>')).toBe(true);
    expect(usesInlineHandlers('<img onerror=boom>')).toBe(true);
  });

  it('is not fooled by a word that merely starts with on', () => {
    expect(usesInlineHandlers('<div data-only="1">only</div>')).toBe(false);
    expect(usesInlineHandlers('<p>click on this</p>')).toBe(false);
  });

  it('is not fooled by an attribute value containing onclick', () => {
    expect(usesInlineHandlers('<div data-note="onclick=x">y</div>')).toBe(false);
  });

  it('says no for markup with no attributes at all', () => {
    expect(usesInlineHandlers('<div><span>hi</span></div>')).toBe(false);
  });
});

describe('wrapScript', () => {
  it('shadows document with the screen’s own scope', () => {
    const out = wrapScript('var a = 1;', 'cards/soft');
    expect(out).toContain('function(document)');
    expect(out).toContain('window.__labScope("cards/soft")');
    expect(out).toContain('var a = 1;');
  });

  it('quotes an id safely rather than splicing it in', () => {
    expect(wrapScript('', 'a"b')).toContain(JSON.stringify('a"b'));
  });

  it('opens with a semicolon, so it cannot join the line before it', () => {
    expect(wrapScript('x()', 'a').startsWith(';')).toBe(true);
  });

  it('puts a newline before the close, so a trailing // comment cannot eat it', () => {
    const out = wrapScript('// note', 'a');
    expect(out).toContain('// note' + String.fromCharCode(10) + '})');
  });
});

describe('splitSelectorList', () => {
  it('splits an ordinary list', () => {
    expect(splitSelectorList('a, b, c').map((s) => s.trim())).toEqual(['a', 'b', 'c']);
  });

  it('keeps a comma inside :is() with its own selector', () => {
    expect(splitSelectorList(':is(h1, h2) span').map((s) => s.trim()))
      .toEqual([':is(h1, h2) span']);
  });

  it('keeps a comma inside :not() and nested parens', () => {
    expect(splitSelectorList(':not(.a, .b), .c').map((s) => s.trim()))
      .toEqual([':not(.a, .b)', '.c']);
  });

  it('keeps a comma inside an attribute value', () => {
    expect(splitSelectorList('[title="a,b"], .c').map((s) => s.trim()))
      .toEqual(['[title="a,b"]', '.c']);
  });

  it('is not confused by an escaped quote in an attribute value', () => {
    expect(splitSelectorList('[t="a\\",b"], .c').length).toBe(2);
  });

  it('returns one entry for one selector', () => {
    expect(splitSelectorList('.only')).toEqual(['.only']);
  });
});

describe('scopeFor and cssSuffix', () => {
  it('matches the screen id, not merely the attribute', () => {
    expect(scopeFor('feed')).toBe('[data-lab-body="feed"]');
  });

  it('keeps a slash, which every variant id contains', () => {
    expect(scopeFor('cards/soft')).toBe('[data-lab-body="cards/soft"]');
  });

  it('escapes a quote rather than ending the selector early', () => {
    expect(scopeFor('a"b')).toBe('[data-lab-body="a\\"b"]');
  });

  it('reduces an id to something legal in an identifier', () => {
    expect(cssSuffix('cards/soft')).toBe('cards-soft');
    expect(cssSuffix('a b.c')).toBe('a-b-c');
  });
});

describe('renameKeyframes', () => {
  it('qualifies the declaration and the reference together', () => {
    const out = renameKeyframes(
      '@keyframes pulse { from { opacity: 0; } } .p { animation: pulse 1s infinite; }',
      'scr',
    );
    expect(out).toContain('@keyframes pulse--scr');
    expect(out).toContain('animation: pulse--scr 1s infinite');
  });

  it('follows animation-name as well as the shorthand', () => {
    const out = renameKeyframes(
      '@keyframes spin {} .a { animation-name: spin; }', 'scr',
    );
    expect(out).toContain('animation-name: spin--scr');
  });

  it('takes the -webkit- prefixed form', () => {
    expect(renameKeyframes('@-webkit-keyframes fade {}', 'scr'))
      .toContain('@-webkit-keyframes fade--scr');
  });

  it('leaves a sheet with no keyframes untouched', () => {
    const css = '.a { color: red; }';
    expect(renameKeyframes(css, 'scr')).toBe(css);
  });

  it('does not rename a property that merely shares the name', () => {
    const out = renameKeyframes('@keyframes red {} .a { color: red; }', 'scr');
    expect(out).toContain('color: red;');
    expect(out).toContain('@keyframes red--scr');
  });

  it('renames every keyframes in a sheet', () => {
    const out = renameKeyframes(
      '@keyframes a {} @keyframes b {} .x { animation: a 1s; } .y { animation: b 2s; }',
      'scr',
    );
    expect(out).toContain('animation: a--scr 1s');
    expect(out).toContain('animation: b--scr 2s');
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
    // The comment is kept, ahead of the rule rather than inside its selector.
    expect(out).toBe(`/* note */ ${BODY_SCOPE} .a, ${BODY_SCOPE} { color: red; }`);
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

  it('finds an at-rule that has a comment written above it', () => {
    // The bug this exists for: the comment left the head starting with a
    // slash, the anchored at-rule test missed, `@keyframes` was scoped like a
    // selector, the block was dropped, and the animation referred to keyframes
    // that no longer existed — so nothing animated and nothing could be frozen.
    const out = scopeCss('/* a note */ @keyframes pulse { 0% { opacity: 0; } }');
    expect(tidy(out)).toContain('@keyframes pulse { 0% { opacity: 0; } }');
    expect(tidy(out)).not.toContain(`${BODY_SCOPE} @keyframes`);
  });

  it('does not split a comment that contains a comma', () => {
    // The bug: prose has commas. Splitting the head on them tore the comment
    // in half, scoped each half as a selector, and left the rule that followed
    // inside broken syntax — a whole stylesheet lost to one comma in a
    // sentence.
    const out = scopeCss('/* tokens, as always */ :root { --a: 1px; }');
    expect(tidy(out)).toContain(`${BODY_SCOPE} { --a: 1px; }`);
    expect(tidy(out)).not.toContain(`, ${BODY_SCOPE} as always`);
  });

  it('keeps the comment, ahead of the rule it described', () => {
    const out = scopeCss('/* a note, with a comma */ h1 { color: red; }');
    expect(out).toContain('/* a note, with a comma */');
    expect(tidy(out)).toContain(`${BODY_SCOPE} h1 { color: red; }`);
  });

  it('handles a comment with a comma in front of a selector list', () => {
    const out = tidy(scopeCss('/* one, two */ .a, .b { color: red; }'));
    expect(out).toContain(`${BODY_SCOPE} .a, ${BODY_SCOPE} .b`);
  });

  it('scopes a rule keyed on the root’s own state', () => {
    // `body[data-active]` is the idiom for reading the contract in CSS: the
    // attribute is on the screen root, not on a descendant of it.
    expect(tidy(scopeCss('body[data-active="true"] .badge { color: red; }')))
      .toBe(`${BODY_SCOPE}[data-active="true"] .badge { color: red; }`);
  });

  it('finds @media when a comment is written above it', () => {
    const out = tidy(scopeCss('/* note */ @media screen { h1 { color: red; } }'));
    expect(out).toContain(`@media screen { ${BODY_SCOPE} h1`);
  });

  it('does not split :is() across the comma inside it', () => {
    expect(tidy(scopeCss(':is(h1, h2) { color: red; }')))
      .toBe(`${BODY_SCOPE} :is(h1, h2) { color: red; }`);
  });

  it('consumes html and body together when they stack', () => {
    expect(tidy(scopeCss('html body { margin: 0; }')))
      .toBe(`${BODY_SCOPE} { margin: 0; }`);
    expect(tidy(scopeCss('html > body { margin: 0; }')))
      .toBe(`${BODY_SCOPE} { margin: 0; }`);
  });

  it('keeps what qualifies a stacked root', () => {
    expect(tidy(scopeCss('html.dark body.themed { color: red; }')))
      .toBe(`${BODY_SCOPE}.dark.themed { color: red; }`);
  });

  it('keeps a descendant of body a descendant', () => {
    expect(tidy(scopeCss('body .card { color: red; }')))
      .toBe(`${BODY_SCOPE} .card { color: red; }`);
  });

  it('takes a custom scope, so two screens could be told apart', () => {
    expect(tidy(scopeCss('h1 { color: red; }', '#screen-a')))
      .toBe('#screen-a h1 { color: red; }');
  });
});

describe('resolveAssetUrl', () => {
  const base = 'http://localhost:5190/src/screens/cards/';

  it('resolves a file beside the page', () => {
    expect(resolveAssetUrl('./card.png', base))
      .toBe('http://localhost:5190/src/screens/cards/card.png');
  });

  it('resolves a bare filename, which is the same thing written shorter', () => {
    expect(resolveAssetUrl('card.png', base))
      .toBe('http://localhost:5190/src/screens/cards/card.png');
  });

  it('climbs out of the folder when asked', () => {
    expect(resolveAssetUrl('../shared/logo.svg', base))
      .toBe('http://localhost:5190/src/screens/shared/logo.svg');
  });

  it('leaves an absolute URL alone', () => {
    const url = 'https://fonts.gstatic.com/x.woff2';
    expect(resolveAssetUrl(url, base)).toBe(url);
  });

  it('leaves a protocol-relative URL alone', () => {
    expect(resolveAssetUrl('//cdn.example/x.js', base)).toBe('//cdn.example/x.js');
  });

  it('leaves data: and blob: alone', () => {
    expect(resolveAssetUrl('data:image/svg+xml,<svg/>', base)).toBe('data:image/svg+xml,<svg/>');
    expect(resolveAssetUrl('blob:abc', base)).toBe('blob:abc');
  });

  it('leaves a bare fragment alone, which is a link into this page', () => {
    expect(resolveAssetUrl('#section', base)).toBe('#section');
  });

  it('leaves a server-rooted path alone', () => {
    expect(resolveAssetUrl('/logo.png', base)).toBe('/logo.png');
  });

  it('leaves an empty value alone rather than inventing the folder', () => {
    expect(resolveAssetUrl('', base)).toBe('');
    expect(resolveAssetUrl('   ', base)).toBe('   ');
  });

  it('survives a base it cannot parse', () => {
    expect(resolveAssetUrl('./x.png', 'not a url')).toBe('./x.png');
  });
});

describe('resolveSrcset', () => {
  const base = 'http://localhost:5190/src/screens/cards/';

  it('resolves every candidate and keeps its descriptor', () => {
    expect(resolveSrcset('a.png 1x, b.png 2x', base))
      .toBe('http://localhost:5190/src/screens/cards/a.png 1x, '
          + 'http://localhost:5190/src/screens/cards/b.png 2x');
  });

  it('handles a single candidate with no descriptor', () => {
    expect(resolveSrcset('a.png', base))
      .toBe('http://localhost:5190/src/screens/cards/a.png');
  });

  it('leaves absolute candidates alone', () => {
    expect(resolveSrcset('https://x/a.png 1x', base)).toBe('https://x/a.png 1x');
  });
});

describe('rewriteCssUrls', () => {
  const base = 'http://localhost:5190/src/screens/cards/';

  it('rewrites url() in every quoting style', () => {
    expect(rewriteCssUrls('a { background: url(bg.png); }', base))
      .toContain('url(http://localhost:5190/src/screens/cards/bg.png)');
    expect(rewriteCssUrls("a { background: url('bg.png'); }", base))
      .toContain("url('http://localhost:5190/src/screens/cards/bg.png')");
    expect(rewriteCssUrls('a { background: url("bg.png"); }', base))
      .toContain('url("http://localhost:5190/src/screens/cards/bg.png")');
  });

  it('rewrites a font-face source', () => {
    expect(rewriteCssUrls('@font-face { src: url(./x.woff2) format("woff2"); }', base))
      .toContain('/src/screens/cards/x.woff2');
  });

  it('rewrites an @import target', () => {
    expect(rewriteCssUrls('@import "shared.css";', base))
      .toBe('@import "http://localhost:5190/src/screens/cards/shared.css";');
  });

  it('leaves an absolute url() untouched, character for character', () => {
    const css = 'a { background: url(https://x/y.png); }';
    expect(rewriteCssUrls(css, base)).toBe(css);
  });

  it('leaves a data: url untouched', () => {
    const css = 'a { background: url(data:image/png;base64,AAA); }';
    expect(rewriteCssUrls(css, base)).toBe(css);
  });

  it('leaves a sheet with no urls exactly as it was', () => {
    const css = 'a { color: red; }';
    expect(rewriteCssUrls(css, base)).toBe(css);
  });
});
