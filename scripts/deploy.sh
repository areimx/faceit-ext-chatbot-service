#!/bin/bash
set -euo pipefail

# --- Configuration ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="${PROJECT_DIR}/logs/deploy"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="${LOG_DIR}/deploy_${TIMESTAMP}.log"

mkdir -p "${LOG_DIR}"

# --- Fix for Non-Interactive Shell (Load NVM) ---
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"

# --- IO Redirection ---
# Save original stdout to FD 3 for reporting status to GitHub
exec 3>&1 
# Redirect stdout/stderr to log file; script becomes silent to the caller
exec 1>>"${LOG_FILE}" 2>&1

echo "Deployment Started: ${TIMESTAMP}"
echo "Project Root: ${PROJECT_DIR}"

# --- Error Handling ---
handle_error() {
    EXIT_CODE=$?
    
    # Report failure to GitHub via FD 3
    echo "❌ DEPLOYMENT FAILED" >&3
    echo "Error at line $1. Check server logs: ${LOG_FILE}" >&3
    
    exit $EXIT_CODE
}

trap 'handle_error ${LINENO}' ERR

# --- Deployment ---
cd "${PROJECT_DIR}"

echo "Fetching latest code..."
git fetch origin main
git reset --hard origin/main

echo "Installing dependencies..."
npm ci --silent --omit=dev

echo "Reloading PM2..."
if pm2 describe chatbot-app > /dev/null; then
    pm2 reload ecosystem.config.js --env production --update-env
else
    pm2 start ecosystem.config.js --env production
fi

pm2 save

echo "Running health check..."
sleep 10
if pm2 jlist | grep -q '"name":"chatbot-app".*"status":"online"'; then
    echo "✅ PM2 reports chatbot-app is online."
else
    echo "❌ PM2 reports service is offline/errored."
    exit 1
fi

echo "Deployment Completed: ${TIMESTAMP}"

# Cleanup old logs (keep last 10)
cd "${LOG_DIR}"
ls -t deploy_*.log | tail -n +11 | xargs -r rm --

# Report success to GitHub via FD 3
echo "✅ Deployment Successful" >&3