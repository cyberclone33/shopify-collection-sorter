# Alpha Dog (Shopify Collection Sorter)

A Shopify embedded application built with Remix, TypeScript, and Prisma, designed to manage product collections, including shelf-life tracking and automatic sorting.

## Tech Stack

*   **Framework:** [Remix](https://remix.run/) (v2.16.1) with [Vite](https://vitejs.dev/)
*   **Language:** [TypeScript](https://www.typescriptlang.org/)
*   **UI:** [React](https://reactjs.org/) with [Shopify Polaris](https://polaris.shopify.com/) (v12.0.0)
*   **Database ORM:** [Prisma](https://www.prisma.io/) (v6.2.1)
*   **Database:** SQLite (hosted on Render persistent disk for production)
*   **Authentication:** Shopify OAuth, Social Logins (Facebook, Google, Line)

## Core Features

This section summarizes the main functionalities derived from the application's routes:

*   **Collection Sorting:**
    *   Lists Shopify collections with product counts and sort order status.
    *   Manually sorts selected collections by moving out-of-stock products to the end (changes sort order to MANUAL if needed).
    *   Supports single and bulk collection sorting.
    *   Records sorted status in a local database (`SortedCollection` table).
    *   Allows reverting the "sorted" status within the app.
    *   Provides an API endpoint (`/api/auto-resort`) for automated re-sorting of previously sorted collections. This endpoint can be triggered by a scheduler (using a secret token) or an admin user, and it iterates through recorded collections, re-applying the sorting logic via the Shopify API.
*   **Shelf Life Management:**
    *   Upload shelf life data via CSV (Product ID/SKU, Batch ID, Expiration Date, Quantity). Handles Big5/UTF-8 encoding.
    *   Displays inventory data, filterable by expiration status (Expired, Soon, 60/90 days, Good) and sync status. Expiration status is derived from the Batch ID (YYYYMMDD format).
    *   Syncs uploaded data with Shopify products/variants based on SKU matching, retrieving product details like price and cost.
    *   Allows setting a sale price for synced items (updates Shopify `price` and sets the original price as `compareAtPrice`).
    *   Supports deleting individual, bulk, or all shelf life records from the app's database (`ShelfLifeItem` table).
*   **Authentication:**
    *   Handles standard Shopify Embedded App OAuth flow (`/auth/$`).
    *   Supports Social Logins (Facebook, Google, Line) via dedicated routes (`/auth/[provider]`, `/auth/[provider]/callback`).
    *   Social login flow:
        *   Initiates OAuth redirect to the provider.
        *   Handles the callback, exchanges code for tokens, fetches user profile.
        *   Saves provider user info to the database (`LineUser`, `GoogleUser`, `FacebookUser` tables).
        *   Attempts to create/link a Shopify customer account via Admin API (if configured), setting marketing consent.
        *   Generates a JWT containing either linked Shopify customer credentials (with a newly generated password) or fallback provider details.
        *   Redirects to the storefront login page (`/account/login`) with the JWT (`[provider]_token`) for potential auto-login by the theme.
        *   Provides verification endpoints (`/auth/[provider]/verify`) for the storefront theme to securely validate the received JWT and retrieve login credentials.
    *   Includes rate limiting on authentication attempts.
*   **Admin Interface (`app.admin.tsx`):**
    *   Provides a database inspection tool for administrators.
    *   Displays database table names, `SortedCollection` column structure, and recent `Session` / `SortedCollection` records for the current shop.
    *   Allows execution of custom SQL queries (requires shop parameter `?` for basic scoping).
*   **Social Login User Management (`app.social-login.tsx`, `app.line-users.tsx`):**
    *   The main `/app/social-login` route displays lists of users who have authenticated via LINE, Google, or Facebook, separated by tabs.
    *   Shows user details fetched from the database, including profile info (name, avatar), email, and linked Shopify Customer ID (if applicable).
    *   Provides a read-only view for administrators. (The `/app/line-users` route provides a similar view specifically for LINE users).
*   **Webhooks (`webhooks.*.tsx`):**
    *   Handles the `APP_UNINSTALLED` webhook to clean up session data for the uninstalling shop.
    *   Handles the `APP_SCOPES_UPDATE` webhook to update the stored session scopes when permissions change.

## Core App Files (`app/`)

This section describes the core files directly within the `app/` directory that set up the application's foundation:

*   **`db.server.ts`**: Initializes and exports the Prisma client. Handles database URL determination (Render persistent disk vs. local), runs migrations (`prisma migrate deploy`) in production, and includes fallback logic to create tables (`Session`, `SortedCollection`, `LineUser`) directly via `sqlite3` or raw SQL if migrations fail. Uses a global instance in development to prevent multiple clients during hot reload.
*   **`entry.server.tsx`**: The main Remix server entry point. Handles server-side rendering (SSR) using `renderToPipeableStream`. Sets security headers (`getSecurityHeaders`) and Shopify-specific headers (`addDocumentResponseHeaders`), removing `X-Frame-Options` for embedded contexts. Optimizes rendering for bots vs. users (`isbot`). Includes environment variable logging for debugging.
*   **`globals.d.ts`**: TypeScript declaration file allowing direct import of `.css` files as modules within the application's TypeScript/TSX code.
*   **`root.tsx`**: Defines the root HTML structure (`<html>`, `<head>`, `<body>`) for all pages. Includes standard meta tags, Shopify fonts, and Remix components (`<Meta>`, `<Links>`, `<Outlet>`, `<Scripts>`, `<ScrollRestoration>`) for rendering route content, CSS, meta tags, and scripts.
*   **`routes.ts`**: Configures Remix routing to use file-system based routing via `@remix-run/fs-routes` with the `flatRoutes()` convention, meaning routes are defined by the file structure in `app/routes/`.
*   **`shopify.server.ts`**: Initializes and configures the `@shopify/shopify-app-remix` library. Sets up API credentials, scopes, version, session storage (using `PrismaSessionStorage` linked to `db.server.ts`), auth path, distribution mode, and future flags. Exports the main `shopify` object and helper functions (`authenticate`, `login`, `registerWebhooks`, etc.) for interacting with Shopify APIs and handling authentication.

## Route File Descriptions

This section provides a brief overview of each file within the `app/routes/` directory:

*   **`api.auto-resort.tsx`**: API endpoint triggered externally (scheduler) or internally to automatically re-sort collections marked in the database.
*   **`api.line-credentials.tsx`**: Internal API used by the frontend during LINE login to retrieve user credentials (email, access token) for storefront login attempts.
*   **`app._index.tsx`**: The main dashboard/landing page for the embedded app, providing navigation and an overview.
*   **`app.admin.tsx`**: Admin-only page for inspecting database tables and executing custom SQL queries.
*   **`app.collections.tsx`**: The user interface for the Collection Sorter feature, allowing manual and bulk sorting, and viewing collection status.
*   **`app.line-users.tsx`**: Displays a list of users who authenticated via LINE. Functionality is largely consolidated into `app.social-login.tsx`.
*   **`app.shelf-life.tsx`**: The user interface for Shelf Life Management, including CSV upload, inventory viewing/filtering, syncing with Shopify, and setting sale prices.
*   **`app.social-login.tsx`**: The main dashboard for viewing users authenticated via any social provider (LINE, Google, Facebook), displayed in tabs.
*   **`app.tsx`**: The root layout component for all embedded app pages under `/app/*`. Handles authentication and renders the main navigation menu.
*   **`auth.$.tsx`**: Handles the Shopify OAuth callback after app installation or authentication.
*   **`auth.facebook.callback.tsx`**: Handles the callback from Facebook after user authentication. Exchanges code for token, fetches profile, saves/links user, redirects.
*   **`auth.facebook.tsx`**: Initiates the Facebook OAuth login flow, redirecting the user to Facebook.
*   **`auth.facebook.verify.tsx`**: API endpoint for the storefront to verify the JWT received after Facebook login.
*   **`auth.google.callback.tsx`**: Handles the callback from Google after user authentication. Exchanges code for token, fetches profile, saves/links user, redirects.
*   **`auth.google.tsx`**: Initiates the Google OAuth login flow, redirecting the user to Google.
*   **`auth.google.verify.tsx`**: API endpoint for the storefront to verify the JWT received after Google login.
*   **`auth.line.callback.tsx`**: Handles the callback from LINE after user authentication. Exchanges code for token, fetches profile, saves/links user, redirects.
*   **`auth.line.tsx`**: Initiates the LINE OAuth login flow, redirecting the user to LINE.
*   **`auth.line.verify.tsx`**: API endpoint for the storefront to verify the JWT received after LINE login.
*   **`debug.embed.tsx`**: A utility page for testing or debugging the app's behavior when embedded in Shopify.
*   **`debug.health.tsx`**: Provides a health check endpoint (e.g., for Render's monitoring).
*   **`webhooks.app.scopes_update.tsx`**: Handles the `APP_SCOPES_UPDATE` webhook from Shopify to update stored session scopes.
*   **`webhooks.app.uninstalled.tsx`**: Handles the `APP_UNINSTALLED` webhook from Shopify to clean up session data.
*   **`_index/`**: (Directory) Likely contains components or assets related to the index page.
*   **`auth.login/`**: (Directory) Likely contains components or assets related to the login process.

## Utility File Descriptions (`app/utils/`)

This section describes the purpose of each file within the `app/utils/` directory:

*   **`collection-sorter.js`**: Provides the core logic for the collection sorting feature. Fetches products via GraphQL, separates by stock status, ensures MANUAL sort order, reorders via `collectionReorderProducts` mutation (moving out-of-stock to end), handles pagination/batching, and records the action in the `SortedCollection` table (Prisma).
*   **`facebook-auth.server.ts`**: Handles server-side Facebook OAuth. Generates auth URL, exchanges code for token, fetches profile, saves/updates `FacebookUser` table (Prisma), creates/verifies JWTs for storefront login, and links to Shopify customers via `createOrLinkShopifyCustomer`. Uses environment variables for config.
*   **`google-auth.server.ts`**: Handles server-side Google OAuth 2.0. Generates auth URL, exchanges code for tokens, fetches profile, saves/updates `GoogleUser` table (Prisma), creates/verifies JWTs for storefront login, and includes basic ID token parsing. Uses environment variables for config.
*   **`line-auth.server.ts`**: Handles server-side LINE Login OAuth 2.1. Generates auth URL, exchanges code for tokens, fetches profile, parses/validates ID token, saves/updates `LineUser` table (Prisma, with auto-create attempt), creates/verifies JWTs for storefront login, and includes placeholder for linking to Shopify customers. Uses environment variables for config.
*   **`rate-limiter.server.ts`**: Implements a simple in-memory IP-based rate limiter using a `Map`. `checkRateLimit` checks requests against limits. Includes basic cleanup for expired records. Notes Redis is better for production.
*   **`security-headers.server.ts`**: Provides a function (`getSecurityHeaders`) returning standard HTTP security headers (CSP, HSTS, X-Content-Type-Options, X-XSS-Protection, Referrer-Policy) configured for security and Shopify embedding.
*   **`shelf-life.server.ts`**: Handles server-side Shelf Life Management. Parses CSVs (flexible column detection), saves/retrieves data to/from `ShelfLifeItem` table (Prisma), processes CSV files, and syncs items with Shopify variants by SKU. Sync updates `ShelfLifeItem` status and updates a custom JSON metafield (`alpha_dog.expiration_data`) on variants with batch details.
*   **`shopify-customer.server.ts`**: Interacts with Shopify Customer Admin API (REST). Finds customers by email, creates new customers (optional password/marketing consent), sets passwords. `createOrLinkShopifyCustomer` finds/creates a Shopify customer and links it to a social login by updating the local `LineUser`/`GoogleUser`/`FacebookUser` record with the `shopifyCustomerId` (raw SQL).

## Theme Extensions (`extensions/`)

This section describes the Theme App Extensions provided by the application:

*   **`line-login`**: This extension integrates social login functionality directly into the Shopify theme. It provides:
    *   **Theme Blocks:** Liquid blocks (`social_login_buttons.liquid`, `social_login_embed.liquid`) allow merchants to add social login buttons (including LINE) to storefront pages (e.g., login, registration) via the theme editor. An `expiration_date.liquid` block is also included, possibly for displaying shelf-life related information on product or account pages.
    *   **App Embed Block:** Allows configuration of the social login features within the theme editor.
    *   **Assets:** Includes JavaScript (`line-login.js`) for client-side logic (e.g., handling redirects, potentially verifying JWTs passed from the app), CSS (`line-login.css`) for styling, and image assets (logos).
    *   **Configuration:** A snippet (`line_login_config.liquid`) likely holds necessary configuration like API keys or app URLs for the frontend scripts.
    *   **Localization:** Supports English and Traditional Chinese (`locales/`).

## Prisma / Database (`prisma/`)

This directory manages the application's database interactions using the Prisma ORM.

*   **`schema.prisma`**: The central configuration file defining the database connection (SQLite via `DATABASE_URL`), Prisma Client generator, and data models:
    *   `Session`: Standard model for `@shopify/shopify-app-remix` session storage.
    *   `SortedCollection`: Tracks manually sorted collections (ID, title, timestamp).
    *   `LineUser`, `GoogleUser`, `FacebookUser`: Store social login user data (provider ID, tokens, profile, linked `shopifyCustomerId`).
    *   `ShelfLifeItem`: Holds imported shelf life data (product ID/SKU, batch ID, expiration, quantity, location) and synced Shopify details (variant ID, title, price, cost, sync status).
*   **`migrations/`**: Contains timestamped SQL migration files generated by `prisma migrate`, documenting schema changes.
*   **Database Files (`*.db`, `*.db-journal`)**: The SQLite database files. The specific file (`dev.db` or `prod.db`) is determined by the `DATABASE_URL` environment variable, often pointing to persistent storage on Render (`/data/prisma/prod.db`) in production.

## Main Routes

*   `/app`: Main embedded application views (Index, Collections, Shelf Life, Admin, Social Login, Line Users).
*   `/auth`: Handles authentication flows for Shopify and social providers.
*   `/api`: Provides backend API endpoints (e.g., `/api/auto-resort`, `/api/line-credentials`).
*   `/webhooks`: Receives and processes Shopify webhooks (e.g., app uninstall, scopes update).

## Hosting

*   **Platform:** [Render](https://render.com/)
*   **Service Type:** Node.js Web Service (Free Plan)
*   **Database Hosting:** SQLite file stored on a Render Persistent Disk (`/opt/render/project/src/prisma/prod.db`).

## Utility Scripts (`scripts/`)

This directory contains standalone scripts for various tasks:

*   **`auto-resort.js`**: A script intended for automated execution (e.g., via cron). It fetches all records from the `SortedCollection` table, retrieves the corresponding shop session, and uses the `sortCollection` utility to re-apply the sorting logic for each collection, effectively maintaining the sort order over time.
*   **`create-line-user-table.js`**: A utility script designed to manually ensure the `LineUser` table exists in the database, likely as a workaround for deployment issues. It attempts `prisma db push` first, then falls back to executing a raw SQL `CREATE TABLE IF NOT EXISTS` statement.
*   **`init-db.js`**: A comprehensive database initialization script, likely used during deployment startup. It ensures Prisma client generation, checks/creates necessary directories and permissions (especially for Render's `/data` path), runs `prisma migrate deploy`, includes fallbacks (`db push`), and verifies table existence.
*   **`query-db.js`**: A debugging utility script to inspect the database. It connects using the environment-appropriate URL, lists all tables, and then queries/displays the contents of the `Session` and `SortedCollection` tables using raw SQL.

## Setup & Development

1.  **Clone the repository:**
    ```bash
    git clone <your-repository-url>
    cd alpha-dog
    ```
2.  **Install dependencies:**
    ```bash
    npm install
    ```
3.  **Set up environment variables:**
    *   Create a `.env` file in the project root (`alpha-dog/.env`).
    *   Add the necessary environment variables. You'll likely need:
        *   `SHOPIFY_API_KEY`: Your Shopify App API Key.
        *   `SHOPIFY_API_SECRET`: Your Shopify App API Secret Key.
        *   `SCOPES`: The required Shopify API scopes (e.g., `write_products,read_products,...`).
        *   `DATABASE_URL`: For local development, typically `file:./prisma/dev.db`.
        *   `AUTO_RESORT_SECRET`: A secure secret token for triggering the auto-resort API externally.
        *   *(Optional)* Keys/Secrets for Facebook, Google, and Line login if you intend to test those locally.
        *   *(Optional)* `SHOPIFY_ADMIN_API_TOKEN`: Needed for automatic Shopify customer creation/linking during social login.
        *   *(Optional)* `SHOPIFY_STOREFRONT_TOKEN`: May be needed depending on storefront interactions.
4.  **Set up the database:**
    *   Ensure Prisma CLI is available (installed via `npm install`).
    *   Run migrations to create the database schema:
        ```bash
        npx prisma migrate dev
        ```
5.  **Run the development server:**
    *   This command starts the Vite development server and tunnels your local app to make it accessible to Shopify.
        ```bash
        npm run dev
        ```
    *   Follow the prompts from the Shopify CLI to install the app on your development store.

---
