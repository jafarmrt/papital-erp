# Changelog — Papital Workshop ERP

All notable development history is preserved in **Git history** (`git log`). This file
provides a concise, human-readable archive of the pre-1.0 era and the release policy
going forward.

## Release policy (V10 onward)

| Channel | File | Version series |
|---|---|---|
| Client-bundled update center | `src/data/changelogs/0.ts` | baseline `v1.0.0` entry |
| Client-bundled update center (archive) | `src/data/changelogs/archive_1_6.ts` | condensed `1.x.y` – `6.x.y` series (`v1.x` - `v6.0.28`), replaced `1.ts` … `6.ts` in v7.0.11 |
| Client-bundled update center (archive) | `src/data/changelogs/7.ts` | closed `7.x.y` series (`v7.0.0` – `v7.0.140`), frozen in v8.0.0 (fingerprint checked by `npm run check:version`) |
| Client-bundled update center (archive) | `src/data/changelogs/8.ts` | closed `8.x.y` series (`v8.0.0` – `v8.0.128`), frozen in v9.0.0 (fingerprint checked by `npm run check:version`) |
| Client-bundled update center (active) | `src/data/changelogs/9.ts` | current `9.x.y` release series (`v9.0.0` onward); short entries, important points only (v7.0.54) |
| Root archive (this file) | `CHANGELOG.md` | summary of the pre-reset history & milestones |

---

## Version 9.x Series (Active — see `src/data/changelogs/9.ts`)

### v9.0.35 — Document Workflow Steps Guarded by Permissions
- **Document Workflow Permissions (P1):** the default document workflow's warehouse and accounting steps require `warehouse.out` / `accounting.vouchers` (direct approval `workflow.admin`), an untouched installed definition is upgraded, and a step that runs a domain action requires the entity's own permission from the signer (TD-445, `sec_workflow_document_steps_permission_td_445`).

### v9.0.34 — Workflow Signer Permissions From the Role
- **Workflow Signer Permissions (P1):** the engine reads the signer's role permissions itself, so the department posting-permission rule (TD-374) works and the inbox, its counts and task execution follow the same rule as the document widget; `workflow.manage` / `workflow.admin` no longer sign other roles' steps (TD-444, `sec_workflow_signer_permissions_td_444`).

### v9.0.33 — Workflow Start Scoped to the Definition's Entity Type
- **Workflow Start Scope (P0):** `POST /workflow/start` and `startInstance` accept only an active definition whose entity type is the entity's own, on an existing entity; a mismatched instance created earlier no longer advances or shows in the document widget (TD-443, `sec_workflow_start_entity_scope_td_443`).

### v9.0.32 — Package 14 Workflow Audit Documentation
- **Stability Audit, Package 14 (Workflow and Approvals):** `docs/audit/STABILITY_AUDIT_V9.md` gets the workflow section; its 28 proven findings are registered as open rows TD-443 to TD-470 (one P0: starting any workflow on any entity approves a journal voucher without permission). Documentation only; no behaviour change.

### v9.0.31 — Persian Wording in the Personnel UI
- **Personnel Wording:** The personnel pages no longer show «(Update Existing)», «(IBAN)», «اکانت» or «کلیپ‌بورد»; a Vitest check keeps English words out of the Persian personnel UI (TD-440, `personnelWording.test.ts`).

### v9.0.30 — Personnel Edit Optimistic Lock
- **Personnel Edit Lock:** Saving a personnel form opened before someone else's save is refused with a conflict message instead of silently erasing the other change (owner decision D5; TD-442, `reg_personnel_edit_occ_td_442`).

### v9.0.29 — Personnel With Open Business Is Not Deleted
- **Personnel Delete Guard:** A personnel with an unsettled payroll, a work log without a payroll, an account balance or a draft voucher is no longer deleted; the refusal lists the reasons and suggests «قطع همکاری» (owner decision D4; TD-441, `reg_personnel_delete_guard_td_441`).

### v9.0.28 — Unique Personnel Code
- **Personnel Code:** A personnel code is unique among active personnel regardless of letter case and surrounding spaces, now also under concurrent saves (partial unique index, migration 0054); old duplicates are listed by the financial health check (owner decision D6; TD-439, `reg_personnel_code_unique_td_439`).

### v9.0.27 — Personnel Monthly Salary Validated
- **Personnel Salary:** The monthly salary on the personnel form now rejects text and negative values instead of saving 0 or a negative salary; Persian digits and thousands separators are accepted (TD-438, `reg_personnel_salary_decimal_input_td_438`).

### v9.0.26 — Personnel Audit Rows Carry Before and After
- **Personnel Audit:** Creating, editing, deleting and importing personnel now records the changed values (before/after) and the user's IP in the activity log, one row per person; the Nobitex password is never logged (TD-437, `reg_personnel_audit_snapshot_td_437`).

### v9.0.25 — Personnel Excel Import Keeps Empty Cells
- **Personnel Excel Import:** With «به‌روزرسانی», an empty gender, employment-status or nationality cell no longer resets an existing employee to «مرد», «فعال» and «ایرانی»; defaults apply only to new personnel (owner decision D3; TD-436, `reg_personnel_import_keeps_status_td_436`).

### v9.0.24 — One Active Personnel per User
- **Personnel User Link:** A system user is linked to at most one active personnel and only when the user exists; a second link is refused under the user's row lock and by the partial unique index of migration 0053, so «فیش‌های من» never shows another employee's payslip; legacy duplicates are only listed by the health check (owner decision D2; TD-435, `sec_personnel_user_link_unique_td_435`).

### v9.0.23 — Personnel List Field Scope
- **Personnel Field Scope:** The personnel list and detail give pick-list readers (projects, CRM, accounting, warehouse, piecework) only names, code, job title and status; the dossier needs `personnel.view` / `personnel.manage`, the salary the payroll-amount permissions, and the Nobitex password appears only in the detail (owner decision D1; TD-434, `sec_personnel_field_scope_td_434`).

### v9.0.22 — Package 12 Personnel Audit Documentation
- **Stability Audit, Package 12 (Personnel):** `docs/audit/STABILITY_AUDIT_V9.md` gets the personnel section; its 7 proven findings are registered as open rows TD-434 to TD-440 (two P1 salary-data leaks). Documentation only; no behaviour change.

### v9.0.21 — Party Bank Details Scope
- **Party Bank Details Scope:** A party's bank details reach only admins and holders of `customers.view`, `customers.manage` or an `accounting.*` permission; the customer list, its export and «تبدیل به مشتری» drop them for other readers (owner decision ت۶; TD-433, `sec_party_bank_info_scope_td_433`).

### v9.0.20 — CRM Wording in the Persian UI
- **CRM Wording:** Persian UI text says «ارتباط با مشتری» instead of «CRM», and package-9 text uses «پیگیری»، «پرونده فروش» and «اشاره» instead of transliterations (owner decision ت۷; TD-432, Vitest `crmWording.test.ts`).

### v9.0.19 — CRM Follow-up Explicit Actions
- **CRM Follow-up Actions:** The two-way `toggle-followup` is replaced by `complete-followup` and `reopen-followup` with a target state, under the activity row lock and with an audit row per change (`setFollowupCompleted`; TD-430, package-9 finding B09-15).

### v9.0.18 — Sales Lead Input Validation
- **Sales Lead Input:** Lead amounts and probabilities go through `decimalInput`; the amount is non-negative, the probability an integer 0 to 100, and stage, status and currency come from fixed lists (`src/lib/crm/leadFields.ts`; TD-427, package-9 finding B09-12).

### v9.0.17 — CRM Activity Parents Exist
- **CRM Activity Parents:** A CRM activity is saved only when its sales lead and party exist and are not deleted; otherwise 422 (`resolveActivityParents`; TD-426, package-9 finding B09-11).

### v9.0.16 — Sales Lead Delete Guards
- **Sales Lead Delete:** Deleting a sales lead runs under its row lock: a missing lead is 404, a lead with an active document is refused with 409, and activities of deleted leads leave the stats, lists and due reminders (`deleteLead`, `liveLeadActivityCondition`; TD-425, package-9 finding B09-10).

### v9.0.15 — CRM Customer Filter by Party Id
- **CRM Customer Filter:** The CRM customer filter sends the party id; the server returns that party's leads and legacy leads without an id whose customer or company name equals the party name exactly (`leadCustomerCondition`; TD-429, package-9 finding B09-14).

### v9.0.14 — Open CRM Follow-Ups From the Server
- **Open Follow-Ups:** The follow-ups tab, the dashboard «today and overdue» widget and the tab badge read open follow-ups from `GET /crm/followups` with no activity-date range and with pagination; the stats counter uses the same condition (`listFollowups`, `countDueFollowups`; TD-428, package-9 finding B09-13, product-owner decision).

### v9.0.13 — One Proforma Per Lead Under Concurrency
- **Single Proforma Per Lead:** Issuing a proforma for a sales lead locks the lead row inside the document transaction, so concurrent requests can no longer create several proformas for one lead; the lead link and its note are written in the same transaction (`lockLeadForNewProforma`, `markLeadProforma`; TD-424, package-9 finding B09-09).

### v9.0.12 — Voiding a Lead Proforma Reopens a Won Lead
- **Lead Proforma Void:** Voiding the proforma of a sales lead, or the invoice finalized from it, releases the lead inside the void transaction and moves a won lead back to the proposal stage (`releaseLeadOfVoidedDocument`; TD-423, package-9 finding B09-08).

### v9.0.11 — CRM Lead Values Per Currency
- **CRM Stats Per Currency:** The CRM stats card and the customer dossier show the pipeline, won and per-stage lead values per currency; amounts of different currencies are no longer added together (`getCrmStats`, `sumByCurrency`; TD-422, package-9 finding B09-07, product-owner decision).

### v9.0.10 — Customer Delete Refused With Open Items
- **Customer Delete Guard:** Deleting a party is refused (409, Persian reasons) while it has a nonzero approved balance in any currency, draft voucher rows, a draft or proforma document under its name, an active sales lead, an open project or an open cheque; the check runs under the customer row lock (`assertCustomerDeletable`; TD-431, package-9 finding B09-16, product-owner decision).

### v9.0.9 — Excel Import Keeps the Party Type
- **Party Type in Customer Excel Import:** An empty type cell leaves an existing party's type unchanged and makes a new party a customer; supplier is read with or without hamza and «هر دو (مشتری و تامین‌کننده)» as both (`parsePartyTypeCell`, shared by the server and the preview) (TD-421, package-9 finding B09-06).

### v9.0.8 — Unique Active Customer Names
- **Customer Name Uniqueness:** Migration 0052 adds the partial unique index `uq_customers_name_active` on `lower(btrim(name))` of active parties, created only when existing data has no duplicate (old rows are never renamed or merged; the financial health check lists duplicates as `customer_name_uniqueness`). The form, the sales lead link and the Excel import check the same key, and a race ends in the same Persian duplicate-name error (TD-420, package-9 finding B09-05).

### v9.0.7 — Customer Phone Matching by Key
- **Customer Phone Identity:** The sales lead link, the customer form's duplicate check and the customer Excel import compare phones with `phoneMatchKey` (the WooCommerce key of TD-296): spaces, +98 / 0098, Persian digits and a leading zero dropped by Excel no longer create a second customer for one number. Existing duplicates are left as they are (TD-419, package-9 finding B09-04).

### v9.0.6 — Customer Dossier Documents by Exact Buyer
- **Customer Dossier:** The «پیش‌فاکتورها و اسناد» tab loads `GET /customers/:id/documents`: only sales documents (invoice, proforma, return) whose buyer name equals the party's current name exactly, instead of a text search over number, buyer, notes, user, phone and city. Each row shows its own type and status (TD-417, package-9 finding B09-02).

### v9.0.5 — Sales Leads No Longer Change an Existing Customer
- **CRM ↔ Customer Master:** Creating, editing or converting a sales lead only links a customer (by id, then exact phone, then exact name) or creates a new one; it never rewrites an existing customer's name, phone or contact person, so the customer's optimistic lock and the `customers.manage` permission can no longer be bypassed. A differing phone or company name is noted once in the lead's notes (TD-418, package-9 finding B09-03).

### v9.0.4 — Party Account Card by Id
- **Party Balance:** The customers page «تراز مالی» card and the customer dossier load the account card from `GET /customers/:id/account-card`, which selects customer and supplier voucher rows by the party's detailed id; legacy rows without an id match the current name exactly. A similarly named party is no longer added in, and renaming a party no longer empties its card (TD-416, package-9 finding B09-01).

### v9.0.3 — Package 9 Audit Documentation (Customers & CRM)
- **Stability Audit, Package 9:** `docs/audit/STABILITY_AUDIT_V9.md` opens with the customers and CRM section; its 16 proven findings are registered as open rows TD-416 to TD-431 (two P1). The phase-1 baseline and the series targets the product owner confirmed are recorded in the roadmap. Documentation only; no behaviour change.

### v9.0.2 — Workflow Auto-Actions Inside the Approval Transaction
- **Workflow Approval Atomicity:** What a workflow transition does to its entity (invoice finalize, item and treasury opening vouchers, journal voucher status, purchase requisition status and goods receipt) now runs in the transition's own transaction; a failing action refuses the approval with its real error. The in-process `workflowEventBus` and its duplicate `publishEvent` bridge are removed; workflow events go through the outbox only (TD-415, phase-2 finding A02-01).

### v9.0.1 — Test Runner Security Upgrade (vitest 5)
- **Security Gate:** `vitest` upgraded from 3.2.7 to 5.0.3 (dev-only). The CI audit gate was red on every branch because of two critical advisories in `tinypool@1.1.1` (GHSA-5gmw-xhrv-c9v3, GHSA-85c8-ppgw-ccpr) and one moderate advisory in `@vitest/mocker` (GHSA-82fw-gwwq-j7x9); the new chain has no `tinypool` and a patched mocker (TD-414).

### v9.0.0 — Closure of Version 8 & Launch of Version 9
- **Version 8 Closure:** Concluded and archived the v8.x series (`v8.0.0` through `v8.0.128`). `V8_MASTER_ROADMAP.md` is archived with a closing report; 129 debt rows (TD-250 – TD-413) were recorded and all are resolved or closed by product-owner decision (TD-369 closed as an accepted risk); `src/data/changelogs/8.ts` is frozen.
- **Version 9 Mission:** `V9_MASTER_ROADMAP.md` — package-by-package stability audit (architecture and layering, data integrity, concurrency, security, error handling, performance, code quality, tests, UI) of the modules V8 did not cover as areas; stability over rewrites. New debt rows start at TD-414.
- **Governance:** `npm run check:version` now also rejects any change to the closed 8.x series; release paperwork moved to the generic `npm run release` (`scripts/release.ts`, reads the active series), and changes land only through a branch and a draft pull request (`AGENTS.md` §24).

---

## Version 8.x Series (Archived at v8.0.128)

### v8.0.128 — پاکسازی تست‌ها و ابزارهای بلااستفاده
- - سوئیت stress (دو سناریوی آن کد برنامه را اجرا نمی‌کرد)، سرویس‌های فقط‌تستی SystemRecoveryService و DataReconciliationService، شابلون ماژول v4، اسکریپت‌های قدیمی (start/stop/clean-install، db:baseline، setup:init، create-local-db)، فایل‌های AI Studio، دو سند قدیمی، سه وابستگی و خروجی‌های بی‌استفاده حذف شدند؛ رفتار برنامه تغییری نکرد.

### v8.0.127 — کلید ووکامرس روی HTTPS فقط در هدر
- کلید و رمز API ووکامرس روی HTTPS دیگر در آدرس درخواست (و لاگ وب‌سرور فروشگاه) نمی‌آیند و فقط در هدر می‌روند (TD-408).

### v8.0.126 — سفارش حذف‌شده ووکامرس نیازمند بررسی می‌شود
- سفارشی که در ووکامرس به سطل زباله برود یا حذف شود «نیازمند بررسی حسابدار» می‌شود و فاکتورش دست نمی‌خورد (TD-407).

### v8.0.125 — آمار گزارش کار بی گزارش‌های محرمانه
- TD-406: آمار گزارش کار فقط گزارش‌هایی را می‌شمارد که کاربر در فهرست می‌بیند.

### v8.0.124 — گام درخواست خرید بی بازنویسی
- TD-405: اقدام درخواست خرید گام گردش‌کار را بی انتقال و بی تاریخچه از وضعیت درخواست بازنویسی نمی‌کند.

### v8.0.123 — مبلغ ریالی در قاعده‌های گردش‌کار
- TD-404: قاعده مبلغ گردش‌کار مبلغ قابل پرداخت ریالی سند را با مالیات، هزینه خدمات و تسعیر می‌سنجد.

### v8.0.122 — قفل خوش‌بینانه ویرایش طرف حساب
- TD-403: ویرایش طرف حساب و درون‌ریزی اکسل با نسخه کهنه رد می‌شود و روی ویرایش دیگری نمی‌نویسد.

### v8.0.121 — حذف پروژه با تخصیص باز رد می‌شود
- - TD-412: پروژه‌ای که تخصیص مواد باز دارد تا آزادسازی تخصیص‌ها حذف نمی‌شود.

### v8.0.120 — پرداخت حقوق بدون روش چک
- - TD-411: روش «چک» از پرداخت حقوق حذف شد؛ پرداخت چکی رد می‌شود.

### v8.0.119 — فاکتور پیش‌فاکتور با تاریخ نهایی‌سازی
- - TD-410: فاکتورِ حاصل از پیش‌فاکتور تاریخ روز نهایی‌سازی را می‌گیرد؛ شماره و تاریخ پیش‌فاکتور در یادداشت می‌ماند.

### v8.0.118 — ثبت خزانه بی‌سند فقط با مجوز جدا
- - TD-409: دریافت، پرداخت، انتقال و چک «بدون سند حسابداری» فقط با مجوز جدا ثبت و در بررسی سلامت مالی فهرست می‌شوند.

### v8.0.117 — سند فیش حقوق با مبالغ دقیق
- TD-402: سند حسابداری فیش حقوق مبالغ را با محاسبه اعشاری دقیق می‌گیرد، نه عدد جاوااسکریپت.

### v8.0.116 — ارزش انبار سلامت مالی فقط به بهای تمام‌شده
- TD-401: بررسی سلامت مالی کالای بی میانگین موزون را صفر و جدا می‌شمارد و قیمت فهرست فروش را ارزش انبار نمی‌گیرد.

### v8.0.115 — سند حواله و ضایعات به بهای کاردکس
- TD-400: سند حسابداری حواله و ضایعات بهای ردیف‌های خروج کاردکس همان سند را می‌گیرد و همگام‌سازی دوباره پیش‌نویس عددش را عوض نمی‌کند.

### v8.0.114 — نام حساب ۶۰۰۱ و حساب جدای ضایعات
- TD-413: ۶۰۰۱ «بهای تمام‌شده کالای فروش‌رفته» نام گرفت و سند ضایعات حساب نگاشت‌شده «ضایعات و افت کیفی» (۶۰۰۴) را بدهکار می‌کند.

### v8.0.113 — مشاهده‌های ممیزی در دفتر بدهی فنی
- ۱۴ مشاهده بی‌ردیف گزارش‌های ممیزی به‌عنوان بدهی باز ثبت شد، پنج مورد با تصمیم مالک محصول (فقط مستندات).

### v8.0.112 — مبلغ قابل پرداخت در کارتابل تأیید و پرونده مشتری
- TD-389: کارتابل تأیید و پرونده مشتری مبلغ قابل پرداخت سرور را با مالیات و هزینه خدمات نشان می‌دهند.

### v8.0.111 — پیش‌نویس فاکتور پس از ثبت برنمی‌گردد
- TD-388: پیش‌نویس سرور فاکتور فروش پس از ثبت دوباره ساخته نمی‌شود و پیوند پرونده CRM را نگه می‌دارد.

### v8.0.110 — صدور مستقیم رسید از هشدار نقطه سفارش
- TD-387: «صدور مستقیم سند» از نقطه سفارش رسید را با شماره سرور و نام تأمین‌کننده ثبت می‌کند؛ پیش‌تر همیشه رد می‌شد.

### v8.0.109 — نرخ اختصاصی پرسنل در فرم ثبت کارکرد
- TD-386: فرم ثبت کارکرد نرخ اختصاصی پرسنل را پیشنهاد می‌دهد و فقط نرخ دستی را می‌فرستد.

### v8.0.108 — ارقام فارسی در مبلغ‌های حقوق و شماره چک
- TD-385: مبلغ و نرخ با ارقام فارسی یا عربی دیگر صفر نمی‌شود و متن نامعتبر خطا می‌گیرد؛ شماره چک و صیادی لاتین ذخیره می‌شوند.

### v8.0.107 — قیمت فهرست قیمت فقط به ارز خود فاکتور
- TD-384: فرم فاکتور فروش فقط قیمت‌های همان ارز را پیشنهاد می‌دهد و ارز فاکتور دارای ردیف عوض نمی‌شود.

### v8.0.106 — فاکتور ارزی در فرم و چاپ با اعشار نمایش داده می‌شود
- TD-383: فرم فاکتور فروش و فاکتور چاپی مبالغ ارزی را با دو رقم اعشار و جمع چاپی را از مبلغ قابل پرداخت سرور نشان می‌دهند.

### v8.0.105 — مالیات فاکتور ارزی به سِنت گرد می‌شود
- TD-382: مالیات درصدی فاکتور ارزی به کوچک‌ترین واحد ارز گرد می‌شود، نه به دلار کامل.

### v8.0.104 — مبلغ مالیات فاکتور را سرور از درصد حساب می‌کند
- TD-381: مبلغ مالیاتی که با درصد نمی‌خواند رد می‌شود و فرم فاکتور فروش فقط درصد را می‌فرستد.

### v8.0.103 — تخفیف ردیف حداکثر برابر مبلغ همان ردیف
- TD-380: تخفیف ردیف بیشتر از مقدار × قیمت واحد رد می‌شود؛ مازاد تخفیف دیگر از درآمد ردیف‌های دیگر کم نمی‌شود و بدهکاری مشتری با مبلغ فاکتور می‌خواند. ده یافته حوزه L ثبت شد.

### v8.0.102 — A Workflow Step Can Exclude the Initiator
- The workflow designer has a per-transition «آغازکننده تأیید نکند» option (off by default); when set, the user who started the process, directly or through a delegate, cannot run that step and does not see its task, while colleagues of the role and admins can.

### v8.0.101 — Receiving an Unapproved Requisition Approves It in the Receiver's Name
- Receiving goods on a purchase requisition that is not yet approved now runs the approval step in the receiver's name, with their role checked and the approval recorded in the history; a receiver without approval rights is refused and nothing enters stock.

### v8.0.100 — A Transition's Required Permission Is Enforced
- A workflow transition with a required permission now runs, and is offered, only for an admin or a user whose role or own permissions include it; the workflow designer shows and keeps the field instead of clearing it on save.

### v8.0.99 — Requisition Workflow Actions Follow the Current Step
- A purchase requisition action with no transition from its current workflow step is refused (409) instead of changing the status directly, so a received requisition can no longer be reopened, ordered and received into stock again; a rejected workflow continues only through a transition drawn out of its rejected step, such as reopen.

### v8.0.98 — Only the Delegator or an Admin Revokes a Delegation
- A delegate can no longer revoke the delegation given to them (403, and the revoke button is hidden); invalid delegation input returns 422 and a missing delegation or user 404 instead of a server error.

### v8.0.97 — A Delegate Does the Delegator's Role Tasks
- During an active delegation and within its scope, the delegate sees and runs the delegator's role tasks; the signature is recorded in the delegator's name with the delegate as signer, and neither of them can sign the same step twice.

### v8.0.96 — All-Members Approval Means Every Member of the Role
- An AND_ALL workflow step now passes only when every active user of the step's required role has signed (a one-member role passes with that member); a step without a role asks for the K set in the designer.

### v8.0.95 — No Deadlock Between Inbox Tasks and Direct Transitions
- Running an inbox task while the same step is executed from the document widget no longer deadlocks: the task locks the workflow instance before the task, in the same order as a direct transition.

### v8.0.94 — View Permissions No Longer Approve Workflow Steps
- A workflow step that requires the warehouse or accountant role can no longer be approved with a view or treasury permission alone, and production roles no longer count as managers; the role itself, a role of the same department or that department's posting permission is required.

### v8.0.93 — Step Signatures Restart When a Workflow Returns
- When a workflow comes back to a step after a rejection or return, the signatures of that step start from zero: the same user can resubmit, and an old signature no longer fills the quorum.

### v8.0.92 — Running Workflows Keep Their Tasks After a Design Edit
- After a workflow design is saved again, a running instance still gets the tasks and deadline of its next step from its own version snapshot instead of dropping out of the inbox.

### v8.0.91 — Multi-Signature Tasks Stay Open Until the Quorum
- A K-of-N or all-members approval task stays in every signer's inbox until the quorum is met; a partial or repeated signature no longer closes it, and the signer sees how many signatures are collected.

### v8.0.90 — Inbox Tasks Run Their Own Transition
- Approving a workflow task runs that task's own transition instead of the first forward transition of the step, and rejecting runs only a reject transition of the current step; a step without one refuses the rejection instead of approving it.

### v8.0.89 — Upgrade From v7.0.137 Passes Vouchers Refused by 0044
- Migration 0047 backfills source_cheque_id through erp_update_with_unvalidated_checks, so a voucher whose date 0044 refused to convert (closed fiscal year) no longer violates its NOT VALID date constraint and roll back the whole upgrade from v7.0.137; databases that ran the old 0047 are unaffected.

### v8.0.88 — Upgrade Rehearsal on a Restored Copy
- scripts/upgrade-rehearsal.sh (and update.sh --rehearse, before the restart) restores the latest backup into a drill database, runs the new migrations on it and compares ledger totals per account, stock per item and warehouse, bank balances and the financial health check before and after; the live database is never touched.

### v8.0.87 — Restore Apply Builds a New Database and Swaps It In
- RESTORE_MODE=apply no longer restores over the live database: it restores into a new database, verifies it like a drill, refuses while sessions are connected, swaps names and keeps the previous database and uploads directory; attachment files are restored too.

### v8.0.86 — Restore Drill Works With the Installed Database Role
- The role install.sh creates has no CREATEDB: restore.sh now creates, drops and renames databases through RESTORE_ADMIN_URL or sudo -u postgres, restores as the application role and stops with guidance before changing anything when neither is available.

### v8.0.85 — Restore Drill Compares Content With the Backup Manifest
- backup.sh writes the dump and a content manifest (rows and content hash of every table, every constraint) from one exported snapshot; the restore drill compares the restored database with it and checks sequences, attachment files and the migration level. The always-green recovery check was removed.

### v8.0.84 — Backups Run From Cron and Include Attachments
- scripts/backup.sh finds the application directory from its own location, reads DATABASE_URL and ATTACHMENTS_DIR from its .env and archives public/uploads, so a cron line backs up the database and the attachment files; attachment records without an attachment directory fail the backup.

### v8.0.83 — update.sh Waits for Startup and the Built Version
- update.sh reports success only when /health/startup answers (migrations and seed finished) and /health shows the built version (scripts/verify-startup.sh); on failure it prints the rollback steps with the previous commit and the pre-deployment backup.

### v8.0.82 — Migrations Run Without the Request Timeout, One at a Time
- Migrations run on a dedicated connection without the 60 s request statement timeout (MIGRATION_STATEMENT_TIMEOUT, default 0) under advisory lock 91008: the 0044 date migration no longer dies on large voucher tables and two concurrent runs queue instead of failing.

### v8.0.81 — Skipped Migrations and Newer Databases Stop Startup
- Before running, the migrator compares the code journal with __drizzle_migrations: a migration whose `when` is older than the last applied one (Drizzle skipped it silently) or a database newer than the build stops startup with the migration named; a journal lint checks strictly increasing `when` values.

### v8.0.80 — Atomic Project Codes
- - Automatic project codes (PRJ-<year>-<number>) come from an atomic yearly counter in `document_ref_counters` instead of `COUNT(*) + 1`, so concurrent project creation no longer fails on a duplicate code; a custom code is checked under the same lock.

### v8.0.79 — Idempotency Keys Keep Only Successful Responses
- The browser derives the Idempotency-Key from the submission's content and keeps it until a definitive answer, so a resubmission after a lost response returns the first result; the server stores only successful responses, refuses a key reused for another path or body, and extends the key's lock while a long request runs.

### v8.0.78 — Bank Account Maintenance Under Locks
- Editing a bank account locks its row, so two concurrent opening-balance edits no longer double the difference; treasury account codes come from an atomic counter per prefix and a duplicate custom code is refused; deleting a bank account runs under its lock and is refused while it has transactions or cheques.

### v8.0.77 — No Second Pool Connection Inside Transactions
- The first voucher of a new fiscal year, document voids, purchase requisitions and bank accounts with an opening balance now finish with a single free pool connection: the fiscal year row, audit log and workflow start run in the same transaction and a stale timezone cache no longer waits for the database.

### v8.0.76 — Work Logs Stay Consistent With Their Payroll
- Editing or deleting a work log now locks it and checks the payroll link under that lock, so a change racing with payroll issue either lands before the payroll or is refused after it; a work log whose payroll was deleted can be edited again.

### v8.0.75 — Dead-Letter Events Are Replayed Once
- Replaying a dead-letter event now runs under a lock on that event: a concurrent replay, dismissal or outbox requeue of the same event is refused, and an event already replayed is not replayed again, so webhooks and SMS are not sent twice.

### v8.0.74 — Bank Balance Sync Uses Treasury Transactions
- The bank balance sync now rebuilds each balance under the bank locks from the opening balance, treasury transactions and cleared cheques and only reports the difference from the general ledger (product-owner decision); draft vouchers and a concurrent payment no longer corrupt the balance.

### v8.0.73 — Bank Transfers Are Voided as a Whole
- Voiding either side of a bank-to-bank transfer now voids both sides, restores both balances and voids the shared voucher once (product-owner decision); the remaining side of an old half-voided transfer can be voided.

### v8.0.72 — Project Delivery Over Plan Needs a Reason
- Delivering a project's products to stock beyond the planned quantity now needs a recorded reason (product-owner decision), concurrent deliveries are counted under the project lock, and a cancelled project or an item outside the project is refused.

### v8.0.71 — Requisition Receipt Enters Stock Once
- Receiving a purchase requisition now runs in one transaction under the requisition lock: concurrent or later ordering no longer brings the goods in twice, a received or rejected requisition cannot be received or ordered again, a failed order finalization refuses the receipt, and the received quantity comes from the documents.

### v8.0.70 — Reversed Vouchers Keep Their Reversal
- A draft voucher can no longer be reversed or corrected, and a voucher with an active reversal can no longer go back to draft or be deleted, which used to leave an orphan reversal in the ledger.

### v8.0.69 — Deleted Cheques Stay Deleted
- A deleted cheque can no longer be cleared, bounced or deleted again; clearing it used to add its amount to the bank balance, and a concurrent delete and clear were both accepted.

### v8.0.68 — Each Voucher Is Reversed Only Once
- Two concurrent correction vouchers, or a correction and a reversal at the same time, no longer both reverse the same voucher; correction and repost lock the original voucher and every path refuses a voucher that already has an active reversal.

### v8.0.67 — Stock Paths Without Deadlocks
- Area J (concurrency) reviewed. Every stock path locks all its items at once, in id order and before any other lock, with FOR NO KEY UPDATE, so concurrent voids, invoices, receipts and returns sharing items no longer deadlock and a void's reversal row keeps the Kardex replay equal to the live WAC.

### v8.0.66 — Project Reservations Are Built by the Server (TD-306)
- A project's stock reservation is no longer taken from the browser: finalizing builds it on the server from the inventory control sections and item stock, and later saves keep it.

### v8.0.65 — Piecework Logs Need the Piecework Permission; Rates From the Server (TD-300)
- Recording piecework needs the piecework log permission instead of the daily-log one, and only personnel or rate managers enter a manual rate; others get the personnel or task rate.

### v8.0.64 — CRM Won Needs a Proforma on Every Path (TD-309)
- A sales lead can be marked won only after a proforma, whether through its stage or its status; a new lead cannot start as won.

### v8.0.63 — Vouchers Approved at Creation Record Their Approver (TD-308)
- A manual journal voucher created as approved records its creator as the approver.

### v8.0.62 — Document Creator Name Comes From the Session (TD-307)
- The creator name of a document, its Kardex rows and its voucher is the signed-in user, not a name sent in the request.

### v8.0.61 — Editing an Item Keeps the WAC of Stocked Items (TD-305)
- Editing an item that has stock no longer overwrites its weighted average cost without a Kardex row or voucher; the WAC changes only through stock in.

### v8.0.60 — Roles Accept Only Catalog Permissions (TD-304)
- A role can be given only permission keys from the catalog; "*" and unknown keys are refused.

### v8.0.59 — Payroll Payments Follow the Payroll Read Permission (TD-303)
- Payroll payments and personnel advance balances are read with the payroll read permissions only, like the payslips themselves.

### v8.0.58 — Pending Material Edits Need the Approval Permission (TD-302)
- Editing a pending raw-material request needs the approval permission and is refused once the request was approved or rejected.

### v8.0.57 — Private Daily Logs Stay Private by ID (TD-301)
- Opening a daily work log by its id applies the same visibility rule as the list; private and manager-only logs of others are no longer returned.

### v8.0.56 — Only an Admin Manages Admin Accounts (TD-299)
- A user manager without the admin role can no longer grant or remove the admin role, or change or delete an admin account.

### v8.0.55 — Area H Audit; Route Permission Table and View-Only Mutations (TD-298)
- Area H (security and access) was audited from a route → permission table built from the Express routers; BOM allocation and workflow start no longer open to view-only permissions, and a test keeps every route within the access policy.

### v8.0.54 — Stock Movement Chart by Jalali Month (TD-316)
- The stock movement chart now groups inflows and outflows by Jalali month over the current Jalali month and the five before it, instead of labelling Gregorian months with Jalali month names.

### v8.0.53 — Activity Log Shows Tehran Time and Filters Tehran Days (TD-315)
- The activity log API returns its UTC timestamps with a zone marker, so the page shows the time in the business time zone, and its date filter covers the business day rather than the UTC day.

### v8.0.52 — Database Session and Server Process Run in UTC (TD-314)
- The connection pool pins the PostgreSQL session time zone to UTC and the server process runs with TZ=UTC, so server timestamps written by the database and by the code agree on hosts set to Tehran time.

### v8.0.51 — Invoices From Proformas Take the Invoice Series Number (TD-317)
- Finalizing a proforma gives the invoice the next number of the invoice series for its fiscal year and keeps the proforma number in the notes; a proforma whose number already exists among that year's invoices no longer fails with a database error.

### v8.0.50 — Strict Document Dates and Cross-Year Draft Numbering (TD-313)
- A non-existent document date (30 Esfand of a common year, 30 February) or a non-date is refused with 422 instead of shifting silently or failing with 500; the numbering year comes from the stored date, and a draft moved to another fiscal year takes that year's next number.

### v8.0.49 — Browser «Today» in the Business Time Zone (TD-312)
- Stock counts and the invoice and treasury date fallbacks take today's date in the business time zone; a count saved after midnight in Tehran (on Nowruz night, in the new fiscal year) no longer gets yesterday's UTC date.

### v8.0.48 — Default Numbering Year Follows the Business Clock (TD-311)
- Without a date, the numbering year is today's Jalali year in the business time zone; requisition codes and the next-number preview no longer jump to the next year between 1 January and Nowruz.

### v8.0.47 — Fiscal Year Closing Always Ends on the Year's Last Day (TD-310)
- Closing vouchers are dated the year's last day (30 Esfand in a leap year) and the opening voucher 1 Farvardin; other dates are refused, so a leap year's 30 Esfand documents are closed too.

### v8.0.46 — No Floating Promises
- All 209 floating promises in the browser code are marked or handled; `no-floating-promises` is now an ESLint error, and clipboard copies report failure instead of a false «copied» message.

### v8.0.45 — Session-Start Hook and Release Tooling
- Tooling only: a Claude Code session-start hook prepares dependencies and PostgreSQL 16, `scripts/ci-test-env.sh` holds the CI test environment, and `npm run release:v8` writes a release's paperwork.

### v8.0.44 — Online Shop Warehouse for WooCommerce (TD-293)
- A new setting picks the online shop's warehouse: WooCommerce invoices draw from it and the stock sync pushes its sellable stock instead of the total of all warehouses.

### v8.0.43 — Changed Invoiced WooCommerce Orders Need Review (TD-294)
- When an invoiced order is edited in the shop or gets a partial refund, the order is flagged for review with the difference instead of being ignored.

### v8.0.42 — WooCommerce Negative Fees Become Line Discounts (TD-295)
- An order discount sent as a negative fee is spread over the invoice lines as line discounts in proportion to their amounts instead of rejecting the order.

### v8.0.41 — WooCommerce Line Totals Stay Exact (TD-297)
- A WooCommerce order line whose total is not divisible by its quantity is split into two lines with whole-rial prices, so the customer is charged exactly the order amount.

### v8.0.40 — WooCommerce Customer Matched by Phone in Any Format (TD-296)
- A WooCommerce order finds an existing customer whatever the phone format (+98, 0098, spaces, Persian digits) instead of creating a duplicate.

### v8.0.39 — WooCommerce Audit; Thousand-Toman and Thousand-Rial Units (TD-292)
- Area F (WooCommerce) audited with six findings; orders in the Persian plugin's thousand-toman (IRHT) and thousand-rial (IRHR) units are converted to rials and invoiced.

### v8.0.38 — Over-Ordering a Requisition Needs a Recorded Reason (TD-289)
- Ordering beyond a purchase requisition's remaining quantity is refused without a reason; the form warns, and the reason is recorded on the requisition and the order.

### v8.0.37 — Split-Order Form Accepted by the Convert Route (TD-291)
- The requisition convert route validates exactly the split-order form body, so the form works again and keeps each package's warehouse and status.

### v8.0.36 — Requisition Receipt Counts Every Line (TD-290)
- Delivering a purchase order counts every line of an item in its requisition and updates the requisition in the delivery transaction under a row lock.

### v8.0.35 — Project Delivery Issues a Production Receipt (TD-285)
- Delivering a project's finished goods to stock issues a final production receipt linked to the project: debit finished goods, credit work in progress.

### v8.0.34 — BOM Allocation Posts Work in Progress (TD-286)
- Allocating materials to a project posts debit work in progress, credit inventory at the Kardex cost; releasing the allocation voids that voucher.

### v8.0.33 — BOM Release at the Allocation's Own Cost (TD-288)
- Releasing a project material allocation returns the stock at the cost it left the warehouse, not at the current average cost.

### v8.0.32 — Area E Findings; BOM Receipt Allocation Needs a Receipt (TD-287)
- A direct BOM receipt allocation without a registered receipt is refused; with a receipt it moves stock out like a normal allocation. Five other procurement and project findings recorded.

### v8.0.31 — Payroll Payments Can Be Voided (TD-283)
- A payroll payment is voided with a reason from the payroll's payment window; bank balance, voucher, paid amount and payroll status step back.

### v8.0.30 — Fixed Salary per Jalali Month, Partial Months Pro Rata (TD-284)
- A payroll's fixed salary covers every Jalali month of its period, a partial month by days; two half-month payrolls add up to exactly one month.

### v8.0.29 — Advance Deduction Limited to the Outstanding Advance (TD-282)
- A payroll whose advance deduction exceeds the employee's outstanding advance is refused; the payroll form disables issuing it.

### v8.0.28 — Payroll Status Limited to Draft/Approved; Area D Findings (TD-281)
- Payroll status accepts only draft and approved by hand and a paid payroll keeps its status; three payroll findings await product-owner decisions.

### v8.0.27 — Cheque Reconciliation Report Matches the Ledger (TD-280)
- The cheque reconciliation compares cheque payables by their credit balance and no longer expects bounced or returned paid cheques there.

### v8.0.26 — Cheque Method Removed From the Treasury Form (TD-278)
- Cheques are registered only from the cheque book; the treasury and invoice-settlement forms no longer offer a cheque method and the server refuses it.

### v8.0.25 — Cheque Clearing Needs a Bank Ledger Account (TD-277)
- Clearing a cheque into a bank account without a ledger account is refused, like a treasury transaction, instead of marking it cleared without a voucher.

### v8.0.24 — Cleared Cheques Count in the Bank's Treasury Balance (TD-276)
- A cleared received cheque adds to, and a cleared paid cheque subtracts from, its bank account's treasury balance, so the account stays in sync with the ledger.

### v8.0.23 — Foreign-Currency Cheques Are Refused (TD-275)
- A cheque in a currency other than IRR is refused; foreign receipts and payments are recorded from the treasury form at an exchange rate.

### v8.0.22 — Returned Bounced Cheque Moves the Claim to the Customer (TD-273)
- Returning a bounced cheque to its drawer posts debit customer, credit protested cheques, so the claim is back on the customer's account.

### v8.0.21 — Bounced Paid Cheque Restores the Supplier (TD-272)
- A bounced paid cheque now posts a voucher: debit cheques payable, credit the supplier, so the debt to the supplier is open again.

### v8.0.20 — Foreign Treasury Transactions Use Their Rate (TD-274)
- Foreign-currency receipts, payments and transfers post at their exchange rate (explicit, the settled invoice's rate, or the setting) and are refused without one; the treasury form asks for the rate of a foreign account.

### v8.0.19 — Treasury and Cheque Evaluation; Cheque Delete by Link (TD-271)
- Second evaluation part (treasury and Sayad cheques): nine findings recorded; deleting a cheque no longer voids the vouchers of another cheque with the same number.

### v8.0.18 — Exact Rial Cost Rows in Foreign Vouchers (TD-261)
- Cost-of-sales, inventory and donated-goods rows of a foreign-currency voucher keep the document currency with their own rate, so their rial value equals the Kardex exactly; all findings of the first v8 evaluation part are closed.

### v8.0.17 — Free Goods Post to Donated-Goods Income (TD-268)
- A free line in a receipt or purchase (price 0 or a full discount) enters stock at the current WAC and its voucher credits the new account «درآمد کالای اهدایی» (5204); the supplier is credited only with priced lines.

### v8.0.16 — Foreign Rows Converted in Account Cards (TD-260)
- The account card, party ledger and financial health check convert foreign-currency rows to rials at their own rate in the all-currencies view, like the trial balance; a single-currency view shows that currency only.

### v8.0.15 — Reports Skip Deleted Voucher Rows (TD-270)
- The financial health check, project reports, bank ledger balances and personnel advance balances no longer count the old rows of a draft voucher that was edited or re-synced before approval.

### v8.0.14 — Purchase Vouchers Follow the Account Mapping (TD-259)
- Purchase, production receipt and sales return vouchers take inventory, payables and receivables accounts from the account mapping, like sales and remittances.

### v8.0.13 — Kardex Rebuild Starts From Zero Cost (TD-269)
- The Kardex rebuild replays WAC from zero, like an item with no movements; an item first received at price 0 keeps its live WAC after a rebuild.

### v8.0.12 — Zero-Price Receipt Kardex Cost (TD-256)
- A zero-price stock-in records the current WAC in its Kardex row, so voiding it and the Kardex rebuild keep WAC; a production receipt voucher takes such items at their Kardex cost.

### v8.0.11 — Void of an Outflow Restores Its Cost (TD-254)
- Voiding a sale, remittance or waste returns the goods at that outflow's own Kardex cost and recomputes WAC (same rule as stock-in and sales returns); the Kardex replay applies the same rule, also to older voids.

### v8.0.10 — Procurement Delivery Is Stock-In Only (TD-267)
- Procurement delivery finalizes only receipts and purchases; a purchase proforma is a receipt with status proforma (it used to finalize into a sales invoice that took the goods out of stock); finalizing a `purchase` document is stock-in.

### v8.0.9 — Purchase Line Discount in Stock Cost (TD-250)
- Incoming lines enter stock at the net unit price after the line discount (the same net the purchase voucher posts); foreign-currency lines are converted on the net price without intermediate rounding.

### v8.0.8 — Sales Return Capped at Quantity Sold (TD-253)
- A sales return with an original invoice is accepted only up to the invoice's sold quantity minus its earlier final returns (on create and on finalize, with row locks); voiding a return frees its quantity again.

### v8.0.7 — Running Kardex Shows Voided Documents (TD-266)
- Product-owner decision: the item Kardex report shows a voided document's original row (label «باطل‌شده») and its reversal («معکوس ابطال»); the running balance matches stock at every row, totals count only real movements, and each row's WAC is the live engine's WAC after that row.

### v8.0.6 — Void of a Consumed Incoming Document Refused (TD-265)
- Product-owner decision (option A): voiding a receipt, purchase, production receipt, sales return or count surplus is refused when, without it, a warehouse balance in date order would go negative; the error names the consuming documents. Voids of outflows are never refused.

### v8.0.5 — Excel Import Never Revalues Stock (TD-264)
- Product-owner decision (option A): an Excel row that changes the WAC of an item with stock is not applied and is listed in the import errors; a value within 1 rial of the current WAC is treated as unchanged; items without stock take the file's WAC.

### v8.0.4 — Stock Movement Date Rule and Kardex Replay (TD-257, TD-258)
- Product-owner decision: a stock movement (document, finalize, transfer) may not be dated before the item's last movement, except with the new permission `warehouse.backdate` (granted to no role by default); a permitted backdated outflow must keep the warehouse balance non-negative from that date on. Voided documents do not count, so void + reissue keeps the original date.
- The Kardex rebuild replays WAC in registration order with the live engine's formulas (`replayKardexWac`). New findings TD-265 (void of a consumed receipt) and TD-266 (running Kardex report after a void) registered; TD-264 decision (option A) recorded.

### v8.0.3 — Stock-Count and Excel Adjustment Vouchers (TD-255, TD-262, TD-263)
- Product-owner decision: stock-count shortages/surpluses and Excel stock adjustments post a draft voucher at Kardex cost against the new account «کسری و اضافات انبار» (7012, configurable mapping); a surplus of an item without WAC enters at cost 0; new Excel items with stock get the opening voucher; past counts get no voucher.
- A stock count is recorded only as final (a draft count used to deduct stock twice on finalize). New finding TD-264 (Excel WAC overwrite) registered for decision.

### v8.0.2 — Draft Vouchers at Fiscal Closing and Void (TD-252, TD-251)
- Product-owner decision: automatic vouchers stay draft; a fiscal year with draft vouchers is not closed (the preview lists them) and voiding a document, treasury transaction, cheque or payroll soft-deletes its draft voucher instead of issuing an approved reversal.

### v8.0.1 — Business-Logic Verification Tooling (test only)
- Executable inventory/ledger invariants, a seeded one-business-year simulator (`npm run simulate:year`) and the `business_invariants` suite with a shrink-only known-findings baseline.
- First evaluation report `docs/audit/BUSINESS_LOGIC_AUDIT_V8.md` (inventory and accounting): 12 proven findings registered as TD-250 – TD-261; no application behaviour changed.

### v8.0.0 — Closure of Version 7 & Launch of Version 8
- **Version 7 Closure:** Concluded and archived the v7.x series (`v7.0.0` through `v7.0.140`). `V7_MASTER_ROADMAP.md` is archived with a closing report; the debt registry ends the series with 0 open and 236 resolved rows; `src/data/changelogs/7.ts` is frozen.
- **Version 8 Mission:** `V8_MASTER_ROADMAP.md` — prove or refute the business-logic correctness of inventory, costing, accounting, treasury and payroll with executable invariants and a seeded one-business-year simulation on PostgreSQL 16; every finding gets a failing test, a `TD-###` row and its own `v8.0.x` fix.
- **Governance:** The active and closed series are declared in `src/data/changelogs/index.ts`; `npm run check:version` rejects a version outside the active series and any change to a closed series file.

---

## Version 7.x Series (Archived at v7.0.140)

### v7.0.0 – v7.0.140 — Quality Roadmap & Independent Audit Remediation
- **V7 Roadmap:** strict TypeScript (`strict: true`, v7.0.79), Zod on procurement/transactions/dashboard routes, batched stock and voucher lines, formal Drizzle migrations, per-warehouse stock normalized into `item_warehouse_stocks`.
- **Independent Audit Phases 0–3** (`docs/audit/TECHNICAL_AUDIT_REPORT.md`, base v7.0.17): fiscal-year reference numbering, negative-stock policy, tracked outbox delivery, WooCommerce order sync, structured VAT / exchange rate / service charges, decimal money columns, fiscal periods, attachments on disk, read permissions on every read route, flag and date CHECK constraints, Gregorian ISO date storage, Vitest and Playwright, ESLint ratchet.
- **Closure:** 236 technical-debt rows resolved, none open; details in `V7_MASTER_ROADMAP.md` (closing report) and `TECH_DEBT_ARCHIVE.md`.

---

## Version 6.x Series (Archived at v6.0.28)

### v6.0.0 — Official Launch of Version 6 & Version 5 Closure
- **Version 5 Closure:** Concluded and archived the v5.x series (`v5.0.0` through `v5.0.20`) after successfully completing inter-module integration, the 5-phase invoice-stock fix plan, 15-suite test runner isolation, and conducting the comprehensive independent data-integrity audit.
- **Version 6 Mission:** Enacted the Master Roadmap for Version 6 (`V6_MASTER_ROADMAP.md`) focusing on systemic remediation of 26 audited technical findings across 6 strategic pillars: Event-Sourced Kardex & True WAC preservation, double-entry ledger & year-end closing hardening, treasury separation of cash vs promissory cheques, deadlock-free row-locking hierarchy, and 100% architecture rules compliance (zero direct route mutations and zero hard deletes).
- **Governance Alignment:** Synchronized `AGENTS.md`, `package.json` (`6.0.0`), `check-version-sync.ts`, active roadmap `V6_MASTER_ROADMAP.md`, and activated `src/data/changelogs/6.ts`.

---

## Version 5.x Series (Archived / Finalized)

### v5.0.20 — Final Release & Conclusion of Version 5
- **Inter-Module Integration & Audit:** Completed 20 iterative releases across cross-module integration, stock movement automation, test-suite decoupling, and execution of comprehensive independent business logic audit.

### v5.0.0 — Official Launch of Version 5 & Version 4 Closure
- **Version 4 Closure:** Officially concluded and archived the v4.x series (`v4.0.0` through `v4.0.42`) encompassing major architectural refactorings, strict financial decimal precision, runtime contract hardening with Zod, frontend decluttering, and chunk error resilience.
- **Version 5 Mission:** Initiated Version 5 series with full continuity of Version 4 architectural rules and UI decluttering principles, focusing on deep cross-module integration (Inter-Module Workflows), end-to-end testing, error correction, and cross-functional performance optimization across Inventory, Accounting, Treasury, Production, Procurement, and Orders.
- **Governance Alignment:** Synchronized `AGENTS.md`, `package.json` (`5.0.0`), `check-version-sync`, active roadmap `V5_MASTER_ROADMAP.md`, and activated `src/data/changelogs/5.ts`.

---

## Version 4.x Series (Archived / Finalized)

### v4.0.42 — Final Release & Stabilization of Version 4
- **React Singleton & Chunk Resilience:** Resolved hook dispatch collision across lazy-loaded routes by pinning physical React/ReactDOM resolution in Vite, optimizing JSX runtimes, and hardening ErrorBoundary automated reload logic.
- **Final v4 Milestone:** Successfully delivered 42 iterative releases across architecture, security, financial calculation integrity, and UI/UX decluttering.

### v4.0.27 — Official Milestone Completion of Version 4 Architecture & Governance
- **Phase 1 (Database & Domain Schema):** Modular schema split across 8 domain files, `numeric(..., { mode: 'number' })` type consistency (D-1), soft-delete `isDeleted` standard (D-2), and strict foreign key integrity.
- **Phase 2 (Security Hardening):** Strict production CORS lockdown (S-1), IPv6/IPv4-mapped comprehensive SSRF normalization guard (S-2), authenticated Prometheus `/metrics` protection (S-3), elimination of default secrets in production (S-4), and PII data masking for personnel bank details (S-5).
- **Phase 3 (Financial & Payroll Integrity):** Transactional piecework payroll pipeline with `FinancialDecimal` (F-1, F-2), atomic sequence numbering (`piecework_payroll_number_seq`), strict voucher validation eliminating log-and-continue (F-3), and 3-step atomic document finalization (DB-008).
- **Phase 4 (Runtime Zod Contracts):** Sanitized payload replacement in Express `validate` middleware (S-6), strict mutation permission verification, and runtime validation across documents, inventory, transfers, BOM, vouchers, and treasury.
- **Phase 5 (Idempotency & Concurrency):** Triple-key composite idempotency (`user_id + scope + key`) (F-4), deadlock prevention via table priority lock ordering (`withOrderedLocks`) (A-1), auth caching, N+1 query elimination, and paginated transfers (A-2).
- **Phase 6 (Frontend Optimization & UX):** Refactored 1,875-line `BankAndTreasuryTab` into 9 modular components and `useTreasuryCalculations` hook (Q-1), debounce hooks across all search inputs (U-1), base `Modal` & `PrintModal` components (Q-2), and unified `ErrorBoundary`.
- **Phase 7 (CI/CD, Testing & Modular Scaffold):** Multi-stage GitHub Actions CI with live PostgreSQL 16 container (T-1), unified lockfile & test runner metrics (T-2), standardized domain module scaffold in `src/modules/_template/`, and 100% resolution of all 17 independent audit items (TD-088..TD-103).

### v4.0.0 — Official Launch of Version 4 & Version 3 Closure
- **Version 3 Closure:** Officially concluded and archived the comprehensive v3.x series (`v3.0.0` through `v3.3.22`) covering financial core automation, 4-level trial balance, multi-warehouse management, workflow FSM, domain event bus, and Iranian identifier normalization.
- **Version 4 Mission:** Initiated Version 4 series focusing on architectural optimization, codebase simplification, and targeted UI/UX refinements following the principles of visual decluttering, simplicity, and full Persian terminology.
- **Governance Alignment:** Synchronized `AGENTS.md`, `package.json` (`4.0.0`), and activated `src/data/changelogs/4.ts`.

---

## Version 3.x Series (Archived / Finalized)

### v3.1.16 — Strict Project Completion Gate & Progress Matrix Enforcement
- **Strict Matrix Gate:** Enforced backend validation on `PUT /projects/:id` and `POST /projects/:id/add-to-inventory` requiring 100% completion of the SKU × stage physical progress matrix before allowing project status transition to `completed`.
- **UI Lock & Indicators:** Disabled the "تغییر وضعیت پروژه به تکمیل‌شده" checkbox in `ProjectStockEntryTab` with lock icon, remaining items counter, and intuitive warning toast if clicked while incomplete.
- **Progress Matrix Feedback Banner:** Added status indicator banner in `ProjectProductProgressTab` showing total matrix items completed vs remaining and completion readiness.
- **Over-Reservation Inventory Governance:** Integrated comprehensive inventory availability policies for project material reservations.

### v3.0.4 — Version Drift Resolution & Build SSOT (TD-043)
- **Version Single Source of Truth (SSOT):** Centralized version resolution in `src/lib/version.ts` dynamically deriving build metadata and package version.
- **Probe & Health Endpoint Harmonization:** Updated `/health` and `/api/health` to return synchronized `version` and `buildInfo` payload.
- **Manifest & Backup Alignment:** Unified backup export metadata, Release Gate reports, Recovery verification manifests, and Kubernetes deployment YAML.
- **Automated Version Guard:** Added automated unit test assertion (Test 11 in `unitSuite.ts`) to prevent future version drift regressions.

### v3.0.3 — Performance, Memory Caching & Maintenance (TD-039..TD-042)
- **Frontend Code Splitting:** Dynamic `import('xlsx')` and React.lazy Suspense across Excel export/import and reconciliation components.
- **In-Memory TTL Caching:** Lightweight memory cache for RBAC role permissions lookup and system settings with automatic mutation invalidation.
- **Data Archival & Maintenance:** Purge utilities for old outbox events (`purgeProcessedEvents`) and audit trail records (`purgeOldAuditLogs`).
- **Test Scripts Separation:** Split `test:unit` and `test:full` execution scripts in package.json.

### v3.0.2 — Drizzle Migration Unification (TD-038)
- **Migration Pipeline Unification:** Consolidated all schema definitions into `drizzle/0000_v3_baseline.sql` and adopted standard Drizzle ORM migrator runner.

### v3.0.1 — Repository Architecture & Harmonization
- **Harmonization:** Standardized test suite naming, cleaned up development artifacts, and synchronized project documentation.

### v3.0.0 — Comprehensive UI/UX Overhaul & Financial Automation Milestone
- **Phase 1 (Flexible Multi-Step Invoice Settlements):** Full settlement modal supporting Cash, POS/Bank, Sayad Cheques, and Bank Transfers with automatic double-entry voucher generation and status tracking.
- **Phase 2 (3-Stage Accounting Voucher Lifecycle & Voiding):** Clear draft/audited/final voucher states, reversal vouchers for voiding, and correction vouchers with audit logs.
- **Phase 3 (Floating Detailed Party Ledger):** Comprehensive customer/vendor/personnel ledger with running balances, debt/credit indicators, and clean printing/export formats.
- **Phase 4 (Line & Cash Discounts):** Segregated line-item discounts and prompt cash payment discounts automatically mapped to designated discount accounts.
- **Phase 5 (Smart Financial Health Inspector):** Automated audit engine checking 6 critical areas (equilibrium, abnormal balances, inventory-to-ledger reconciliation, missing vouchers, overdue cheques, and bank bindings) with one-click automated sync.
- **Phase 6 (Global UI Simplification & Decluttering):** Universal adoption of the clean `ActionMenu` pattern across all system tables (invoices, items, vouchers, treasury, cheques, personnel, users) and complete Persian translation of technical/Latin terms.

---

Rules:
- Every functional/UI/security change adds an `AIUpdateLog` entry to the active
  version file (`2.ts`) with a unique semver bump; duplicates are never allowed.
- The old per-major-version files (`v1.ts … v9.ts`, ~700 KB of static data) were
  removed from the client bundle on purpose; consult Git for their content.

---

## Pre-1.0 history summary (v8.29.0 → v9.0.0 → baseline)

### v9.0.0 — Stability & Production-Ready (final V9 release; pre-reset era, unrelated to the current 9.x series)
**Phase 0 — P0 hotfixes**
- Locked down `PUT /documents/:id` finalization bypass (status transitions may no longer reach `final`; Zod body schema + service guard).
- Positive quantity / non-negative price validation on document line items and inside `applyStockMovement`.
- WooCommerce order processing made fully transactional (`externalTx` threading) + mandatory HMAC signature (fail-closed).

**Phase 1 — Financial integrity**
- Accounting voucher reversal issued automatically when a finalized document is deleted (+ DB-009 kardex reversal rows via `reversal_of_id`).
- Non-destructive `next-ref` peek (no more burned invoice numbers); atomic cold-start counter seeding.
- Decimal.js accumulators across voucherSync/treasury/documents; NaN-safe pagination caps (`parsePagination`, MAX_PAGE_LIMIT).

**Phase 2 — API hardening & edge security**
- Global error handler migration: ~175 ad-hoc handlers removed; uniform `{error, code, traceId}` responses.
- User lifecycle: soft delete, last-admin protection, `tokenVersion` session invalidation with live per-request user validation.
- CSRF fail-closed for legacy tokens; exact-match webhook auth paths; protected `/metrics` (`METRICS_TOKEN`); dead routes removed.

**Phase 3 — Currency UX**
- Eliminated ~100+ hardcoded «ریال» labels via `<Money>` + `useAppCurrency()`; per-currency KPI totals.
- SearchableSelect adopted in CRM/Documents/Accounting/Cheques forms.

**Phase 4 — UX polish**
- Modal scroll contract on 15 modals; real error display for rule tester (was faking success).
- Minimal responsive shell (<1024px auto-collapse), AbortController on global search, visibility-aware polling.
- SafeImage placeholders, RolesTab empty state, login lockout countdown + password reveal.

**Phase 5 — Code quality**
- React Query migration: Users/ActivityLogs/InvoicesList/Documents/Pricing/Transactions pages (hierarchical keys, placeholderData, cache-first reference lists).
- Giant component decomposition (~1400 LOC out of main pages): approval inbox, customers, NewVoucherModal, pricing, documents → 11 modular components.

**Phase 6 — Regression suite**
- `v9RegressionSuite`: bypass blocking, negative item validation, accounting reversal on deletion, peek idempotence, pagination caps, live session validation. Discovered & fixed a hidden bug: reversal-voucher read-back used outer ORM connection instead of caller's `externalTx`.

### Earlier eras (v1 … v8.29)
Accumulated feature set summarized in the baseline entry (`src/data/changelogs/0.ts`):
warehouse & multi-currency WAC inventory, warehouse docs with workflow approvals,
double-entry accounting with auto vouchers (sales/purchase/warehouse/payroll/treasury/Sayad-cheque),
fiscal-year closing, CRM kanban, production projects with BOM allocation, piecework payroll,
visual workflow designer (SLA analytics), domain-event bus + transactional outbox + DLQ,
webhook subscriptions with HMAC signatures, WooCommerce sync with idempotency,
RBAC permission catalog, observability stack (Winston rotation, Prometheus, K8s probes,
graceful shutdown) and atomic tracked migrations.

---

## v1.1.0 — V10 Release Sign-off (پایدار)

**Date:** 1405/06/06 • **Roadmap:** V10 Master Blueprint (phases 0→7 complete; docs archived in Git history)

| Phase | Deliverables (release series v1.0.x → v1.1.0) |
|---|---|
| 0 — Hotfix | Data-safety hard gate on test cleanup, Kardex envelope contract, ConfirmModal standardization, changelog reset |
| 1 — Date/TZ | Agreed business clock (`businessClock.ts`), client TZ provider, atomic Jalali date-normalization migration (alt_034) |
| 2 — Items & Coding | Unified tabbed products page, 300KB image standard + shared compressor, atomic `item_code_counters` next-code (alt_035), segmented code-builder UI |
| 3 — Unified UX | 21 native dialogs removed (Promise-based ConfirmDialogHost), unified print system (`.no-print`, DocPrintModal, isolated print area), movement analysis relocated, two-step inventory-audit confirmation |
| 4 — CRM & HR | Sellers as personnel (`assigned_personnel_id`, alt_036), formal `documents.crm_lead_id` (alt_037) + gated-lead unlock + customer-sync audit diffs, treasury-locked payroll payments (`PayrollPaymentService`) + fixed/mixed salary models (alt_038) |
| 5 — RBAC & Menu | Approved 8-group menu restructure + `/inventory-status`, permission vocabulary unification + dead-permission enforcement, per-role `menu_visibility` matrix (deny-list) |
| 6 — Finance & Print | Automation-status report (voucher coverage per doc type), per-project accounting report with running balance, workflow approver signatures on printed documents |
| 7 — Release Eng. | Docs consolidated into AGENTS.md (single source), new README with Linux install/update scripts (`install.sh`, `update.sh`, systemd), V10 regression suite (6 critical scenarios) |

**Sign-off:** All 15 critical-scenario suites + V10 regression suite green; lint and production build clean; `package.json`, `/health` and `src/data/changelogs/1.ts` version strings aligned at **v1.1.0**.

---

## v2.8.7 — تکامل و پاکسازی بدهی‌های فنی (سری 2.x پایدار)

**Date:** 1405/06/15 • **Series:** 2.x • **Milestone:** رفع جامع بدهی‌های فنی باز (TD-033 تا TD-037) و بهبود استحکام معماری

| حوزه | دستاوردها و اقدامات انجام‌شده |
|---|---|
| **TD-033 (Backend Types)** | جایگزینی بیش از ۳۸۰ نقطه `: any` در سرویس‌های رویدادها، ورکفلو، ریکاوری، اکشن‌ها و روت‌های اکسپرس با تایپ‌های صریح و بدون خطای تایپ‌اسکریپت |
| **TD-034 (Dates & Calendars)** | استانداردسازی کامل تاریخ‌های میلادی ISO و ثبت همزمان (Dual-Write) در جداول `daily_work_logs`, `piecework_logs`, `crm_activities` به همراه مایگریشن بک‌فیل و ایندکس‌ها |
| **TD-035 (Migrator)** | رفع وابستگی و اصلاح سال مالی در backfill قدیمی مایگریتر |
| **TD-036 (DB Hygiene)** | توسعه اسکریپت تراکنشی `scripts/cleanup-test-data.ts` (`npm run db:cleanup-test`)، پاکسازی کامل داده‌های آزمایشی و تسویه‌نشده، کالیبراسیون توالی‌های PostgreSQL و اسکن ۱۰۰٪ سالم مغایرت‌گیری ۱۲ گانه |
| **TD-037 (Dead Code Elimination)** | حذف کامل کامپوننت بلااستفاده `src/components/SystemTestRunner.tsx` (۳۰۰ خط کد مرده)، کاهش حجم باندل نهایی فرانت‌اند و تثبیت مسیر رسمی آزمون‌ها از طریق CLI استاندارد `npm run test` |

**Sign-off:** تمامی بدهی‌های فنی رده مهم و بحرانی حل شده؛ بیلد و linter کاملاً سبز (`tsc --noEmit` + `vite build`)؛ هماهنگی نسخه‌ها در `package.json`, `src/app.ts (/health)`, `src/data/changelogs/2.ts` روی **v2.8.7**.

