# Alpha-Dog Development Guide

## Commands
- `npm run dev` - Run development environment
- `npm run lint` - Run ESLint
- `npm run build` - Build for production
- `npm run prisma` - Run Prisma commands (e.g., `npm run prisma -- db push`)
- `npm run resort:run` - Run collection auto-resort script
- `npm run setup` - Initialize database

## Code Style
- **Typescript**: Strict mode enabled. Use proper types, avoid `any`.
- **Formatting**: Uses Prettier with ESLint integration (eslint-config-prettier).
- **Imports**: ES modules (type: "module"). Sort imports alphabetically.
- **Naming**: 
  - React components: PascalCase
  - Functions/variables: camelCase
  - Files: kebab-case.ts(.tsx)
  - Server-side files: *.server.ts
- **Error Handling**: Use try/catch blocks for async operations, especially in server functions.
- **Component Structure**: Use Remix routing conventions and Shopify Polaris components.
- **Testing**: No specific testing framework identified.

This is a Remix/React application built for Shopify with Prisma for database management.