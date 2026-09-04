import { beforeEach, describe, expect, it } from 'vitest';
import {
  affectedIds, applyCommand, createHistory, isNoop, type Command, type Placement,
} from './history';

/** vitest runs in node by default, so sessionStorage has to exist to be used. */
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as unknown as { sessionStorage: Storage }).sessionStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  } as Storage;
});

const at = (x: number, y: number, width = 100, height = 100): Placement =>
  ({ x, y, width, height });

const move = (id: string, from: Placement, to: Placement): Command =>
  ({ kind: 'move', id, from, to });

describe('createHistory', () => {
  it('has nothing to undo to begin with', () => {
    const h = createHistory();
    expect(h.canUndo()).toBe(false);
    expect(h.undo()).toBeNull();
  });

  it('gives commands back newest first', () => {
    const h = createHistory();
    h.push(move('a', at(0, 0), at(10, 0)));
    h.push(move('b', at(0, 0), at(20, 0)));
    expect(h.undo()).toMatchObject({ id: 'b' });
    expect(h.undo()).toMatchObject({ id: 'a' });
    expect(h.undo()).toBeNull();
  });

  it('moves an undone command onto the redo stack and back', () => {
    const h = createHistory();
    h.push(move('a', at(0, 0), at(10, 0)));
    h.undo();
    expect(h.canRedo()).toBe(true);
    expect(h.redo()).toMatchObject({ id: 'a' });
    expect(h.canUndo()).toBe(true);
    expect(h.canRedo()).toBe(false);
  });

  it('makes the redo branch unreachable once you do something new', () => {
    const h = createHistory();
    h.push(move('a', at(0, 0), at(10, 0)));
    h.undo();
    h.push(move('b', at(0, 0), at(20, 0)));
    expect(h.canRedo()).toBe(false);
  });

  it('forgets the oldest entry at the limit, not the newest', () => {
    const h = createHistory();
    for (let i = 0; i < 55; i += 1) h.push(move(`s${i}`, at(0, 0), at(i, 0)));
    expect(h.undo()).toMatchObject({ id: 's54' });
    // Fifty kept, so the oldest surviving is s5.
    let last = h.undo();
    while (h.canUndo()) last = h.undo();
    expect(last).toMatchObject({ id: 's5' });
  });

  it('survives being rebuilt from storage, which a reload does', () => {
    const a = createHistory();
    a.push(move('a', at(0, 0), at(10, 0)));
    const b = createHistory();
    expect(b.canUndo()).toBe(true);
    expect(b.undo()).toMatchObject({ id: 'a' });
  });

  it('comes back empty rather than throwing on nonsense in storage', () => {
    store.set('interaction-lab:history:v1', '{ not json');
    expect(createHistory().canUndo()).toBe(false);
    store.set('interaction-lab:history:v1', '"a string"');
    expect(createHistory().canUndo()).toBe(false);
  });

  it('clears both stacks', () => {
    const h = createHistory();
    h.push(move('a', at(0, 0), at(10, 0)));
    h.undo();
    h.clear();
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
  });
});

describe('applyCommand', () => {
  const layout = { a: at(0, 0), b: at(500, 0) };

  it('puts a moved frame back where it was', () => {
    const cmd = move('a', at(0, 0), at(120, 40));
    expect(applyCommand(layout, cmd, 'undo')['a']).toEqual(at(0, 0));
    expect(applyCommand(layout, cmd, 'redo')['a']).toEqual(at(120, 40));
  });

  it('leaves every other frame alone', () => {
    const out = applyCommand(layout, move('a', at(0, 0), at(120, 40)), 'undo');
    expect(out['b']).toEqual(layout['b']);
  });

  it('replaces only the ids a layout command knows about', () => {
    // A screen added since the command was recorded keeps its place rather
    // than vanishing because the old snapshot never mentioned it.
    const cmd: Command = {
      kind: 'layout',
      from: { a: at(0, 0) },
      to: { a: at(999, 0) },
    };
    const out = applyCommand({ ...layout, c: at(9, 9) }, cmd, 'undo');
    expect(out['a']).toEqual(at(0, 0));
    expect(out['c']).toEqual(at(9, 9));
  });
});

describe('affectedIds', () => {
  it('names the one frame a move touched', () => {
    expect(affectedIds(move('a', at(0, 0), at(1, 1)))).toEqual(['a']);
  });

  it('names every frame a layout command touched', () => {
    expect(affectedIds({ kind: 'layout', from: {}, to: { a: at(0, 0), b: at(1, 1) } }))
      .toEqual(['a', 'b']);
  });
});

describe('isNoop', () => {
  it('sees a move that went nowhere', () => {
    expect(isNoop(move('a', at(10, 10), at(10, 10)))).toBe(true);
  });

  it('sees a move that changed only the size', () => {
    expect(isNoop(move('a', at(10, 10, 100, 100), at(10, 10, 200, 100)))).toBe(false);
  });

  it('sees a layout command that rearranged nothing', () => {
    const same = { a: at(0, 0), b: at(1, 1) };
    expect(isNoop({ kind: 'layout', from: same, to: { ...same } })).toBe(true);
  });

  it('sees a layout command that added or dropped an id', () => {
    expect(isNoop({ kind: 'layout', from: { a: at(0, 0) }, to: { a: at(0, 0), b: at(1, 1) } }))
      .toBe(false);
  });
});
