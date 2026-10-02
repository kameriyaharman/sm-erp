import * as service from './assignments.service.js';

export async function getStaffAssignments(req, res) {
  res.json({ data: await service.getStaffAssignments(req.auth, req.valid.params.id) });
}

export async function putStaffAssignments(req, res) {
  res.json({ data: await service.putStaffAssignments(req.auth, req.valid.params.id, req.valid.body) });
}

export async function sectionAssignments(req, res) {
  res.json({ data: await service.sectionAssignments(req.auth, req.valid.query.sectionId) });
}

export async function teacherAssignments(req, res) {
  res.set('Cache-Control', 'private, no-store').json({ data: await service.teacherAssignments(req.auth) });
}

export async function teacherTimetable(req, res) {
  res.set('Cache-Control', 'private, no-store').json({ data: await service.teacherTimetable(req.auth) });
}
