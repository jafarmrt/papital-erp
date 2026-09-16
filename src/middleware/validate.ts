import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

const fieldTranslations: Record<string, string> = {
  name: 'نام',
  title: 'عنوان',
  content: 'شرح / محتوا',
  code: 'کد',
  unit: 'واحد اندازه گیری',
  category: 'دسته‌بندی',
  reorder_point: 'نقطه سفارش',
  reorderPoint: 'نقطه سفارش',
  weighted_average_cost: 'قیمت میانگین',
  weightedAverageCost: 'قیمت میانگین',
  body: 'اطلاعات ارسالی',
  type: 'نوع',
  quantity: 'مقدار / تعداد',
  price: 'قیمت',
  document_type: 'نوع سند',
  docType: 'نوع سند',
  refNumber: 'شماره مرجع / فاکتور',
  items: 'اقلام',
  image: 'تصویر',
  thumbnail: 'تصویر کوچک',
  date: 'تاریخ',
  startDate: 'تاریخ شروع',
  endDate: 'تاریخ پایان',
  start_date: 'تاریخ شروع',
  end_date: 'تاریخ پایان',
  start_time: 'ساعت شروع',
  end_time: 'ساعت پایان',
  startTime: 'ساعت شروع',
  endTime: 'ساعت پایان',
  work_mode: 'نحوه حضور',
  workMode: 'نحوه حضور',
  work_hours: 'ساعات کارکرد',
  workHours: 'ساعات کارکرد',
  firstName: 'نام',
  lastName: 'نام خانوادگی',
  fullName: 'نام و نام خانوادگی',
  full_name: 'نام و نام خانوادگی',
  personnelCode: 'کد پرسنلی',
  nationalId: 'کد ملی',
  phone: 'شماره تلفن',
  jobTitle: 'عنوان شغلی',
  employmentStatus: 'وضعیت همکاری',
  cardNumber: 'شماره کارت',
  accountNumber: 'شماره حساب',
  shebaNumber: 'شماره شبا',
  bankName: 'نام بانک',
  customRate: 'نرخ اختصاصی',
  defaultRate: 'نرخ پیش‌فرض',
  unitRate: 'نرخ واحد',
  totalAmount: 'مبلغ کل',
  payrollNumber: 'شماره فیش',
  status: 'وضعیت',
  priority: 'اولویت',
  customer_id: 'شناسه مشتری',
  customerId: 'شناسه مشتری',
  customerName: 'نام مشتری',
  customer_name: 'نام مشتری',
  item_id: 'شناسه کالا',
  itemId: 'شناسه کالا',
  projectCode: 'کد پروژه',
  project_code: 'کد پروژه',
  stage_order: 'ترتیب مرحله',
  stageOrder: 'ترتیب مرحله',
  progress_percent: 'درصد پیشرفت',
  progressPercent: 'درصد پیشرفت',
  estimatedValue: 'ارزش تخمینی',
  estimated_value: 'ارزش تخمینی',
  activityDate: 'تاریخ اقدام',
  activity_date: 'تاریخ اقدام',
  nextFollowUpDate: 'تاریخ سررسید پیگیری',
  next_followup_date: 'تاریخ سررسید پیگیری',
  nextFollowUpTask: 'عنوان تسک پیگیری',
  next_followup_task: 'عنوان تسک پیگیری',
  assignedTo: 'مسئول ارجاع',
  assigned_to: 'مسئول ارجاع',
  username: 'نام کاربری',
  password: 'رمز عبور',
  role: 'نقش کاربر',
  permissions: 'مجوزهای دسترسی',
  description: 'توضیحات',
  notes: 'یادداشت',
  manager_notes: 'یادداشت مدیریتی',
  rejectionReason: 'دلیل عدم تأیید',
  rejection_reason: 'دلیل عدم تأیید',
  settings: 'تنظیمات',
  key: 'کلید تنظیم',
  value: 'مقدار تنظیم',
  prefix: 'پیشوند کد',
  mode: 'حالت',
  id: 'شناسه',
  userId: 'شناسه کاربر',
  user_id: 'شناسه کاربر',
  documentId: 'شناسه سند',
  document_id: 'شناسه سند',
  personnelId: 'شناسه پرسنل',
  leadId: 'شناسه سرنخ',
  activityId: 'شناسه فعالیت',
  taskId: 'شناسه تسک',
  payrollId: 'شناسه فیش حقوقی',
  ruleId: 'شناسه قانون',
  webhookId: 'شناسه وب‌هوک',
  draftId: 'شناسه پیش‌نویس',
  voucherId: 'شناسه سند حسابداری',
  accountId: 'شناسه حساب',
  warehouseId: 'شناسه انبار',
  categoryId: 'شناسه دسته‌بندی'
};

import { z } from 'zod';

export const numericIdString = z.string().min(1, 'شناسه الزامی است')
  .regex(/^[1-9]\d*$/, 'شناسه باید عدد صحیح مثبت باشد');

export const paramsIdSchema = z.object({
  params: z.object({
    id: numericIdString
  }).passthrough()
}).passthrough();

export const createParamsIdSchema = (paramName: string = 'id', label: string = 'شناسه') => {
  return z.object({
    params: z.object({
      [paramName]: z.string().min(1, `${label} الزامی است`)
        .regex(/^[1-9]\d*$/, `${label} باید عدد صحیح مثبت باشد`)
    }).passthrough()
  }).passthrough();
};

export const paramsUserIdSchema = createParamsIdSchema('userId', 'شناسه کاربر');
export const paramsDocIdSchema = createParamsIdSchema('id', 'شناسه سند');
export const paramsItemIdSchema = createParamsIdSchema('id', 'شناسه کالا');
export const paramsCategoryIdSchema = createParamsIdSchema('id', 'شناسه دسته‌بندی');
export const paramsWarehouseIdSchema = createParamsIdSchema('id', 'شناسه انبار');
export const paramsPersonnelIdSchema = createParamsIdSchema('id', 'شناسه پرسنل');

export const validate = (schema: ZodSchema) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      });

      // S-6: الصاق مستقیم داده‌های تمیز، تایپ‌شده و فیلترشده Zod به شیء req
      if (parsed && typeof parsed === 'object') {
        if ('body' in parsed && (parsed as any).body !== undefined) {
          req.body = (parsed as any).body;
        }
        if ('query' in parsed && (parsed as any).query !== undefined) {
          req.query = (parsed as any).query;
        }
        if ('params' in parsed && (parsed as any).params !== undefined) {
          req.params = (parsed as any).params;
        }
      }

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const detailMessages = error.issues.map(e => {
          const field = e.path.length > 1 ? e.path[e.path.length - 1] : e.path[0];
          const translatedField = fieldTranslations[field as string] || String(field);
          return `(${translatedField}) ${e.message}`;
        }).join(' | ');
        return res.status(400).json({
          code: 'VALIDATION_ERROR',
          message: `خطای اعتبارسنجی: ${detailMessages}`,
          details: {
            issues: error.issues.map(e => ({ path: e.path.join('.'), message: e.message }))
          },
          success: false,
          error: `خطای اعتبارسنجی: ${detailMessages}`
        });
      }
      next(error);
    }
  };
};
