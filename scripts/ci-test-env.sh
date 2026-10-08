#!/bin/bash
# v8.0.45: متغیرهای محیط job «test» در .github/workflows/ci.yml برای اجرای محلی آزمون‌ها (AGENTS.md §17).
# مقدارها همان مقدارهای آزمونی CI هستند، نه راز واقعی. استفاده: `source scripts/ci-test-env.sh && npm test`
# پایگاه‌داده را هوک شروع جلسه (.claude/hooks/session-start.sh) روشن و آماده می‌کند.
export DATABASE_URL=postgresql://postgres:test@localhost:5432/erp_test
export JWT_SECRET=test-jwt-secret-at-least-32-characters-long-1234
export ERP_SETUP_TOKEN=test_setup_token_at_least_16_chars_long
export METRICS_TOKEN=test_metrics_token_for_ci_pipeline_1234
# v9.0.340 (TD-898): WooCommerce and webhook keys are stored encrypted (src/lib/secretBox.ts), as install.sh sets up
export ERP_SECRETS_KEY=test-secrets-key-at-least-32-characters-long-1234
export NODE_ENV=test
export ERP_ALLOW_TEST_CLEANUP=1
export ERP_TEST_SCHEMA_ISOLATION=1
export PORT=3000
