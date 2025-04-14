#!/bin/bash

# Automated Daily Discounts Cron Script
# This script triggers the webhook endpoint for automated daily discounts
# It should be run via cron every 5 minutes or your desired interval

# Load environment variables if available
if [ -f /Users/jarvis/Desktop/FUN/alpha-dog/.env ]; then
  source /Users/jarvis/Desktop/FUN/alpha-dog/.env
fi

# Fallback environment variables if not loaded from .env
APP_URL=${APP_URL:-"https://shopify-collection-sorter.onrender.com"}
SHOPIFY_ADMIN_API_TOKEN=${SHOPIFY_ADMIN_API_TOKEN:-""}

if [ -z "$SHOPIFY_ADMIN_API_TOKEN" ]; then
  echo "Error: SHOPIFY_ADMIN_API_TOKEN environment variable is not set"
  exit 1
fi

SHOP=${SHOP:-"alphapetstw.myshopify.com"}

# Current timestamp
timestamp=$(date +"%Y-%m-%d %H:%M:%S")

# Endpoint URL
WEBHOOK_URL="${APP_URL}/webhook/daily-discounts/auto?shop=${SHOP}"

echo "[$timestamp] Triggering automated daily discounts"

# Send the request to the webhook endpoint
response=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  -H "X-Shopify-Admin-API-Token: $SHOPIFY_ADMIN_API_TOKEN" \
  -d "{}" \
  "$WEBHOOK_URL")

# Extract the HTTP status code
http_code=$(echo "$response" | tail -n1)
# Extract the response body (all but the last line)
body=$(echo "$response" | sed '$d')

if [ "$http_code" -eq 200 ]; then
  echo "[$timestamp] Successfully triggered automated daily discounts"
  echo "$body" | grep -o '"message":"[^"]*"' | cut -d'"' -f4
else
  echo "[$timestamp] Failed to trigger automated daily discounts (HTTP $http_code)"
  echo "$body"
fi
