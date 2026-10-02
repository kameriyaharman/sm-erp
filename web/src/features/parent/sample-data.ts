import type { ParentHomeData, Period } from './types';

/** Sample data relative to `today`, so the preview always looks current. Replace with API data. */
export function makeSampleParentHome(today: Date = new Date()): ParentHomeData {
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const addDays = (n: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + n);
  const at = (daysAgo: number, h: number, m = 0) => {
    const d = addDays(-daysAgo);
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  };

  const grade5: Record<number, Period[]> = {};
  const subjects5 = [
    ['Mathematics', 'Mrs. Tina Kaur', '5A'],
    ['English', 'Mr. Joseph Dsouza', '5A'],
    ['EVS', 'Ms. Farah Ali', 'Lab 2'],
    ['Hindi', 'Mrs. Sunita Rawat', '5A'],
    ['Computer', 'Mr. Arun Pillai', 'Comp Lab'],
    ['Art & Craft', 'Ms. Ritu Saini', 'Art Room'],
    ['Physical Ed.', 'Mr. Manoj Yadav', 'Ground'],
  ];
  for (let day = 1; day <= 6; day += 1) {
    const rot = (i: number) => subjects5[(i + day) % subjects5.length];
    const slots: [string, string][] = [['08:20', '09:00'], ['09:00', '09:40'], ['09:40', '10:20'], ['10:40', '11:20'], ['11:20', '12:00'], ['12:30', '13:10'], ['13:10', '13:50']];
    const periods: Period[] = [{ id: `d${day}-asm`, start: '08:00', end: '08:20', kind: 'assembly', subject: 'Morning assembly' }];
    slots.forEach(([start, end], i) => {
      if (day === 6 && i > 3) return; // half day on Saturday
      const [subject, teacher, room] = rot(i);
      periods.push({ id: `d${day}-p${i}`, start, end, kind: subject === 'Physical Ed.' ? 'activity' : 'class', subject, teacher, room });
      if (i === 2) periods.push({ id: `d${day}-sb`, start: '10:20', end: '10:40', kind: 'break', subject: 'Short break' });
      if (i === 4 && day !== 6) periods.push({ id: `d${day}-lb`, start: '12:00', end: '12:30', kind: 'break', subject: 'Lunch break' });
    });
    grade5[day] = periods;
  }

  const grade8: Record<number, Period[]> = {};
  for (let day = 1; day <= 6; day += 1) {
    grade8[day] = grade5[day].map((p) =>
      p.kind === 'class' ? { ...p, subject: p.subject === 'EVS' ? 'Science' : p.subject === 'Art & Craft' ? 'Social Studies' : p.subject, room: p.room === '5A' ? '8B' : p.room } : p,
    );
  }

  return {
    parentName: 'Ravi Sharma',
    schoolName: 'DPS Dwarka',
    schoolPhone: '+91 11 2508 4400',
    children: [
      {
        child: {
          id: 'stu-aarav',
          name: 'Aarav Sharma',
          firstName: 'Aarav',
          className: 'Grade 5',
          sectionName: 'A',
          rollNumber: '1',
          classTeacher: { name: 'Mrs. Tina Kaur', phone: '+91 98110 42231' },
        },
        fee: { totalDue: '31000.00', overdue: '12500.00', nextDueDate: iso(addDays(8)), oldestOverdueDate: iso(addDays(-84)) },
        attendance: { date: iso(today), status: 'absent', markedAt: at(0, 9, 12) },
        reportCard: { label: 'Term 1', publishedAt: at(3, 16), percentage: 86.4, grade: 'A2', isNew: true },
        timetable: grade5,
        homework: [
          {
            id: 'hw-1',
            subject: 'Mathematics',
            title: 'Fractions worksheet, questions 1 to 15',
            details: 'Show working for each answer. Questions 12 to 15 use the number line from page 64.',
            teacher: 'Mrs. Tina Kaur',
            assignedAt: at(0, 11, 5),
            dueDate: iso(addDays(1)),
            attachments: [{ name: 'Fractions-worksheet-3.pdf', url: '#', sizeKb: 412 }],
          },
          {
            id: 'hw-2',
            subject: 'English',
            title: 'Read chapter 6 of "The Blue Umbrella" and write a 100-word summary',
            teacher: 'Mr. Joseph Dsouza',
            assignedAt: at(1, 12, 40),
            dueDate: iso(addDays(2)),
            attachments: [],
          },
          {
            id: 'hw-3',
            subject: 'EVS',
            title: 'Bring 3 types of leaves pressed in a notebook',
            details: 'For Monday\'s lab activity on plant families. Label each leaf with where you found it.',
            teacher: 'Ms. Farah Ali',
            assignedAt: at(2, 10, 15),
            dueDate: iso(addDays(3)),
            attachments: [{ name: 'Leaf-collection-guide.jpg', url: '#', sizeKb: 860 }],
          },
          {
            id: 'hw-4',
            subject: 'Hindi',
            title: 'Paath 5 ke prashn-uttar copy mein likhein',
            teacher: 'Mrs. Sunita Rawat',
            assignedAt: at(4, 9, 30),
            dueDate: iso(addDays(-1)),
            attachments: [],
          },
        ],
        bus: { routeName: 'Route 7, Sector 12', state: 'to_home', etaMinutes: 14, stopName: 'Sector 12 Market gate', updatedAt: at(0, 13, 58) },
      },
      {
        child: {
          id: 'stu-anaya',
          name: 'Anaya Sharma',
          firstName: 'Anaya',
          className: 'Grade 8',
          sectionName: 'B',
          rollNumber: '17',
          classTeacher: { name: 'Mr. Raj Verma', phone: null },
        },
        fee: { totalDue: '0.00', overdue: '0.00', nextDueDate: null, oldestOverdueDate: null },
        attendance: { date: iso(today), status: 'present', markedAt: at(0, 8, 47) },
        reportCard: { label: 'Term 1', publishedAt: at(3, 16), percentage: 91.2, grade: 'A1', isNew: false },
        timetable: grade8,
        homework: [
          {
            id: 'hw-8-1',
            subject: 'Science',
            title: 'Lab record: Activity 4.2, acids and bases',
            teacher: 'Ms. Farah Ali',
            assignedAt: at(0, 12, 20),
            dueDate: iso(addDays(4)),
            attachments: [{ name: 'Activity-4.2.pdf', url: '#', sizeKb: 290 }],
          },
        ],
        bus: null,
      },
    ],
  };
}
