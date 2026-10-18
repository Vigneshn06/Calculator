# Calculator

Live: https://vigneshn06.github.io/Calculator/

A modern calculator built with **Vite + TypeScript**, tested with **Vitest**, deployed via **GitHub Actions → GitHub Pages**.

## Features
- Safe expression parser (no `eval`), correct operator precedence, parentheses, `%`, `^`, `!`
- Scientific mode: √, sin, cos, tan, log, ln, π, e
- Live result preview while typing
- Full keyboard support (Enter, Esc, Backspace, Ctrl/⌘+C to copy)
- Calculation history (saved locally)
- Light / dark theme (follows system, can override)
- Responsive, accessible, installable offline PWA

## Develop
```bash
npm install
npm run dev      # local dev server
npm test         # unit tests
npm run build    # production build into dist/
```

## Deploy
In the repo: **Settings → Pages → Source: GitHub Actions**. Every push to `main` runs tests and deploys.
