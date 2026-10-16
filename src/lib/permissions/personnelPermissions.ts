/**
 * OBS-R2-55: the personnel page shows each write button by the key its API asks. Create, edit, delete, the Excel export and
 * the Excel import (`POST` / `PUT` / `DELETE /personnel`, `GET /personnel/export`, `POST /personnel/bulk-import`) all ask
 * `personnel.manage`; a reader with only `personnel.view` sees the list and the dossier.
 */
export const PERSONNEL_MANAGE_PERMISSION = 'personnel.manage';
