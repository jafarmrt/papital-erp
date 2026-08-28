require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// jalaali-js reference implementation (Node side) for cross-checking SQL port
function div(a, b) { return ~~(a / b); }
function mod(a, b) { return a - ~~(a / b) * b; }
const BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];

function jalCal(jy) {
  const bl = BREAKS.length;
  const gy = jy + 621;
  let leapJ = -14;
  let jp = BREAKS[0];
  let jump = 0;
  for (let i = 1; i < bl; i += 1) {
    const jm = BREAKS[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ += div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ += div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}
function g2d(gy, gm, gd) {
  let d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4)
    + div(153 * mod(gm + 9, 12) + 2, 5)
    + gd - 34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}
function d2g(jdn) {
  let j = 4 * jdn + 139361631;
  j += div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}
function j2d(jy, jm, jd) {
  const r = jalCal(jy);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

function jalaliToGregorianDate(jy, jm, jd) {
  const g = d2g(j2d(jy, jm, jd));
  return `${g.gy}-${String(g.gm).padStart(2, '0')}-${String(g.gd).padStart(2, '0')}`;
}

async function main() {
  // Known anchor pairs to verify
  const cases = [
    [1404, 12, 30], [1404, 12, 29], [1405, 1, 1], [1405, 8, 15],
    [1405, 6, 31], [1403, 1, 1], [1402, 8, 15]
  ];
  console.log('Node-side references:');
  for (const [jy, jm, jd] of cases) {
    console.log(`  ${jy}/${jm}/${jd} -> ${jalaliToGregorianDate(jy, jm, jd)}`);
  }

  // SQL dry-run: create functions in a rolled-back transaction and compare
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE OR REPLACE FUNCTION v10_jal_cal(jy_in integer)
      RETURNS TABLE(leap_out integer, gy_out integer, march_out integer, jump_out integer)
      LANGUAGE plpgsql IMMUTABLE AS $fn$
      DECLARE
        bl integer := 20;
        gy integer := jy_in + 621;
        leap_j integer := -14;
        jp integer := -61;
        jump_l integer := 0;
        jm integer;
        jmp integer;
        i integer;
        n integer;
        leap_g integer;
        march integer;
        breaks int[] := ARRAY[-61,9,38,199,426,686,756,818,1111,1181,1210,1635,2060,2097,2192,2262,2324,2394,2456,3178];
      BEGIN
        FOR i IN 1 .. bl - 1 LOOP
          jm := breaks[i];
          jump_l := jm - jp;
          IF jy_in < jm THEN EXIT; END IF;
          leap_j := leap_j + (jump_l / 33) * 8 + ((jump_l % 33) / 4);
          jp := jm;
        END LOOP;
        n := jy_in - jp;
        leap_j := leap_j + (n / 33) * 8 + (((n % 33) + 3) / 4);
        IF (jump_l % 33) = 4 AND (jump_l - n) = 4 THEN leap_j := leap_j + 1; END IF;
        leap_g := (gy / 4) - (((gy / 100) + 1) * 3 / 4) - 150;
        march := 20 + leap_j - leap_g;
        IF (jump_l - n) < 6 THEN n := n - jump_l + ((jump_l + 4) / 33) * 33; END IF;
        leap_out := ((n + 1) % 33) - 1;
        leap_out := ((leap_out % 4));
        IF leap_out = -1 THEN leap_out := 4; END IF;
        gy_out := gy; march_out := march; jump_out := jump_l;
        RETURN NEXT;
      END;
      $fn$;

      CREATE OR REPLACE FUNCTION v10_g2d(gy integer, gm integer, gd integer)
      RETURNS integer LANGUAGE plpgsql IMMUTABLE AS $fn$
      DECLARE d integer;
      BEGIN
        d := ((gy + ((gm - 8) / 6) + 100100) * 1461) / 4
           + ((153 * ((gm + 9) % 12) + 2) / 5)
           + gd - 34840408;
        d := d - ((((gy + 100100 + ((gm - 8) / 6)) / 100) * 3) / 4) + 752;
        RETURN d;
      END;
      $fn$;

      CREATE OR REPLACE FUNCTION v10_d2g(jdn integer)
      RETURNS TABLE(gy integer, gm integer, gd integer)
      LANGUAGE plpgsql IMMUTABLE AS $fn$
      DECLARE j integer; i integer;
      BEGIN
        j := 4 * jdn + 139361631;
        j := j + ((((4 * jdn + 183187720) / 146097) * 3) / 4) * 4 - 3908;
        i := ((j % 1461) / 4) * 5 + 308;
        gd := ((i % 153) / 5) + 1;
        gm := ((i / 153) % 12) + 1;
        gy := (j / 1461) - 100100 + ((8 - gm) / 6);
        RETURN NEXT;
      END;
      $fn$;

      CREATE OR REPLACE FUNCTION v10_jalali_to_gregorian_date(jy integer, jm integer, jd integer)
      RETURNS date LANGUAGE plpgsql IMMUTABLE AS $fn$
      DECLARE rec record; jdn integer; g record;
      BEGIN
        SELECT * INTO rec FROM v10_jal_cal(jy);
        jdn := v10_g2d(rec.gy_out, 3, rec.march_out) + (jm - 1) * 31 - (jm / 7) * (jm - 7) + jd - 1;
        SELECT * INTO g FROM v10_d2g(jdn);
        RETURN make_date(g.gy, g.gm, g.gd);
      END;
      $fn$;
    `);

    console.log('\nSQL-side results:');
    for (const [jy, jm, jd] of cases) {
      const res = await client.query(`SELECT v10_jalali_to_gregorian_date($1,$2,$3)::text AS g`, [jy, jm, jd]);
      console.log(`  ${jy}/${jm}/${jd} -> ${res.rows[0].g}`);
    }
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  }
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
