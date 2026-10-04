import * as service from './expenses.service.js';

export async function listExpenses(req, res) {
  res.json(await service.listExpenses(req.auth, req.valid.query));
}

export async function createExpense(req, res) {
  res.status(201).json({ data: await service.createExpense(req.auth, req.valid.body) });
}

export async function deleteExpense(req, res) {
  await service.deleteExpense(req.auth, req.valid.params.id, req.valid.body);
  res.status(204).end();
}

export async function monthlyExpenses(req, res) {
  res.json({ data: await service.monthlyExpenses(req.auth, req.valid.query) });
}
