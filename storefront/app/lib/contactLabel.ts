/** v12 phase 8e: what the contact field asks for, by the code ways the ERP has now (shared by the pages' forms) */
export const contactLabel = (sms: boolean, email: boolean) => sms && email ? 'شمارهٔ همراه یا ایمیل' : email ? 'ایمیل' : 'شمارهٔ همراه';
