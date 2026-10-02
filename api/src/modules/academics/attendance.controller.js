import * as attendanceService from './attendance.service.js';
import { NS, invalidate } from '../../cache/cache.js';

export async function listSections(req, res) {
  res.json({ data: await attendanceService.listSections(req.auth, req.valid.query) });
}

export async function getRoster(req, res) {
  res.json({ data: await attendanceService.getRoster(req.auth, req.valid.query) });
}

export async function submitAttendance(req, res) {
  const { _tenantId, ...result } = await attendanceService.submitAttendance(req.auth, req.valid.body);
  await invalidate(NS.ATTENDANCE, _tenantId);
  // 201 on first submission for the day, 200 when an existing register was updated.
  res.status(result.updated ? 200 : 201).json({ data: result });
}

export async function listNotifications(req, res) {
  res.json({ data: await attendanceService.listNotifications(req.auth, req.valid.query) });
}
