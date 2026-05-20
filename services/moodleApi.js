class MoodleAPI {
    constructor(baseUrl, token) {
        // Strip trailing slashes
        this.baseUrl = baseUrl.replace(/\/+$/, '');
        this.token = token;
    }

    async getStudents(courseId) {
        // Moodle Web Services API: core_enrol_get_enrolled_users
        const url = `${this.baseUrl}/webservice/rest/server.php?wstoken=${this.token}&wsfunction=core_enrol_get_enrolled_users&moodlewsrestformat=json&courseid=${courseId}`;
        
        try {
            const response = await fetch(url, { method: 'GET' });
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            // Moodle API returns an object with an 'exception' key on errors (even with a 200 HTTP status)
            if (data.exception) {
                throw new Error(data.message || data.exception);
            }
            
            // data should be an array of users
            if (!Array.isArray(data)) {
                console.log('Moodle API response was not an array of users:', data);
                return [];
            }
            
            // Filter out users who are not students (roleid 5 is usually student, but checking roles isn't always reliable depending on Moodle version)
            // LTI users in Moodle are just normal users, often we just pull everyone enrolled, or we can look for "roles" if included.
            // For now, we will return everyone enrolled, or those with role "student".
            const students = data.filter(u => {
                // If roles array exists, verify they have a student role
                if (u.roles && u.roles.length > 0) {
                    const isStudent = u.roles.some(r => r.shortname === 'student');
                    if (!isStudent) return false;
                }
                return true;
            });

            return students.map(u => ({
                canvas_user_id: u.id.toString(), // Using Canvas column to store Moodle ID
                name: u.fullname || `${u.firstname} ${u.lastname}`,
                sortable_name: `${u.lastname || ''}, ${u.firstname || ''}`.trim(),
                email: u.email || '',
                avatar_url: u.profileimageurl || ''
            }));
        } catch (err) {
            console.error('Moodle API Error (getStudents):', err.message);
            throw err;
        }
    }
}

module.exports = MoodleAPI;
