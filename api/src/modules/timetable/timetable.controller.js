import * as service from './timetable.service.js';

export async function getTimetable(req, res) {
  res.json({ data: await service.getTimetable(req.auth, req.valid.query) });
}

export async function putTimetable(req, res) {
  res.json({ data: await service.putTimetable(req.auth, req.valid.body) });
}
