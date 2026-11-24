import type { MessageAnswer, MessageStatus } from './storefrontMessageRules.js';

/** v12 phase 10f: «پیام‌های سایت» between the ERP's server and its screen, and what the site sends and gets */
export interface MessageListRow {
  id: number;
  formId: number;
  formTitle: string;
  status: MessageStatus;
  /** the first written answers on one line */
  preview: string;
  createdAt: string;
  version: number;
}

export interface MessageDetail extends Omit<MessageListRow, 'preview'> {
  answers: MessageAnswer[];
  /** who set the status last, and when ('' while the message is new) */
  statusBy: string;
  statusAt: string;
  /** the sales lead this message opened (null = none) */
  leadId: number | null;
}

export interface MessageList {
  data: MessageListRow[];
  total: number;
  page: number;
  pageSize: number;
  /** how many messages each status holds, whatever the list is filtered by */
  counts: Record<MessageStatus, number>;
}

export interface MessageStatusInput { status: MessageStatus; version: number }

/** `POST /api/storefront/v1/forms/:key/submit`: the answers by the form's field ids, under a key of the request's own */
export interface FormSubmitRequest {
  requestKey: string;
  /** the version of the form the visitor filled in: a form changed since then takes no answer written for the old one */
  formVersion: number;
  answers: Record<string, unknown>;
}
export interface FormSubmitAnswer {
  /** the message's number, for the visitor to name when they call */
  reference: string;
}
