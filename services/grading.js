const { pool } = require('../db');

class GradingEngine {
    // Proportional: (attended / taught_to_date) * max_points
    static async calculateProportional(studentId, courseId, maxPoints) {
        const result = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM attendance a
         JOIN sessions s ON a.session_id = s.id
         WHERE a.student_id = $1 AND s.course_id = $2 AND a.status = 'Present'
        ) as attended,
        (SELECT COUNT(*) FROM attendance a
         JOIN sessions s ON a.session_id = s.id
         WHERE a.student_id = $1 AND s.course_id = $2 AND a.status != 'unmarked'
        ) as taught
    `, [studentId, courseId]);

        const { attended, taught } = result.rows[0];
        if (parseInt(taught) === 0) return maxPoints;
        return Math.round((parseInt(attended) / parseInt(taught)) * maxPoints * 100) / 100;
    }

    // Rule-Based Percentage Penalty: check absences against rules, apply % penalty to total grade
    static async calculateRuleBasedPercentage(studentId, courseId) {
        const absResult = await pool.query(`
      SELECT COUNT(*) as absences FROM attendance a
      JOIN sessions s ON a.session_id = s.id
      WHERE a.student_id = $1 AND s.course_id = $2 AND a.status = 'Absent'
    `, [studentId, courseId]);
        const absences = parseInt(absResult.rows[0].absences);

        const rulesResult = await pool.query(`
      SELECT * FROM grading_rules WHERE course_id = $1 ORDER BY min_absences ASC
    `, [courseId]);

        let penaltyPercent = 0;
        for (const rule of rulesResult.rows) {
            const min = rule.min_absences;
            const max = rule.max_absences;
            if (absences >= min && (max === null || absences < max)) {
                penaltyPercent = parseFloat(rule.penalty_value);
                break;
            }
        }
        // Return negative penalty percentage (to be applied against total grade)
        return -penaltyPercent;
    }

    // Rule-Based Absolute Points Penalty: check absences against rules, deduct points
    static async calculateRuleBasedAbsolute(studentId, courseId, basePoints) {
        const absResult = await pool.query(`
      SELECT COUNT(*) as absences FROM attendance a
      JOIN sessions s ON a.session_id = s.id
      WHERE a.student_id = $1 AND s.course_id = $2 AND a.status = 'Absent'
    `, [studentId, courseId]);
        const absences = parseInt(absResult.rows[0].absences);

        const rulesResult = await pool.query(`
      SELECT * FROM grading_rules WHERE course_id = $1 ORDER BY min_absences ASC
    `, [courseId]);

        let penalty = 0;
        for (const rule of rulesResult.rows) {
            const min = rule.min_absences;
            const max = rule.max_absences;
            if (absences >= min && (max === null || absences < max)) {
                penalty = parseFloat(rule.penalty_value);
                break;
            }
        }
        return basePoints - penalty;
    }

    // Raw Points by Session Attended: (attended / total_sessions) * max_points
    static async calculateRawPoints(studentId, courseId, totalSessions, maxPoints) {
        const result = await pool.query(`
      SELECT COUNT(*) as attended FROM attendance a
      JOIN sessions s ON a.session_id = s.id
      WHERE a.student_id = $1 AND s.course_id = $2 AND a.status = 'Present'
    `, [studentId, courseId]);

        const attended = parseInt(result.rows[0].attended);
        if (totalSessions === 0) return 0;
        return Math.round((attended / totalSessions) * maxPoints * 100) / 100;
    }

    // Per-Absence Deduction: start at max_points, deduct per_absence_value for each absence
    // per_absence_type can be 'points' (deduct fixed points) or 'percent' (deduct % of max)
    static async calculatePerAbsence(studentId, courseId, maxPoints, perAbsenceValue, perAbsenceType) {
        const absResult = await pool.query(`
      SELECT COUNT(*) as absences FROM attendance a
      JOIN sessions s ON a.session_id = s.id
      WHERE a.student_id = $1 AND s.course_id = $2 AND a.status = 'Absent'
    `, [studentId, courseId]);
        const absences = parseInt(absResult.rows[0].absences);

        let grade;
        if (perAbsenceType === 'percent') {
            // Each absence deducts X% of max points
            const totalDeduction = absences * parseFloat(perAbsenceValue);
            grade = maxPoints - (maxPoints * totalDeduction / 100);
        } else {
            // Each absence deducts X points
            grade = maxPoints - (absences * parseFloat(perAbsenceValue));
        }
        return Math.max(0, Math.round(grade * 100) / 100);
    }

    static async calculateGrade(studentId, courseId) {
        const courseResult = await pool.query(
            'SELECT * FROM courses WHERE id = $1', [courseId]
        );
        if (courseResult.rows.length === 0) return 0;
        const course = courseResult.rows[0];

        switch (course.grading_mode) {
            case 'per_absence':
                return this.calculatePerAbsence(studentId, courseId,
                    parseFloat(course.grading_points),
                    parseFloat(course.per_absence_value || 0),
                    course.per_absence_type || 'points');
            case 'proportional':
                return this.calculateProportional(studentId, courseId, parseFloat(course.grading_points));
            case 'rule_percentage':
                return this.calculateRuleBasedPercentage(studentId, courseId);
            case 'rule_absolute':
                return this.calculateRuleBasedAbsolute(studentId, courseId, parseFloat(course.grading_points));
            case 'raw_points':
                return this.calculateRawPoints(studentId, courseId, course.grading_total_sessions, parseFloat(course.grading_points));
            default:
                return 0;
        }
    }

    static async getStudentAttendanceStats(studentId, courseId) {
        const result = await pool.query(`
      SELECT
        a.status,
        COUNT(*) as count
      FROM attendance a
      JOIN sessions s ON a.session_id = s.id
      WHERE a.student_id = $1 AND s.course_id = $2 AND a.status != 'unmarked'
      GROUP BY a.status
    `, [studentId, courseId]);

        const stats = { Present: 0, Absent: 0, Late: 0, Excused: 0 };
        result.rows.forEach(r => { stats[r.status] = parseInt(r.count); });

        const total = Object.values(stats).reduce((a, b) => a + b, 0);
        stats.total = total;
        stats.rate = total > 0 ? Math.round((stats.Present / total) * 100) : 100;
        return stats;
    }
}

module.exports = GradingEngine;
