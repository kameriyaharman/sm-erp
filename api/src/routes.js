import { Router } from 'express';
import academicsRoutes from './modules/academics/attendance.routes.js';
import authRoutes from './modules/auth/auth.routes.js';
import documentRoutes, { verifyRouter } from './modules/documents/documents.routes.js';
import feesRoutes from './modules/fees/fees.routes.js';
import financeRoutes from './modules/finance/finance.routes.js';
import { webhookRouter as paymentWebhook } from './modules/payments/payments.routes.js';
import parentRoutes from './modules/parent/parent.routes.js';
import notificationRoutes from './modules/notifications/notifications.routes.js';
import schoolRoutes from './modules/school/school.routes.js';
import studentRoutes from './modules/students/students.routes.js';
import staffRoutes from './modules/staff/staff.routes.js';
import { examsRouter, marksRouter, papersRouter, teacherRouter } from './modules/exams/exams.routes.js';
import noticeRoutes from './modules/notices/notices.routes.js';
import homeworkRoutes from './modules/homework/homework.routes.js';
import timetableRoutes from './modules/timetable/timetable.routes.js';
import transportRoutes from './modules/transport/transport.routes.js';
import expenseRoutes from './modules/expenses/expenses.routes.js';

const router = Router();

router.use('/academics', academicsRoutes);
router.use('/auth', authRoutes);
router.use('/documents', documentRoutes);
router.use('/fees', feesRoutes);
router.use('/verify', verifyRouter);
// Before /finance: the finance router authenticates every request, the gateway has no JWT.
router.use('/finance/webhook', paymentWebhook);
router.use('/finance', financeRoutes);
router.use('/notifications', notificationRoutes);
router.use('/parent', parentRoutes);
router.use('/school', schoolRoutes);
router.use('/students', studentRoutes);
router.use('/staff', staffRoutes);
router.use('/exams', examsRouter);
router.use('/papers', papersRouter);
router.use('/marks', marksRouter);
router.use('/teacher', teacherRouter);
router.use('/notices', noticeRoutes);
router.use('/homework', homeworkRoutes);
router.use('/timetable', timetableRoutes);
router.use('/transport', transportRoutes);
router.use('/expenses', expenseRoutes);

export default router;
