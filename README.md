# Canvas Attendance LTI

A Canvas LMS attendance tool (similar to aPlus+ Attendance) that works with free teacher accounts.

## Features
- **4 Grading Modes**: Proportional, Rule-Based % Penalty, Rule-Based Absolute Points, Raw Points
- **Canvas Integration**: Sync students, calendar events, and push grades back to Canvas
- **Attendance Recording**: Manual entry with Present/Absent/Late/Excused statuses
- **Student Self-Registration**: Generate codes for students to mark their own attendance
- **Reports**: Summary, By Date, Comments, Grades — export to CSV/Excel
- **Student Portal**: Students see their attendance + enter codes

## Quick Deploy to Render.com (FREE)

### Step 1: Create a Supabase Database (FREE)
1. Go to [supabase.com](https://supabase.com) and create a free account
2. Create a new project (choose a region close to you)
3. Once created, go to **Settings → Database**
4. Copy the **Connection string (URI)** — it looks like: `postgresql://postgres:password@db.xxxx.supabase.co:5432/postgres`

### Step 2: Push to GitHub
```bash
cd canvas_new_attendance
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/canvas-attendance-lti.git
git push -u origin main
```

### Step 3: Deploy to Render.com (FREE)
1. Go to [render.com](https://render.com) and create a free account
2. Click **New → Web Service**
3. Connect your GitHub repo
4. Render will auto-detect the `render.yaml` — or configure manually:
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Plan**: Free
5. Add these **Environment Variables**:
   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | Your Supabase connection string |
   | `LTI_KEY` | Any key you choose (e.g., `my-attendance-key`) |
   | `LTI_SECRET` | Any secret you choose (e.g., `my-secret-123`) |
   | `SESSION_SECRET` | A random string |
   | `CANVAS_API_URL` | `https://canvas.instructure.com/api/v1` (or your Canvas URL) |
   | `CANVAS_API_TOKEN` | Your Canvas API token |
6. Click **Deploy**

### Step 4: Get a Canvas API Token
1. Log into Canvas
2. Go to **Account → Settings**
3. Scroll to **Approved Integrations → New Access Token**
4. Give it a name and generate — copy the token

### Step 5: Add to Canvas as External Tool
1. In your Canvas course, go to **Settings → Apps → + App**
2. Configuration Type: **By URL** or **Manual Entry**
   - **Name**: Attendance
   - **Consumer Key**: Same as your `LTI_KEY`
   - **Shared Secret**: Same as your `LTI_SECRET`
   - **Launch URL**: `https://YOUR-APP.onrender.com/lti/launch`
3. Save — "Attendance" now appears in your course navigation!

## Local Development

```bash
# Copy env file and fill in values
cp .env.example .env

# Install dependencies
npm install

# Start server
npm start

# Open in browser
# Instructor: http://localhost:3000/dev-launch
# Student: http://localhost:3000/dev-student
```

## Tech Stack
- **Backend**: Node.js, Express
- **Database**: PostgreSQL (Supabase free tier)
- **Hosting**: Render.com (free tier)
- **Frontend**: Vanilla JS, CSS
- **LTI**: ims-lti (LTI 1.1)
