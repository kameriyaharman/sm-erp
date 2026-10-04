import { Router } from 'express';
import academicsRoutes from './modules/academics/attendance.routes.js';
import authRoutes from './modules/auth/auth.routes.js';
import documentRoutes, { verifyRouter } from './modules/documents/documents.routes.js';
import feesRoutes from './modules/fees/fees.routes.js';
import financeRoutes from './modules/finance/finance.routes.js';
import { gatewaySettingsRouter, webhookRouter as paymentWebhook } from './modules/payments/payments.routes.js';
import portalAccessRoutes from './modules/portal-access/portal-access.routes.js';
import parentRoutes from './modules/parent/parent.routes.js';
import notificationRoutes from './modules/notifications/notifications.routes.js';
import schoolRoutes from './modules/school/school.routes.js';
import studentRoutes from './modules/students/students.routes.js';
import staffRoutes from './modules/staff/staff.routes.js';
import { examsRouter, marksRouter, papersRouter } from './modules/exams/exams.routes.js';
import teacherRoutes from './modules/teacher/teacher.routes.js';
import noticeRoutes from './modules/notices/notices.routes.js';
import homeworkRoutes from './modules/homework/homework.routes.js';
import timetableRoutes from './modules/timetable/timetable.routes.js';
import transportRoutes from './modules/transport/transport.routes.js';
import expenseRoutes from './modules/expenses/expenses.routes.js';
import { accountsRouter, daybookRouter, ledgerRouter } from './modules/accounts/accounts.routes.js';
import { concessionRouter, feeSetupRouter } from './modules/fee-setup/fee-setup.routes.js';

const router = Router();

router.use('/academics', academicsRoutes);
router.use('/auth', authRoutes);
router.use('/documents', documentRoutes);
// Fee setup (heads, class-wise structure) first: its routes guard themselves, the fees router guards everything.
router.use('/fees', feeSetupRouter);
router.use('/fees', feesRoutes);
router.use('/verify', verifyRouter);
// Before /finance: the finance router authenticates every request, the gateway has no JWT.
router.use('/finance/webhook', paymentWebhook);
router.use('/finance', financeRoutes);
router.use('/notifications', notificationRoutes);
router.use('/parent', parentRoutes);
router.use('/school', schoolRoutes);
// Before /settings: Settings -> Online payments (a school's own Razorpay account).
router.use('/settings/payments', gatewaySettingsRouter);
router.use('/portal-access', portalAccessRoutes);
router.use('/students', concessionRouter); // only /students/:id/fee-concession
router.use('/students', studentRoutes);
router.use('/staff', staffRoutes);
router.use('/exams', examsRouter);
router.use('/papers', papersRouter);
router.use('/marks', marksRouter);
router.use('/teacher', teacherRoutes);
router.use('/notices', noticeRoutes);
router.use('/homework', homeworkRoutes);
router.use('/timetable', timetableRoutes);
router.use('/transport', transportRoutes);
router.use('/expenses', expenseRoutes);
router.use('/accounts', accountsRouter);
router.use('/daybook', daybookRouter);
router.use('/ledger', ledgerRouter);

export default router;
