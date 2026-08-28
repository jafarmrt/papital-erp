#!/usr/bin/env bash
cd "$(dirname "$0")"

PORT=3000
if [ -f .env ] && grep -q "^PORT=" .env; then
    PORT=$(grep "^PORT=" .env | cut -d '=' -f 2 | tr -d '"' | tr -d "'")
fi

echo "Starting Workshop ERP & Inventory System on port $PORT..."
if command -v pm2 &> /dev/null && pm2 list | grep -q "inventory-app"; then
    pm2 start "inventory-app"
    echo "Started with PM2. Access at http://localhost:$PORT"
else
    if [ -f "dist/server.cjs" ]; then
        nohup node dist/server.cjs > app.log 2>&1 &
        echo "Application started in background (PID: $!). Access at http://localhost:$PORT"
    else
        nohup npm start > app.log 2>&1 &
        echo "Application started via npm start. Access at http://localhost:$PORT"
    fi
fi

# Open browser if GUI session is active
if [ -n "$DISPLAY" ] && command -v xdg-open &> /dev/null; then
    sleep 2
    xdg-open "http://localhost:$PORT" 2>/dev/null || true
fi
