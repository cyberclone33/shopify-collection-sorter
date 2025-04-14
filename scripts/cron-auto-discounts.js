#!/usr/bin/env node

/**
 * Automated Daily Discounts Cron Script
 * This script triggers the webhook endpoint for automated daily discounts
 * It should be run via cron or PM2 every 5 minutes or your desired interval
 * 
 * Example cron setup:
 * */5 * * * * /path/to/app/scripts/cron-auto-discounts.js
 * 
 * Example PM2 setup:
 * pm2 start scripts/cron-auto-discounts.js --cron "*/5 * * * *"
 */

// Try to load environment variables from .env file
try {
  require('dotenv').config();
} catch (e) {
  // dotenv might not be installed, continue without it
  console.log('dotenv not available, using process.env directly');
}

const appUrl = process.env.APP_URL || 'https://shopify-collection-sorter.onrender.com';
const adminApiToken = process.env.SHOPIFY_ADMIN_API_TOKEN;
const shop = process.env.SHOP || 'alphapetstw.myshopify.com';

if (!adminApiToken) {
  console.error('Error: SHOPIFY_ADMIN_API_TOKEN environment variable is not set');
  process.exit(1);
}

const webhookUrl = `${appUrl}/webhook/daily-discounts/auto?shop=${shop}`;
const timestamp = new Date().toISOString();

console.log(`[${timestamp}] Triggering automated daily discounts`);

// Function to trigger the webhook
async function triggerWebhook() {
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Admin-API-Token': adminApiToken
      },
      body: JSON.stringify({})
    });
    
    const body = await response.json();
    
    if (response.ok) {
      console.log(`[${timestamp}] Successfully triggered automated daily discounts`);
      console.log(body.message || 'No specific message returned');
    } else {
      console.error(`[${timestamp}] Failed to trigger automated daily discounts (HTTP ${response.status})`);
      console.error(body);
    }
  } catch (error) {
    console.error(`[${timestamp}] Error triggering webhook:`, error);
  }
}

// Run the script
triggerWebhook().catch(console.error);
