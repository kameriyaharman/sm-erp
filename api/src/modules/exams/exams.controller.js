import * as service from './exams.service.js';

export async function listExams(req, res) {
  res.json({ data: await service.listExams(req.auth, req.valid.query) });
}

export async function createExam(req, res) {
  res.status(201).json({ data: await service.createExam(req.auth, req.valid.body) });
}

export async function updateExam(req, res) {
  res.json({ data: await service.updateExam(req.auth, req.valid.params.id, req.valid.body) });
}

export async function listPapers(req, res) {
  res.json({ data: await service.listPapers(req.auth, req.valid.params.id, req.valid.query) });
}

export async function createPapers(req, res) {
  res.status(201).json({ data: await service.createPapers(req.auth, req.valid.params.id, req.valid.body) });
}

export async function updatePaper(req, res) {
  res.json({ data: await service.updatePaper(req.auth, req.valid.params.id, req.valid.body) });
}

export async function getMarks(req, res) {
  res.json({ data: await service.getMarks(req.auth, req.valid.query) });
}

export async function saveMarks(req, res) {
  res.json({ data: await service.saveMarks(req.auth, req.valid.body) });
}

export async function listTeacherPapers(req, res) {
  res.json({ data: await service.listTeacherPapers(req.auth) });
}
