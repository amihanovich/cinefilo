# Cinéfilo - Project Documentation

## Git Workflow

**Default branch for all development: `dev`**
- Always commit and push to `dev` unless explicitly told otherwise
- `git push -u origin dev`

## Project Overview

Cinéfilo (formerly QueVeo) is a fullstack web application built with modern TypeScript and React technologies.

### Tech Stack

**Frontend/Fullstack:**
- [TanStack Start](https://tanstack.com/start/latest) - Fullstack React framework with server rendering
- [React 19](https://react.dev/) - UI library
- [Vite](https://vitejs.dev/) - Build tool and dev server
- [TailwindCSS 4](https://tailwindcss.com/) - Utility-first CSS framework
- [TypeScript](https://www.typescriptlang.org/) - Type safety

**UI Components:**
- [Radix UI](https://www.radix-ui.com/) - Unstyled, accessible components
- [Lucide React](https://lucide.dev/) - Icon library
- [Recharts](https://recharts.org/) - Chart components
- [Embla Carousel](https://www.embla-carousel.com/) - Carousel component

**Forms & Validation:**
- [React Hook Form](https://react-hook-form.com/) - Form state management
- [Zod](https://zod.dev/) - TypeScript-first schema validation

**Backend & Database:**
- [Supabase](https://supabase.com/) - PostgreSQL database with auth
- [TanStack Query (React Query)](https://tanstack.com/query/latest) - Server state management
- [Vercel AI SDK](https://sdk.vercel.ai/) - AI model integration

**Deployment:**
- [Railway](https://railway.app/) - Cloud deployment platform
- [NIXPACKS](https://nixpacks.com/) - Build system for Railway

## Project Structure

```
que_veo/
├── src/
│   ├── components/       # React components
│   ├── routes/          # TanStack Router routes
│   ├── server/          # Server-side code
│   └── ...
├── supabase/            # Supabase configuration
├── vite.config.ts       # Vite configuration
├── tsconfig.json        # TypeScript configuration
├── package.json         # Dependencies and scripts
├── railway.json         # Railway deployment config
├── nixpacks.toml        # NIXPACKS build config
└── DEPLOYMENT.md        # Deployment guide
```

## Development Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production (generates `.output/` directory)
- `npm run build:dev` - Build in development mode
- `npm run preview` - Preview production build locally
- `npm start` - Run the production server
- `npm run lint` - Run ESLint
- `npm run format` - Format code with Prettier

## Key Files

### Configuration Files
- **vite.config.ts** - Vite bundler configuration with TanStack Start plugin
- **tsconfig.json** - TypeScript compiler options
- **nixpacks.toml** - Build configuration for Railway/NIXPACKS
- **railway.json** - Railway deployment settings
- **.env.example** - Template for environment variables

### Build Output
- **.output/server/** - Compiled server code (production)
- **.output/client/** - Compiled client code (production)

## Environment Variables

Required for Supabase integration:

```
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<anon-key>
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<anon-key>
VITE_SUPABASE_PROJECT_ID=<project-id>
```

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for Railway deployment instructions.

### Quick Deploy Checklist
- [ ] Repository pushed to GitHub
- [ ] Supabase project created and configured
- [ ] Railway account created
- [ ] Environment variables configured in Railway
- [ ] GitHub connection established
- [ ] Build succeeds locally (`npm run build`)

## Notable Dependencies

- `@ai-sdk/openai-compatible` - AI/LLM integration
- `@supabase/supabase-js` - Supabase JavaScript client
- `@hookform/resolvers` - Form validation integration
- `@lovable.dev/cloud-auth-js` - Cloud authentication
- `sonner` - Toast notifications
- `vaul` - Drawer component

## Development Notes

1. **Build Target:** Node.js adapter (not Cloudflare Workers)
   - Set in vite.config.ts with `cloudflare: false`
   - Enables Railway deployment

2. **Package Manager:** npm is preferred (bun.lock also present)
   - Install: `npm install --legacy-peer-deps`

3. **Styling:** TailwindCSS v4 with custom configuration
   - Component library: Radix UI (unstyled)
   - Use class-variance-authority for component variants

4. **Type Safety:** Full TypeScript across frontend and backend
   - No `any` types
   - Use Zod for runtime validation

## Testing

Current setup doesn't include automated tests. Consider adding:
- Vitest for unit tests
- Testing Library for component tests
- Playwright for E2E tests

## Future Improvements

- Add automated testing framework
- Add GitHub Actions CI/CD pipeline
- Add database migrations management
- Add API rate limiting
- Add monitoring/logging service
