# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` - Run the development server with Shopify CLI for local development
- `npm run build` - Build the application for production
- `npm run lint` - Run ESLint to check code quality
- `npm run start` - Start the production server
- `npm run setup` - Initialize the database (run migrations)
- `npm run prisma -- db push` - Update database schema with Prisma changes
- `npm run resort:run` - Run the collection auto-resort script via Node
- `npm run resort:manual` - Run the auto-resort collection functionality directly
- `npm run docker-start` - Run setup and start the app in a Docker environment

## Code Architecture

### Framework and Technology

- **Framework**: Remix with Vite
- **UI**: React with Shopify Polaris
- **Database**: SQLite with Prisma ORM
- **Authentication**: Shopify OAuth + Social Login (Facebook, Google, LINE)

### Core Application Structure

1. **Shopify Embedded App**
   - Built using `@shopify/shopify-app-remix` and `@shopify/app-bridge-react`
   - Configured in `app/shopify.server.ts` with Prisma session storage
   - Uses flat routing via `@remix-run/fs-routes`

2. **Data Models (Prisma)**
   - `Session`: Shopify session storage
   - `SortedCollection`: Tracks sorted collections
   - `LineUser`, `GoogleUser`, `FacebookUser`: Social login users
   - `ShelfLifeItem`: Inventory with expiration date tracking
   - `DailyDiscountLog`: Records of automatic discounts

3. **Key Features**

   - **Collection Sorter**:
     - Moves out-of-stock products to the end of collections
     - Changes sort order to MANUAL if needed
     - Stores sort history in database
   
   - **Social Login**:
     - Supports Facebook, Google, and LINE authentication
     - Links social accounts to Shopify customers
     - Uses JWT for secure authentication
   
   - **Shelf Life Management**:
     - Tracks product expiration dates via CSV import
     - Syncs with Shopify inventory
     - Manages pricing for expiring products
   
   - **Automated Daily Discounts**:
     - Automatically applies discounts to random products
     - Reverses discounts on schedule
     - Tracks discount history

### API Structure

- **Shopify Authentication**: `/auth/*` routes
- **Main App Routes**: `/app/*` for embedded app UI
- **API Endpoints**: `/api/*` for AJAX and integration
- **Webhooks**: `/webhooks/*` for Shopify notifications

### Utility Modules

- **Collection Sorting**: `app/utils/collection-sorter.js`
- **Authentication**: Various auth helpers in `app/utils/`
- **Shelf Life Management**: `app/utils/shelf-life.server.ts`
- **Auto Discounts**: `app/utils/autoDiscount.server.ts`

## Database Management

- Local SQLite database in development (`/prisma/dev.db`)
- Production database stored on Render persistent disk
- Migrations managed through Prisma (`/prisma/migrations/`)
- Database initialization script in `/scripts/init-db.js`

## TypeScript and Code Style

- TypeScript with strict mode enabled
- ESLint with Prettier integration for code formatting
- Server-side files use `.server.ts` suffix
- Component naming: PascalCase
- File naming: kebab-case.ts(.tsx)

## Error Handling Conventions

- Try/catch blocks for async operations
- Proper error logging and user feedback
- GraphQL error handling in API requests

## Extension Development

The app includes Shopify theme extensions:
- `line-login`: Social login buttons integrated with the theme
- Localization support for English and Traditional Chinese