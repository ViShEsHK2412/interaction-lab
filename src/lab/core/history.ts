/**
 * Undo, as serializable commands rather than closures.
 *
 * Closures would be simpler and are the wrong shape: they cannot be written
 * down, so the stack dies with the page. These are plain JSON descriptors, and
 * the stack lives in sessionStorage, which is per tab, survives a reload, and
 * goes away with the tab. That matters because a canvas reloads more than a
 * document does, and losing the whole history to a hot reload is the kind of
 * thing that makes people stop trusting undo.
 *
 * Coalescing is by construction rather than by inspection: an entry is pushed
 * once, at the end of a completed gesture, with the values captured at its
 * start. There is no merging pass because there is nothing to merge.
 */

export interface Placement {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Command =
  /** One completed drag or resize of one frame. */
  | { kind: 'move'; id: string; from: Placement; to: Placement }
  /** Reset, cleanup, or anything else that rearranges everything at once. */
  | { kind: 'layout'; from: Record<string, Placement>; to: Record<string, Placement> };

const KEY = 'interaction-lab:history:v1';
const LIMIT = 50;

interface Stacks {
  undo: Command[];
  redo: Command[];
}

const empty = (): Stacks => ({ undo: [], redo: [] });

/**
 * Read back defensively. This is text from a previous version of the software,
 * and a stack that fails to parse must come back empty rather than throw and
 * take the canvas down with it.
 */
function read(): Stacks {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return empty();
    const data: unknown = JSON.parse(raw);
    if (typeof data !== 'object' || data === null) return empty();
    const { undo, redo } = data as { undo?: unknown; redo?: unknown };
    return {
      undo: Array.isArray(undo) ? (undo as Command[]) : [],
      redo: Array.isArray(redo) ? (redo as Command[]) : [],
    };
  } catch {
    return empty();
  }
}

function write(stacks: Stacks): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(stacks));
  } catch { /* quota or disabled; losing history is not worth an exception */ }
}

export interface History {
  push(command: Command): void;
  undo(): Command | null;
  redo(): Command | null;
  canUndo(): boolean;
  canRedo(): boolean;
  clear(): void;
}

export function createHistory(): History {
  const stacks = read();

  const save = () => write(stacks);

  return {
    push(command) {
      stacks.undo.push(command);
      // A new action makes the redo branch unreachable, which is what every
      // linear undo does and what people expect.
      stacks.redo.length = 0;
      // Drop the distant past, not the recent: running out of history should
      // cost you the oldest thing you did.
      if (stacks.undo.length > LIMIT) stacks.undo.shift();
      save();
    },
    undo() {
      const command = stacks.undo.pop();
      if (!command) return null;
      stacks.redo.push(command);
      save();
      return command;
    },
    redo() {
      const command = stacks.redo.pop();
      if (!command) return null;
      stacks.undo.push(command);
      save();
      return command;
    },
    canUndo: () => stacks.undo.length > 0,
    canRedo: () => stacks.redo.length > 0,
    clear() {
      stacks.undo.length = 0;
      stacks.redo.length = 0;
      save();
    },
  };
}

/** The layout a command produces, in each direction. */
export function applyCommand(
  layout: Record<string, Placement>,
  command: Command,
  direction: 'undo' | 'redo',
): Record<string, Placement> {
  if (command.kind === 'move') {
    const target = direction === 'undo' ? command.from : command.to;
    return { ...layout, [command.id]: { ...target } };
  }
  const target = direction === 'undo' ? command.from : command.to;
  // A whole-layout command replaces only the ids it knows about, so a screen
  // added since the command was recorded keeps its place instead of vanishing.
  return { ...layout, ...target };
}

/** Which screens a command touches, so undo can reveal what it changed. */
export function affectedIds(command: Command): string[] {
  return command.kind === 'move' ? [command.id] : Object.keys(command.to);
}

/** Nothing moved, so nothing is worth remembering. */
export function isNoop(command: Command): boolean {
  const same = (a: Placement, b: Placement) =>
    a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
  if (command.kind === 'move') return same(command.from, command.to);
  const ids = new Set([...Object.keys(command.from), ...Object.keys(command.to)]);
  for (const id of ids) {
    const a = command.from[id];
    const b = command.to[id];
    if (!a || !b || !same(a, b)) return false;
  }
  return true;
}
