#!/bin/bash

set -e

# VPS connection details
VPS_HOST="${VPS_HOST:-72.60.121.202}"
VPS_USER="${VPS_USER:-root}"
VPS_DEPLOY_PATH="${VPS_DEPLOY_PATH:-/root/score24}"

echo "🚀 Starting deployment to $VPS_USER@$VPS_HOST..."

# Step 1: Push to GitHub
echo "📤 Pushing to GitHub..."
git push origin master || git push

# Step 2: Stop and delete PM2 processes on VPS
echo "⏹️  Stopping PM2 processes..."
SSHPASS=$SSHPASS sshpass -e ssh -o StrictHostKeyChecking=no "$VPS_USER@$VPS_HOST" "pm2 stop score24-daily-fetcher scheduled-odds-poller 2>/dev/null || true && pm2 delete score24-daily-fetcher scheduled-odds-poller 2>/dev/null || true"

# Step 3: Pull latest code from GitHub
echo "📥 Pulling latest code from GitHub..."
SSHPASS=$SSHPASS sshpass -e ssh -o StrictHostKeyChecking=no "$VPS_USER@$VPS_HOST" "cd $VPS_DEPLOY_PATH && git pull origin master"

# Step 4: Install dependencies on VPS
echo "📥 Installing dependencies..."
SSHPASS=$SSHPASS sshpass -e ssh -o StrictHostKeyChecking=no "$VPS_USER@$VPS_HOST" "cd $VPS_DEPLOY_PATH && bun install"

# Step 5: Run fetch-daily to populate fresh data
echo "📊 Running fetch-daily to populate fresh match data..."
SSHPASS=$SSHPASS sshpass -e ssh -o StrictHostKeyChecking=no "$VPS_USER@$VPS_HOST" "cd $VPS_DEPLOY_PATH && bun run src/fetch_daily_data.ts"

# Step 6: Start scheduled-odds-poller with PM2
echo "🎯 Starting scheduled-odds-poller..."
SSHPASS=$SSHPASS sshpass -e ssh -o StrictHostKeyChecking=no "$VPS_USER@$VPS_HOST" "cd $VPS_DEPLOY_PATH && pm2 start ecosystem.config.js --only scheduled-odds-poller || pm2 start src/scheduled-odds-poller.ts --name scheduled-odds-poller"

echo "✅ Deployment complete! Your VPS is running the latest code."
echo ""
echo "📋 What happened:"
echo "  1. Pushed code to GitHub"
echo "  2. Stopped old PM2 processes"
echo "  3. Pulled latest code from GitHub"
echo "  4. Installed dependencies"
echo "  5. Ran fetch-daily to populate fresh data"
echo "  6. Started scheduled-odds-poller"
echo ""
echo "🔍 To check status on VPS, run:"
echo "  ssh $VPS_USER@$VPS_HOST 'cd $VPS_DEPLOY_PATH && pm2 status'"
