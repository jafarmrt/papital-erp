#!/usr/bin/env bash

# ==============================================================================
# Clean & Reset Installation Script
# Target: Ubuntu, Debian, Linux
# ==============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

APP_NAME="inventory-app"
DB_NAME="inventory_db"
DB_USER="inventory_admin"

echo -e "${CYAN}=================================================================${NC}"
echo -e "${YELLOW}   CLEAN & RESET INSTALLATION ENVIRONMENT                        ${NC}"
echo -e "${CYAN}=================================================================${NC}"

echo -e "${YELLOW}Stopping PM2 processes (if running)...${NC}"
if command -v pm2 &> /dev/null; then
    pm2 delete "$APP_NAME" 2>/dev/null || true
    pm2 save 2>/dev/null || true
fi

echo -e "${YELLOW}Stopping systemd service (if running)...${NC}"
sudo systemctl stop inventory.service 2>/dev/null || true

echo -e "${YELLOW}Cleaning temporary build files...${NC}"
rm -rf dist node_modules/.vite .env

# V10-0.1: .pgdata contains the ENTIRE local database (all business data).
# It is NEVER deleted without an explicit, separate confirmation.
if [ -d ".pgdata" ]; then
    echo -e "${RED}WARNING: .pgdata directory contains your ENTIRE embedded database${NC}"
    echo -e "${RED}(documents, vouchers, inventory, users). Deleting it destroys all data.${NC}"
    read -p "Delete embedded database (.pgdata)? Type 'DELETE-DATA' to confirm: " confirm_pgdata
    if [[ "$confirm_pgdata" == "DELETE-DATA" ]]; then
        rm -rf .pgdata
        echo -e "${YELLOW}Embedded database removed.${NC}"
    else
        echo -e "${GREEN}✔ Embedded database (.pgdata) PRESERVED.${NC}"
    fi
fi

echo -e "${YELLOW}Would you like to drop PostgreSQL database '${DB_NAME}' if installed?${NC}"
read -p "Reset PostgreSQL database? [y/N]: " reset_db
if [[ "$reset_db" =~ ^[Yy]$ ]]; then
    if command -v psql &> /dev/null; then
        sudo -u postgres psql -c "DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE);" 2>/dev/null || true
        sudo -u postgres psql -c "DROP USER IF EXISTS ${DB_USER};" 2>/dev/null || true
        echo -e "${GREEN}✔ PostgreSQL database reset.${NC}"
    fi
fi

echo -e "\n${GREEN}=================================================================${NC}"
echo -e "${GREEN}✔ Clean completed successfully!${NC}"
echo -e "You can now run fresh installation via:"
echo -e "  • Personal Ubuntu PC : ${CYAN}chmod +x install-ubuntu.sh && ./install-ubuntu.sh${NC}"
echo -e "  • Enterprise VPS     : ${CYAN}chmod +x setup-vps.sh && ./setup-vps.sh${NC}"
echo -e "${GREEN}=================================================================${NC}\n"
