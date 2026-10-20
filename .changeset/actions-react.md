---
"@client-compose/react": minor
---

`useAction` performs actions (spec §5) and applies their effects: invalidated screens shown with `useScreen` / `ComposedScreen` reload and their cached responses are dropped, and the new `onInvalidate` / `onNavigate` config callbacks let apps refresh Server Components and route. `performAction` in the config sends action requests another way (e.g. through a Next.js Server Action).
