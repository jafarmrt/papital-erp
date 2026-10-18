import { pgTable, serial, text, integer, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './auth';
import { personnel } from './personnel';

/**
 * v10.2 package 9 (group dashboard, part C of the social dashboard proposal, migration 0130): a colleague's reaction
 * (🎉 🎂 👏 ❤️, stored by key) or short message on a birthday. One live row per birthday person, Jalali year and sender;
 * the sender edits or removes their own, and a removal is a soft delete.
 */
export const birthdayGreetings = pgTable('birthday_greetings', {
  id: serial('id').primaryKey(),
  personnelId: integer('personnel_id').notNull().references(() => personnel.id),
  jalaliYear: integer('jalali_year').notNull(),
  senderUserId: integer('sender_user_id').notNull().references(() => users.id),
  reaction: text('reaction'),
  message: text('message').notNull().default(''),
  isDeleted: integer('is_deleted').notNull().default(0),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).notNull().defaultNow(),
}, (table) => ({
  uq_birthday_greetings_live: uniqueIndex('uq_birthday_greetings_live').on(table.personnelId, table.jalaliYear, table.senderUserId)
    .where(sql`${table.isDeleted} = 0`),
  idx_birthday_greetings_personnel: index('idx_birthday_greetings_personnel').on(table.personnelId, table.jalaliYear),
  idx_birthday_greetings_sender: index('idx_birthday_greetings_sender').on(table.senderUserId),
}));
