# interaction-lab

A Figma-style infinite canvas that hosts your app screens, fully interactive.

Zoom out to see every prototype at once. Pan around. Double-click a screen to
lock in and use it like the real app.

Built from [timothymaarv/interaction-lab-prompt](https://github.com/timothymaarv/interaction-lab-prompt),
adapted: the prompt assumes an existing app to convert, and this is the lab on
its own, with demo screens instead.

No dependencies beyond React. The camera, the input routing and the persistence
are all hand-rolled, which is the point: a canvas is about a hundred lines of
arithmetic and you want to own them.

## Status

Early. See the commit history for what actually works today.

## Development

```bash
npm install
npm run dev        # http://localhost:5190
npm test           # the pure maths
npm run typecheck
```
