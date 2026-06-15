# Cinéfilo

Cinéfilo es una aplicación web fullstack que te ayuda a decidir qué ver. Busca películas y series, filtra por plataforma y recibe recomendaciones personalizadas impulsadas por IA.

## Tech Stack

| Capa | Tecnología |
|---|---|
| Framework fullstack | [TanStack Start](https://tanstack.com/start/latest) + [React 19](https://react.dev/) |
| Build tool | [Vite](https://vitejs.dev/) |
| Estilos | [TailwindCSS 4](https://tailwindcss.com/) |
| Tipos | [TypeScript](https://www.typescriptlang.org/) |
| Componentes UI | [Radix UI](https://www.radix-ui.com/) + [Lucide React](https://lucide.dev/) |
| Formularios | [React Hook Form](https://react-hook-form.com/) + [Zod](https://zod.dev/) |
| Base de datos | [Supabase](https://supabase.com/) (PostgreSQL + Auth) |
| Server state | [TanStack Query](https://tanstack.com/query/latest) |
| IA | [Vercel AI SDK](https://sdk.vercel.ai/) |
| Deploy | [Railway](https://railway.app/) |

## Requisitos previos

- **Node.js 22+**
- **npm**
- Una cuenta y proyecto en [Supabase](https://supabase.com/)

## Instalación

```bash
# Clonar el repositorio
git clone https://github.com/amihanovich/que_veo.git
cd que_veo

# Instalar dependencias
npm install --legacy-peer-deps

# Configurar variables de entorno
cp .env.example .env
```

Completar el archivo `.env` con los valores de tu proyecto Supabase (ver sección [Variables de entorno](#variables-de-entorno)).

## Correr localmente

```bash
npm run dev
```

La aplicación estará disponible en `http://localhost:3000`.

## Scripts disponibles

| Comando | Descripción |
|---|---|
| `npm run dev` | Servidor de desarrollo con hot reload |
| `npm run build` | Build de producción (genera `.output/`) |
| `npm run build:dev` | Build en modo desarrollo |
| `npm run preview` | Preview del build de producción |
| `npm start` | Corre el servidor de producción |
| `npm run lint` | Ejecuta ESLint |
| `npm run format` | Formatea el código con Prettier |

## Variables de entorno

Obtener los valores desde el [dashboard de Supabase](https://supabase.com/dashboard):

```env
SUPABASE_URL=https://<tu-proyecto>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<anon-key>
VITE_SUPABASE_URL=https://<tu-proyecto>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<anon-key>
VITE_SUPABASE_PROJECT_ID=<tu-project-id>
```

## Estructura del proyecto

```
/
├── src/
│   ├── components/       # Componentes React
│   ├── routes/           # Rutas de TanStack Router
│   ├── server/           # Código server-side
│   └── ...
├── supabase/             # Configuración de Supabase
├── vite.config.ts        # Configuración de Vite
├── tsconfig.json         # Configuración de TypeScript
├── nixpacks.toml         # Build config para Railway
├── railway.json          # Config de deployment en Railway
├── .env.example          # Template de variables de entorno
└── DEPLOYMENT.md         # Guía detallada de deployment
```

El build de producción se genera en `.output/`:
- `.output/server/` — servidor compilado
- `.output/client/` — assets del cliente

## Deployment

Ver [DEPLOYMENT.md](./DEPLOYMENT.md) para instrucciones completas de deploy en Railway.

Checklist rápido:
- [ ] Repositorio conectado a Railway desde GitHub
- [ ] Proyecto de Supabase creado y configurado
- [ ] Variables de entorno configuradas en Railway
- [ ] `npm run build` corre exitosamente de forma local

## Notas de desarrollo

- **Package manager:** se prefiere `npm` (`npm install --legacy-peer-deps` por dependencias de peer)
- **Adapter:** Node.js (no Cloudflare Workers) — configurado en `vite.config.ts` con `cloudflare: false`
- **Estilos:** TailwindCSS v4; usar `class-variance-authority` para variantes de componentes
- **Tipos:** TypeScript estricto en todo el proyecto; sin `any`; validación en runtime con Zod

