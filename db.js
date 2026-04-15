const { Pool } = require('pg');
const dns = require('dns');
require('dotenv').config();

// Supabase may resolve to IPv6 which can fail on some networks
dns.setDefaultResultOrder('ipv4first');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS courses (
        id SERIAL PRIMARY KEY,
        canvas_course_id VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(500),
        canvas_api_token TEXT,
        canvas_api_url TEXT DEFAULT 'https://canvas.instructure.com/api/v1',
        calendar_sync BOOLEAN DEFAULT false,
        grading_enabled BOOLEAN DEFAULT false,
        grading_mode VARCHAR(50) DEFAULT 'proportional',
        grading_points NUMERIC DEFAULT 100,
        grading_total_sessions INTEGER DEFAULT 0,
        assignment_id VARCHAR(255),
        calendar_locked BOOLEAN DEFAULT false,
        statuses TEXT DEFAULT '["Present","Absent","Late","Excused"]',
        configured BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id SERIAL PRIMARY KEY,
        course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
        title VARCHAR(500) NOT NULL,
        start_time TIMESTAMP NOT NULL,
        end_time TIMESTAMP NOT NULL,
        location VARCHAR(500),
        canvas_event_id VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS students (
        id SERIAL PRIMARY KEY,
        canvas_user_id VARCHAR(255) NOT NULL,
        name VARCHAR(500),
        sortable_name VARCHAR(500),
        email VARCHAR(500),
        avatar_url TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(canvas_user_id)
      );

      CREATE TABLE IF NOT EXISTS enrollments (
        id SERIAL PRIMARY KEY,
        course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
        student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(course_id, student_id)
      );

      CREATE TABLE IF NOT EXISTS attendance (
        id SERIAL PRIMARY KEY,
        session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
        student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
        status VARCHAR(50) DEFAULT 'unmarked',
        comment TEXT,
        recorded_by VARCHAR(50) DEFAULT 'manual',
        recorded_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(session_id, student_id)
      );

      CREATE TABLE IF NOT EXISTS grading_rules (
        id SERIAL PRIMARY KEY,
        course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
        min_absences INTEGER NOT NULL,
        max_absences INTEGER,
        penalty_value NUMERIC NOT NULL,
        sort_order INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS attendance_codes (
        id SERIAL PRIMARY KEY,
        session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
        code VARCHAR(10) NOT NULL,
        expires_at TIMESTAMP,
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS lti_sessions (
        id SERIAL PRIMARY KEY,
        session_token VARCHAR(255) UNIQUE NOT NULL,
        canvas_user_id VARCHAR(255),
        canvas_course_id VARCHAR(255),
        user_name VARCHAR(500),
        user_role VARCHAR(50),
        lis_outcome_service_url TEXT,
        lis_result_sourcedid TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        expires_at TIMESTAMP DEFAULT NOW() + INTERVAL '24 hours'
      );
    `);
    console.log('Database tables initialized successfully');
  } catch (err) {
    console.error('Error initializing database:', err);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, initDatabase };
