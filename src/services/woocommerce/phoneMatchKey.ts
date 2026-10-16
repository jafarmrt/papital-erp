// The TD-296 phone key lives in the shared search kernel (OBS-R2-99: global search reads it too); re-exported here for
// the WooCommerce, customer and sales lead code that has always imported it from this file.
export { phoneMatchKey, phoneMatchKeySql } from '../../lib/search/phoneMatchKey.js';
