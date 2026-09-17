import 'dotenv/config';
import readline from 'readline';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { pool, orm } from '../src/db/drizzle.js';
import { users, warehouses, appSettings, roles } from '../src/db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { runSeed } from '../src/db/seed.js';

interface SetupOptions {
  adminFullName?: string;
  adminUsername?: string;
  adminPassword?: string;
  setupToken?: string;
  companyName?: string;
  companyPhone?: string;
  companyAddress?: string;
  warehouseName?: string;
  warehouseCode?: string;
  currency?: string;
  invoiceStartNumber?: string;
  nonInteractive?: boolean;
}

function safeCompareTokens(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  const bufProvided = Buffer.from(provided);
  const bufExpected = Buffer.from(expected);
  if (bufProvided.length !== bufExpected.length) return false;
  return crypto.timingSafeEqual(bufProvided, bufExpected);
}

function parseCliArgs(): SetupOptions {
  const args = process.argv.slice(2);
  const options: SetupOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--non-interactive' || arg === '-y') {
      options.nonInteractive = true;
    } else if (arg.startsWith('--setup-token=')) {
      options.setupToken = arg.split('=')[1];
    } else if (arg === '--setup-token' && args[i + 1]) {
      options.setupToken = args[++i];
    } else if (arg.startsWith('--admin-name=')) {
      options.adminFullName = arg.split('=')[1];
    } else if (arg === '--admin-name' && args[i + 1]) {
      options.adminFullName = args[++i];
    } else if (arg.startsWith('--admin-user=')) {
      options.adminUsername = arg.split('=')[1];
    } else if (arg === '--admin-user' && args[i + 1]) {
      options.adminUsername = args[++i];
    } else if (arg.startsWith('--admin-pass=')) {
      options.adminPassword = arg.split('=')[1];
    } else if (arg === '--admin-pass' && args[i + 1]) {
      options.adminPassword = args[++i];
    } else if (arg.startsWith('--company-name=')) {
      options.companyName = arg.split('=')[1];
    } else if (arg === '--company-name' && args[i + 1]) {
      options.companyName = args[++i];
    } else if (arg.startsWith('--company-phone=')) {
      options.companyPhone = arg.split('=')[1];
    } else if (arg === '--company-phone' && args[i + 1]) {
      options.companyPhone = args[++i];
    } else if (arg.startsWith('--company-address=')) {
      options.companyAddress = arg.split('=')[1];
    } else if (arg === '--company-address' && args[i + 1]) {
      options.companyAddress = args[++i];
    } else if (arg.startsWith('--warehouse-name=')) {
      options.warehouseName = arg.split('=')[1];
    } else if (arg === '--warehouse-name' && args[i + 1]) {
      options.warehouseName = args[++i];
    } else if (arg.startsWith('--warehouse-code=')) {
      options.warehouseCode = arg.split('=')[1];
    } else if (arg === '--warehouse-code' && args[i + 1]) {
      options.warehouseCode = args[++i];
    } else if (arg.startsWith('--currency=')) {
      options.currency = arg.split('=')[1];
    } else if (arg === '--currency' && args[i + 1]) {
      options.currency = args[++i];
    } else if (arg.startsWith('--invoice-start=')) {
      options.invoiceStartNumber = arg.split('=')[1];
    } else if (arg === '--invoice-start' && args[i + 1]) {
      options.invoiceStartNumber = args[++i];
    }
  }

  return options;
}

function promptQuestion(rl: readline.Interface, query: string, defaultValue = '', isPassword = false): Promise<string> {
  return new Promise((resolve) => {
    const formattedQuery = defaultValue ? `${query} [default: ${defaultValue}]: ` : `${query}: `;

    if (isPassword && process.stdin.isTTY) {
      // In TTY terminal, we can hide or mask password
      process.stdout.write(formattedQuery);
      let password = '';
      
      const onData = (char: Buffer) => {
        const str = char.toString('utf-8');
        switch (str) {
          case '\n':
          case '\r':
          case '\u0004':
            process.stdin.removeListener('data', onData);
            process.stdin.setRawMode(false);
            process.stdout.write('\n');
            resolve(password.trim() || defaultValue);
            break;
          case '\u0003': // Ctrl+C
            process.stdin.setRawMode(false);
            process.exit(1);
            break;
          case '\u007f': // Backspace
          case '\b':
            if (password.length > 0) {
              password = password.slice(0, -1);
              process.stdout.write('\b \b');
            }
            break;
          default:
            if (str.length === 1 && str >= ' ') {
              password += str;
              process.stdout.write('*');
            }
            break;
        }
      };

      try {
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.on('data', onData);
      } catch {
        // Fallback for non-raw streams
        rl.question(formattedQuery, (answer) => {
          resolve(answer.trim() || defaultValue);
        });
      }
    } else {
      rl.question(formattedQuery, (answer) => {
        resolve(answer.trim() || defaultValue);
      });
    }
  });
}

async function main() {
  console.log('\x1b[36m=================================================================\x1b[0m');
  console.log('\x1b[1m\x1b[34m        WORKSHOP ERP & INVENTORY MANAGEMENT SYSTEM               \x1b[0m');
  console.log('\x1b[1m\x1b[32m           INITIAL INSTALLATION & SETUP PROTOCOL                 \x1b[0m');
  console.log('\x1b[36m=================================================================\x1b[0m');
  console.log('This protocol initializes the core database tables, default roles,');
  console.log('first administrator account, default warehouse, and company details.');

  const isProduction = process.env.NODE_ENV === 'production';
  const cliOptions = parseCliArgs();

  // Production Execution Guard (S-4)
  if (isProduction) {
    const envSetupToken = process.env.ERP_SETUP_TOKEN;
    if (!envSetupToken || envSetupToken.trim() === 'papital_erp_setup_token_2026' || envSetupToken.trim().length < 16) {
      console.error('\n\x1b[31m[SECURITY ERROR] Running initial-setup in production requires a valid, secure ERP_SETUP_TOKEN in environment (minimum 16 characters, non-default).\x1b[0m\n');
      process.exit(1);
    }

    const providedToken = cliOptions.setupToken || process.env.SETUP_CLI_TOKEN;
    if (!providedToken || !safeCompareTokens(providedToken.trim(), envSetupToken.trim())) {
      console.error('\n\x1b[31m[SECURITY ERROR] Unauthorized setup execution in production. You must provide --setup-token=<token> matching the server ERP_SETUP_TOKEN.\x1b[0m\n');
      process.exit(1);
    }

    const prodPassword = cliOptions.adminPassword || process.env.ADMIN_INITIAL_PASSWORD;
    if (!prodPassword || prodPassword.trim() === 'admin123456' || prodPassword.trim().length < 8) {
      console.error('\n\x1b[31m[SECURITY ERROR] In production, administrator password must be specified via --admin-pass (or ADMIN_INITIAL_PASSWORD), at least 8 characters, and cannot be "admin123456".\x1b[0m\n');
      process.exit(1);
    }
  }

  const configuredToken = process.env.ERP_SETUP_TOKEN;
  const effectiveSetupToken = isProduction 
    ? (configuredToken || '') 
    : (configuredToken || crypto.randomBytes(24).toString('hex'));

  if (!isProduction && effectiveSetupToken) {
    console.log(`\n\x1b[1m\x1b[35m[SECURITY] Web Setup Token (ERP_SETUP_TOKEN): ${effectiveSetupToken}\x1b[0m`);
    console.log('\x1b[90m(Provide this token in X-Setup-Token header or the Web Setup UI to authorize setup)\x1b[0m\n');
  }

  // Test Database Connection
  process.stdout.write('\x1b[33m[1/4] Verifying database connection...\x1b[0m ');
  try {
    const testResult = await pool.query('SELECT NOW()');
    if (!testResult.rows || testResult.rows.length === 0) {
      throw new Error('Database returned empty query result.');
    }
    console.log('\x1b[32m[OK]\x1b[0m');
  } catch (dbErr: any) {
    console.log('\x1b[31m[FAILED]\x1b[0m');
    console.error(`\x1b[31mDatabase connection error: ${dbErr.message}\x1b[0m`);
    console.error('Please check your DATABASE_URL in .env file and ensure PostgreSQL is active.');
    process.exit(1);
  }

  // Run Self-Healing & Base Seeding Migrations
  process.stdout.write('\x1b[33m[2/4] Running schema migrations & base system seeds...\x1b[0m ');
  try {
    await runSeed();
    console.log('\x1b[32m[OK]\x1b[0m');
  } catch (seedErr: any) {
    console.log('\x1b[31m[FAILED]\x1b[0m');
    console.error(`\x1b[31mError during migration/seed: ${seedErr.message}\x1b[0m`);
    process.exit(1);
  }

  // Check if system already has an admin user
  const [{ userCount }] = await orm.select({ userCount: sql<number>`count(*)` }).from(users);
  const isInitialInstall = Number(userCount || 0) === 0;

  if (!isInitialInstall) {
    console.log('\n\x1b[33mNotice: The system already has registered users in database.\x1b[0m');
    if (cliOptions.nonInteractive) {
      console.log('Skipping interactive initialization (--non-interactive specified).');
      process.exit(0);
    }
  }

  // Setup Protocol Data Collection
  console.log('\n\x1b[33m[3/4] Initial Setup Protocol (Company, Admin, & Warehouse):\x1b[0m');

  let adminFullName = cliOptions.adminFullName;
  let adminUsername = cliOptions.adminUsername;
  let adminPassword = cliOptions.adminPassword;
  let companyName = cliOptions.companyName;
  let companyPhone = cliOptions.companyPhone;
  let companyAddress = cliOptions.companyAddress;
  let warehouseName = cliOptions.warehouseName;
  let warehouseCode = cliOptions.warehouseCode;
  let currency = cliOptions.currency;
  let invoiceStartNumber = cliOptions.invoiceStartNumber;

  if (!cliOptions.nonInteractive) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      console.log('\n\x1b[1m--- 1. Administrator Account ---\x1b[0m');
      if (!adminFullName) {
        adminFullName = await promptQuestion(rl, '  Enter Admin Full Name', 'System Administrator');
      }
      if (!adminUsername) {
        adminUsername = await promptQuestion(rl, '  Enter Admin Username', 'admin');
      }
      const minPassLen = isProduction ? 8 : 6;
      while (!adminPassword || adminPassword.length < minPassLen || (isProduction && adminPassword === 'admin123456')) {
        adminPassword = await promptQuestion(rl, `  Enter Admin Password (min ${minPassLen} chars)`, '', true);
        if (adminPassword.length < minPassLen) {
          console.log(`  \x1b[31mPassword must be at least ${minPassLen} characters long.\x1b[0m`);
        } else if (isProduction && adminPassword === 'admin123456') {
          console.log('  \x1b[31mDefault password "admin123456" is not permitted in production.\x1b[0m');
        }
      }

      console.log('\n\x1b[1m--- 2. Company & Business Information ---\x1b[0m');
      if (!companyName) {
        companyName = await promptQuestion(rl, '  Enter Company / Workshop Name', 'Workshop ERP & Inventory');
      }
      if (companyPhone === undefined) {
        companyPhone = await promptQuestion(rl, '  Enter Contact Phone (optional)', '');
      }
      if (companyAddress === undefined) {
        companyAddress = await promptQuestion(rl, '  Enter Business Address (optional)', '');
      }
      if (!currency) {
        console.log('  Available currencies: IRR (Rial), TOMAN (Toman), USD ($), EUR (€), AED (Dirham), GBP (£)');
        currency = await promptQuestion(rl, '  Enter Primary Currency Code', 'IRR');
      }
      if (!invoiceStartNumber) {
        invoiceStartNumber = await promptQuestion(rl, '  Enter Starting Invoice / Document Number', '1000');
      }

      console.log('\n\x1b[1m--- 3. Default Warehouse ---\x1b[0m');
      if (!warehouseName) {
        warehouseName = await promptQuestion(rl, '  Enter Default Warehouse Name', 'Central Warehouse');
      }
      if (!warehouseCode) {
        warehouseCode = await promptQuestion(rl, '  Enter Default Warehouse Code', 'main');
      }
    } finally {
      rl.close();
    }
  } else {
    // Non-interactive mode (S-4)
    adminFullName = adminFullName || 'System Administrator';
    adminUsername = adminUsername || 'admin';
    if (!adminPassword && process.env.ADMIN_INITIAL_PASSWORD) {
      adminPassword = process.env.ADMIN_INITIAL_PASSWORD;
    }
    if (!adminPassword) {
      if (isProduction) {
        console.error('\n\x1b[31m[SECURITY ERROR] In production non-interactive mode, --admin-pass or ADMIN_INITIAL_PASSWORD is required.\x1b[0m\n');
        process.exit(1);
      }
      adminPassword = crypto.randomBytes(12).toString('base64url');
      console.log(`\n\x1b[33m[SECURITY] Non-interactive mode without password. Generated secure admin password: \x1b[32m${adminPassword}\x1b[0m\n`);
    }
    companyName = companyName || 'Workshop ERP & Inventory';
    companyPhone = companyPhone || '';
    companyAddress = companyAddress || '';
    warehouseName = warehouseName || 'Central Warehouse';
    warehouseCode = warehouseCode || 'main';
    currency = currency || 'IRR';
    invoiceStartNumber = invoiceStartNumber || '1000';
  }

  // Sanitize values
  adminFullName = (adminFullName || 'System Administrator').trim();
  adminUsername = (adminUsername || 'admin').trim();
  adminPassword = (adminPassword || '').trim();

  if (isProduction) {
    if (!adminPassword || adminPassword.length < 8 || adminPassword === 'admin123456') {
      console.error('\n\x1b[31m[SECURITY ERROR] Administrator password in production cannot be "admin123456" and must be at least 8 characters.\x1b[0m\n');
      process.exit(1);
    }
  }
  companyName = (companyName || 'Workshop ERP & Inventory').trim();
  companyPhone = (companyPhone || '').trim();
  companyAddress = (companyAddress || '').trim();
  warehouseName = (warehouseName || 'Central Warehouse').trim();
  warehouseCode = (warehouseCode || 'main').trim().toLowerCase();
  currency = (currency || 'IRR').trim().toUpperCase();
  invoiceStartNumber = (invoiceStartNumber || '1000').trim();

  // Step 4: Apply Initial Configurations
  process.stdout.write('\n\x1b[33m[4/4] Applying setup configurations to database...\x1b[0m ');

  try {
    // 1. Create or Update Administrator Account
    const hashedPassword = bcrypt.hashSync(adminPassword, 10);
    const existingUser = await orm.select().from(users).where(eq(users.username, adminUsername)).limit(1);

    if (existingUser.length > 0) {
      await orm.update(users).set({
        fullName: adminFullName,
        password: hashedPassword,
        role: 'admin'
      }).where(eq(users.id, existingUser[0].id));
    } else {
      await orm.insert(users).values({
        username: adminUsername,
        password: hashedPassword,
        fullName: adminFullName,
        role: 'admin',
        avatarUrl: ''
      });
    }

    // 2. Create or Update Default Warehouse
    const existingWarehouse = await orm.select().from(warehouses).where(eq(warehouses.code, warehouseCode)).limit(1);
    if (existingWarehouse.length > 0) {
      await orm.update(warehouses).set({
        name: warehouseName,
        isActive: 1
      }).where(eq(warehouses.id, existingWarehouse[0].id));
    } else {
      await orm.insert(warehouses).values({
        name: warehouseName,
        code: warehouseCode,
        isActive: 1
      });
    }

    // 3. Save Company and App Settings
    const settingsToSave = [
      { key: 'company_name', value: companyName },
      { key: 'company_phone', value: companyPhone },
      { key: 'company_address', value: companyAddress },
      { key: 'currency', value: currency },
      { key: 'invoice_start_number', value: invoiceStartNumber }
    ];

    for (const item of settingsToSave) {
      await orm.insert(appSettings).values(item).onConflictDoUpdate({
        target: appSettings.key,
        set: { value: item.value }
      });
    }

    console.log('\x1b[32m[OK]\x1b[0m');

    // Display formatted summary
    console.log('\n\x1b[32m=================================================================\x1b[0m');
    console.log('\x1b[1m\x1b[32m   ✔ INITIAL SETUP PROTOCOL COMPLETED SUCCESSFULLY!              \x1b[0m');
    console.log('\x1b[32m=================================================================\x1b[0m');
    console.log('\x1b[1mSummary of Initialized Configuration:\x1b[0m');
    console.log(`  • Super Admin User : \x1b[36m${adminUsername}\x1b[0m (${adminFullName})`);
    console.log(`  • Default Warehouse: \x1b[36m${warehouseName}\x1b[0m [code: ${warehouseCode}]`);
    console.log(`  • Company Name     : \x1b[36m${companyName}\x1b[0m`);
    console.log(`  • Primary Currency : \x1b[36m${currency}\x1b[0m`);
    console.log(`  • Invoice Start Ref: \x1b[36m#${invoiceStartNumber}\x1b[0m`);
    console.log('=================================================================\n');

  } catch (err: any) {
    console.log('\x1b[31m[FAILED]\x1b[0m');
    console.error(`\x1b[31mError saving configuration: ${err.message}\x1b[0m`);
    process.exit(1);
  } finally {
    if (pool && typeof pool.end === 'function') {
      try {
        await pool.end();
      } catch {
        // Ignore pool shutdown errors
      }
    }
  }
}

main().catch((err) => {
  console.error('Fatal setup error:', err);
  process.exit(1);
});
