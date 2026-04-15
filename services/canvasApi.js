const fetch = require('node-fetch');

class CanvasAPI {
    constructor(apiUrl, apiToken) {
        this.apiUrl = apiUrl.replace(/\/$/, '');
        this.token = apiToken;
    }

    async request(endpoint, options = {}) {
        const url = `${this.apiUrl}${endpoint}`;
        const headers = {
            'Authorization': `Bearer ${this.token}`,
            'Content-Type': 'application/json',
            ...options.headers
        };
        const res = await fetch(url, { ...options, headers });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Canvas API error ${res.status}: ${text}`);
        }
        return res.json();
    }

    async getStudents(courseId) {
        let allStudents = [];
        let page = 1;
        let hasMore = true;
        while (hasMore) {
            const students = await this.request(
                `/courses/${courseId}/enrollments?type[]=StudentEnrollment&per_page=100&page=${page}`
            );
            allStudents = allStudents.concat(students);
            hasMore = students.length === 100;
            page++;
        }
        return allStudents.map(e => ({
            canvas_user_id: String(e.user_id),
            name: e.user?.name || 'Unknown',
            sortable_name: e.user?.sortable_name || '',
            email: e.user?.login_id || '',
            avatar_url: e.user?.avatar_url || ''
        }));
    }

    async getCalendarEvents(courseId) {
        let allEvents = [];
        let page = 1;
        let hasMore = true;
        while (hasMore) {
            const events = await this.request(
                `/calendar_events?context_codes[]=course_${courseId}&per_page=100&page=${page}&all_events=true`
            );
            allEvents = allEvents.concat(events);
            hasMore = events.length === 100;
            page++;
        }
        return allEvents.map(e => ({
            canvas_event_id: String(e.id),
            title: e.title || 'Untitled Session',
            start_time: e.start_at,
            end_time: e.end_at || e.start_at,
            location: e.location_name || ''
        }));
    }

    async createAssignment(courseId, name, points) {
        const data = {
            assignment: {
                name,
                points_possible: points,
                submission_types: ['none'],
                published: true,
                grading_type: 'points'
            }
        };
        const result = await this.request(`/courses/${courseId}/assignments`, {
            method: 'POST',
            body: JSON.stringify(data)
        });
        return result;
    }

    async submitGrade(courseId, assignmentId, studentCanvasId, grade) {
        const data = {
            submission: {
                posted_grade: String(grade)
            }
        };
        return this.request(
            `/courses/${courseId}/assignments/${assignmentId}/submissions/${studentCanvasId}`,
            { method: 'PUT', body: JSON.stringify(data) }
        );
    }

    async getCourse(courseId) {
        return this.request(`/courses/${courseId}`);
    }
}

module.exports = CanvasAPI;
