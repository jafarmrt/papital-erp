#!/usr/bin/env bash
cd "$(dirname "$0")"

echo "Stopping Workshop ERP & Inventory System..."
if command -v pm2 &> /dev/null; then
    pm2 stop "inventory-app" 2>/dev/null || true
fi

# Stop systemd service if active
if command -v systemctl &> /dev/null; then
    sudo systemctl stop inventory.service 2>/dev/null || true
fi

# Stop any running node instance for this app
pkill -f "node dist/server.cjs" 2>/dev/null || true
echo "Application stopped."
