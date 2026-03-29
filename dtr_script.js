// ============================================
// SUPABASE CONFIGURATION
// ============================================
const SUPABASE_URL = 'https://frrhreykilydsylunzlc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZycmhyZXlraWx5ZHN5bHVuemxjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA3MjU0NTUsImV4cCI6MjA4NjMwMTQ1NX0.MJCBNy2QHUeW7At7sia1wY9WrbszsYeR6OIKjhHh0Vw';

// Initialize Supabase client
const supabaseClient = window.supabase && window.supabase.createClient ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

// Global variables
let currentUser = null;
let currentAdmin = null;
let records = [];
let students = [];

// ============================================
// GRACE PERIOD & TIME HELPERS
// ============================================

const DEFAULT_GRACE_PERIOD = 15; // minutes
const DEFAULT_OFFICIAL_START = '08:00';

/** Returns the current shift settings — from localStorage, then UI, then hardcoded defaults */
function getShiftSettings() {
    const saved = JSON.parse(localStorage.getItem('dtrShiftSettings') || '{}');
    const startTime   = document.getElementById('officialStartTime')?.value
                     || saved.startTime
                     || DEFAULT_OFFICIAL_START;
    const rawGrace    = document.getElementById('gracePeriodMinutes')?.value;
    const gracePeriod = rawGrace !== undefined && rawGrace !== ''
                     ? parseInt(rawGrace, 10)
                     : (saved.gracePeriod ?? DEFAULT_GRACE_PERIOD);
    return {
        startTime:   startTime || DEFAULT_OFFICIAL_START,
        gracePeriod: isNaN(gracePeriod) ? DEFAULT_GRACE_PERIOD : gracePeriod
    };
}

/** Persist current shift settings to localStorage */
function saveShiftSettings() {
    const settings = getShiftSettings();
    localStorage.setItem('dtrShiftSettings', JSON.stringify(settings));
    updateGraceHint();

    // Flash "✓ Saved" badge
    const badge = document.getElementById('graceSettingSaved');
    if (badge) {
        badge.style.display = 'inline';
        clearTimeout(badge._hideTimer);
        badge._hideTimer = setTimeout(() => { badge.style.display = 'none'; }, 1500);
    }
}

/** Increment/decrement grace period via the +/- stepper buttons */
function adjustGrace(delta) {
    const el = document.getElementById('gracePeriodMinutes');
    if (!el) return;
    const current = parseInt(el.value, 10) || 0;
    el.value = Math.max(0, Math.min(60, current + delta));
    saveShiftSettings();
    updateGraceHint();
}

/** Load persisted shift settings into the UI inputs */
function loadShiftSettings() {
    const saved = JSON.parse(localStorage.getItem('dtrShiftSettings') || '{}');
    const startEl  = document.getElementById('officialStartTime');
    const graceEl  = document.getElementById('gracePeriodMinutes');
    if (startEl && saved.startTime)   startEl.value = saved.startTime;
    if (graceEl && saved.gracePeriod !== undefined) graceEl.value = saved.gracePeriod;
    updateGraceHint();
}

/** Convert "HH:MM" to total minutes */
function timeToMinutes(t) {
    if (!t) return 0;
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
}

/** Convert total minutes back to "HH:MM" string */
function minutesToTimeStr(totalMins) {
    const h = Math.floor(totalMins / 60);
    const m = totalMins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Format total minutes as "X hrs Y mins" */
function minutesToHrsMin(totalMinutes) {
    const hrs = Math.floor(totalMinutes / 60);
    const mins = Math.round(totalMinutes % 60);
    return `${hrs} hrs ${mins} mins`;
}

/**
 * Apply grace period logic to the morning time-in.
 * @param {string} actualTimeIn  - "HH:MM" the user actually clocked in
 * @param {string} officialStart - "HH:MM" the scheduled shift start
 * @param {number} gracePeriodMins
 * @returns {{ effectiveTimeIn: string, latenessMinutes: number, status: string }}
 */
function applyGracePeriod(actualTimeIn, officialStart, gracePeriodMins) {
    if (!actualTimeIn) return { effectiveTimeIn: actualTimeIn, latenessMinutes: 0, status: 'On Time' };

    const actualMins    = timeToMinutes(actualTimeIn);
    const officialMins  = timeToMinutes(officialStart);
    const graceEndMins  = officialMins + gracePeriodMins;

    if (actualMins <= graceEndMins) {
        // Within grace window → normalize to official start
        return {
            effectiveTimeIn: officialStart,
            latenessMinutes: 0,
            status: 'On Time'
        };
    } else {
        // Beyond grace window → lateness counted from grace-period end
        const latenessMinutes = actualMins - graceEndMins;
        return {
            effectiveTimeIn: actualTimeIn,   // hours counted from actual arrival
            latenessMinutes,
            status: `Late (${latenessMinutes} min)`
        };
    }
}

/** Live-update grace window hint and preview while user types */
function updateGraceHint() {
    const { startTime, gracePeriod } = getShiftSettings();
    const graceEndMins = timeToMinutes(startTime) + gracePeriod;
    const graceEnd     = minutesToTimeStr(graceEndMins);

    const hint = document.getElementById('graceHintText');
    if (hint) hint.innerHTML = `Grace window: <strong>${formatTime(startTime)}</strong> – <strong>${formatTime(graceEnd)}</strong>`;

    // Live preview on the form
    const actualIn = document.getElementById('morningIn')?.value;
    const hasMorning    = !!document.getElementById('morningIn')?.value;
    const hasAfternoon  = !!document.getElementById('afternoonIn')?.value;
    const isHalfDayAft  = !hasMorning && hasAfternoon;
    const preview       = document.getElementById('gracePeriodPreview');
    if (!preview) return;

    if (actualIn && !isHalfDayAft) {
        const { latenessMinutes, status } = applyGracePeriod(actualIn, startTime, gracePeriod);
        const cls = latenessMinutes > 0 ? 'late' : 'on-time';
        preview.style.display = 'block';
        preview.innerHTML = `<span class="status-badge ${cls}">${status}</span>
            <span class="grace-detail">${latenessMinutes > 0
                ? `Lateness computed from ${formatTime(graceEnd)} — ${latenessMinutes} min`
                : `Login normalized to ${formatTime(startTime)}`}</span>`;
    } else if (isHalfDayAft) {
        preview.style.display = 'block';
        preview.innerHTML = `<span class="status-badge half-day">Half Day (Afternoon)</span>
            <span class="grace-detail">No grace period applied — actual times used.</span>`;
    } else {
        preview.style.display = 'none';
    }
}

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', function() {
    // SECURITY: Ensure screens are hidden initially
    document.getElementById('dtrScreen').style.display = 'none';
    document.getElementById('adminDashboard').style.display = 'none';
    document.getElementById('adminLoginScreen').style.display = 'none';
    
    // Check if user or admin is already logged in
    const savedUser = localStorage.getItem('currentUser');
    const savedAdmin = localStorage.getItem('currentAdmin');
    
    if (savedAdmin) {
        currentAdmin = JSON.parse(savedAdmin);
        showAdminDashboard();
    } else if (savedUser) {
        currentUser = JSON.parse(savedUser);
        showDTRScreen();
    } else {
        showStudentLogin();
    }
    
    // Handle Enter key on login forms
    document.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            if (document.getElementById('loginScreen').style.display !== 'none') {
                handleLogin();
            } else if (document.getElementById('adminLoginScreen').style.display !== 'none') {
                handleAdminLogin();
            }
        }
    });

    // Live grace period hint updates
    ['officialStartTime', 'gracePeriodMinutes', 'morningIn', 'afternoonIn'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', updateGraceHint);
    });

    // Auto-save shift settings whenever they change
    ['officialStartTime', 'gracePeriodMinutes'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', saveShiftSettings);
    });
});

// ============================================
// SCREEN NAVIGATION FUNCTIONS
// ============================================

function showStudentLogin() {
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('adminLoginScreen').style.display = 'none';
    document.getElementById('dtrScreen').style.display = 'none';
    document.getElementById('adminDashboard').style.display = 'none';
    document.body.style.overflow = 'hidden';
    document.body.style.padding = '0';
}

function showAdminLogin() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('adminLoginScreen').style.display = 'flex';
    document.getElementById('dtrScreen').style.display = 'none';
    document.getElementById('adminDashboard').style.display = 'none';
    document.body.style.overflow = 'hidden';
    document.body.style.padding = '0';
}

function showDTRScreen() {
    if (!currentUser) {
        showStudentLogin();
        return;
    }
    
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('adminLoginScreen').style.display = 'none';
    document.getElementById('dtrScreen').style.display = 'block';
    document.getElementById('adminDashboard').style.display = 'none';
    document.body.style.overflow = 'auto';
    document.body.style.padding = '20px';
    
    loadUserInfo();
    loadRecords();
    setDefaultDate();
    loadShiftSettings();
}

function showAdminDashboard() {
    if (!currentAdmin) {
        showAdminLogin();
        return;
    }
    
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('adminLoginScreen').style.display = 'none';
    document.getElementById('dtrScreen').style.display = 'none';
    document.getElementById('adminDashboard').style.display = 'block';
    document.body.style.overflow = 'auto';
    document.body.style.padding = '20px';
    
    loadAdminInfo();
    loadStudents();
}

// ============================================
// STUDENT AUTHENTICATION
// ============================================

async function handleLogin() {
    const studentId = document.getElementById('studentId').value.trim();
    const password = document.getElementById('password').value;
    const errorMsg = document.getElementById('loginError');
    const successMsg = document.getElementById('loginSuccess');
    
    errorMsg.style.display = 'none';
    successMsg.style.display = 'none';
    
    if (!studentId || !password) {
        errorMsg.textContent = 'Please fill in all fields.';
        errorMsg.style.display = 'block';
        return;
    }
    
    try {
        if (supabaseClient) {
            const { data: student, error} = await supabaseClient
                .from('students')
                .select('*')
                .eq('student_id', studentId)
                .eq('password', password)
                .single();
            
            if (error || !student) {
                errorMsg.textContent = 'Invalid credentials. Please try again.';
                errorMsg.style.display = 'block';
                return;
            }
            
            currentUser = student;
        } else {
            // Demo mode
            currentUser = {
                id: Date.now(),
                student_id: studentId,
                name: studentId,
                department: 'OJT Department',
                company: 'Company Name'
            };
        }
        
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
        
        successMsg.textContent = 'Login successful! Loading your records...';
        successMsg.style.display = 'block';
        
        setTimeout(() => {
            showDTRScreen();
        }, 1000);
        
    } catch (error) {
        console.error('Login error:', error);
        errorMsg.textContent = 'An error occurred. Please try again.';
        errorMsg.style.display = 'block';
    }
}

function handleLogout() {
    if (confirm('Are you sure you want to logout?')) {
        currentUser = null;
        localStorage.removeItem('currentUser');
        records = [];
        showStudentLogin();
    }
}

// ============================================
// ADMIN AUTHENTICATION
// ============================================

async function handleAdminLogin() {
    const username = document.getElementById('adminUsername').value.trim();
    const password = document.getElementById('adminPassword').value;
    const errorMsg = document.getElementById('adminLoginError');
    const successMsg = document.getElementById('adminLoginSuccess');
    
    errorMsg.style.display = 'none';
    successMsg.style.display = 'none';
    
    if (!username || !password) {
        errorMsg.textContent = 'Please fill in all fields.';
        errorMsg.style.display = 'block';
        return;
    }
    
    try {
        if (supabaseClient) {
            // Check admin credentials from admins table
            const { data: admin, error } = await supabaseClient
                .from('admins')
                .select('*')
                .eq('username', username)
                .eq('password', password)
                .single();
            
            if (error || !admin) {
                errorMsg.textContent = 'Invalid admin credentials.';
                errorMsg.style.display = 'block';
                return;
            }
            
            currentAdmin = admin;
        } else {
            // Demo mode - hardcoded admin credentials
            if (username === 'admin' && password === 'admin123') {
                currentAdmin = {
                    id: 1,
                    username: 'admin',
                    name: 'Administrator'
                };
            } else {
                errorMsg.textContent = 'Invalid admin credentials. (Demo: admin/admin123)';
                errorMsg.style.display = 'block';
                return;
            }
        }
        
        localStorage.setItem('currentAdmin', JSON.stringify(currentAdmin));
        
        successMsg.textContent = 'Admin login successful!';
        successMsg.style.display = 'block';
        
        setTimeout(() => {
            showAdminDashboard();
        }, 1000);
        
    } catch (error) {
        console.error('Admin login error:', error);
        errorMsg.textContent = 'An error occurred. Please try again.';
        errorMsg.style.display = 'block';
    }
}

function handleAdminLogout() {
    if (confirm('Are you sure you want to logout?')) {
        currentAdmin = null;
        localStorage.removeItem('currentAdmin');
        students = [];
        showStudentLogin();
    }
}

function loadAdminInfo() {
    if (!currentAdmin) return;
    document.getElementById('adminDisplayName').textContent = currentAdmin.name || currentAdmin.username || 'Administrator';
}

// ============================================
// ADMIN - STUDENT MANAGEMENT
// ============================================

async function loadStudents() {
    if (!currentAdmin) return;
    
    document.getElementById('loadingStudents').style.display = 'block';
    
    try {
        if (supabaseClient) {
            const { data, error } = await supabaseClient
                .from('students')
                .select('*')
                .order('created_at', { ascending: false });
            
            if (error) throw error;
            students = data || [];
        } else {
            // Demo mode
            students = JSON.parse(localStorage.getItem('demoStudents')) || [];
        }
        
        displayStudents();
        
    } catch (error) {
        console.error('Error loading students:', error);
        students = [];
        displayStudents();
    } finally {
        document.getElementById('loadingStudents').style.display = 'none';
    }
}

function displayStudents() {
    const tbody = document.getElementById('studentsBody');
    if (!tbody) return;
    
    if (students.length === 0) {
        tbody.innerHTML = '<tr class="no-records"><td colspan="7">No students found.</td></tr>';
        return;
    }
    
    tbody.innerHTML = students.map(student => `
        <tr>
            <td><strong>${student.student_id}</strong></td>
            <td>${student.name || '-'}</td>
            <td>${student.email || '-'}</td>
            <td>${student.department || '-'}</td>
            <td>${student.company || '-'}</td>
            <td>${student.supervisor || '-'}</td>
            <td class="no-print">
                <button class="delete-btn" style="background: #667eea; margin-right: 5px;" onclick="openEditModal(${student.id})">Edit</button>
                <button class="delete-btn" onclick="deleteStudent(${student.id}, '${student.student_id}')">Delete</button>
            </td>
        </tr>
    `).join('');
}

async function addStudent() {
    const studentId = document.getElementById('newStudentId').value.trim();
    const password = document.getElementById('newPassword').value;
    const name = document.getElementById('newName').value.trim();
    const email = document.getElementById('newEmail').value.trim();
    const department = document.getElementById('newDepartment').value.trim();
    const company = document.getElementById('newCompany').value.trim();
    const supervisor = document.getElementById('newSupervisor').value.trim();
    
    const errorMsg = document.getElementById('adminError');
    const successMsg = document.getElementById('adminSuccess');
    
    errorMsg.style.display = 'none';
    successMsg.style.display = 'none';
    
    if (!studentId || !password || !name) {
        errorMsg.textContent = 'Student ID, Password, and Name are required.';
        errorMsg.style.display = 'block';
        return;
    }
    
    try {
        const newStudent = {
            student_id: studentId,
            password: password,
            name: name,
            email: email || null,
            department: department || null,
            company: company || null,
            supervisor: supervisor || null,
            created_at: new Date().toISOString()
        };
        
        if (supabaseClient) {
            const { data, error } = await supabaseClient
                .from('students')
                .insert([newStudent])
                .select();
            
            if (error) {
                if (error.message.includes('duplicate') || error.code === '23505') {
                    errorMsg.textContent = 'Student ID already exists!';
                } else {
                    errorMsg.textContent = 'Failed to add student: ' + error.message;
                }
                errorMsg.style.display = 'block';
                return;
            }
        } else {
            // Demo mode
            newStudent.id = Date.now();
            const demoStudents = JSON.parse(localStorage.getItem('demoStudents')) || [];
            
            // Check for duplicate
            if (demoStudents.find(s => s.student_id === studentId)) {
                errorMsg.textContent = 'Student ID already exists!';
                errorMsg.style.display = 'block';
                return;
            }
            
            demoStudents.push(newStudent);
            localStorage.setItem('demoStudents', JSON.stringify(demoStudents));
        }
        
        successMsg.textContent = 'Student account created successfully!';
        successMsg.style.display = 'block';
        
        // Clear form
        document.getElementById('newStudentId').value = '';
        document.getElementById('newPassword').value = '';
        document.getElementById('newName').value = '';
        document.getElementById('newEmail').value = '';
        document.getElementById('newDepartment').value = '';
        document.getElementById('newCompany').value = '';
        document.getElementById('newSupervisor').value = '';
        
        // Reload students
        setTimeout(() => {
            successMsg.style.display = 'none';
            loadStudents();
        }, 2000);
        
    } catch (error) {
        console.error('Error adding student:', error);
        errorMsg.textContent = 'Failed to add student. Please try again.';
        errorMsg.style.display = 'block';
    }
}

async function deleteStudent(id, studentId) {
    if (!confirm(`Are you sure you want to delete student ${studentId}? This will also delete all their time records!`)) {
        return;
    }
    
    try {
        if (supabaseClient) {
            const { error } = await supabaseClient
                .from('students')
                .delete()
                .eq('id', id);
            
            if (error) throw error;
        } else {
            // Demo mode
            const demoStudents = JSON.parse(localStorage.getItem('demoStudents')) || [];
            const filtered = demoStudents.filter(s => s.id !== id);
            localStorage.setItem('demoStudents', JSON.stringify(filtered));
        }
        
        loadStudents();
        
    } catch (error) {
        console.error('Error deleting student:', error);
        alert('Failed to delete student. Please try again.');
    }
}

function openEditModal(id) {
    const student = students.find(s => s.id === id);
    if (!student) return;
    
    document.getElementById('editStudentDbId').value = student.id;
    document.getElementById('editStudentId').value = student.student_id;
    document.getElementById('editPassword').value = '';
    document.getElementById('editName').value = student.name || '';
    document.getElementById('editEmail').value = student.email || '';
    document.getElementById('editDepartment').value = student.department || '';
    document.getElementById('editCompany').value = student.company || '';
    document.getElementById('editSupervisor').value = student.supervisor || '';
    
    document.getElementById('editModal').style.display = 'flex';
}

function closeEditModal() {
    document.getElementById('editModal').style.display = 'none';
    document.getElementById('editError').style.display = 'none';
    document.getElementById('editSuccess').style.display = 'none';
}

async function updateStudent() {
    const id = parseInt(document.getElementById('editStudentDbId').value);
    const studentId = document.getElementById('editStudentId').value.trim();
    const password = document.getElementById('editPassword').value;
    const name = document.getElementById('editName').value.trim();
    const email = document.getElementById('editEmail').value.trim();
    const department = document.getElementById('editDepartment').value.trim();
    const company = document.getElementById('editCompany').value.trim();
    const supervisor = document.getElementById('editSupervisor').value.trim();
    
    const errorMsg = document.getElementById('editError');
    const successMsg = document.getElementById('editSuccess');
    
    errorMsg.style.display = 'none';
    successMsg.style.display = 'none';
    
    if (!studentId || !name) {
        errorMsg.textContent = 'Student ID and Name are required.';
        errorMsg.style.display = 'block';
        return;
    }
    
    try {
        const updates = {
            student_id: studentId,
            name: name,
            email: email || null,
            department: department || null,
            company: company || null,
            supervisor: supervisor || null
        };
        
        // Only update password if provided
        if (password) {
            updates.password = password;
        }
        
        if (supabaseClient) {
            const { data, error } = await supabaseClient
                .from('students')
                .update(updates)
                .eq('id', id)
                .select();
            
            if (error) {
                errorMsg.textContent = 'Failed to update student: ' + error.message;
                errorMsg.style.display = 'block';
                return;
            }
        } else {
            // Demo mode
            const demoStudents = JSON.parse(localStorage.getItem('demoStudents')) || [];
            const index = demoStudents.findIndex(s => s.id === id);
            if (index !== -1) {
                demoStudents[index] = { ...demoStudents[index], ...updates };
                localStorage.setItem('demoStudents', JSON.stringify(demoStudents));
            }
        }
        
        successMsg.textContent = 'Student updated successfully!';
        successMsg.style.display = 'block';
        
        setTimeout(() => {
            closeEditModal();
            loadStudents();
        }, 1500);
        
    } catch (error) {
        console.error('Error updating student:', error);
        errorMsg.textContent = 'Failed to update student. Please try again.';
        errorMsg.style.display = 'block';
    }
}

// ============================================
// STUDENT DTR FUNCTIONS (unchanged)
// ============================================

function loadUserInfo() {
    if (!currentUser) return;
    
    document.getElementById('displayName').textContent = currentUser.name || currentUser.student_id || 'Student';
    document.getElementById('displayDepartment').textContent = currentUser.department || 'Department';
    document.getElementById('displayCompany').textContent = currentUser.company || 'Company';
}

function setDefaultDate() {
    const today = new Date().toISOString().split('T')[0];
    const el = document.getElementById('entryDate');
    if (el) el.value = today;
}

function validateTimes() {
    const morningIn = document.getElementById('morningIn').value;
    const morningOut = document.getElementById('morningOut').value;
    const afternoonIn = document.getElementById('afternoonIn').value;
    const afternoonOut = document.getElementById('afternoonOut').value;
    const errorMsg = document.getElementById('errorMessage');

    // Check if at least one session is filled
    const hasMorningSession = morningIn || morningOut;
    const hasAfternoonSession = afternoonIn || afternoonOut;

    if (!hasMorningSession && !hasAfternoonSession) {
        errorMsg.textContent = 'Please fill in at least one session (Morning OR Afternoon).';
        errorMsg.style.display = 'block';
        return false;
    }

    // If morning session is started, both fields must be filled
    if (hasMorningSession && (!morningIn || !morningOut)) {
        errorMsg.textContent = 'Both Morning Time-In and Time-Out are required for morning session.';
        errorMsg.style.display = 'block';
        return false;
    }

    // If afternoon session is started, both fields must be filled
    if (hasAfternoonSession && (!afternoonIn || !afternoonOut)) {
        errorMsg.textContent = 'Both Afternoon Time-In and Time-Out are required for afternoon session.';
        errorMsg.style.display = 'block';
        return false;
    }

    const toMinutes = (time) => {
        const [hours, minutes] = time.split(':').map(Number);
        return hours * 60 + minutes;
    };

    // Validate morning session if present
    if (hasMorningSession) {
        const morningInMin = toMinutes(morningIn);
        const morningOutMin = toMinutes(morningOut);

        if (morningOutMin <= morningInMin) {
            errorMsg.textContent = 'Morning Time-Out must be after Morning Time-In.';
            errorMsg.style.display = 'block';
            return false;
        }
    }

    // Validate afternoon session if present
    if (hasAfternoonSession) {
        const afternoonInMin = toMinutes(afternoonIn);
        const afternoonOutMin = toMinutes(afternoonOut);

        if (afternoonOutMin <= afternoonInMin) {
            errorMsg.textContent = 'Afternoon Time-Out must be after Afternoon Time-In.';
            errorMsg.style.display = 'block';
            return false;
        }
    }

    // If both sessions present, validate afternoon is after morning
    if (hasMorningSession && hasAfternoonSession) {
        const morningOutMin = toMinutes(morningOut);
        const afternoonInMin = toMinutes(afternoonIn);

        if (afternoonInMin <= morningOutMin) {
            errorMsg.textContent = 'Afternoon Time-In must be after Morning Time-Out (lunch break).';
            errorMsg.style.display = 'block';
            return false;
        }
    }

    errorMsg.style.display = 'none';
    return true;
}

function calculateHours(timeIn, timeOut) {
    // Return 0 if either time is missing (half day - this session not worked)
    if (!timeIn || !timeOut) {
        return 0;
    }
    
    const [inHours, inMinutes] = timeIn.split(':').map(Number);
    const [outHours, outMinutes] = timeOut.split(':').map(Number);
    
    const inTotalMinutes = inHours * 60 + inMinutes;
    const outTotalMinutes = outHours * 60 + outMinutes;
    
    const diffMinutes = outTotalMinutes - inTotalMinutes;
    return diffMinutes / 60;
}

async function addEntry() {
    if (!validateTimes()) {
        return;
    }

    const date         = document.getElementById('entryDate').value;
    const morningIn    = document.getElementById('morningIn').value;   // raw — stored as-is
    const morningOut   = document.getElementById('morningOut').value;
    const afternoonIn  = document.getElementById('afternoonIn').value;
    const afternoonOut = document.getElementById('afternoonOut').value;

    const hasMorning   = !!(morningIn && morningOut);
    const hasAfternoon = !!(afternoonIn && afternoonOut);
    const isHalfDayAft = !hasMorning && hasAfternoon;

    let effectiveMorningIn = morningIn; // used ONLY for hour calculation
    let latenessMinutes    = 0;
    let morningStatus      = '';

    if (hasMorning) {
        const { startTime, gracePeriod } = getShiftSettings();
        const result = applyGracePeriod(morningIn, startTime, gracePeriod);

        effectiveMorningIn = result.effectiveTimeIn || morningIn; // normalized for calc
        latenessMinutes    = result.latenessMinutes;
        morningStatus      = result.status;
    } else if (isHalfDayAft) {
        morningStatus = 'Half Day';
    }

    // Hours calculated using effective (normalized) time — accurate deduction
    const morningHours   = calculateHours(effectiveMorningIn, morningOut);
    const afternoonHours = calculateHours(afternoonIn, afternoonOut);
    const dailyHours     = morningHours + afternoonHours;

    const entry = {
        student_id:       currentUser.id,
        date:             date,
        morning_in:       morningIn    || null,  // raw input — what the user actually typed
        morning_out:      morningOut   || null,
        afternoon_in:     afternoonIn  || null,
        afternoon_out:    afternoonOut || null,
        daily_hours:      dailyHours.toFixed(2),
        lateness_minutes: latenessMinutes,
        morning_status:   morningStatus,
        actual_login:     morningIn    || null,  // same as raw morning_in
        created_at:       new Date().toISOString()
    };

    try {
        if (supabaseClient) {
            // Base columns that always exist in the schema
            const baseEntry = {
                student_id:   entry.student_id,
                date:         entry.date,
                morning_in:   entry.morning_in,
                morning_out:  entry.morning_out,
                afternoon_in: entry.afternoon_in,
                afternoon_out:entry.afternoon_out,
                daily_hours:  entry.daily_hours,
                created_at:   entry.created_at
            };

            // Try inserting the full payload (with new columns) first
            let { data, error } = await supabaseClient
                .from('time_records')
                .insert([entry])
                .select();

            // If schema cache error (new columns missing), retry with base columns only
            if (error && (error.code === 'PGRST204' || (error.message && error.message.includes('schema cache')))) {
                console.warn('⚠️ New columns not found in schema — inserting with base columns only.');
                console.warn('📋 Run the SQL migration in your Supabase SQL editor to add lateness_minutes, morning_status, actual_login columns.');
                ({ data, error } = await supabaseClient
                    .from('time_records')
                    .insert([baseEntry])
                    .select());
            }

            if (error) {
                if (error.message && error.message.includes('relation "public.time_records" does not exist')) {
                    console.error('⚠️ DATABASE NOT SET UP: The time_records table does not exist in Supabase.');
                    alert('⚠️ Database tables not found!\n\nPlease create the database tables in Supabase first.\nSee FIX_404_ERROR.md for instructions.');
                    return;
                }
                throw error;
            }
        } else {
            const allRecords = JSON.parse(localStorage.getItem('dtrRecords')) || [];
            entry.id = Date.now();
            allRecords.push(entry);
            localStorage.setItem('dtrRecords', JSON.stringify(allRecords));
        }

        const successMsg = document.getElementById('successMessage');
        successMsg.textContent = `Time entry added! ${morningStatus ? '• ' + morningStatus : ''}`;
        successMsg.style.display = 'block';
        setTimeout(() => { successMsg.style.display = 'none'; }, 3000);

        clearForm();
        loadRecords();
        
    } catch (error) {
        console.error('Error adding entry:', error);
        console.error('Error details:', error.message);
        const errorMsg = document.getElementById('errorMessage');
        errorMsg.textContent = 'Failed to add entry. Please try again.';
        errorMsg.style.display = 'block';
    }
}

async function loadRecords() {
    if (!currentUser) return;
    
    document.getElementById('loadingRecords').style.display = 'block';
    
    try {
        if (supabaseClient) {
            const { data, error } = await supabaseClient
                .from('time_records')
                .select('*')
                .eq('student_id', currentUser.id)
                .order('date', { ascending: false });

            if (error) {
                if (error.message && error.message.includes('relation "public.time_records" does not exist')) {
                    console.error('⚠️ DATABASE NOT SET UP: The time_records table does not exist in Supabase.');
                    console.error('📋 SOLUTION: Run the SQL script to create tables. Check the setup guide.');
                    alert('⚠️ Database tables not found!\n\nPlease create the database tables in Supabase first.\nSee FIX_404_ERROR.md for instructions.');
                    records = [];
                } else {
                    throw error;
                }
            } else {
                records = data || [];
            }
        } else {
            const allRecords = JSON.parse(localStorage.getItem('dtrRecords')) || [];
            records = allRecords.filter(r => r.student_id === currentUser.id);
            records.sort((a, b) => new Date(b.date) - new Date(a.date));
        }
        
        displayRecords();
        updateSummary();
        
    } catch (error) {
        console.error('Error loading records:', error);
        console.error('Error details:', error.message);
        records = [];
        displayRecords();
    } finally {
        document.getElementById('loadingRecords').style.display = 'none';
    }
}

function clearForm() {
    document.getElementById('morningIn').value = '';
    document.getElementById('morningOut').value = '';
    document.getElementById('afternoonIn').value = '';
    document.getElementById('afternoonOut').value = '';
    const preview = document.getElementById('gracePeriodPreview');
    if (preview) preview.style.display = 'none';
    setDefaultDate();
    const em = document.getElementById('errorMessage');
    if (em) em.style.display = 'none';
}

function displayRecords() {
    const tbody = document.getElementById('recordsBody');
    if (!tbody) return;
    
    if (records.length === 0) {
        tbody.innerHTML = '<tr class="no-records"><td colspan="8">No records yet. Add your first time entry above.</td></tr>';
        return;
    }

    tbody.innerHTML = records.map(record => {
        const status        = record.morning_status || '';
        const lateness      = parseInt(record.lateness_minutes) || 0;
        const statusClass   = status === 'On Time'   ? 'on-time'   :
                              status === 'Half Day'  ? 'half-day'  :
                              lateness > 0           ? 'late'       : '';
        const statusBadge   = status
            ? `<span class="status-badge ${statusClass}">${status}</span>`
            : '<span style="color:#ccc;">—</span>';

        return `
        <tr>
            <td>${formatDate(record.date)}</td>
            <td>${formatTime(record.morning_in)}</td>
            <td>${formatTime(record.morning_out)}</td>
            <td>${formatTime(record.afternoon_in)}</td>
            <td>${formatTime(record.afternoon_out)}</td>
            <td>${statusBadge}</td>
            <td><strong>${record.daily_hours} hrs</strong></td>
            <td class="no-print"><button class="delete-btn" onclick="deleteEntry(${record.id})">Delete</button></td>
        </tr>`;
    }).join('');
}

function formatDate(dateString) {
    const date = new Date(dateString + 'T00:00:00');
    const options = { year: 'numeric', month: 'short', day: 'numeric', weekday: 'short' };
    return date.toLocaleDateString('en-US', options);
}

function formatTime(time) {
    if (!time) return '-';
    const [hours, minutes] = time.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
}

async function deleteEntry(id) {
    if (confirm('Are you sure you want to delete this entry?')) {
        try {
            if (supabaseClient) {
                const { error } = await supabaseClient
                    .from('time_records')
                    .delete()
                    .eq('id', id)
                    .eq('student_id', currentUser.id);

                if (error) throw error;
            } else {
                const allRecords = JSON.parse(localStorage.getItem('dtrRecords')) || [];
                const filteredRecords = allRecords.filter(record => !(record.id === id && record.student_id === currentUser.id));
                localStorage.setItem('dtrRecords', JSON.stringify(filteredRecords));
            }

            loadRecords();
        } catch (error) {
            console.error('Error deleting entry:', error);
            alert('Failed to delete entry. Please try again.');
        }
    }
}

function updateSummary() {
    const totalHours = records.reduce((sum, record) => sum + parseFloat(record.daily_hours || 0), 0);
    const totalMins  = Math.round(totalHours * 60);

    const today = new Date();
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    const weeklyHours = records
        .filter(record => {
            const recordDate = new Date(record.date + 'T00:00:00');
            return recordDate >= startOfWeek;
        })
        .reduce((sum, record) => sum + parseFloat(record.daily_hours || 0), 0);
    const weeklyMins = Math.round(weeklyHours * 60);

    // Total accumulated
    const th = document.getElementById('totalHours');
    if (th) th.textContent = totalHours.toFixed(2);
    const tm = document.getElementById('totalMinutes');
    if (tm) tm.textContent = `${totalMins.toLocaleString()} min`;
    const thm = document.getElementById('totalHrsMin');
    if (thm) thm.textContent = minutesToHrsMin(totalMins);

    // Weekly
    const wh = document.getElementById('weeklyHours');
    if (wh) wh.textContent = weeklyHours.toFixed(2);
    const wm = document.getElementById('weeklyMinutes');
    if (wm) wm.textContent = `${weeklyMins.toLocaleString()} min`;
    const whm = document.getElementById('weeklyHrsMin');
    if (whm) whm.textContent = minutesToHrsMin(weeklyMins);

    // Days worked
    const td = document.getElementById('totalDays');
    if (td) td.textContent = records.length;

    // Total lateness
    const lateRecords     = records.filter(r => parseInt(r.lateness_minutes) > 0);
    const totalLateMins   = lateRecords.reduce((sum, r) => sum + (parseInt(r.lateness_minutes) || 0), 0);
    const lateDaysCount   = lateRecords.length;

    const tlm = document.getElementById('totalLateMinutes');
    if (tlm) tlm.textContent = totalLateMins.toLocaleString();

    const tll = document.getElementById('totalLateLabel');
    if (tll) tll.textContent = totalLateMins === 1 ? 'minute late' : 'minutes late';

    const tlhm = document.getElementById('totalLateHrsMin');
    if (tlhm) tlhm.textContent = totalLateMins > 0 ? minutesToHrsMin(totalLateMins) : '—';

    const tld = document.getElementById('totalLateDays');
    if (tld) tld.textContent = `${lateDaysCount} late ${lateDaysCount === 1 ? 'day' : 'days'}`;

    // Tint the late card red if there's any lateness, green if clean
    const lateCard = document.querySelector('.late-card');
    if (lateCard) {
        lateCard.classList.toggle('late-card--dirty', totalLateMins > 0);
        lateCard.classList.toggle('late-card--clean', totalLateMins === 0);
    }
}

function printDTR() {
    window.print();
}
