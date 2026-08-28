import { Router } from 'express';
import { sql, eq, and, gt, desc, inArray } from 'drizzle-orm';
import { orm } from '../db/drizzle.js';
import { items, transactions, users, appSettings, warehouses } from '../db/schema.js';
import { authenticateToken } from '../middleware/auth.js';
import { logger } from '../middleware/logger.js';

const router = Router();
router.use(authenticateToken);

const dashboardCache = {
  data: null as any,
  timestamp: 0,
  TTL: 30000 // 30 seconds
};

router.get('/stats', async (req, res) => {
  try {
    const [{ count: totalProducts }] = await orm.select({ count: sql<number>`count(*)` }).from(items).where(and(eq(items.type, 'product'), eq(items.isDeleted, 0)));
    const [{ count: totalMaterials }] = await orm.select({ count: sql<number>`count(*)` }).from(items).where(and(eq(items.type, 'raw_material'), eq(items.isDeleted, 0)));
    const [{ count: lowStock }] = await orm.select({ count: sql<number>`count(*)` }).from(items).where(and(eq(items.isDeleted, 0), sql`${items.currentStock} <= COALESCE(${items.reorderPoint}, 5)`));
    const [{ count: recentTx }] = await orm.select({ count: sql<number>`count(*)` }).from(transactions).where(and(eq(transactions.isDeleted, 0), sql`${transactions.date}::timestamp >= (current_date - interval '7 days')`));
    // V9-2.2: شمارش فقط کاربران فعال (حذف‌شده‌های نرم مستثنی)
    const [{ count: userCount }] = await orm.select({ count: sql<number>`count(*)` }).from(users).where(eq(users.isDeleted, 0));

    res.json({
      totalProducts: Number(totalProducts),
      totalMaterials: Number(totalMaterials),
      lowStock: Number(lowStock),
      recentTx: Number(recentTx),
      activeUsers: Number(userCount)
    });
  } catch (err: any) {
    logger.error({ message: 'STATS ENDPOINT ERROR', error: err });
    throw err;
  }
});

async function syncMissingInitialTransactions() {
  try {
    const itemsWithoutInTx = await orm.execute(sql`
      SELECT i.id, i.current_stock, i.stocks
      FROM ${items} i
      LEFT JOIN (
        SELECT item_id, SUM(quantity) as total_in
        FROM ${transactions}
        WHERE type = 'in' AND is_deleted = 0
        GROUP BY item_id
      ) t ON i.id = t.item_id
      WHERE i.is_deleted = 0 AND i.current_stock > 0 AND COALESCE(t.total_in, 0) = 0
    `);

    const todayStr = new Date().toISOString().split('T')[0];

    for (const row of itemsWithoutInTx.rows) {
      const itemId = Number(row.id);
      const totalStock = Number(row.current_stock || 0);
      const stocksObj = (row.stocks as Record<string, number>) || {};

      if (Object.keys(stocksObj).length > 0) {
        for (const [whCode, qtyVal] of Object.entries(stocksObj)) {
          const qty = Number(qtyVal || 0);
          if (qty > 0) {
            await orm.insert(transactions).values({
              itemId,
              type: 'in',
              quantity: qty,
              date: todayStr,
              documentType: 'audit',
              documentRef: 'موجودی اولیه (تطبیق سیستم)',
              location: whCode,
              notes: 'ثبت موجودی اولیه جهت گردش کالا',
              createdBy: 'سیستم',
              isDeleted: 0
            });
          }
        }
      } else if (totalStock > 0) {
        await orm.insert(transactions).values({
          itemId,
          type: 'in',
          quantity: totalStock,
          date: todayStr,
          documentType: 'audit',
          documentRef: 'موجودی اولیه (تطبیق سیستم)',
          location: 'main',
          notes: 'ثبت موجودی اولیه جهت گردش کالا',
          createdBy: 'سیستم',
          isDeleted: 0
        });
      }
    }
  } catch (err) {
    logger.error({ message: 'Error syncing missing initial transactions', error: err });
  }
}

router.get('/dashboard-bi-stats', async (req, res) => {
  // Sync any items with stock that lack 'in' transactions
  await syncMissingInitialTransactions();

  const now = Date.now();
  if (dashboardCache.data && (now - dashboardCache.timestamp < dashboardCache.TTL)) {
    return res.json(dashboardCache.data);
  }

  try {
    const settings = await orm.select().from(appSettings)
      .where(inArray(appSettings.key, ['fast_moving_days', 'slow_moving_days', 'dead_stock_days']));
    
    const fastSetting = settings.find(s => s.key === 'fast_moving_days');
    const slowSetting = settings.find(s => s.key === 'slow_moving_days');
    const deadSetting = settings.find(s => s.key === 'dead_stock_days');
    
    const fastDays = fastSetting ? parseInt(fastSetting.value, 10) : 30;
    const slowDays = slowSetting ? parseInt(slowSetting.value, 10) : 90;
    const deadDays = deadSetting ? parseInt(deadSetting.value, 10) : 180;

    const alarms = await orm.select({
      id: items.id, name: items.name, code: items.code, current_stock: items.currentStock, reorder_point: items.reorderPoint, unit: items.unit, type: items.type
    }).from(items).where(and(eq(items.isDeleted, 0), sql`${items.currentStock} <= ${items.reorderPoint}`, gt(items.reorderPoint, 0))).orderBy(items.currentStock);

    const fastMovingResult = await orm.execute(sql`
      SELECT i.id, i.name, i.code, i.unit, SUM(t.quantity) as total_qty, i.current_stock
      FROM ${transactions} t
      JOIN ${items} i ON t.item_id = i.id
      WHERE t.type = 'out' AND t.is_deleted = 0 AND t.date::timestamp >= current_date - (${fastDays}::int * interval '1 day')
      GROUP BY i.id, i.name, i.code, i.unit, i.current_stock
      ORDER BY total_qty DESC
      LIMIT 5
    `);
    const fastMoving = fastMovingResult.rows;

    const slowMovingResult = await orm.execute(sql`
      SELECT i.id, i.name, i.code, i.current_stock, i.unit, i.weighted_average_cost
      FROM ${items} i
      LEFT JOIN ${transactions} t_slow ON i.id = t_slow.item_id 
        AND t_slow.type = 'out' 
        AND t_slow.is_deleted = 0 
        AND t_slow.date::timestamp >= current_date - (${slowDays}::int * interval '1 day')
      JOIN (
        SELECT DISTINCT item_id FROM ${transactions}
        WHERE type = 'out' AND is_deleted = 0 AND date::timestamp >= current_date - (${deadDays}::int * interval '1 day')
      ) t_dead ON i.id = t_dead.item_id
      WHERE i.is_deleted = 0 AND i.current_stock > 0 
        AND t_slow.id IS NULL
      ORDER BY i.current_stock DESC
      LIMIT 5
    `);
    const slowMoving = slowMovingResult.rows;

    const deadStockResult = await orm.execute(sql`
      SELECT i.id, i.name, i.code, i.current_stock, i.unit, i.weighted_average_cost
      FROM ${items} i
      LEFT JOIN ${transactions} t_dead ON i.id = t_dead.item_id 
        AND t_dead.type = 'out' 
        AND t_dead.is_deleted = 0 
        AND t_dead.date::timestamp >= current_date - (${deadDays}::int * interval '1 day')
      JOIN (
        SELECT item_id FROM ${transactions}
        WHERE type = 'in' AND is_deleted = 0
        GROUP BY item_id
        HAVING min(date::timestamp) < current_date - (${deadDays}::int * interval '1 day')
      ) t_in ON i.id = t_in.item_id
      WHERE i.is_deleted = 0 AND i.current_stock > 0 
        AND t_dead.id IS NULL
      ORDER BY i.current_stock DESC
      LIMIT 5
    `);
    const deadStock = deadStockResult.rows;

    const valResult = await orm.execute(sql`
      SELECT SUM(current_stock * COALESCE(weighted_average_cost, 0)) as total_value
      FROM ${items}
      WHERE is_deleted = 0
    `);
    const total_value = valResult.rows[0]?.total_value;

    const activeWarehouses = await orm.select({ name: warehouses.name, code: warehouses.code }).from(warehouses).where(eq(warehouses.isActive, 1));
    const distributionObj: Record<string, number> = {};
    for (const w of activeWarehouses) {
      distributionObj[w.code] = 0;
    }

    const warehouseDistribution = await orm.execute(sql`
      SELECT 
        key as location, 
        SUM(NULLIF(value, '')::numeric) as total_stock
      FROM ${items}, jsonb_each_text(COALESCE(stocks, '{}'::jsonb))
      WHERE is_deleted = 0
      GROUP BY key
      ORDER BY total_stock DESC
    `);
    for (const row of warehouseDistribution.rows) {
      const loc = row.location as string;
      if (loc in distributionObj) {
        distributionObj[loc] = Number(row.total_stock);
      }
    }

    const trendsResult = await orm.execute(sql`
      SELECT to_char(date::timestamp, 'YYYY-MM') as date, type, SUM(quantity) as total
      FROM ${transactions}
      WHERE is_deleted = 0 AND date::timestamp >= current_date - interval '6 months'
      GROUP BY to_char(date::timestamp, 'YYYY-MM'), type
      ORDER BY date ASC
    `);
    const trends = trendsResult.rows;

    const result = {
      reorderAlarms: alarms,
      fastMoving: fastMoving,
      slowMoving: slowMoving,
      deadStock: deadStock,
      totalValuation: total_value || 0,
      locations: distributionObj,
      warehouses: activeWarehouses,
      monthlyTrends: trends,
      fastDays,
      slowDays,
      deadDays
    };

    dashboardCache.data = result;
    dashboardCache.timestamp = now;

    res.json(result);
  } catch(err: any) {
    logger.error({ message: 'BI-STATS ENDPOINT ERROR', error: err });
    throw err;
  }
});

export default router;
