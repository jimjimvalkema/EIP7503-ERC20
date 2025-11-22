# Agent Guidelines

## Build & Test Commands

- **dev**: `bun dev` - Start development server with Vite
- **build**: `bun run build` - Build for production
- **check**: `bun run check` - Type-check with svelte-check and tsc
- **preview**: `bun run preview` - Preview production build locally

No test framework is configured; use svelte-check and tsc for validation.

## Code Style Guidelines

**TypeScript & JavaScript**
- Target ES2022 with module: ESNext (tsconfig.app.json)
- Use strict types: `checkJs: true`, `allowJs: true`
- Import paths: use `$lib` alias for src/lib imports (e.g., `$lib/utils`)
- Disable ESLint rules with `// eslint-disable-next-line` when necessary (see utils.ts for pattern)

**Svelte Components**
- Use `<script lang="ts" module>` for exports and utilities, `<script lang="ts">` for component logic
- Use `$props()` rune for component props (Svelte 5 style, no `export let`)
- Use `$bindable()` for refs that need binding (see button.svelte)
- File structure: place props/types in module script, then component script

**Naming & Organization**
- Components: PascalCase, placed in `src/lib/components/` organized by category (e.g., `ui/button/`)
- Utilities: camelCase functions in `src/lib/utils.ts` (e.g., `cn()`, helper types)
- Variants: use `tailwind-variants` (`tv()` function) for styled component patterns

**Styling**
- Tailwind CSS v4 with Vite plugin integration
- Use shadcn-svelte for UI components (configured in components.json)
- Use `cn()` utility (clsx + tailwind-merge) for conditional class merging
- Variant patterns: define with `tv()` for type-safe style composition
- Add new shadcn components with: `bunx shadcn-svelte@latest add [component-name]`

**Error Handling**
- Use TypeScript's strict null checks; prefer non-null assertions (`!`) only when certain
- Type utilities: `WithElementRef<T>`, `WithoutChildren<T>` for flexible prop typing (utils.ts)

**Dependencies**
- Use Bun as package manager (bun.lock file)
- Core: Svelte 5.43+, Vite 7, TypeScript 5.9, TailwindCSS 4
- UI: @lucide/svelte icons, tailwind-variants, tailwind-merge, clsx
