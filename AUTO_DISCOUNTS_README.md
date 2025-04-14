# Automated Daily Discounts Setup Guide

This guide explains how to set up the automatic discount feature for your Shopify store.

## Configuration

1. Add the following environment variables to your Render application or `.env` file:

```
# Your Admin API token (Private App Access Token)
SHOPIFY_ADMIN_API_TOKEN=your_admin_api_token_here

# Your shop domain (e.g., your-store.myshopify.com)
SHOP=your-store.myshopify.com

# Your app URL
APP_URL=https://your-app-url.com
```

## How to Get Your Admin API Token

If you haven't created an Admin API token yet, follow these steps:

1. Log into your Shopify Admin
2. Go to Apps > Develop apps > Create an app
3. Give your app a name like "Daily Discounts" and click Create app
4. Go to "API credentials"
5. Click "Configure Admin API scopes"
6. Add the following scopes:
   - `read_products`, `write_products` (for accessing and modifying products)
   - `read_inventory` (for checking inventory levels)
7. Click "Save"
8. Click "Install app" to install the app to your store
9. After installation, you will be provided with an Admin API access token
10. Save this token as your `SHOPIFY_ADMIN_API_TOKEN` environment variable

## Running Automated Discounts

You have several options to run the automated discounts:

### Option 1: Cron Job (Server)

If you have server access, set up a cron job to run the script every 5 minutes:

```bash
# Edit your crontab
crontab -e

# Add this line to run every 5 minutes
*/5 * * * * /path/to/app/scripts/cron-auto-discounts.sh
```

### Option 2: Node.js Script with PM2

If you're using Node.js with PM2:

```bash
# Install PM2 if you haven't already
npm install -g pm2

# Start the cron job with PM2
pm2 start scripts/cron-auto-discounts.js --cron "*/5 * * * *"
```

### Option 3: External Scheduler Service

You can use a service like cron-job.org to call your webhook URL:

```
https://your-app-url.com/webhook/daily-discounts/auto
```

When setting up the webhook, add the header:
- `X-Shopify-Admin-API-Token: your_admin_api_token_here`

## Testing

To test if your setup is working correctly:

1. Visit this URL in your browser:
   ```
   https://your-app-url.com/webhook/daily-discounts/auto?test=true&apiToken=your_admin_api_token_here
   ```

2. You should see a JSON response with the results of the operation.

## Webhook Authentication

The webhook endpoint authenticates requests using your Admin API token. It checks for the token in:

1. Request headers: `X-Shopify-Admin-API-Token`
2. URL query parameters: `?apiToken=your_token`
3. Request body: `{ "apiToken": "your_token" }`

## Troubleshooting

If you encounter any issues:

1. Check your application logs for error messages
2. Verify that your Admin API token has the correct scopes
3. Ensure your Shopify store domain is correctly set
4. Make sure your token is valid and has not expired
