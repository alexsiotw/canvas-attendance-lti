require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const lti = require('ims-lti');
const XLSX = require('xlsx');
const { pool, initDatabase } = require('./db');
const CanvasAPI = require('./services/canvasApi');
const GradingEngine = require('./services/grading');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy for Render.com (must be before session middleware)
app.set('trust proxy', 1);

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        maxAge: 24 * 60 * 60 * 1000
    }
}));

// Allow Canvas to iframe the app
app.use((req, res, next) => {
    res.removeHeader('X-Frame-Options');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self' https://*.instructure.com https://*.canvas.com");
    next();
});

// Protect instructor pages — students can't access index.html directly
app.get('/', (req, res, next) => {
    if (req.session.lti && req.session.lti.role === 'student') {
        return res.redirect('/student.html');
    }
    next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ============== LTI LAUNCH ==============
app.post('/lti/launch', (req, res) => {
    const consumerKey = process.env.LTI_KEY || 'attendance-lti-key';
    const consumerSecret = process.env.LTI_SECRET || 'attendance-lti-secret';

    const provider = new lti.Provider(consumerKey, consumerSecret);
    provider.valid_request(req, (err, isValid) => {
        if (err || !isValid) {
            console.log('LTI validation skipped/failed, proceeding with request body');
        }

        const userId = req.body.user_id || 'demo_user';
        const canvasUserId = req.body.custom_canvas_user_id || '';
        const courseId = req.body.custom_canvas_course_id || req.body.context_id || 'demo_course';
        const userName = req.body.lis_person_name_full || 'Instructor';
        const userEmail = req.body.lis_person_contact_email_primary || '';
        const roles = req.body.roles || '';
        const isInstructor = roles.includes('Instructor') || roles.includes('Administrator') || roles.includes('urn:lti:role:ims/lis/Instructor');

        req.session.lti = {
            userId,
            canvasUserId,
            courseId,
            userName,
            userEmail,
            role: isInstructor ? 'instructor' : 'student',
            outcomeUrl: req.body.lis_outcome_service_url || '',
            sourcedId: req.body.lis_result_sourcedid || ''
        };

        // Log LTI params for debugging
        console.log('LTI Launch:', { userId, canvasUserId, courseId, userName, role: isInstructor ? 'instructor' : 'student' });

        if (isInstructor) {
            res.redirect('/');
        } else {
            res.redirect('/student.html');
        }
    });
});

// Dev/test launch endpoint
app.get('/dev-launch', (req, res) => {
    req.session.lti = {
        userId: 'dev_instructor',
        courseId: req.query.courseId || 'demo_course',
        userName: 'Dev Instructor',
        role: 'instructor'
    };
    res.redirect('/');
});

app.get('/dev-student', (req, res) => {
    req.session.lti = {
        userId: req.query.userId || 'dev_student_1',
        courseId: req.query.courseId || 'demo_course',
        userName: 'Dev Student',
        role: 'student'
    };
    res.redirect('/student.html');
});

// Auth middleware
function requireAuth(req, res, next) {
    if (!req.session.lti) {
        return res.status(401).json({ error: 'Not authenticated. Launch via LTI or use /dev-launch' });
    }
    next();
}

function requireInstructor(req, res, next) {
    if (!req.session.lti || req.session.lti.role !== 'instructor') {
        return res.status(403).json({ error: 'Instructor access required' });
    }
    next();
}

// ============== SESSION INFO ==============
app.get('/api/me', requireAuth, (req, res) => {
    res.json(req.session.lti);
});

// ============== COURSE CONFIG ==============
app.get('/api/config', requireAuth, async (req, res) => {
    try {
        const courseId = req.session.lti.courseId;
        let result = await pool.query('SELECT * FROM courses WHERE canvas_course_id = $1', [courseId]);
        if (result.rows.length === 0) {
            res.json({ configured: false, canvas_course_id: courseId });
        } else {
            const course = result.rows[0];
            // Get grading rules
            const rules = await pool.query('SELECT * FROM grading_rules WHERE course_id = $1 ORDER BY sort_order', [course.id]);
            course.rules = rules.rows;
            res.json(course);
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/config', requireInstructor, async (req, res) => {
    try {
        const courseId = req.session.lti.courseId;
        const {
            name, canvas_api_token, canvas_api_url,
            calendar_sync, grading_enabled, grading_mode,
            grading_points, grading_total_sessions,
            rules, statuses
        } = req.body;

        // Upsert course
        const result = await pool.query(`
      INSERT INTO courses (canvas_course_id, name, canvas_api_token, canvas_api_url, calendar_sync,
        grading_enabled, grading_mode, grading_points, grading_total_sessions, statuses, configured)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)
      ON CONFLICT (canvas_course_id) DO UPDATE SET
        name = COALESCE($2, courses.name),
        canvas_api_token = COALESCE($3, courses.canvas_api_token),
        canvas_api_url = COALESCE($4, courses.canvas_api_url),
        calendar_sync = $5,
        grading_enabled = $6,
        grading_mode = $7,
        grading_points = $8,
        grading_total_sessions = $9,
        statuses = COALESCE($10, courses.statuses),
        configured = true,
        updated_at = NOW()
      RETURNING *
    `, [courseId, name || 'My Course', canvas_api_token, canvas_api_url || 'https://canvas.instructure.com/api/v1',
            calendar_sync || false, grading_enabled || false, grading_mode || 'proportional',
            grading_points || 100, grading_total_sessions || 0,
            statuses ? JSON.stringify(statuses) : '["Present","Absent","Late","Excused"]'
        ]);

        const course = result.rows[0];

        // Update grading rules
        if (rules && Array.isArray(rules)) {
            await pool.query('DELETE FROM grading_rules WHERE course_id = $1', [course.id]);
            for (let i = 0; i < rules.length; i++) {
                const r = rules[i];
                await pool.query(`
          INSERT INTO grading_rules (course_id, min_absences, max_absences, penalty_value, sort_order)
          VALUES ($1, $2, $3, $4, $5)
        `, [course.id, r.min_absences, r.max_absences || null, r.penalty_value, i]);
            }
        }

        // If API token provided, sync students
        if (canvas_api_token) {
            try {
                const api = new CanvasAPI(canvas_api_url || 'https://canvas.instructure.com/api/v1', canvas_api_token);
                const students = await api.getStudents(courseId);
                for (const s of students) {
                    const stuResult = await pool.query(`
            INSERT INTO students (canvas_user_id, name, sortable_name, email, avatar_url)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (canvas_user_id) DO UPDATE SET name=$2, sortable_name=$3, email=$4, avatar_url=$5
            RETURNING id
          `, [s.canvas_user_id, s.name, s.sortable_name, s.email, s.avatar_url]);

                    await pool.query(`
            INSERT INTO enrollments (course_id, student_id)
            VALUES ($1, $2) ON CONFLICT DO NOTHING
          `, [course.id, stuResult.rows[0].id]);
                }

                // Sync calendar if enabled
                if (calendar_sync) {
                    const events = await api.getCalendarEvents(courseId);
                    for (const e of events) {
                        if (!e.start_time) continue;
                        await pool.query(`
              INSERT INTO sessions (course_id, title, start_time, end_time, location, canvas_event_id)
              VALUES ($1, $2, $3, $4, $5, $6)
              ON CONFLICT DO NOTHING
            `, [course.id, e.title, e.start_time, e.end_time || e.start_time, e.location, e.canvas_event_id]);
                    }
                }
            } catch (apiErr) {
                console.error('Canvas API sync error:', apiErr.message);
                // Continue — config is saved even if sync fails
            }
        }

        res.json({ success: true, course });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============== STUDENTS ==============
app.get('/api/students', requireAuth, async (req, res) => {
    try {
        const courseId = req.session.lti.courseId;
        const course = await getCourse(courseId);
        if (!course) return res.json([]);

        const result = await pool.query(`
      SELECT s.* FROM students s
      JOIN enrollments e ON s.id = e.student_id
      WHERE e.course_id = $1
      ORDER BY s.sortable_name, s.name
    `, [course.id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Add students manually
app.post('/api/students', requireInstructor, async (req, res) => {
    try {
        const courseId = req.session.lti.courseId;
        const course = await getCourse(courseId);
        if (!course) return res.status(404).json({ error: 'Course not configured' });

        const { name, email } = req.body;
        const canvasUserId = 'manual_' + uuidv4().slice(0, 8);

        const stuResult = await pool.query(`
      INSERT INTO students (canvas_user_id, name, sortable_name, email)
      VALUES ($1, $2, $3, $4) RETURNING *
    `, [canvasUserId, name, name, email || '']);

        await pool.query(`
      INSERT INTO enrollments (course_id, student_id) VALUES ($1, $2) ON CONFLICT DO NOTHING
    `, [course.id, stuResult.rows[0].id]);

        res.json(stuResult.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Sync students from Canvas
app.post('/api/students/sync', requireInstructor, async (req, res) => {
    try {
        const courseId = req.session.lti.courseId;
        const course = await getCourse(courseId);
        if (!course || !course.canvas_api_token) {
            return res.status(400).json({ error: 'Canvas API token not configured' });
        }

        const api = new CanvasAPI(course.canvas_api_url, course.canvas_api_token);
        const students = await api.getStudents(courseId);

        for (const s of students) {
            const stuResult = await pool.query(`
        INSERT INTO students (canvas_user_id, name, sortable_name, email, avatar_url)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (canvas_user_id) DO UPDATE SET name=$2, sortable_name=$3, email=$4, avatar_url=$5
        RETURNING id
      `, [s.canvas_user_id, s.name, s.sortable_name, s.email, s.avatar_url]);

            await pool.query(`
        INSERT INTO enrollments (course_id, student_id) VALUES ($1, $2) ON CONFLICT DO NOTHING
      `, [course.id, stuResult.rows[0].id]);
        }

        res.json({ success: true, count: students.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============== SESSIONS ==============
app.get('/api/sessions', requireAuth, async (req, res) => {
    try {
        const courseId = req.session.lti.courseId;
        const course = await getCourse(courseId);
        if (!course) return res.json([]);

        const { start, end } = req.query;
        let query = 'SELECT * FROM sessions WHERE course_id = $1';
        const params = [course.id];

        if (start) {
            params.push(start);
            query += ` AND start_time >= $${params.length}`;
        }
        if (end) {
            params.push(end);
            query += ` AND start_time <= $${params.length}`;
        }

        query += ' ORDER BY start_time ASC';
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/sessions', requireInstructor, async (req, res) => {
    try {
        const courseId = req.session.lti.courseId;
        const course = await getCourse(courseId);
        if (!course) return res.status(404).json({ error: 'Course not configured' });

        const sessions = Array.isArray(req.body) ? req.body : [req.body];
        const created = [];

        for (const s of sessions) {
            const result = await pool.query(`
        INSERT INTO sessions (course_id, title, start_time, end_time, location)
        VALUES ($1, $2, $3, $4, $5) RETURNING *
      `, [course.id, s.title, s.start_time, s.end_time || s.start_time, s.location || '']);
            created.push(result.rows[0]);
        }

        res.json(created);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/sessions/:id', requireInstructor, async (req, res) => {
    try {
        const { title, start_time, end_time, location } = req.body;
        const result = await pool.query(`
      UPDATE sessions SET title=$1, start_time=$2, end_time=$3, location=$4 WHERE id=$5 RETURNING *
    `, [title, start_time, end_time, location || '', req.params.id]);
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/sessions/:id', requireInstructor, async (req, res) => {
    try {
        await pool.query('DELETE FROM sessions WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Sync sessions from Canvas calendar
app.post('/api/sessions/sync', requireInstructor, async (req, res) => {
    try {
        const courseId = req.session.lti.courseId;
        const course = await getCourse(courseId);
        if (!course || !course.canvas_api_token) {
            return res.status(400).json({ error: 'Canvas API not configured' });
        }

        const api = new CanvasAPI(course.canvas_api_url, course.canvas_api_token);
        const events = await api.getCalendarEvents(courseId);
        let count = 0;

        for (const e of events) {
            if (!e.start_time) continue;
            const existing = await pool.query(
                'SELECT id FROM sessions WHERE course_id = $1 AND canvas_event_id = $2',
                [course.id, e.canvas_event_id]
            );
            if (existing.rows.length === 0) {
                await pool.query(`
          INSERT INTO sessions (course_id, title, start_time, end_time, location, canvas_event_id)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [course.id, e.title, e.start_time, e.end_time || e.start_time, e.location, e.canvas_event_id]);
                count++;
            } else {
                await pool.query(`
          UPDATE sessions SET title=$1, start_time=$2, end_time=$3, location=$4
          WHERE id=$5
        `, [e.title, e.start_time, e.end_time, e.location, existing.rows[0].id]);
            }
        }

        res.json({ success: true, synced: count, total: events.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============== ATTENDANCE ==============
app.get('/api/attendance/:sessionId', requireAuth, async (req, res) => {
    try {
        const courseId = req.session.lti.courseId;
        const course = await getCourse(courseId);
        if (!course) return res.json([]);

        const result = await pool.query(`
      SELECT a.*, s.name as student_name, s.sortable_name, s.email, s.avatar_url
      FROM students s
      JOIN enrollments e ON s.id = e.student_id AND e.course_id = $1
      LEFT JOIN attendance a ON a.session_id = $2 AND a.student_id = s.id
      ORDER BY s.sortable_name, s.name
    `, [course.id, req.params.sessionId]);

        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/attendance/:sessionId', requireInstructor, async (req, res) => {
    try {
        const { records } = req.body; // [{student_id, status, comment}]
        const sessionId = req.params.sessionId;

        for (const r of records) {
            await pool.query(`
        INSERT INTO attendance (session_id, student_id, status, comment, recorded_by, recorded_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (session_id, student_id) DO UPDATE SET
          status = $3, comment = $4, recorded_by = $5, recorded_at = NOW()
      `, [sessionId, r.student_id, r.status, r.comment || '', 'manual']);
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Fill blanks with a default status
app.post('/api/attendance/:sessionId/fill', requireInstructor, async (req, res) => {
    try {
        const { status } = req.body;
        const sessionId = req.params.sessionId;
        const courseId = req.session.lti.courseId;
        const course = await getCourse(courseId);

        const students = await pool.query(`
      SELECT s.id FROM students s
      JOIN enrollments e ON s.id = e.student_id AND e.course_id = $1
      WHERE s.id NOT IN (
        SELECT student_id FROM attendance WHERE session_id = $2 AND status != 'unmarked'
      )
    `, [course.id, sessionId]);

        for (const s of students.rows) {
            await pool.query(`
        INSERT INTO attendance (session_id, student_id, status, recorded_by)
        VALUES ($1, $2, $3, 'fill') ON CONFLICT (session_id, student_id) DO UPDATE SET status=$3
      `, [sessionId, s.id, status]);
        }

        res.json({ success: true, filled: students.rows.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get attendance grid (students x sessions for a date range)
app.get('/api/attendance-grid', requireAuth, async (req, res) => {
    try {
        const courseId = req.session.lti.courseId;
        const course = await getCourse(courseId);
        if (!course) return res.json({ students: [], sessions: [], attendance: {} });

        const { start, end } = req.query;

        // Get sessions for the range
        let sessQuery = 'SELECT * FROM sessions WHERE course_id = $1';
        const sessParams = [course.id];
        if (start) { sessParams.push(start); sessQuery += ` AND start_time >= $${sessParams.length}`; }
        if (end) { sessParams.push(end); sessQuery += ` AND start_time <= $${sessParams.length}`; }
        sessQuery += ' ORDER BY start_time ASC';
        const sessions = (await pool.query(sessQuery, sessParams)).rows;

        // Get students
        const students = (await pool.query(`
      SELECT s.* FROM students s
      JOIN enrollments e ON s.id = e.student_id WHERE e.course_id = $1
      ORDER BY s.sortable_name
    `, [course.id])).rows;

        // Get attendance for these sessions
        const sessionIds = sessions.map(s => s.id);
        let attendance = {};
        if (sessionIds.length > 0) {
            const attResult = await pool.query(`
        SELECT * FROM attendance WHERE session_id = ANY($1)
      `, [sessionIds]);
            attResult.rows.forEach(a => {
                const key = `${a.student_id}_${a.session_id}`;
                attendance[key] = a;
            });
        }

        res.json({ students, sessions, attendance });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============== ATTENDANCE CODES ==============
app.get('/api/codes', requireAuth, async (req, res) => {
    try {
        const courseId = req.session.lti.courseId;
        const course = await getCourse(courseId);
        if (!course) return res.json([]);

        const result = await pool.query(`
      SELECT c.*, s.title as session_title, s.start_time
      FROM attendance_codes c
      JOIN sessions s ON c.session_id = s.id
      WHERE s.course_id = $1 AND c.active = true
      ORDER BY s.start_time ASC
    `, [course.id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/codes/:sessionId/generate', requireInstructor, async (req, res) => {
    try {
        const code = Math.random().toString(36).substring(2, 8).toUpperCase();
        const expiresAt = req.body.expires_at || new Date(Date.now() + 30 * 60 * 1000).toISOString();

        // Deactivate old codes
        await pool.query('UPDATE attendance_codes SET active = false WHERE session_id = $1', [req.params.sessionId]);

        const result = await pool.query(`
      INSERT INTO attendance_codes (session_id, code, expires_at, active)
      VALUES ($1, $2, $3, true) RETURNING *
    `, [req.params.sessionId, code, expiresAt]);

        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/codes/verify', requireAuth, async (req, res) => {
    try {
        const { code, session_id } = req.body;
        const userId = req.session.lti.userId;

        const codeResult = await pool.query(`
      SELECT c.*, s.course_id FROM attendance_codes c
      JOIN sessions s ON c.session_id = s.id
      WHERE c.session_id = $1 AND c.code = $2 AND c.active = true
    `, [session_id, code.toUpperCase()]);

        if (codeResult.rows.length === 0) {
            return res.status(400).json({ error: 'Invalid or expired code' });
        }

        const codeRecord = codeResult.rows[0];
        if (new Date(codeRecord.expires_at) < new Date()) {
            return res.status(400).json({ error: 'Code has expired' });
        }

        // Find student by multiple possible IDs
        const canvasUserId = req.session.lti.canvasUserId || '';
        const userEmail = req.session.lti.userEmail || '';

        let student = null;
        if (canvasUserId) {
            student = (await pool.query('SELECT id FROM students WHERE canvas_user_id = $1', [canvasUserId])).rows[0];
        }
        if (!student) {
            student = (await pool.query('SELECT id FROM students WHERE canvas_user_id = $1', [userId])).rows[0];
        }
        if (!student && userEmail) {
            student = (await pool.query('SELECT id FROM students WHERE email = $1', [userEmail])).rows[0];
        }
        if (!student) {
            return res.status(404).json({ error: 'Student not found in this course' });
        }

        await pool.query(`
      INSERT INTO attendance (session_id, student_id, status, recorded_by, recorded_at)
      VALUES ($1, $2, 'Present', 'self', NOW())
      ON CONFLICT (session_id, student_id) DO UPDATE SET status='Present', recorded_by='self', recorded_at=NOW()
    `, [session_id, student.id]);

        res.json({ success: true, message: 'Attendance recorded!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============== GRADING ==============
app.post('/api/grades/calculate', requireInstructor, async (req, res) => {
    try {
        const courseId = req.session.lti.courseId;
        const course = await getCourse(courseId);
        if (!course || !course.grading_enabled) {
            return res.json({ message: 'Grading not enabled' });
        }

        const students = (await pool.query(`
      SELECT s.* FROM students s
      JOIN enrollments e ON s.id = e.student_id WHERE e.course_id = $1
    `, [course.id])).rows;

        const grades = [];
        for (const s of students) {
            const grade = await GradingEngine.calculateGrade(s.id, course.id);
            const stats = await GradingEngine.getStudentAttendanceStats(s.id, course.id);
            grades.push({ student: s, grade, stats });
        }

        res.json(grades);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/grades/sync-canvas', requireInstructor, async (req, res) => {
    try {
        const courseId = req.session.lti.courseId;
        const course = await getCourse(courseId);
        if (!course || !course.canvas_api_token || !course.grading_enabled) {
            return res.status(400).json({ error: 'Grading or Canvas API not configured' });
        }

        const api = new CanvasAPI(course.canvas_api_url, course.canvas_api_token);

        // Create or use existing assignment
        let assignmentId = course.assignment_id;
        if (!assignmentId) {
            const assignment = await api.createAssignment(courseId, 'Attendance', course.grading_points);
            assignmentId = String(assignment.id);
            await pool.query('UPDATE courses SET assignment_id = $1 WHERE id = $2', [assignmentId, course.id]);
        }

        const students = (await pool.query(`
      SELECT s.* FROM students s
      JOIN enrollments e ON s.id = e.student_id WHERE e.course_id = $1
    `, [course.id])).rows;

        let synced = 0;
        for (const s of students) {
            const grade = await GradingEngine.calculateGrade(s.id, course.id);
            try {
                await api.submitGrade(courseId, assignmentId, s.canvas_user_id, grade);
                synced++;
            } catch (e) {
                console.error(`Failed to sync grade for ${s.name}:`, e.message);
            }
        }

        res.json({ success: true, synced, total: students.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============== REPORTS ==============
app.get('/api/reports/summary', requireAuth, async (req, res) => {
    try {
        const courseId = req.session.lti.courseId;
        const course = await getCourse(courseId);
        if (!course) return res.json([]);

        const students = (await pool.query(`
      SELECT s.* FROM students s
      JOIN enrollments e ON s.id = e.student_id WHERE e.course_id = $1
      ORDER BY s.sortable_name
    `, [course.id])).rows;

        const report = [];
        for (const s of students) {
            const stats = await GradingEngine.getStudentAttendanceStats(s.id, course.id);
            let grade = null;
            if (course.grading_enabled) {
                grade = await GradingEngine.calculateGrade(s.id, course.id);
            }
            report.push({ student: s, stats, grade });
        }

        res.json(report);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/reports/by-date', requireAuth, async (req, res) => {
    try {
        const courseId = req.session.lti.courseId;
        const course = await getCourse(courseId);
        if (!course) return res.json([]);

        const result = await pool.query(`
      SELECT s.title, s.start_time, s.id as session_id,
        COUNT(CASE WHEN a.status = 'Present' THEN 1 END) as present_count,
        COUNT(CASE WHEN a.status = 'Absent' THEN 1 END) as absent_count,
        COUNT(CASE WHEN a.status = 'Late' THEN 1 END) as late_count,
        COUNT(CASE WHEN a.status = 'Excused' THEN 1 END) as excused_count,
        COUNT(CASE WHEN a.status IS NOT NULL AND a.status != 'unmarked' THEN 1 END) as total_marked
      FROM sessions s
      LEFT JOIN attendance a ON a.session_id = s.id
      WHERE s.course_id = $1
      GROUP BY s.id, s.title, s.start_time
      ORDER BY s.start_time ASC
    `, [course.id]);

        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/reports/comments', requireAuth, async (req, res) => {
    try {
        const courseId = req.session.lti.courseId;
        const course = await getCourse(courseId);
        if (!course) return res.json([]);

        const result = await pool.query(`
      SELECT a.comment, a.recorded_at, a.status,
        s.name as student_name, sess.title as session_title, sess.start_time
      FROM attendance a
      JOIN students s ON a.student_id = s.id
      JOIN sessions sess ON a.session_id = sess.id
      WHERE sess.course_id = $1 AND a.comment IS NOT NULL AND a.comment != ''
      ORDER BY a.recorded_at DESC
    `, [course.id]);

        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/reports/student/:studentId', requireAuth, async (req, res) => {
    try {
        const courseId = req.session.lti.courseId;
        const course = await getCourse(courseId);
        if (!course) return res.json(null);

        const student = (await pool.query('SELECT * FROM students WHERE id = $1', [req.params.studentId])).rows[0];
        if (!student) return res.status(404).json({ error: 'Student not found' });

        const stats = await GradingEngine.getStudentAttendanceStats(student.id, course.id);
        let grade = null;
        if (course.grading_enabled) {
            grade = await GradingEngine.calculateGrade(student.id, course.id);
        }

        const detail = (await pool.query(`
      SELECT a.*, s.title as session_title, s.start_time, s.end_time, s.location
      FROM sessions s
      LEFT JOIN attendance a ON a.session_id = s.id AND a.student_id = $1
      WHERE s.course_id = $2
      ORDER BY s.start_time ASC
    `, [student.id, course.id])).rows;

        res.json({ student, stats, grade, detail });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Export report
app.get('/api/reports/export', requireAuth, async (req, res) => {
    try {
        const courseId = req.session.lti.courseId;
        const course = await getCourse(courseId);
        if (!course) return res.status(404).json({ error: 'Course not found' });

        const format = req.query.format || 'csv';

        const students = (await pool.query(`
      SELECT s.* FROM students s
      JOIN enrollments e ON s.id = e.student_id WHERE e.course_id = $1
      ORDER BY s.sortable_name
    `, [course.id])).rows;

        const sessions = (await pool.query(`
      SELECT * FROM sessions WHERE course_id = $1 ORDER BY start_time
    `, [course.id])).rows;

        // Build matrix
        const data = [];
        const header = ['Student Name', 'Email', ...sessions.map(s => s.title + ' (' + new Date(s.start_time).toLocaleDateString() + ')'), 'Present', 'Absent', 'Late', 'Excused', 'Rate'];
        data.push(header);

        for (const student of students) {
            const row = [student.name, student.email];
            let present = 0, absent = 0, late = 0, excused = 0;

            for (const sess of sessions) {
                const att = await pool.query(
                    'SELECT status FROM attendance WHERE session_id = $1 AND student_id = $2',
                    [sess.id, student.id]
                );
                const status = att.rows.length > 0 ? att.rows[0].status : '-';
                row.push(status);
                if (status === 'Present') present++;
                else if (status === 'Absent') absent++;
                else if (status === 'Late') late++;
                else if (status === 'Excused') excused++;
            }

            const total = present + absent + late + excused;
            row.push(present, absent, late, excused, total > 0 ? Math.round((present / total) * 100) + '%' : 'N/A');
            data.push(row);
        }

        if (format === 'xlsx') {
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.aoa_to_sheet(data);
            XLSX.utils.book_append_sheet(wb, ws, 'Attendance');
            const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', 'attachment; filename=attendance_report.xlsx');
            res.send(buf);
        } else {
            const csv = data.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename=attendance_report.csv');
            res.send(csv);
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============== STUDENT PORTAL ==============
app.get('/api/student/sessions', requireAuth, async (req, res) => {
    try {
        const courseId = req.session.lti.courseId;
        const userId = req.session.lti.userId;
        const canvasUserId = req.session.lti.canvasUserId || '';
        const userName = req.session.lti.userName;
        const userEmail = req.session.lti.userEmail || '';
        const course = await getCourse(courseId);
        if (!course) return res.json([]);

        // Try to find student by multiple possible IDs
        let student = null;

        // Try canvas_user_id match (from Canvas API sync)
        if (canvasUserId) {
            student = (await pool.query('SELECT * FROM students WHERE canvas_user_id = $1', [canvasUserId])).rows[0];
        }
        // Try LTI user_id match
        if (!student) {
            student = (await pool.query('SELECT * FROM students WHERE canvas_user_id = $1', [userId])).rows[0];
        }
        // Try email match as fallback
        if (!student && userEmail) {
            student = (await pool.query('SELECT * FROM students WHERE email = $1', [userEmail])).rows[0];
        }

        // Auto-create student if not found (they launched via LTI so they're real)
        if (!student && course) {
            const stuResult = await pool.query(`
                INSERT INTO students (canvas_user_id, name, sortable_name, email)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (canvas_user_id) DO UPDATE SET name=$2, email=$4
                RETURNING *
            `, [canvasUserId || userId, userName, userName, userEmail]);
            student = stuResult.rows[0];
        }

        // Auto-enroll in course if not already
        if (student && course) {
            await pool.query(`
                INSERT INTO enrollments (course_id, student_id)
                VALUES ($1, $2) ON CONFLICT DO NOTHING
            `, [course.id, student.id]);
        }

        const sessions = (await pool.query(`
      SELECT s.*,
        a.status, a.recorded_at, a.comment,
        ac.code as active_code, ac.expires_at as code_expires
      FROM sessions s
      LEFT JOIN attendance a ON a.session_id = s.id AND a.student_id = $1
      LEFT JOIN attendance_codes ac ON ac.session_id = s.id AND ac.active = true
      WHERE s.course_id = $2
      ORDER BY s.start_time ASC
    `, [student ? student.id : -1, course.id])).rows;

        res.json({ student, sessions });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============== HELPERS ==============
async function getCourse(canvasCourseId) {
    const result = await pool.query('SELECT * FROM courses WHERE canvas_course_id = $1', [canvasCourseId]);
    return result.rows.length > 0 ? result.rows[0] : null;
}

// ============== START ==============
async function start() {
    try {
        await initDatabase();
        app.listen(PORT, () => {
            console.log(`Canvas Attendance LTI running on port ${PORT}`);
            console.log(`Dev launch: http://localhost:${PORT}/dev-launch`);
            console.log(`Student test: http://localhost:${PORT}/dev-student`);
        });
    } catch (err) {
        console.error('Failed to start:', err);
        process.exit(1);
    }
}

start();
