/*
 * Main script for the Training Planner PWA.
 *
 * This script handles user authentication, plan generation, progress tracking
 * and dynamic updating of the calendar. Plans are stored locally per-user and
 * automatically adapt after each 30‑day cycle. Each day contains a set of
 * exercises with targets (repetitions or minutes) and the user can record
 * what they actually completed. The difference between the target and
 * completion is carried forward to the next day to ensure no exercise is
 * neglected. After a 30‑day cycle ends, a new plan is generated based on
 * the average completion rate: if the user consistently completes most of
 * their workouts, the next plan becomes slightly harder; if not, the plan
 * becomes easier.  Everything persists through reloads via localStorage.
 */

(function() {
    // Wait for DOM to be ready
    document.addEventListener('DOMContentLoaded', () => {
        registerServiceWorker();
        init();
    });

    /**
     * Registers the service worker for offline support.
     */
    function registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('service-worker.js').catch(err => {
                console.warn('Service worker registration failed:', err);
            });
        }
    }

    /**
     * Initialize the app: either show the auth screen or the main app.
     */
    function init() {
        const currentUserName = localStorage.getItem('currentUser');
        const nav = document.getElementById('nav');
        nav.innerHTML = '';
        if (currentUserName) {
            // when a user is logged in, show settings and logout buttons
            // also show a stats button for viewing progress charts
            const statsBtn = document.createElement('button');
            statsBtn.textContent = 'Statistici';
            statsBtn.addEventListener('click', () => {
                const users = getUsers();
                const user = users[currentUserName];
                const plan = getCurrentPlan(user);
                if (plan) {
                    openStatsModal(plan);
                } else {
                    alert('Nu există plan curent pentru a afișa statistici.');
                }
            });
            nav.appendChild(statsBtn);

            // settings button
            const settingsBtn = document.createElement('button');
            settingsBtn.textContent = 'Setări';
            settingsBtn.addEventListener('click', () => {
                openSettingsModal();
            });
            nav.appendChild(settingsBtn);
            // logout button
            const logoutBtn = document.createElement('button');
            logoutBtn.textContent = 'Logout';
            logoutBtn.addEventListener('click', () => {
                localStorage.removeItem('currentUser');
                init();
            });
            nav.appendChild(logoutBtn);
            renderApp();

            // After rendering the app, maybe send a reminder notification for today's workout
            const users = getUsers();
            const user = users[currentUserName];
            if (user) {
                const plan = getCurrentPlan(user);
                if (plan) {
                    maybeSendDailyNotification(plan);
                }
            }
        } else {
            renderAuth();
        }
    }

    /**
     * Opens the settings modal where users can customise their training preferences.
     * Preferences include difficulty (a multiplier applied to exercise targets) and
     * available equipment. Changing these options will affect newly generated plans.
     */
    function openSettingsModal() {
        const modal = document.getElementById('settingsModal');
        const settingsBody = document.getElementById('settingsBody');
        const closeBtn = document.getElementById('closeSettings');
        // Clear previous content
        settingsBody.innerHTML = '';
        // Setup close events
        closeBtn.onclick = () => {
            modal.classList.add('hidden');
        };
        window.onclick = function(event) {
            if (event.target === modal) {
                modal.classList.add('hidden');
            }
        };
        // Retrieve current user and preferences
        const username = localStorage.getItem('currentUser');
        const users = getUsers();
        const user = users[username];
        if (!user) return;
        const prefs = user.preferences || { difficulty: 1.0, equipment: { gantere: true, banda: true, vesta: true } };
        // Title
        const title = document.createElement('h2');
        title.textContent = 'Setări Antrenament';
        settingsBody.appendChild(title);
        // Difficulty selection
        const diffLabel = document.createElement('label');
        diffLabel.textContent = 'Nivel de dificultate:';
        diffLabel.style.display = 'block';
        settingsBody.appendChild(diffLabel);
        const diffSelect = document.createElement('select');
        diffSelect.id = 'difficultySelect';
        const options = [
            { value: 0.8, text: 'Începător (mai ușor)' },
            { value: 1.0, text: 'Intermediar' },
            { value: 1.2, text: 'Avansat (mai greu)' }
        ];
        options.forEach(opt => {
            const option = document.createElement('option');
            option.value = opt.value;
            option.textContent = opt.text;
            if (Math.abs(prefs.difficulty - opt.value) < 0.001) option.selected = true;
            diffSelect.appendChild(option);
        });
        settingsBody.appendChild(diffSelect);
        // Equipment checkboxes
        const equipLabel = document.createElement('label');
        equipLabel.textContent = 'Echipamente disponibile:';
        equipLabel.style.display = 'block';
        equipLabel.style.marginTop = '10px';
        settingsBody.appendChild(equipLabel);
        const equipmentList = [
            { key: 'gantere', label: 'Gantere' },
            { key: 'banda', label: 'Bandă elastică' },
            { key: 'vesta', label: 'Vestă de greutate' }
        ];
        equipmentList.forEach(item => {
            const wrapper = document.createElement('div');
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = `equip_${item.key}`;
            checkbox.checked = prefs.equipment && prefs.equipment[item.key];
            const label = document.createElement('label');
            label.htmlFor = checkbox.id;
            label.textContent = item.label;
            wrapper.appendChild(checkbox);
            wrapper.appendChild(label);
            settingsBody.appendChild(wrapper);
        });
        // Save button
        const saveBtn = document.createElement('button');
        saveBtn.textContent = 'Salvează Preferințele';
        saveBtn.style.marginTop = '15px';
        saveBtn.addEventListener('click', () => {
            // Build preferences object from inputs
            const newPrefs = {
                difficulty: parseFloat(diffSelect.value),
                equipment: {}
            };
            equipmentList.forEach(item => {
                const cb = document.getElementById(`equip_${item.key}`);
                newPrefs.equipment[item.key] = cb.checked;
            });
            // Save to user and persist
            user.preferences = newPrefs;
            users[username] = user;
            saveUsers(users);
            // Inform user that changes will affect next plans
            alert('Preferințele au fost salvate. Modificările vor fi aplicate următorului plan generat.');
            modal.classList.add('hidden');
        });
        settingsBody.appendChild(saveBtn);
        // Show modal
        modal.classList.remove('hidden');
    }

    /**
     * Render authentication screen for login/register.
     */
    function renderAuth() {
        const app = document.getElementById('app');
        app.innerHTML = '';
        const container = document.createElement('div');
        container.className = 'auth-container';
        const heading = document.createElement('h2');
        heading.textContent = 'Conectează-te sau Creează cont';
        container.appendChild(heading);
        const usernameInput = document.createElement('input');
        usernameInput.placeholder = 'Nume utilizator';
        usernameInput.autocomplete = 'username';
        const passwordInput = document.createElement('input');
        passwordInput.placeholder = 'Parolă';
        passwordInput.type = 'password';
        passwordInput.autocomplete = 'current-password';
        const loginBtn = document.createElement('button');
        loginBtn.textContent = 'Autentificare';
        const registerBtn = document.createElement('button');
        registerBtn.textContent = 'Înregistrare';
        // Event listeners
        loginBtn.addEventListener('click', () => {
            const user = usernameInput.value.trim();
            const pass = passwordInput.value;
            if (!user || !pass) return alert('Introdu numele de utilizator și parola.');
            const users = getUsers();
            if (users[user] && users[user].password === pass) {
                localStorage.setItem('currentUser', user);
                init();
            } else {
                alert('Cont inexistent sau parolă incorectă.');
            }
        });
        registerBtn.addEventListener('click', () => {
            const user = usernameInput.value.trim();
            const pass = passwordInput.value;
            if (!user || !pass) return alert('Introdu numele de utilizator și parola.');
            let users = getUsers();
            if (users[user]) {
                alert('Numele de utilizator există deja. Folosește autentificare.');
                return;
            }
            // create user with default preferences
            users[user] = {
                password: pass,
                plans: [],
                preferences: {
                    // default difficulty 1 (intermediate) and all equipment available
                    difficulty: 1.0,
                    equipment: { gantere: true, banda: true, vesta: true }
                }
            };
            saveUsers(users);
            localStorage.setItem('currentUser', user);
            init();
        });
        container.appendChild(usernameInput);
        container.appendChild(passwordInput);
        container.appendChild(loginBtn);
        container.appendChild(registerBtn);
        app.appendChild(container);
    }

    /**
     * Render the main application: calendar view with the current plan.
     */
    function renderApp() {
        const app = document.getElementById('app');
        app.innerHTML = '';
        const currentUserName = localStorage.getItem('currentUser');
        const users = getUsers();
        const user = users[currentUserName];
        if (!user) {
            // If user data is missing (corrupted storage), reset
            localStorage.removeItem('currentUser');
            return init();
        }
        // Get or create current plan
        let plan = getCurrentPlan(user);
        if (!plan) {
            // create new plan using user preferences
            const prefs = user.preferences || { difficulty: 1.0, equipment: {} };
            const difficulty = prefs.difficulty || 1.0;
            plan = createPlan(new Date(), difficulty, prefs);
            user.plans.push(plan);
            saveUsers(users);
        }
        // Render header and calendar
        const heading = document.createElement('h2');
        const startDate = new Date(plan.startDate);
        const endDate = new Date(plan.endDate);
        heading.textContent = `Ciclu curent: ${formatDate(startDate)} - ${formatDate(endDate)}`;
        app.appendChild(heading);
        const calendar = document.createElement('div');
        calendar.className = 'calendar';
        plan.days.forEach((day, index) => {
            const dayDiv = document.createElement('div');
            dayDiv.className = 'day';
            const date = new Date(startDate);
            date.setDate(startDate.getDate() + index);
            const title = document.createElement('h3');
            title.textContent = `${formatDay(date)} ${date.getDate()}`;
            dayDiv.appendChild(title);
            // Progress bar
            const bar = document.createElement('div');
            bar.className = 'progress-bar';
            const inner = document.createElement('div');
            inner.className = 'progress-bar-inner';
            const completion = calculateDayCompletion(day);
            inner.style.width = `${Math.min(100, Math.round(completion * 100))}%`;
            bar.appendChild(inner);
            dayDiv.appendChild(bar);
            // Badge
            const badge = document.createElement('div');
            badge.className = 'badge';
            // Determine badge color/class
            const percent = completion * 100;
            if (percent >= 100) {
                badge.classList.add('badge-100');
                badge.textContent = '100%';
            } else if (percent >= 50) {
                badge.classList.add('badge-50');
                badge.textContent = '≥50%';
            } else if (percent >= 30) {
                badge.classList.add('badge-30');
                badge.textContent = '≥30%';
            } else if (percent > 0) {
                badge.classList.add('badge-10');
                badge.textContent = '>0%';
            } else {
                badge.textContent = '0%';
            }
            dayDiv.appendChild(badge);
            // Click event to open modal
            dayDiv.addEventListener('click', () => {
                openDayModal(user, plan, index);
            });
            calendar.appendChild(dayDiv);
        });
        app.appendChild(calendar);
    }

    /**
     * Opens the modal for a particular day to view/record details.
     * @param {Object} user - The current user object.
     * @param {Object} plan - The current plan object.
     * @param {number} dayIndex - Index of the day in the plan.
     */
    function openDayModal(user, plan, dayIndex) {
        const modal = document.getElementById('modal');
        const modalBody = document.getElementById('modalBody');
        const closeBtn = document.getElementById('closeModal');
        modalBody.innerHTML = '';
        // Setup close
        closeBtn.onclick = () => {
            modal.classList.add('hidden');
        };
        window.onclick = function(event) {
            if (event.target === modal) {
                modal.classList.add('hidden');
            }
        };
        // Determine day and tasks
        const day = plan.days[dayIndex];
        const date = new Date(plan.startDate);
        date.setDate(date.getDate() + dayIndex);
        const header = document.createElement('h2');
        header.textContent = `${formatDay(date)}, ${formatDate(date)}`;
        modalBody.appendChild(header);
        // Task list
        const taskContainer = document.createElement('div');
        day.exercises.forEach((ex, idx) => {
            const taskDiv = document.createElement('div');
            taskDiv.className = 'task';
            const label = document.createElement('label');
            label.textContent = ex.name;
            const input = document.createElement('input');
            input.type = 'number';
            input.min = 0;
            input.value = ex.completed || 0;
            input.dataset.index = idx;
            const unitSpan = document.createElement('span');
            unitSpan.className = 'unit';
            unitSpan.textContent = ex.unit;
            taskDiv.appendChild(label);
            taskDiv.appendChild(input);
            taskDiv.appendChild(unitSpan);
            if (ex.description) {
                const desc = document.createElement('p');
                desc.className = 'desc';
                desc.textContent = ex.description;
                taskDiv.appendChild(desc);
            }
            taskContainer.appendChild(taskDiv);
        });
        modalBody.appendChild(taskContainer);
        // Feedback box
        const feedbackLabel = document.createElement('label');
        feedbackLabel.textContent = 'Feedback (opțional):';
        feedbackLabel.style.display = 'block';
        modalBody.appendChild(feedbackLabel);
        const feedbackInput = document.createElement('textarea');
        feedbackInput.id = 'feedback';
        feedbackInput.value = day.feedback || '';
        modalBody.appendChild(feedbackInput);
        // Footer with actions
        const footer = document.createElement('div');
        footer.className = 'modal-footer';
        const saveBtn = document.createElement('button');
        saveBtn.textContent = 'Salvează';
        saveBtn.addEventListener('click', () => {
            // Collect completed values
            const inputs = taskContainer.querySelectorAll('input');
            const completedTasks = [];
            inputs.forEach(inp => {
                const idx = parseInt(inp.dataset.index);
                const val = Number(inp.value);
                completedTasks[idx] = val;
            });
            const feedback = feedbackInput.value.trim();
            // Update day and possibly plan
            updateDayCompletion(user, plan, dayIndex, completedTasks, feedback);
            // Save changes and re-render calendar
        // Save the modified user back to localStorage
        const allUsers = getUsers();
        const username = localStorage.getItem('currentUser');
        if (username) {
            allUsers[username] = user;
        }
        saveUsers(allUsers);
        // Hide modal and re-render calendar to reflect new completion status
        modal.classList.add('hidden');
        renderApp();
        });
        // Option for marking missed day (skip)
        const skipBtn = document.createElement('button');
        skipBtn.textContent = 'Nu am lucrat';
        skipBtn.style.backgroundColor = '#9e9e9e';
        skipBtn.addEventListener('click', () => {
            // Mark as no work done: zero completed, but maybe feedback
            const zeroCompleted = day.exercises.map(() => 0);
            const feedback = feedbackInput.value.trim() || 'N/A';
            updateDayCompletion(user, plan, dayIndex, zeroCompleted, feedback);
        // Save the modified user back to localStorage
        const allUsers = getUsers();
        const username = localStorage.getItem('currentUser');
        if (username) {
            allUsers[username] = user;
        }
        saveUsers(allUsers);
        // Hide modal and re-render
        modal.classList.add('hidden');
        renderApp();
        });
        footer.appendChild(skipBtn);
        footer.appendChild(saveBtn);
        modalBody.appendChild(footer);
        modal.classList.remove('hidden');
    }

    /**
     * Update the completion for a given day, carry over unfinished exercises and adapt plan if cycle ended.
     * @param {Object} user - Current user object
     * @param {Object} plan - Current plan object
     * @param {number} dayIndex - Index of the day being updated
     * @param {Array<number>} completedArray - Array of completed quantities for each exercise
     * @param {string} feedback - Optional feedback text
     */
    function updateDayCompletion(user, plan, dayIndex, completedArray, feedback) {
        const day = plan.days[dayIndex];
        day.feedback = feedback;
        let carryOver = [];
        day.exercises.forEach((ex, idx) => {
            const completed = Math.max(0, Number(completedArray[idx] || 0));
            ex.completed = completed;
            // Determine if there is unfinished volume to carry over
            const remaining = (ex.target || 0) - completed;
            if (remaining > 0) {
                // Create a new exercise entry for next day
                carryOver.push({
                    name: ex.name + ' (recuperare)',
                    target: remaining,
                    unit: ex.unit,
                    description: `Recuperează seturile nefinalizate de ${ex.name}`,
                    completed: 0
                });
            }
        });
        // If carryOver exists and not last day, add to next day's exercises
        if (carryOver.length > 0 && dayIndex < plan.days.length - 1) {
            plan.days[dayIndex + 1].exercises = plan.days[dayIndex + 1].exercises.concat(carryOver);
        }
        // Mark day completion percentage for later calculations (optional)
        day.completion = calculateDayCompletion(day);
        // Check if cycle ended and adapt if needed
        const todayIndex = dayIndex;
        if (todayIndex >= plan.days.length - 1) {
            // Completed last day -> generate new plan based on performance
            const difficultyFactor = determineNextDifficulty(plan);
            const nextStartDate = new Date(plan.endDate);
            nextStartDate.setDate(nextStartDate.getDate() + 1);
            // incorporate user preferences (difficulty and equipment)
            const prefs = user.preferences || { difficulty: 1.0, equipment: {} };
            // overall difficulty = prefs.difficulty * dynamic factor
            const combinedDifficulty = (prefs.difficulty || 1.0) * difficultyFactor;
            const newPlan = createPlan(nextStartDate, combinedDifficulty, prefs);
            user.plans.push(newPlan);
        }
    }

    /**
     * Determine the difficulty factor for the next plan based on the current plan's performance.
     * Returns a multiplier: >1 means harder, <1 means easier, 1 means same.
     * @param {Object} plan - The plan to evaluate
     */
    function determineNextDifficulty(plan) {
        // Compute average completion across all days
        let sum = 0;
        plan.days.forEach(d => {
            sum += calculateDayCompletion(d);
        });
        const avg = sum / plan.days.length;
        // If average completion is above 80%, increase difficulty by 10%
        if (avg >= 0.8) return 1.1;
        // If average completion is below 50%, decrease difficulty by 20%
        if (avg < 0.5) return 0.8;
        // Otherwise keep same difficulty
        return 1.0;
    }

    /**
     * Get the current plan for the user or null if none.
     * @param {Object} user - The user object
     */
    function getCurrentPlan(user) {
        if (!user.plans || user.plans.length === 0) return null;
        // get last plan
        const plan = user.plans[user.plans.length - 1];
        const endDate = new Date(plan.endDate);
        const today = new Date();
        // If plan ended before today, return null
        if (today > endDate) return null;
        return plan;
    }

    /**
     * Creates a new 30‑day plan starting from startDate with a difficulty factor applied to targets.
     * @param {Date} startDate - Date to begin the plan
     * @param {number} difficulty - Multiplier for exercise targets
     */
    function createPlan(startDate, difficulty = 1.0, preferences = null) {
        const plan = {
            startDate: startDate.toISOString().substring(0, 10),
            days: [],
            difficulty: difficulty
        };
        // 30 days plan
        for (let i = 0; i < 30; i++) {
            const templateExercises = getDayTemplate(i % 7);
            const dayExercises = templateExercises.map(ex => {
                // Clone template exercise to avoid mutating original
                let cloned = {
                    name: ex.name,
                    target: ex.target,
                    unit: ex.unit,
                    description: ex.description,
                    equipment: ex.equipment ? JSON.parse(JSON.stringify(ex.equipment)) : undefined
                };
                // Adapt exercise based on equipment preferences
                if (preferences && preferences.equipment) {
                    cloned = adaptExerciseForEquipment(cloned, preferences.equipment);
                }
                // Apply difficulty factor to numeric targets (skip for rest unit or already zero)
                let newTarget = cloned.target;
                if (cloned.unit !== 'rest' && newTarget > 0) {
                    newTarget = Math.max(1, Math.round(newTarget * difficulty));
                }
                return {
                    name: cloned.name,
                    target: newTarget,
                    unit: cloned.unit,
                    description: cloned.description,
                    equipment: cloned.equipment,
                    completed: 0
                };
            });
            plan.days.push({ exercises: dayExercises, feedback: '', completion: 0 });
        }
        // compute end date (startDate + 29 days)
        const end = new Date(startDate);
        end.setDate(end.getDate() + 29);
        plan.endDate = end.toISOString().substring(0, 10);
        return plan;
    }

    /**
     * Provides a template of exercises for a day of the week.
     * Days are numbered 0 (Luni) through 6 (Duminică) following the pattern described in the specification.
     * Each exercise has a base target; difficulty will scale these numbers.
     *
     * @param {number} dayIndex - Index from 0 to 6
     */
    function getDayTemplate(dayIndex) {
        switch(dayIndex) {
            case 0: // Luni - Push + lower body
                return [
                    { name: 'Genuflexiuni cu gantere', target: 30, unit: 'reps', description: '3 seturi a 10 genuflexiuni cu gantere.', equipment: ['gantere'] },
                    { name: 'Flotări clasice', target: 40, unit: 'reps', description: '4 seturi de flotări standard.', equipment: [] },
                    { name: 'Shoulder press cu gantere', target: 24, unit: 'reps', description: '3 seturi a 8 ridicări deasupra capului.', equipment: ['gantere'] },
                    { name: 'Flotări diamante', target: 20, unit: 'reps', description: '2 seturi a 10 flotări cu palmele apropiate.', equipment: [] },
                    { name: 'Plank', target: 60, unit: 'sec', description: '3 planșe de câte 20 de secunde.', equipment: [] }
                ];
            case 1: // Marți - Pull + spate/biceps
                return [
                    { name: 'Tracțiuni asistate', target: 15, unit: 'reps', description: 'Folosind o bandă elastică, efectuează 3 seturi a 5 tracțiuni.', equipment: ['banda'] },
                    { name: 'Tracțiuni negative', target: 10, unit: 'reps', description: 'Sari la bară și coboară lent, 2-3 secunde pe repetare.', equipment: [] },
                    { name: 'Ramat cu gantera', target: 30, unit: 'reps', description: '3 seturi a 10 pentru fiecare braț.', equipment: ['gantere'] },
                    { name: 'Biceps curls', target: 30, unit: 'reps', description: '3 seturi a 10 flexii cu gantere.', equipment: ['gantere'] },
                    { name: 'Plank lateral', target: 60, unit: 'sec', description: '2 seturi, 30 de secunde pe fiecare parte.', equipment: [] }
                ];
            case 2: // Miercuri - Cardio + mobilitate
                return [
                    { name: 'Mers înclinat', target: 30, unit: 'min', description: '30 de minute de mers alert pe bandă înclinată sau în aer liber.', equipment: [] },
                    { name: 'Stretching', target: 10, unit: 'min', description: '10 minute de stretching și mobilitate.', equipment: [] }
                ];
            case 3: // Joi - Push variat
                return [
                    { name: 'Fandări', target: 40, unit: 'reps', description: '20 pe fiecare picior, 2 seturi.', equipment: [] },
                    { name: 'Flotări declinate', target: 30, unit: 'reps', description: '3 seturi a 10 flotări cu picioarele ridicate.', equipment: [] },
                    { name: 'Flotări la spalier', target: 24, unit: 'reps', description: '2 seturi a 12 flotări la spalier sau perete.', equipment: [] },
                    { name: 'Extensii triceps', target: 30, unit: 'reps', description: '3 seturi a 10 extensii cu gantera sau bandă.', equipment: ['gantere','banda'] },
                    { name: 'Abdomene mixte', target: 30, unit: 'reps', description: 'Combinații de crunch-uri și ridicări de picioare.', equipment: [] }
                ];
            case 4: // Vineri - Pull variat
                return [
                    { name: 'Tracțiuni negative', target: 10, unit: 'reps', description: 'Încetinește coborârea cât poți.', equipment: [] },
                    { name: 'Tracțiuni asistate', target: 15, unit: 'reps', description: 'Bandă elastică cu rezistență medie, 3 seturi.', equipment: ['banda'] },
                    { name: 'Ramat inversat', target: 30, unit: 'reps', description: '3 seturi a 10 la spalier sau bară joasă.', equipment: [] },
                    { name: 'Hammer curls', target: 24, unit: 'reps', description: '2 seturi a 12 cu gantere.', equipment: ['gantere'] },
                    { name: 'Ridicări genunchi atârnat', target: 20, unit: 'reps', description: '3 seturi a 5-8 ridicări de genunchi.', equipment: [] }
                ];
            case 5: // Sâmbătă - Cardio II
                return [
                    { name: 'Alergare + mers', target: 30, unit: 'min', description: '20 minute alergare ușoară, 10 minute mers.', equipment: [] },
                    { name: 'Stretching', target: 15, unit: 'min', description: 'Stretching amplu pentru tot corpul.', equipment: [] }
                ];
            case 6: // Duminică - Odihnă
                return [
                    { name: 'Odihnă completă', target: 1, unit: 'rest', description: 'Relaxează-te, hidratează-te și pregătește-te pentru săptămâna următoare.' }
                ];
            default:
                return [];
        }
    }

    /**
     * Calculates completion percentage for a given day based on exercises and their completion.
     * @param {Object} day - The day object containing exercises
     * @returns {number} value between 0 and 1
     */
    function calculateDayCompletion(day) {
        const exercises = day.exercises;
        if (!exercises || exercises.length === 0) return 0;
        let total = 0;
        let done = 0;
        exercises.forEach(ex => {
            // For 'rest' unit we treat as done if completed >=1
            if (ex.unit === 'rest') {
                total += 1;
                done += (ex.completed && ex.completed > 0) ? 1 : 0;
            } else {
                total += ex.target;
                done += Math.min(ex.completed || 0, ex.target);
            }
        });
        if (total === 0) return 0;
        return done / total;
    }

    /**
     * Adapt an exercise based on equipment availability. If the exercise requires
     * equipment that the user does not have, reduce the target by half and mark
     * the description and name accordingly. This helps users without certain
     * equipment still perform a version of the exercise. If all required
     * equipment is available, the exercise is returned unchanged.
     *
     * @param {Object} exercise - The exercise object with a possible 'equipment' array
     * @param {Object} equipmentPrefs - Object with equipment keys and boolean values
     * @returns {Object} new exercise object
     */
    function adaptExerciseForEquipment(exercise, equipmentPrefs) {
        // If no equipment specified, nothing to adapt
        if (!exercise || !exercise.equipment || exercise.equipment.length === 0) {
            return exercise;
        }
        // Check if user has all required equipment
        let allAvailable = true;
        exercise.equipment.forEach(eq => {
            if (!equipmentPrefs || !equipmentPrefs[eq]) {
                allAvailable = false;
            }
        });
        if (allAvailable) {
            return exercise;
        }
        // If missing equipment, adapt: reduce target by 50% and update name/description
        const adapted = Object.assign({}, exercise);
        if (typeof adapted.target === 'number') {
            adapted.target = Math.max(1, Math.round(adapted.target * 0.5));
        }
        adapted.name = `${exercise.name} (adaptat)`;
        adapted.description = `${exercise.description || ''} (adaptat pentru lipsa echipamentului)`;
        return adapted;
    }

    /**
     * Open a modal displaying a bar chart of daily completion percentages for the current plan.
     * Uses Chart.js to render a simple bar chart. The chart plots each day of the 30‑day plan
     * on the X axis and the completion percentage (0–100%) on the Y axis. A new canvas is
     * generated each time to avoid reusing old charts.
     *
     * @param {Object} plan - The plan object containing days and start date
     */
    function openStatsModal(plan) {
        const modal = document.getElementById('statsModal');
        const statsBody = document.getElementById('statsBody');
        const closeBtn = document.getElementById('closeStats');
        // Set up close events
        closeBtn.onclick = () => {
            modal.classList.add('hidden');
        };
        window.onclick = function(event) {
            if (event.target === modal) {
                modal.classList.add('hidden');
            }
        };
        // Generate labels and data
        const labels = [];
        const data = [];
        const start = new Date(plan.startDate);
        plan.days.forEach((day, idx) => {
            const date = new Date(start);
            date.setDate(start.getDate() + idx);
            labels.push(formatDate(date));
            data.push(Math.round(calculateDayCompletion(day) * 100));
        });
        // Clear previous content and create canvas
        statsBody.innerHTML = '';
        const canvas = document.createElement('canvas');
        canvas.id = 'progressChart';
        canvas.width = 400;
        canvas.height = 200;
        statsBody.appendChild(canvas);
        const ctx = canvas.getContext('2d');
        // Destroy any existing chart to avoid duplicates
        if (window.currentStatsChart && typeof window.currentStatsChart.destroy === 'function') {
            window.currentStatsChart.destroy();
        }
        window.currentStatsChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: '% Completare',
                    data: data,
                    backgroundColor: '#1976d2',
                    borderColor: '#135ca1',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 100,
                        title: {
                            display: true,
                            text: 'Procent completare'
                        }
                    },
                    x: {
                        ticks: {
                            maxRotation: 90,
                            minRotation: 45,
                            autoSkip: true,
                            maxTicksLimit: 10
                        }
                    }
                }
            }
        });
        // Show modal
        modal.classList.remove('hidden');
    }

    /**
     * Sends a browser notification reminding the user to complete today's workout
     * if there are uncompleted exercises for the current day. It requests
     * notification permission if not yet granted. Notifications will not be
     * shown if the current day is outside the plan, or if the plan is fully
     * completed for today. This runs when the app initializes after login.
     *
     * @param {Object} plan - The current plan
     */
    function maybeSendDailyNotification(plan) {
        if (!('Notification' in window)) return;
        // Request permission if needed
        if (Notification.permission === 'default') {
            Notification.requestPermission().then(() => {
                // After permission, call again to maybe send
                maybeSendDailyNotification(plan);
            });
            return;
        }
        if (Notification.permission !== 'granted') return;
        // Determine today's index in plan
        const today = new Date();
        const start = new Date(plan.startDate);
        // zero out hours to compare dates (floor to 00:00)
        today.setHours(0, 0, 0, 0);
        start.setHours(0, 0, 0, 0);
        const diff = Math.floor((today - start) / (1000 * 60 * 60 * 24));
        if (diff < 0 || diff >= plan.days.length) return; // out of range
        const day = plan.days[diff];
        const completion = calculateDayCompletion(day);
        if (completion < 1) {
            try {
                new Notification('Antrenament disponibil astăzi', {
                    body: 'Deschide aplicația și înregistrează-ți progresul.',
                    icon: '/icons/icon-192.png'
                });
            } catch (err) {
                // On some browsers, Notification may need service worker context
                console.warn('Unable to send notification:', err);
            }
        }
    }

    /**
     * Return an object mapping usernames to user data from localStorage.
     */
    function getUsers() {
        try {
            const str = localStorage.getItem('users');
            return str ? JSON.parse(str) : {};
        } catch (e) {
            console.warn('Unable to parse users:', e);
            return {};
        }
    }

    /**
     * Save the users object back to localStorage.
     * @param {Object} users - Users object to save
     */
    function saveUsers(users) {
        localStorage.setItem('users', JSON.stringify(users));
    }

    /**
     * Format a date object into DD/MM/YYYY.
     */
    function formatDate(date) {
        const d = new Date(date);
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();
        return `${day}/${month}/${year}`;
    }

    /**
     * Format date into localized day-of-week name (Romanian).
     */
    function formatDay(date) {
        const days = ['Luni', 'Marți', 'Miercuri', 'Joi', 'Vineri', 'Sâmbătă', 'Duminică'];
        return days[date.getDay() === 0 ? 6 : date.getDay() - 1];
    }

})();