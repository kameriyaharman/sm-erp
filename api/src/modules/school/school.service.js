import { staffScope } from '../shared/access.js';
import * as repo from './school.repository.js';

export async function listClasses(auth, { branchId }) {
  const scope = await staffScope(auth, { branchId });
  const [classes, sections] = await Promise.all([repo.listClasses(scope), repo.listCurrentSections(scope)]);
  return classes.map((c) => ({
    id: c.id,
    name: c.name,
    numericLevel: c.numeric_level,
    sections: sections
      .filter((s) => s.class_id === c.id)
      .map((s) => ({
        id: s.id,
        name: s.name,
        label: `${s.class_name} ${s.name}`,
        capacity: s.capacity,
        studentCount: s.student_count,
        classTeacher: s.staff_id ? { staffId: s.staff_id, userId: s.teacher_user_id, name: s.teacher_name } : null,
      })),
  }));
}

export async function listSubjects(auth, { branchId }) {
  const rows = await repo.listSubjects(await staffScope(auth, { branchId }));
  return rows.map((s) => ({ id: s.id, name: s.name, code: s.code, isGradedOnly: s.is_graded_only, displayOrder: s.display_order }));
}

export async function listTerms(auth, { branchId }) {
  const rows = await repo.listCurrentTerms(await staffScope(auth, { branchId }));
  return rows.map((t) => ({ id: t.id, name: t.name, sequenceNo: t.sequence_no, startDate: t.start_date, endDate: t.end_date }));
}

export async function listFeeHeads(auth, { branchId }) {
  const rows = await repo.listFeeHeads(await staffScope(auth, { branchId }));
  return rows.map((f) => ({ id: f.id, name: f.name, code: f.code }));
}
