import * as service from './accounts.service.js';

export async function listAccounts(req, res) {
  res.json(await service.listAccounts(req.auth, req.valid.query));
}

export async function createAccount(req, res) {
  res.status(201).json({ data: await service.createAccount(req.auth, req.valid.body) });
}

export async function updateAccount(req, res) {
  res.json({ data: await service.updateAccount(req.auth, req.valid.params.id, req.valid.body) });
}

export async function transfer(req, res) {
  res.status(201).json({ data: await service.transfer(req.auth, req.valid.body) });
}

export async function summary(req, res) {
  res.json(await service.summary(req.auth, req.valid.query));
}

export async function dayBook(req, res) {
  res.json(await service.dayBook(req.auth, req.valid.query));
}

export async function dayBookRange(req, res) {
  res.json(await service.dayBookRange(req.auth, req.valid.query));
}

export async function listLedger(req, res) {
  res.json(await service.listLedger(req.auth, req.valid.query));
}

export async function createEntry(req, res) {
  res.status(201).json({ data: await service.createEntry(req.auth, req.valid.body) });
}

export async function deleteEntry(req, res) {
  await service.deleteEntry(req.auth, req.valid.params.id, req.valid.body);
  res.status(204).end();
}

export async function exportCsv(req, res) {
  const { filename, body } = await service.exportCsv(req.auth, req.valid.query);
  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'private, no-store',
  });
  res.send(body);
}

export async function exportLedgerCsv(req, res) {
  const { filename, body } = await service.exportLedgerCsv(req.auth, req.valid.query);
  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'private, no-store',
  });
  res.send(body);
}
