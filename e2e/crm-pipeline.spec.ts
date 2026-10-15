import { expect, test, type Page } from '@playwright/test';
import { adminApi, dataOf, signIn, uniqueSuffix, type AdminApi, type Json } from './support/flowKit';

/**
 * v10.1.19 (N-02 part 3, TD-1272): the sales pipeline board. Its five stage columns sat in a grid whose cells were narrower
 * than the columns' 260 px minimum, so each column ran over its neighbour on a laptop. The board now has fixed-width columns
 * with horizontal scrolling, one stage tab per column on a phone, and cards that are dragged between stages.
 */

const STAGE_KEYS = ['lead', 'qualified', 'proposal', 'won', 'lost'] as const;

const TEXT = {
  pipelineTab: 'قیف فروش',
  lostDialog: 'دلیل از دست رفتن',
  cancel: 'انصراف',
  wonRefused: 'ابتدا باید برای این پرونده فروش، پیش‌فاکتور صادر و ثبت کنید',
} as const;

const column = (page: Page, stage: string) => page.locator(`[data-pipeline-stage="${stage}"]`);
const card = (page: Page, leadId: number) => page.locator(`[data-pipeline-lead="${leadId}"]`);

async function openBoard(page: Page): Promise<void> {
  await signIn(page);
  await page.goto('/crm');
  await page.getByRole('button', { name: TEXT.pipelineTab }).first().click();
}

/** A real drag in small mouse steps; Chromium starts an HTML drag only after the pointer moves with the button down. */
async function dragCard(page: Page, leadId: number, stage: string): Promise<void> {
  const from = (await card(page, leadId).boundingBox())!;
  const to = (await column(page, stage).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2, { steps: 3 });
  await page.mouse.move(to.x + to.width / 2, to.y + 80, { steps: 10 });
  await page.mouse.up();
}

async function leadStage(kit: AdminApi, leadId: number): Promise<string> {
  return String(dataOf<Json>(await kit.get(`/api/crm/leads/${leadId}`)).stage);
}

let kit: AdminApi;
let leadId: number;

test.beforeAll(async () => {
  kit = await adminApi();
  const lead = dataOf<Json>(await kit.send('post', '/api/crm/leads', {
    title: `پرونده قیف آزمون ${uniqueSuffix()}`, customerName: `مشتری قیف ${uniqueSuffix()}`, stage: 'lead', estimatedValue: 5_000_000,
  }));
  leadId = Number(lead.id);
});

test.afterAll(async () => {
  await kit.dispose();
});

for (const width of [1366, 1024]) {
  test(`pipeline columns never overlap at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openBoard(page);
    const boxes = [];
    for (const stage of STAGE_KEYS) {
      const box = await column(page, stage).boundingBox();
      expect(box, `column ${stage} is on the page`).not.toBeNull();
      boxes.push(box!);
    }
    for (let i = 0; i < boxes.length; i += 1) {
      expect(boxes[i].width, `column ${STAGE_KEYS[i]} keeps its width`).toBeGreaterThanOrEqual(260);
      for (let j = i + 1; j < boxes.length; j += 1) {
        const apart = boxes[i].x + boxes[i].width <= boxes[j].x + 0.5 || boxes[j].x + boxes[j].width <= boxes[i].x + 0.5;
        expect(apart, `columns ${STAGE_KEYS[i]} and ${STAGE_KEYS[j]} do not overlap`).toBe(true);
      }
    }
  });
}

test('a phone shows one stage at a time behind stage tabs', async ({ page }) => {
  // Signed in on a laptop width, where the side menu shows the sign-out link, then narrowed to a phone.
  await page.setViewportSize({ width: 1366, height: 900 });
  await openBoard(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const tabs = page.locator('[data-pipeline-tab]');
  await expect(tabs).toHaveCount(STAGE_KEYS.length);
  await expect(page.locator('[data-pipeline-stage]')).toHaveCount(1);
  await page.locator('[data-pipeline-tab="qualified"]').click();
  await expect(column(page, 'qualified')).toBeVisible();
  await expect(page.locator('[data-pipeline-stage]')).toHaveCount(1);
});

test('a card is dragged to another stage, and the server rules still hold', async ({ page }) => {
  // Wide enough for all five columns, so every drop target is on screen without scrolling the board.
  await page.setViewportSize({ width: 1800, height: 900 });
  await openBoard(page);

  await dragCard(page, leadId, 'qualified');
  await expect(column(page, 'qualified').locator(`[data-pipeline-lead="${leadId}"]`)).toBeVisible();
  await expect.poll(() => leadStage(kit, leadId)).toBe('qualified');

  // Dropping on «ناموفق» asks for the reason first; cancelling leaves the file where it was.
  await dragCard(page, leadId, 'lost');
  const dialog = page.getByRole('dialog', { name: TEXT.lostDialog });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: TEXT.cancel }).click();
  expect(await leadStage(kit, leadId)).toBe('qualified');

  // Dropping on «موفق» without a live proforma is refused and the card stays in its column (TD-309).
  await dragCard(page, leadId, 'won');
  await expect(page.getByText(TEXT.wonRefused)).toBeVisible();
  await expect(column(page, 'qualified').locator(`[data-pipeline-lead="${leadId}"]`)).toBeVisible();
  expect(await leadStage(kit, leadId)).toBe('qualified');
});
