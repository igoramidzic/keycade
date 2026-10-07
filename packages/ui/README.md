# Shared UI

The three React applications consume this package's TypeScript source and shared Tailwind CSS.
React and React DOM are peer dependencies so the apps own their runtime; the shared Vite
configuration deduplicates both packages.

## shadcn provenance

Initialized on October 6, 2026 with `npx --yes shadcn@latest` (resolved version `4.21.3`):

```sh
npx --yes shadcn@latest init --cwd apps/bank-site --defaults --template vite --force --no-reinstall
npx --yes shadcn@latest add button badge card --cwd apps/bank-site --yes
```

The CLI's default `base-nova` preset supplies the neutral palette, Geist font, and component
styles. Initialization generated the theme and initial utilities. The app's aliases were
then configured for the [supported monorepo workflow](https://ui.shadcn.com/docs/monorepo),
and `add` generated Button, Badge, and Card directly in this package. CLI dependencies
were moved from the initializing app into their owning shared package and pinned. Biome
formats generated source; component styling and theme values remain the CLI defaults.

To add another used component, run the requested CLI from an app:

```sh
npx shadcn@latest add <component> --cwd apps/bank-site
```

Keep matching style, icon library, and base color in each `components.json`. Run `pnpm
install` to reconcile the single workspace lockfile after dependency changes.
