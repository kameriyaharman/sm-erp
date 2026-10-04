#!/usr/bin/env node
/**
 * Demo data for the Setup module (migration 011): a complete school profile with a logo,
 * and the admission-register details of every demo student (Delhi NCR address, blood group,
 * Aadhaar, religion, mother tongue, house, both parents' phones and occupations, emergency
 * contact, previous school, the odd allergy) plus passport photos for a few of them.
 *
 * Runs only when SEED_DEMO=true and tenant "demo" exists (seed-demo.js). Idempotent:
 *   school profile  skipped when the demo branch already has a principal_name or a logo
 *   students        only students whose address is still empty are filled (so a student
 *                   the office has edited is never overwritten)
 *   photos          only for those same students
 * Works on a database where every earlier seed ran (the live demo). Set-based: one UPDATE
 * for all students, one INSERT for the photos.
 */
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { pool, withTransaction } from '../src/db/pool.js';
import { logger } from '../src/utils/logger.js';
import { verhoeffDigit } from '../src/modules/setup/profile.helpers.js';

if (process.env.SEED_DEMO !== 'true') {
  logger.info('Demo setup seed skipped (SEED_DEMO is not "true")');
  process.exit(0);
}

// ===================================================================== tiny PNG painter

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** RGB PNG of size w x h; paint(x, y) -> [r, g, b]. */
function png(w, h, paint) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b] = paint(x, y);
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

/** School crest: navy disc, marigold ring, an open white book with a marigold flame above it. */
function logoPng() {
  const S = 240;
  const navy = hex('#14234b'); const gold = hex('#f2a516'); const white = [255, 255, 255];
  return png(S, S, (x, y) => {
    const dx = x - S / 2 + 0.5; const dy = y - S / 2 + 0.5; const r = Math.hypot(dx, dy);
    if (r > 118) return white;
    if (r > 108) return gold;
    if (r > 102) return white;
    // book: two pages tilted like an open book
    const by = dy - 28;
    if (by > -26 && by < 26 && Math.abs(dx) < 64 && Math.abs(dx) > 3) {
      const slope = Math.abs(dx) * 0.18;
      if (by > -26 + slope && by < 22 + slope) return white;
    }
    // flame
    const fy = dy + 42; const fx = dx;
    if (fy < 18 && fy > -34 && Math.abs(fx) < (fy + 34) * 0.38 * (1 - Math.max(0, fy) / 22)) return gold;
    return navy;
  });
}

/** Passport-style avatar: soft background, head and shoulders silhouette. */
function photoPng(seed) {
  const W = 180; const H = 220;
  const bgs = ['#dbe7f6', '#e3f0e6', '#f6e7d6', '#ece3f6', '#f3e0e4'];
  const shirts = ['#1f3a68', '#7a1f2b', '#2f5d3a', '#3b3b58', '#6b4a1f'];
  const skins = ['#c68b59', '#b07548', '#d9a066', '#a8683f'];
  const bg = hex(bgs[seed % bgs.length]); const shirt = hex(shirts[(seed * 3) % shirts.length]); const skin = hex(skins[(seed * 7) % skins.length]);
  const hair = hex('#1d1712');
  return png(W, H, (x, y) => {
    const cx = W / 2;
    const head = Math.hypot((x - cx) / 38, (y - 88) / 46);
    const hairCap = Math.hypot((x - cx) / 41, (y - 78) / 44) <= 1 && y < 82;
    const body = y > 150 && Math.abs(x - cx) < 20 + (y - 150) * 1.4;
    const neck = y > 120 && y <= 158 && Math.abs(x - cx) < 15;
    if (hairCap) return hair;
    if (head <= 1) return skin;
    if (neck) return mix(skin, [0, 0, 0], 0.08);
    if (body) return shirt;
    return mix(bg, white(), (y / H) * 0.25);
  });
}
const white = () => [255, 255, 255];

// ===================================================================== demo data

// Real Delhi NCR localities (house numbers made up).
const LOCALITIES = [
  ['Sector 6, Dwarka', 'New Delhi', 'Delhi', '110075'],
  ['Sector 12, Dwarka', 'New Delhi', 'Delhi', '110078'],
  ['Janakpuri, Block C', 'New Delhi', 'Delhi', '110058'],
  ['Uttam Nagar, Mohan Garden', 'New Delhi', 'Delhi', '110059'],
  ['Palam Colony, Raj Nagar II', 'New Delhi', 'Delhi', '110077'],
  ['Vikaspuri, Block G', 'New Delhi', 'Delhi', '110018'],
  ['DLF Phase 3', 'Gurugram', 'Haryana', '122002'],
  ['Sector 23, Palam Vihar', 'Gurugram', 'Haryana', '122017'],
  ['Sector 62', 'Noida', 'Uttar Pradesh', '201309'],
  ['Indirapuram, Niti Khand 1', 'Ghaziabad', 'Uttar Pradesh', '201014'],
  ['Rajouri Garden, J Block', 'New Delhi', 'Delhi', '110027'],
  ['Najafgarh, Roshan Garden', 'New Delhi', 'Delhi', '110043'],
  ['Sector 15, Rohini', 'New Delhi', 'Delhi', '110089'],
  ['Mahavir Enclave Part 1', 'New Delhi', 'Delhi', '110045'],
];
const SOCIETIES = ['Shree Ganesh Apartments', 'Kailash Apartments', 'Gold Croft CGHS', 'Sunview Residency', null, null, 'Akashdeep Apartments', null];
const BLOOD = ['B+', 'O+', 'A+', 'B+', 'O+', 'AB+', 'A+', 'O-', 'B-', 'A-'];
const RELIGION = ['Hindu', 'Hindu', 'Hindu', 'Sikh', 'Hindu', 'Muslim', 'Hindu', 'Christian', 'Hindu', 'Jain'];
const TONGUE = ['Hindi', 'Hindi', 'Punjabi', 'Hindi', 'Bengali', 'Hindi', 'Tamil', 'Hindi', 'Marathi', 'Malayalam'];
const HOUSES = ['Tagore', 'Raman', 'Ashoka', 'Shivaji'];
const FATHER_JOBS = ['Software engineer', 'Bank officer', 'Shop owner', 'Government employee', 'Chartered accountant', 'Doctor', 'Business', 'Army officer', 'Teacher', 'Sales manager'];
const MOTHER_JOBS = ['Homemaker', 'Teacher', 'Nurse', 'Homemaker', 'Software engineer', 'Bank officer', 'Homemaker', 'Boutique owner', 'Doctor', 'Homemaker'];
const PREVIOUS = [
  ['Little Angels Play School, Dwarka', 'Playschool', 'UKG'],
  ['Kendriya Vidyalaya, Janakpuri', 'CBSE', 'Class 3'],
  ['St. Mary\'s Convent, Gurugram', 'ICSE', 'Class 2'],
];
const EMERGENCY = [['Aunt', 'Rekha'], ['Uncle', 'Rajiv'], ['Grandfather', 'Om Prakash'], ['Grandmother', 'Kamla'], ['Uncle', 'Manoj']];
const ALLERGIES = { 2: 'Peanuts', 7: 'Dust (mild asthma, carries an inhaler)', 11: 'Penicillin' };

const pick = (list, i) => list[i % list.length];

/** Unique, Verhoeff-valid 12-digit numbers (start 2–9), stable per position. */
function demoAadhaar(i) {
  const body = `${(i % 8) + 2}${String(7300000000 + i * 104729).slice(-10)}`;
  return body + verhoeffDigit(body);
}

async function loadDemo() {
  const { rows: [ctx] } = await pool.query(
    `SELECT t.id AS tenant_id, b.id AS branch_id, b.principal_name,
            (SELECT 1 FROM branch_logos l WHERE l.branch_id = b.id) AS has_logo,
            (SELECT id FROM users WHERE tenant_id = t.id AND email = 'admin@demo.school') AS admin_id
       FROM tenants t
       JOIN branches b ON b.tenant_id = t.id AND b.deleted_at IS NULL
      WHERE t.code = 'demo'
      ORDER BY b.is_head_office DESC
      LIMIT 1`,
  );
  return ctx ?? null;
}

async function seedSchoolProfile(demo) {
  if (demo.principal_name || demo.has_logo) {
    logger.info('Demo school profile already set; skipped');
    return;
  }
  const logo = logoPng();
  await withTransaction(async (db) => {
    await db.query(
      `UPDATE branches
          SET address_line1 = COALESCE(address_line1, 'Sector 10, Dwarka'),
              address_line2 = COALESCE(address_line2, 'Opp. Sector 10 Metro Station'),
              website = 'www.demopublicschool.edu.in', principal_name = 'Dr. Meenakshi Rao', board = 'CBSE, New Delhi',
              established_year = 1998, medium_of_instruction = 'English',
              settings = CASE WHEN settings ? 'documents'
                              THEN jsonb_set(settings, '{documents}', (settings->'documents') - 'principalName' - 'website' - 'board')
                              ELSE settings END
        WHERE id = $1`,
      [demo.branch_id],
    );
    await db.query(
      `INSERT INTO branch_logos (branch_id, tenant_id, mime_type, size_bytes, sha256, data, uploaded_by)
       VALUES ($1, $2, 'image/png', $3, $4, $5, $6) ON CONFLICT (branch_id) DO NOTHING`,
      [demo.branch_id, demo.tenant_id, logo.length, createHash('sha256').update(logo).digest('hex'), logo, demo.admin_id],
    );
  });
  logger.info('Demo school profile and logo saved', { logoBytes: logo.length });
}

async function seedStudents(demo) {
  // Students the office hasn't filled in yet, with their primary parent (the father in the demo).
  const { rows } = await pool.query(
    `SELECT sp.id, sp.branch_id, sp.parent_id, sp.father_name, sp.mother_name, pu.phone AS parent_phone, pu.email AS parent_email,
            u.last_name, sp.admission_number
       FROM student_profiles sp
       JOIN users u ON u.id = sp.user_id
       LEFT JOIN users pu ON pu.id = sp.parent_id
      WHERE sp.tenant_id = $1 AND sp.deleted_at IS NULL AND sp.address = '{}'::jsonb
        AND sp.aadhaar_number IS NULL
      ORDER BY sp.admission_number`,
    [demo.tenant_id],
  );
  if (rows.length === 0) {
    logger.info('Demo student profiles already filled; skipped');
    return;
  }
  const taken = new Set((await pool.query(`SELECT aadhaar_number FROM student_profiles WHERE tenant_id = $1 AND aadhaar_number IS NOT NULL`, [demo.tenant_id])).rows.map((r) => r.aadhaar_number));

  // Siblings (same parent) share the family details.
  const families = new Map();
  let familyNo = 0;
  const cols = {
    id: [], address: [], blood: [], aadhaar: [], religion: [], tongue: [], house: [], fatherPhone: [], fatherEmail: [], fatherJob: [],
    motherPhone: [], motherJob: [], emName: [], emRel: [], emPhone: [], prevSchool: [], prevBoard: [], lastClass: [], allergies: [], marks: [],
  };
  let n = 0;
  rows.forEach((s, i) => {
    let fam = families.get(s.parent_id ?? s.id);
    if (!fam) {
      const f = familyNo++;
      const [area, city, state, pincode] = pick(LOCALITIES, f);
      const society = pick(SOCIETIES, f * 3);
      const motherPhone = `9${String(711000000 + f * 26417).padStart(9, '0')}`;
      const [emRel, emFirst] = pick(EMERGENCY, f);
      fam = {
        address: {
          line1: society ? `Flat ${100 + ((f * 37) % 300)}, ${society}` : `House No. ${12 + ((f * 53) % 480)}`,
          line2: area, city, state, pincode,
        },
        religion: pick(RELIGION, f), tongue: pick(TONGUE, f), fatherJob: pick(FATHER_JOBS, f), motherJob: pick(MOTHER_JOBS, f),
        motherPhone: `+91${motherPhone}`,
        emName: `${emFirst} ${s.last_name ?? ''}`.trim(), emRel, emPhone: `+919${String(899000000 + f * 15485).padStart(9, '0')}`,
      };
      families.set(s.parent_id ?? s.id, fam);
    }
    let aadhaar;
    do aadhaar = demoAadhaar(i + n++); while (taken.has(aadhaar));
    taken.add(aadhaar);
    const prev = i % 4 === 1 ? pick(PREVIOUS, i) : null;

    cols.id.push(s.id);
    cols.address.push(JSON.stringify(fam.address));
    cols.blood.push(pick(BLOOD, i));
    cols.aadhaar.push(aadhaar);
    cols.religion.push(fam.religion);
    cols.tongue.push(fam.tongue);
    cols.house.push(pick(HOUSES, i));
    cols.fatherPhone.push(s.parent_phone ? (/^\d{10}$/.test(s.parent_phone) ? `+91${s.parent_phone}` : s.parent_phone) : null);
    cols.fatherEmail.push(s.parent_email ?? null);
    cols.fatherJob.push(fam.fatherJob);
    cols.motherPhone.push(fam.motherPhone);
    cols.motherJob.push(fam.motherJob);
    cols.emName.push(fam.emName);
    cols.emRel.push(fam.emRel);
    cols.emPhone.push(fam.emPhone);
    cols.prevSchool.push(prev?.[0] ?? null);
    cols.prevBoard.push(prev?.[1] ?? null);
    cols.lastClass.push(prev?.[2] ?? null);
    cols.allergies.push(ALLERGIES[i] ?? null);
    cols.marks.push(i % 5 === 0 ? 'Mole on the left cheek' : null);
  });

  // Photos for the first few (shows both the photo and the initials fallback in the UI).
  const photoIds = rows.slice(0, 8).map((r) => r.id);
  const photos = photoIds.map((_, i) => photoPng(i));

  await withTransaction(async (db) => {
    const { rowCount } = await db.query(
      `UPDATE student_profiles sp
          SET address = v.address::jsonb, blood_group = COALESCE(sp.blood_group, v.blood), aadhaar_number = v.aadhaar,
              religion = COALESCE(sp.religion, v.religion), mother_tongue = COALESCE(sp.mother_tongue, v.tongue),
              nationality = COALESCE(sp.nationality, 'Indian'), house = COALESCE(sp.house, v.house),
              father_phone = COALESCE(sp.father_phone, v.father_phone), father_email = COALESCE(sp.father_email, v.father_email),
              father_occupation = COALESCE(sp.father_occupation, v.father_job),
              mother_phone = COALESCE(sp.mother_phone, v.mother_phone), mother_occupation = COALESCE(sp.mother_occupation, v.mother_job),
              emergency_contact_name = COALESCE(sp.emergency_contact_name, v.em_name),
              emergency_contact_relation = COALESCE(sp.emergency_contact_relation, v.em_rel),
              emergency_contact_phone = COALESCE(sp.emergency_contact_phone, v.em_phone),
              previous_school = COALESCE(sp.previous_school, v.prev_school), previous_school_board = COALESCE(sp.previous_school_board, v.prev_board),
              last_class_passed = COALESCE(sp.last_class_passed, v.last_class),
              allergies = COALESCE(sp.allergies, v.allergies), identification_marks = COALESCE(sp.identification_marks, v.marks)
         FROM unnest($1::uuid[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::text[],
                     $11::text[], $12::text[], $13::text[], $14::text[], $15::text[], $16::text[], $17::text[], $18::text[], $19::text[], $20::text[])
              AS v(id, address, blood, aadhaar, religion, tongue, house, father_phone, father_email, father_job,
                   mother_phone, mother_job, em_name, em_rel, em_phone, prev_school, prev_board, last_class, allergies, marks)
        WHERE sp.id = v.id AND sp.address = '{}'::jsonb AND sp.aadhaar_number IS NULL`,
      [cols.id, cols.address, cols.blood, cols.aadhaar, cols.religion, cols.tongue, cols.house, cols.fatherPhone, cols.fatherEmail, cols.fatherJob,
        cols.motherPhone, cols.motherJob, cols.emName, cols.emRel, cols.emPhone, cols.prevSchool, cols.prevBoard, cols.lastClass, cols.allergies, cols.marks],
    );
    const { rowCount: photoCount } = await db.query(
      `INSERT INTO student_photos (student_id, tenant_id, branch_id, mime_type, size_bytes, sha256, data, uploaded_by)
       SELECT sp.id, sp.tenant_id, sp.branch_id, 'image/png', octet_length(v.data), v.sha256, v.data, $4
         FROM unnest($1::uuid[], $2::bytea[], $3::text[]) AS v(id, data, sha256)
         JOIN student_profiles sp ON sp.id = v.id
       ON CONFLICT (student_id) DO NOTHING`,
      [photoIds, photos, photos.map((p) => createHash('sha256').update(p).digest('hex')), demo.admin_id],
    );
    logger.info('Demo student profiles filled', { students: rowCount, families: families.size, photos: photoCount });
  });
}

try {
  const demo = await loadDemo();
  if (!demo) {
    logger.info('Demo setup seed skipped (no demo school)');
  } else {
    await seedSchoolProfile(demo);
    await seedStudents(demo);
  }
  await pool.end();
  process.exit(0);
} catch (err) {
  logger.error('Demo setup seed failed', { error: err.message, stack: err.stack });
  await pool.end().catch(() => {});
  process.exit(1);
}
