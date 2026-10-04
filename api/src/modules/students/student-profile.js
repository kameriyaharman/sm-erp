import { AppError } from '../../errors/AppError.js';
import { normalizePhone } from '../notifications/phone.js';
import { addressIn } from '../setup/profile.helpers.js';

/**
 * Admission / edit input -> student_profiles columns. Pure (no I/O); unit-tested in
 * test/setup.test.js.
 */

const invalid = (field, message) => AppError.badRequest('Validation failed', { body: { [field]: [message] } }, 'VALIDATION_ERROR');

/** Optional phone: undefined = unchanged, null = clear, else +91XXXXXXXXXX (400 on `field`). */
function phoneOrNull(value, field) {
  if (value === undefined || value === null) return value;
  try {
    return normalizePhone(value);
  } catch (err) {
    throw invalid(field, err.message);
  }
}

/**
 * Validated admission / edit input -> student_profiles columns (only the keys that were sent).
 * Nested objects (father, mother, guardian, ...) are partial: a missing key leaves the column alone.
 */
export function profileColumns(input) {
  const c = {};
  const set = (col, value) => {
    if (value !== undefined) c[col] = value;
  };
  set('blood_group', input.bloodGroup);
  set('aadhaar_number', input.aadhaarNumber);
  set('religion', input.religion);
  set('mother_tongue', input.motherTongue);
  set('nationality', input.nationality);
  set('house', input.house);
  set('identification_marks', input.identificationMarks);
  set('social_category', input.socialCategory);
  set('pen_number', input.penNumber);
  set('apaar_id', input.apaarId);
  if (input.address !== undefined) c.address = JSON.stringify(addressIn(input.address));
  for (const who of ['father', 'mother']) {
    const p = input[who];
    if (!p) continue;
    set(`${who}_name`, p.name);
    set(`${who}_phone`, phoneOrNull(p.phone, who));
    set(`${who}_email`, p.email);
    set(`${who}_occupation`, p.occupation);
  }
  if (input.guardian) {
    set('guardian_name', input.guardian.name);
    set('guardian_relation', input.guardian.relation);
    set('guardian_phone', phoneOrNull(input.guardian.phone, 'guardian'));
  }
  if (input.emergencyContact) {
    set('emergency_contact_name', input.emergencyContact.name);
    set('emergency_contact_relation', input.emergencyContact.relation);
    set('emergency_contact_phone', phoneOrNull(input.emergencyContact.phone, 'emergencyContact'));
  }
  if (input.previousSchool) {
    set('previous_school', input.previousSchool.name);
    set('previous_school_board', input.previousSchool.board);
    set('last_class_passed', input.previousSchool.lastClassPassed);
    set('tc_number', input.previousSchool.tcNumber);
    set('tc_date', input.previousSchool.tcDate);
  }
  if (input.medical) {
    set('allergies', input.medical.allergies);
    set('medical_notes', input.medical.notes);
  }
  // Older clients send the names flat; the nested form wins.
  if (c.father_name === undefined) set('father_name', input.fatherName);
  if (c.mother_name === undefined) set('mother_name', input.motherName);
  if (c.guardian_name === undefined) set('guardian_name', input.guardianName);
  return c;
}
