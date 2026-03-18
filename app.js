const app = {
    data: {
        animals: [],
        foodBags: [],
        archivedBags: [],
        weightLogs: {},        // { animalId: [{date, weight}] }
        consumptionHistory: [], // [{date, bagId, consumed}] — snapshot journalier
        currentUser: null,
        isOffline: false,
        db: null,
        currentSection: 'animals',
        lastCalculationDate: null
    },

    init() {
        this.loadFromLocalStorage();
        this.setupFirebase();
        this.checkAuthState();
        this.setupNetworkListeners();
        this.startDailyCalculation();

        const today = new Date().toISOString().split('T')[0];
        document.getElementById('animalBirthDate').value = today;
        document.getElementById('foodBagPurchaseDate').value = today;

        document.addEventListener('touchmove', function(e) {
            if (e.target.closest('.modal-content')) return;
            if (e.target.closest('.content')) return;
            e.preventDefault();
        }, { passive: false });

        this.checkDailyConsumption();
    },

    setupFirebase() {
        const firebaseConfig = {
            apiKey: "AIzaSyC74xW13wbXfyHrKu3DjJYwy-Nm4cO5n4g",
            authDomain: "krokets-ca695.firebaseapp.com",
            projectId: "krokets-ca695",
            storageBucket: "krokets-ca695.firebasestorage.app",
            messagingSenderId: "214999482185",
            appId: "1:214999482185:web:d098d28ca802aba2492498"
        };
        if (typeof firebase !== 'undefined') {
            firebase.initializeApp(firebaseConfig);
            this.data.db = firebase.firestore();
        }
    },

    checkAuthState() {
        const savedUser = localStorage.getItem('petcare_user');
        if (savedUser) {
            this.data.currentUser = JSON.parse(savedUser);
            this.showMainApp();
        }
    },

    setupNetworkListeners() {
        window.addEventListener('online', () => this.updateSyncStatus('online'));
        window.addEventListener('offline', () => this.updateSyncStatus('offline'));
        if (!navigator.onLine) this.updateSyncStatus('offline');
    },

    updateSyncStatus(status) {
        const el = document.getElementById('syncIndicator');
        const dot = document.getElementById('syncDot');
        const text = document.getElementById('syncText');
        el.classList.add('show');
        dot.className = 'sync-dot ' + status;
        if (status === 'online') {
            text.textContent = 'Synchronisé';
            setTimeout(() => el.classList.remove('show'), 2000);
        } else if (status === 'offline') {
            text.textContent = 'Hors ligne';
        } else if (status === 'syncing') {
            text.textContent = 'Synchronisation...';
        }
    },

    startDailyCalculation() {
        setInterval(() => this.checkDailyConsumption(), 60000);
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') this.checkDailyConsumption();
        });
    },

    checkDailyConsumption() {
        const today = new Date().toISOString().split('T')[0];
        const lastCalc = this.data.lastCalculationDate;
        if (lastCalc === today) return;
        let daysToCalculate = 1;
        if (lastCalc) {
            const lastDate = new Date(lastCalc);
            const todayDate = new Date(today);
            daysToCalculate = Math.ceil(Math.abs(todayDate - lastDate) / 86400000);
            if (daysToCalculate > 30) daysToCalculate = 30;
        }
        for (let i = 0; i < daysToCalculate; i++) {
            const dateStr = this._dateOffset(today, -(daysToCalculate - 1 - i));
            this.deductDailyConsumption(dateStr);
        }
        this.data.lastCalculationDate = today;
        // Garder seulement les 30 derniers jours d'historique
        const cutoff = this._dateOffset(today, -30);
        this.data.consumptionHistory = (this.data.consumptionHistory || [])
            .filter(h => h.date >= cutoff);
        this.saveToLocalStorage();
        this.syncToCloud();
        this.renderAll();
    },

    _dateOffset(dateStr, days) {
        const d = new Date(dateStr);
        d.setDate(d.getDate() + days);
        return d.toISOString().split('T')[0];
    },

    deductDailyConsumption(dateStr) {
        this.data.foodBags.forEach(bag => {
            const associated = this.data.animals.filter(a => a.foodBagId === bag.id);
            if (associated.length === 0) return;
            const dailyKg = associated.reduce((sum, a) => sum + (parseFloat(a.dailyFood) / 1000), 0);
            let newRemaining = parseFloat(bag.remaining) - dailyKg;
            if (newRemaining < 0) newRemaining = 0;
            bag.remaining = newRemaining.toFixed(3);
            // Enregistrer dans l'historique de consommation
            if (dateStr) {
                if (!this.data.consumptionHistory) this.data.consumptionHistory = [];
                this.data.consumptionHistory.push({ date: dateStr, bagId: bag.id, consumed: dailyKg });
            }
        });
    },

    // ─── AUTH ─────────────────────────────────────────────────────────────────

    async signInWithGoogle() {
        try {
            if (typeof firebase === 'undefined' || !firebase.apps.length) {
                alert("Firebase non disponible. Mode hors ligne activé.");
                this.useOfflineMode();
                return;
            }
            const provider = new firebase.auth.GoogleAuthProvider();
            const result = await firebase.auth().signInWithPopup(provider);
            this.data.currentUser = result.user;
            localStorage.setItem('petcare_user', JSON.stringify({
                uid: result.user.uid, displayName: result.user.displayName,
                email: result.user.email, photoURL: result.user.photoURL
            }));
            await this.syncFromCloud();
            this.showMainApp();
        } catch (error) { alert("Erreur de connexion: " + error.message); }
    },

    useOfflineMode() {
        this.data.isOffline = true;
        this.data.currentUser = { uid: 'local', displayName: 'Local' };
        this.showMainApp();
        this.updateSyncStatus('offline');
    },

    signOut() {
        if (confirm("Déconnexion ?")) {
            localStorage.removeItem('petcare_user');
            localStorage.removeItem('petcare_data');
            location.reload();
        }
    },

    showMainApp() {
        document.getElementById('authScreen').classList.add('hidden');
        document.getElementById('mainApp').classList.remove('hidden');
        this.renderAll();
    },

    // ─── STORAGE ──────────────────────────────────────────────────────────────

    loadFromLocalStorage() {
        const saved = localStorage.getItem('petcare_data');
        if (saved) {
            const data = JSON.parse(saved);
            this.data.animals = data.animals || [];
            this.data.foodBags = data.foodBags || [];
            this.data.archivedBags = data.archivedBags || [];
            this.data.weightLogs = data.weightLogs || {};
            this.data.consumptionHistory = data.consumptionHistory || [];
            this.data.lastCalculationDate = data.lastCalculationDate || null;
        }
        this.data.animals.forEach(animal => {
            const photo = localStorage.getItem('petcare_photo_' + animal.id);
            if (photo) animal.photo = photo;
        });
    },

    saveToLocalStorage() {
        const animalsWithoutPhotos = this.data.animals.map(({ photo, ...rest }) => rest);
        try {
            localStorage.setItem('petcare_data', JSON.stringify({
                animals: animalsWithoutPhotos,
                foodBags: this.data.foodBags,
                archivedBags: this.data.archivedBags,
                weightLogs: this.data.weightLogs,
                consumptionHistory: this.data.consumptionHistory,
                lastCalculationDate: this.data.lastCalculationDate
            }));
        } catch (e) { console.error('localStorage quota exceeded:', e); }
        this.data.animals.forEach(animal => {
            if (animal.photo) {
                try { localStorage.setItem('petcare_photo_' + animal.id, animal.photo); }
                catch (e) { console.warn('Photo trop grande pour localStorage:', animal.name); }
            }
        });
    },

    async syncToCloud() {
        if (this.data.isOffline || !this.data.db) return;
        this.updateSyncStatus('syncing');
        try {
            const animalsWithoutPhotos = this.data.animals.map(({ photo, ...rest }) => rest);
            await this.data.db.collection('users').doc(this.data.currentUser.uid).set({
                animals: animalsWithoutPhotos,
                foodBags: this.data.foodBags,
                archivedBags: this.data.archivedBags,
                weightLogs: this.data.weightLogs,
                consumptionHistory: this.data.consumptionHistory,
                lastCalculationDate: this.data.lastCalculationDate,
                lastUpdate: new Date()
            });
            this.updateSyncStatus('online');
        } catch (error) { this.updateSyncStatus('offline'); }
    },

    async syncFromCloud() {
        if (this.data.isOffline || !this.data.db) return;
        try {
            const doc = await this.data.db.collection('users').doc(this.data.currentUser.uid).get();
            if (doc.exists) {
                const data = doc.data();
                this.data.animals = data.animals || [];
                this.data.foodBags = data.foodBags || [];
                this.data.archivedBags = data.archivedBags || [];
                this.data.weightLogs = data.weightLogs || {};
                this.data.consumptionHistory = data.consumptionHistory || [];
                this.data.lastCalculationDate = data.lastCalculationDate || null;
                this.data.animals.forEach(animal => {
                    const photo = localStorage.getItem('petcare_photo_' + animal.id);
                    if (photo) animal.photo = photo;
                });
                this.saveToLocalStorage();
                this.renderAll();
            }
        } catch (error) { console.error("Sync error:", error); }
    },

    // ─── NAVIGATION ───────────────────────────────────────────────────────────

    showSection(section, event) {
        if (event) event.preventDefault();
        this.data.currentSection = section;
        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
        event.target.closest('.nav-item').classList.add('active');
        document.querySelectorAll('.section').forEach(el => el.classList.remove('active'));
        document.getElementById(section + 'Section').classList.add('active');
        const titles = { animals: 'Mes Animaux', food: 'Croquettes', stats: 'Statistiques' };
        document.getElementById('pageTitle').textContent = titles[section];
        if (section === 'stats') this.renderStats();
    },

    showAddModal() {
        if (this.data.currentSection === 'animals') this.showAddAnimal();
        else if (this.data.currentSection === 'food') this.showAddFoodBag();
    },

    // ─── PHOTO HANDLING ───────────────────────────────────────────────────────

    triggerPhotoSelect() { document.getElementById('animalPhoto').click(); },

    handlePhotoSelect(event) {
        const file = event.target.files[0];
        if (!file) return;
        if (file.size > 10 * 1024 * 1024) { alert('Image trop grande. Maximum 10MB.'); return; }
        this.compressImage(file, 400, 0.75, (compressedData) => {
            document.getElementById('animalPhotoData').value = compressedData;
            const preview = document.getElementById('photoPreview');
            preview.src = compressedData;
            preview.classList.remove('hidden');
            document.getElementById('photoPlaceholder').classList.add('hidden');
            document.getElementById('photoUploadContainer').classList.add('has-image');
            document.getElementById('photoChangeBtn').classList.remove('hidden');
            document.getElementById('photoHint').textContent = 'Appuyez sur la photo pour changer';
        });
    },

    compressImage(file, maxSize, quality, callback) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let w = img.width, h = img.height;
                if (w > h) { if (w > maxSize) { h = Math.round(h * maxSize / w); w = maxSize; } }
                else { if (h > maxSize) { w = Math.round(w * maxSize / h); h = maxSize; } }
                canvas.width = w; canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                callback(canvas.toDataURL('image/jpeg', quality));
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    },

    changePhoto() { document.getElementById('animalPhoto').click(); },
    openModal(id) { document.getElementById(id).classList.add('active'); document.body.style.overflow = 'hidden'; },
    closeModal(id) {
        document.getElementById(id).classList.remove('active');
        document.body.style.overflow = '';
        if (id === 'animalModal') setTimeout(() => { document.getElementById('animalPhoto').value = ''; }, 300);
    },
    closeModalOnOverlay(event, modalId) { if (event.target === event.currentTarget) this.closeModal(modalId); },

    // ─── ANIMALS ──────────────────────────────────────────────────────────────

    renderAnimals() {
        const container = document.getElementById('animalsList');

        // ── Rappels de réapprovisionnement ──
        const alerts = this._getRestockAlerts();
        let alertBanner = '';
        if (alerts.length > 0) {
            alertBanner = `
                <div class="restock-banner">
                    <div class="restock-banner-icon">🛒</div>
                    <div class="restock-banner-content">
                        <div class="restock-banner-title">Réapprovisionnement nécessaire</div>
                        ${alerts.map(a => `
                            <div class="restock-banner-item">
                                <span class="restock-dot ${a.urgent ? 'urgent' : 'warning'}"></span>
                                <span><strong>${a.bagName}</strong> — ${a.message}</span>
                            </div>`).join('')}
                    </div>
                </div>`;
        }

        if (this.data.animals.length === 0) {
            container.innerHTML = alertBanner + `
                <div class="empty-state">
                    <div class="empty-icon"><img src="icon3.png" alt="Krokets" onerror="this.style.display='none'; this.parentElement.textContent='🐾'"></div>
                    <div class="empty-title">Aucun animal</div>
                    <div class="empty-text">Commencez par ajouter votre compagnon à quatre pattes</div>
                    <button class="btn btn-primary" onclick="app.showAddAnimal()" style="max-width: 250px;">Ajouter un animal</button>
                </div>`;
            return;
        }

        const cardsHtml = this.data.animals.map(animal => {
            const age = this.calculateAge(animal.birthDate);
            const foodBag = this.data.foodBags.find(fb => fb.id === animal.foodBagId);
            const logs = (this.data.weightLogs[animal.id] || []);
            const lastWeight = logs.length > 0 ? logs[logs.length - 1] : null;

            let bagHtml = '';
            if (foodBag) {
                const status = this.getBagStatus(foodBag);
                bagHtml = `
                    <div class="progress-section">
                        <div class="progress-header">
                            <span class="progress-label">🍖 ${foodBag.name}</span>
                            <span class="progress-value">${status.percentageExact}%</span>
                        </div>
                        <div class="progress-bar">
                            <div class="progress-fill ${status.color}" style="width: ${Math.max(0, Math.min(100, status.percentage))}%"></div>
                        </div>
                        <div class="progress-details">
                            <span>${parseFloat(foodBag.remaining).toFixed(3)}kg / ${parseFloat(foodBag.totalWeight).toFixed(3)}kg</span>
                            <span>${status.daysLeft > 0 ? `⏱️ ${status.daysLeft}j restants` : '⚠️ Vide'}</span>
                        </div>
                    </div>`;
            } else {
                bagHtml = `<div class="alert-box alert-warning" style="margin-top: 8px;">⚠️ Aucun sac associé</div>`;
            }

            const avatarContent = animal.photo ?
                `<img src="${animal.photo}" alt="${animal.name}">` :
                `<div class="animal-avatar-placeholder">${animal.type === 'dog' ? '🐕' : '🐈'}</div>`;

            const weightBadge = lastWeight ?
                `<span class="badge badge-weight" onclick="event.stopPropagation(); app.showWeightModal('${animal.id}')">⚖️ ${lastWeight.weight}kg</span>` :
                `<span class="badge badge-weight-empty" onclick="event.stopPropagation(); app.showWeightModal('${animal.id}')">⚖️ Peser</span>`;

            return `
                <div class="card animal-card" onclick="app.editAnimal('${animal.id}')">
                    <div class="animal-header">
                        <div class="animal-avatar">${avatarContent}</div>
                        <div class="animal-info">
                            <div class="animal-name">${animal.name}</div>
                            <div class="animal-meta">
                                <span>${age} an${age !== 1 ? 's' : ''}</span>
                                <span class="badge">${animal.dailyFood}g/j</span>
                                <span>${animal.type === 'dog' ? '🐕' : '🐈'}</span>
                                ${weightBadge}
                            </div>
                        </div>
                    </div>
                    ${bagHtml}
                </div>`;
        }).join('');

        container.innerHTML = alertBanner + cardsHtml;
    },

    _getRestockAlerts() {
        const alerts = [];
        this.data.foodBags.forEach(bag => {
            const status = this.getBagStatus(bag);
            const remaining = parseFloat(bag.remaining);
            if (remaining <= 0) {
                alerts.push({ bagName: bag.name, message: 'Sac vide !', urgent: true });
            } else if (status.daysLeft <= 3 && status.daysLeft > 0) {
                const date = new Date();
                date.setDate(date.getDate() + status.daysLeft);
                const dateStr = date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
                alerts.push({ bagName: bag.name, message: `Fin le ${dateStr}`, urgent: true });
            } else if (status.daysLeft <= 7 && status.daysLeft > 3) {
                alerts.push({ bagName: bag.name, message: `Plus que ${status.daysLeft} jours`, urgent: false });
            }
        });
        return alerts;
    },

    calculateAge(birthDate) {
        const today = new Date(), birth = new Date(birthDate);
        let age = today.getFullYear() - birth.getFullYear();
        const md = today.getMonth() - birth.getMonth();
        if (md < 0 || (md === 0 && today.getDate() < birth.getDate())) age--;
        return age;
    },

    getBagStatus(bag) {
        const total = parseFloat(bag.totalWeight), remaining = parseFloat(bag.remaining);
        const percentage = (remaining / total) * 100;
        const percentageExact = percentage.toFixed(3);
        const associated = this.data.animals.filter(a => a.foodBagId === bag.id);
        const dailyConsumption = associated.reduce((sum, a) => sum + (parseFloat(a.dailyFood) / 1000), 0);
        const daysLeft = dailyConsumption > 0 ? Math.floor(remaining / dailyConsumption) : 0;
        let color = 'progress-green';
        if (percentage < 25) color = 'progress-red';
        else if (percentage < 50) color = 'progress-orange';
        else if (percentage < 75) color = 'progress-blue';
        return { percentage, percentageExact, daysLeft, color };
    },

    showAddAnimal() {
        document.getElementById('animalModalTitle').textContent = 'Nouvel Animal';
        document.getElementById('animalForm').reset();
        document.getElementById('animalId').value = '';
        document.getElementById('animalPhotoData').value = '';
        document.getElementById('deleteAnimalSection').classList.add('hidden');
        document.getElementById('showDeleteAnimalBtn').classList.add('hidden');
        const preview = document.getElementById('photoPreview');
        preview.src = ''; preview.classList.add('hidden');
        document.getElementById('photoPlaceholder').classList.remove('hidden');
        document.getElementById('photoUploadContainer').classList.remove('has-image');
        document.getElementById('photoChangeBtn').classList.add('hidden');
        document.getElementById('photoHint').textContent = 'Appuyez pour choisir une photo';
        document.getElementById('animalPhoto').value = '';
        this.updateFoodBagSelect();
        document.getElementById('animalBirthDate').value = new Date().toISOString().split('T')[0];
        this.openModal('animalModal');
    },

    editAnimal(id) {
        const animal = this.data.animals.find(a => a.id === id);
        if (!animal) return;
        document.getElementById('animalModalTitle').textContent = 'Modifier';
        document.getElementById('animalId').value = animal.id;
        document.getElementById('animalName').value = animal.name;
        document.getElementById('animalType').value = animal.type;
        document.getElementById('animalBirthDate').value = animal.birthDate;
        document.getElementById('animalDailyFood').value = animal.dailyFood;
        document.getElementById('animalPhoto').value = '';
        const preview = document.getElementById('photoPreview');
        if (animal.photo) {
            preview.src = animal.photo; preview.classList.remove('hidden');
            document.getElementById('photoPlaceholder').classList.add('hidden');
            document.getElementById('photoUploadContainer').classList.add('has-image');
            document.getElementById('photoChangeBtn').classList.remove('hidden');
            document.getElementById('photoHint').textContent = 'Appuyez sur la photo pour changer';
            document.getElementById('animalPhotoData').value = animal.photo;
        } else {
            preview.src = ''; preview.classList.add('hidden');
            document.getElementById('photoPlaceholder').classList.remove('hidden');
            document.getElementById('photoUploadContainer').classList.remove('has-image');
            document.getElementById('photoChangeBtn').classList.add('hidden');
            document.getElementById('photoHint').textContent = 'Appuyez pour choisir une photo';
            document.getElementById('animalPhotoData').value = '';
        }
        this.updateFoodBagSelect();
        document.getElementById('animalFoodBag').value = animal.foodBagId || '';
        document.getElementById('deleteAnimalSection').classList.add('hidden');
        document.getElementById('showDeleteAnimalBtn').classList.remove('hidden');
        this.openModal('animalModal');
    },

    updateFoodBagSelect() {
        const select = document.getElementById('animalFoodBag');
        const options = '<option value="">Aucun (à sélectionner plus tard)</option>';
        select.innerHTML = this.data.foodBags.length === 0
            ? options + '<option disabled>Aucun sac disponible</option>'
            : options + this.data.foodBags.map(bag =>
                `<option value="${bag.id}">${bag.name} (${parseFloat(bag.remaining).toFixed(3)}kg)</option>`
            ).join('');
    },

    saveAnimal(event) {
        event.preventDefault();
        const id = document.getElementById('animalId').value;
        const animal = {
            id: id || 'animal_' + Date.now(),
            name: document.getElementById('animalName').value,
            type: document.getElementById('animalType').value,
            birthDate: document.getElementById('animalBirthDate').value,
            dailyFood: parseFloat(document.getElementById('animalDailyFood').value),
            foodBagId: document.getElementById('animalFoodBag').value || null,
            photo: document.getElementById('animalPhotoData').value || null
        };
        if (id) { this.data.animals[this.data.animals.findIndex(a => a.id === id)] = animal; }
        else { this.data.animals.push(animal); }
        this.saveToLocalStorage(); this.syncToCloud();
        this.closeModal('animalModal'); this.renderAll();
    },

    showDeleteAnimal() {
        document.getElementById('showDeleteAnimalBtn').classList.add('hidden');
        document.getElementById('deleteAnimalSection').classList.remove('hidden');
    },
    cancelDeleteAnimal() {
        document.getElementById('deleteAnimalSection').classList.add('hidden');
        document.getElementById('showDeleteAnimalBtn').classList.remove('hidden');
    },
    confirmDeleteAnimal() {
        const id = document.getElementById('animalId').value;
        localStorage.removeItem('petcare_photo_' + id);
        delete this.data.weightLogs[id];
        this.data.animals = this.data.animals.filter(a => a.id !== id);
        this.saveToLocalStorage(); this.syncToCloud();
        this.closeModal('animalModal'); this.renderAll();
    },

    // ─── JOURNAL DE POIDS ─────────────────────────────────────────────────────

    showWeightModal(animalId) {
        const animal = this.data.animals.find(a => a.id === animalId);
        if (!animal) return;

        const logs = (this.data.weightLogs[animalId] || []).slice().sort((a, b) => a.date.localeCompare(b.date));
        const today = new Date().toISOString().split('T')[0];

        // Graphe SVG poids
        const chartHtml = this._renderWeightChart(logs);

        // Liste des entrées
        const logsHtml = logs.length === 0
            ? '<div style="color:var(--ios-gray); text-align:center; padding:16px 0; font-size:13px;">Aucune pesée enregistrée</div>'
            : `<div class="weight-log-list">${logs.slice().reverse().map((l, i) => {
                const prev = logs[logs.length - 1 - i - 1];
                const diff = prev ? (l.weight - prev.weight) : null;
                const diffHtml = diff !== null
                    ? `<span class="weight-diff ${diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat'}">${diff > 0 ? '+' : ''}${diff.toFixed(2)}kg</span>`
                    : '';
                return `
                    <div class="weight-entry">
                        <div class="weight-entry-date">${new Date(l.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
                        <div class="weight-entry-val">${l.weight} kg ${diffHtml}</div>
                        <button class="weight-delete-btn" onclick="app.deleteWeightLog('${animalId}', '${l.date}')">×</button>
                    </div>`;
            }).join('')}</div>`;

        const modalBody = document.getElementById('weightModalBody');
        document.getElementById('weightModalAnimalName').textContent = `⚖️ ${animal.name}`;
        document.getElementById('weightModalAnimalId').value = animalId;
        document.getElementById('weightNewDate').value = today;
        document.getElementById('weightNewValue').value = '';
        modalBody.innerHTML = chartHtml + logsHtml;
        this.openModal('weightModal');
    },

    _renderWeightChart(logs) {
        if (logs.length < 2) {
            return `<div style="text-align:center; color:var(--ios-gray); padding:20px 0; font-size:13px;">
                ${logs.length === 0 ? 'Ajoutez des pesées pour voir la courbe' : 'Ajoutez une 2ème pesée pour voir la courbe'}
            </div>`;
        }
        const weights = logs.map(l => parseFloat(l.weight));
        const maxW = Math.max(...weights), minW = Math.min(...weights);
        const range = maxW - minW || 0.5;
        const W = 280, H = 100, pL = 36, pR = 12, pT = 12, pB = 24;
        const iW = W - pL - pR, iH = H - pT - pB;

        const pts = logs.map((l, i) => ({
            x: pL + i * iW / (logs.length - 1),
            y: pT + iH - ((parseFloat(l.weight) - minW) / range) * iH,
            w: l.weight
        }));

        const line = pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
        const area = `M${pts[0].x.toFixed(1)},${(pT + iH).toFixed(1)} ` +
            pts.map(p => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') +
            ` L${pts[pts.length-1].x.toFixed(1)},${(pT + iH).toFixed(1)} Z`;

        const gridY = [0, 0.5, 1].map(r => {
            const y = pT + iH - r * iH;
            return `<line x1="${pL}" y1="${y.toFixed(1)}" x2="${W - pR}" y2="${y.toFixed(1)}" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
                    <text x="${(pL-4).toFixed(1)}" y="${(y+4).toFixed(1)}" text-anchor="end" font-size="8" fill="rgba(255,255,255,0.4)">${(minW + r*range).toFixed(1)}</text>`;
        }).join('');

        const dots = pts.map(p =>
            `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" fill="var(--ios-teal)" stroke="#1c1c1e" stroke-width="1.5"/>`
        ).join('');

        // Labels dates (premier + dernier)
        const dateLabels = [
            `<text x="${pts[0].x.toFixed(1)}" y="${(pT+iH+16).toFixed(1)}" text-anchor="start" font-size="8" fill="rgba(255,255,255,0.4)">${new Date(logs[0].date).toLocaleDateString('fr-FR',{day:'numeric',month:'short'})}</text>`,
            `<text x="${pts[pts.length-1].x.toFixed(1)}" y="${(pT+iH+16).toFixed(1)}" text-anchor="end" font-size="8" fill="rgba(255,255,255,0.4)">${new Date(logs[logs.length-1].date).toLocaleDateString('fr-FR',{day:'numeric',month:'short'})}</text>`
        ].join('');

        const trend = weights[weights.length-1] - weights[0];
        const trendColor = trend > 0 ? 'var(--ios-orange)' : trend < 0 ? 'var(--ios-green)' : 'var(--ios-gray)';
        const trendIcon = trend > 0 ? '↗' : trend < 0 ? '↘' : '→';

        return `
            <div class="weight-chart-wrap">
                <svg viewBox="0 0 ${W} ${H}" style="width:100%; height:${H}px; overflow:visible;">
                    <defs>
                        <linearGradient id="weightGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stop-color="#5AC8FA" stop-opacity="0.3"/>
                            <stop offset="100%" stop-color="#5AC8FA" stop-opacity="0"/>
                        </linearGradient>
                    </defs>
                    ${gridY}
                    <path d="${area}" fill="url(#weightGrad)"/>
                    <polyline points="${line}" fill="none" stroke="var(--ios-teal)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
                    ${dots}
                    ${dateLabels}
                </svg>
                <div class="weight-chart-stats">
                    <span>Min: <strong>${minW.toFixed(1)}kg</strong></span>
                    <span>Max: <strong>${maxW.toFixed(1)}kg</strong></span>
                    <span style="color:${trendColor};">${trendIcon} ${trend > 0 ? '+' : ''}${trend.toFixed(2)}kg total</span>
                </div>
            </div>`;
    },

    saveWeightLog(event) {
        event.preventDefault();
        const animalId = document.getElementById('weightModalAnimalId').value;
        const date = document.getElementById('weightNewDate').value;
        const weight = parseFloat(document.getElementById('weightNewValue').value);
        if (!date || isNaN(weight) || weight <= 0) return;

        if (!this.data.weightLogs[animalId]) this.data.weightLogs[animalId] = [];
        // Remplacer si même date, sinon ajouter
        const idx = this.data.weightLogs[animalId].findIndex(l => l.date === date);
        if (idx >= 0) this.data.weightLogs[animalId][idx].weight = weight;
        else this.data.weightLogs[animalId].push({ date, weight });
        this.data.weightLogs[animalId].sort((a, b) => a.date.localeCompare(b.date));

        this.saveToLocalStorage(); this.syncToCloud();
        this.showWeightModal(animalId); // re-render modal
        this.renderAnimals();
    },

    deleteWeightLog(animalId, date) {
        if (!this.data.weightLogs[animalId]) return;
        this.data.weightLogs[animalId] = this.data.weightLogs[animalId].filter(l => l.date !== date);
        this.saveToLocalStorage(); this.syncToCloud();
        this.showWeightModal(animalId);
        this.renderAnimals();
    },

    // ─── FOOD BAGS ────────────────────────────────────────────────────────────

    renderFoodBags() {
        const container = document.getElementById('foodBagsList');
        if (this.data.foodBags.length === 0 && this.data.archivedBags.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon"><img src="icon3.png" alt="Krokets" onerror="this.style.display='none'; this.parentElement.textContent='🍖'"></div>
                    <div class="empty-title">Aucun sac</div>
                    <div class="empty-text">Ajoutez un sac de croquettes pour suivre la consommation</div>
                    <button class="btn btn-primary" onclick="app.showAddFoodBag()" style="max-width: 250px;">Ajouter un sac</button>
                </div>`;
            return;
        }

        const activeBagsHtml = this.data.foodBags.map(bag => {
            const status = this.getBagStatus(bag);
            const associated = this.data.animals.filter(a => a.foodBagId === bag.id);
            const totalDaily = associated.reduce((sum, a) => sum + a.dailyFood, 0);
            const isEmpty = parseFloat(bag.remaining) <= 0;
            let alertHtml = '';
            if (isEmpty) {
                alertHtml = `
                    <div class="alert-box alert-critical" style="margin-bottom: 10px;">⚠️ Sac vide !</div>
                    <button class="btn btn-archive" onclick="event.stopPropagation(); app.archiveBag('${bag.id}')">📦 Archiver ce sac</button>`;
            } else if (status.percentage < 10) {
                alertHtml = `<div class="alert-box alert-critical">⚠️ Stock critique — Rachetez maintenant !</div>`;
            } else if (status.daysLeft <= 7 && status.daysLeft > 0) {
                const endDate = new Date(); endDate.setDate(endDate.getDate() + status.daysLeft);
                const endStr = endDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
                alertHtml = `<div class="alert-box alert-warning">⏱️ Fin estimée le ${endStr}</div>`;
            }
            return `
                <div class="card food-card${isEmpty ? ' food-card-empty' : ''}" onclick="app.editFoodBag('${bag.id}')">
                    <div class="food-header">
                        <div>
                            <div class="food-title">${bag.name}</div>
                            <div class="food-subtitle">${associated.map(a => a.name).join(', ') || 'Aucun animal'}</div>
                        </div>
                        <div class="food-icon">${isEmpty ? '📭' : '🍖'}</div>
                    </div>
                    <div class="progress-bar" style="margin-bottom: 8px;">
                        <div class="progress-fill ${status.color}" style="width: ${Math.max(0, Math.min(100, status.percentage))}%"></div>
                    </div>
                    <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 12px;">
                        <span style="color: var(--ios-gray);">${parseFloat(bag.remaining).toFixed(3)}kg / ${parseFloat(bag.totalWeight).toFixed(3)}kg</span>
                        <span style="font-weight: 600; font-family: monospace;">${status.percentageExact}%</span>
                    </div>
                    <div class="food-stats">
                        <div class="stat-box"><div class="stat-number">${status.daysLeft}</div><div class="stat-desc">Jours restants</div></div>
                        <div class="stat-box"><div class="stat-number">${bag.price}€</div><div class="stat-desc">Prix du sac</div></div>
                        <div class="stat-box"><div class="stat-number">${totalDaily}g</div><div class="stat-desc">/jour (${associated.length})</div></div>
                        <div class="stat-box"><div class="stat-number">${(bag.price / bag.totalWeight).toFixed(3)}€</div><div class="stat-desc">Prix/kg</div></div>
                    </div>
                    ${alertHtml}
                </div>`;
        }).join('');

        // ── Historique des sacs archivés (enrichi) ──
        let archivedHtml = '';
        if (this.data.archivedBags.length > 0) {
            archivedHtml = `<div class="section-label">📦 Historique des sacs (${this.data.archivedBags.length})</div>`;
            archivedHtml += this.data.archivedBags.map(bag => {
                const purchaseDate = bag.purchaseDate ? new Date(bag.purchaseDate) : null;
                const archivedDate = bag.archivedAt ? new Date(bag.archivedAt) : null;
                const purchaseStr = purchaseDate ? purchaseDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
                const archivedStr = archivedDate ? archivedDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
                const pricePerKg = (bag.price / parseFloat(bag.totalWeight)).toFixed(2);

                // Durée de vie réelle
                let durationHtml = '';
                if (purchaseDate && archivedDate) {
                    const days = Math.round((archivedDate - purchaseDate) / 86400000);
                    durationHtml = `<span class="badge badge-gray">⏱ ${days}j</span>`;
                }

                // Consommation réelle calculée depuis l'historique
                const histoForBag = (this.data.consumptionHistory || []).filter(h => h.bagId === bag.id);
                const realConsumed = histoForBag.reduce((s, h) => s + h.consumed, 0);
                const realConsumedHtml = realConsumed > 0
                    ? `<span class="badge badge-gray">${realConsumed.toFixed(2)}kg consommés</span>` : '';

                return `
                    <div class="card archived-card" onclick="app.showArchivedBagDetail('${bag.id}')">
                        <div class="food-header">
                            <div style="flex:1; min-width:0;">
                                <div class="food-title" style="color: rgba(255,255,255,0.6);">${bag.name}</div>
                                <div class="food-subtitle">${purchaseStr} → ${archivedStr}</div>
                            </div>
                            <div class="food-icon" style="opacity:0.35; flex-shrink:0;">📦</div>
                        </div>
                        <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:6px;">
                            <span class="badge badge-gray">${bag.totalWeight}kg</span>
                            <span class="badge badge-gray">${bag.price}€</span>
                            <span class="badge badge-gray">${pricePerKg}€/kg</span>
                            ${durationHtml}
                            ${realConsumedHtml}
                        </div>
                    </div>`;
            }).join('');
        }

        container.innerHTML = activeBagsHtml + archivedHtml;
    },

    showArchivedBagDetail(bagId) {
        const bag = this.data.archivedBags.find(b => b.id === bagId);
        if (!bag) return;

        const purchaseDate = bag.purchaseDate ? new Date(bag.purchaseDate) : null;
        const archivedDate = bag.archivedAt ? new Date(bag.archivedAt) : null;
        const days = (purchaseDate && archivedDate) ? Math.round((archivedDate - purchaseDate) / 86400000) : '—';
        const pricePerKg = (bag.price / parseFloat(bag.totalWeight)).toFixed(2);
        const histoForBag = (this.data.consumptionHistory || []).filter(h => h.bagId === bagId);
        const realConsumed = histoForBag.reduce((s, h) => s + h.consumed, 0);
        const costPerDay = (days > 0 && typeof days === 'number') ? (bag.price / days).toFixed(2) : '—';

        const content = `
            <div style="padding:4px 0;">
                <div class="archived-detail-row"><span>Marque</span><strong>${bag.name}</strong></div>
                <div class="archived-detail-row"><span>Poids total</span><strong>${bag.totalWeight} kg</strong></div>
                <div class="archived-detail-row"><span>Prix payé</span><strong>${bag.price} €</strong></div>
                <div class="archived-detail-row"><span>Prix au kg</span><strong>${pricePerKg} €/kg</strong></div>
                <div class="archived-detail-row"><span>Date d'achat</span><strong>${purchaseDate ? purchaseDate.toLocaleDateString('fr-FR', {day:'numeric',month:'long',year:'numeric'}) : '—'}</strong></div>
                <div class="archived-detail-row"><span>Archivé le</span><strong>${archivedDate ? archivedDate.toLocaleDateString('fr-FR', {day:'numeric',month:'long',year:'numeric'}) : '—'}</strong></div>
                <div class="archived-detail-row"><span>Durée de vie</span><strong>${typeof days === 'number' ? days + ' jours' : '—'}</strong></div>
                <div class="archived-detail-row"><span>Coût / jour</span><strong>${costPerDay !== '—' ? costPerDay + ' €' : '—'}</strong></div>
                ${realConsumed > 0 ? `<div class="archived-detail-row"><span>Consommé (suivi)</span><strong>${realConsumed.toFixed(3)} kg</strong></div>` : ''}
            </div>
            <button class="btn btn-danger" style="margin-top:20px;" onclick="app.deleteArchivedBag('${bagId}')">🗑 Supprimer de l'historique</button>`;

        document.getElementById('archivedDetailTitle').textContent = bag.name;
        document.getElementById('archivedDetailBody').innerHTML = content;
        this.openModal('archivedDetailModal');
    },

    deleteArchivedBag(bagId) {
        if (!confirm('Supprimer définitivement ce sac de l\'historique ?')) return;
        this.data.archivedBags = this.data.archivedBags.filter(b => b.id !== bagId);
        this.saveToLocalStorage(); this.syncToCloud();
        this.closeModal('archivedDetailModal');
        this.renderFoodBags();
    },

    archiveBag(bagId) {
        const bag = this.data.foodBags.find(b => b.id === bagId);
        if (!bag) return;
        if (!confirm(`Archiver le sac "${bag.name}" ?\nLes animaux associés perdront leur référence.`)) return;
        this.data.animals.forEach(a => { if (a.foodBagId === bagId) a.foodBagId = null; });
        this.data.archivedBags.unshift({ ...bag, archivedAt: new Date().toISOString() });
        this.data.foodBags = this.data.foodBags.filter(b => b.id !== bagId);
        this.saveToLocalStorage(); this.syncToCloud(); this.renderAll();
    },

    showAddFoodBag() {
        document.getElementById('foodBagModalTitle').textContent = 'Nouveau Sac';
        document.getElementById('foodBagForm').reset();
        document.getElementById('foodBagId').value = '';
        document.getElementById('deleteFoodBagSection').classList.add('hidden');
        document.getElementById('showDeleteFoodBagBtn').classList.add('hidden');
        document.getElementById('foodBagPurchaseDate').value = new Date().toISOString().split('T')[0];
        this.openModal('foodBagModal');
    },

    editFoodBag(id) {
        const bag = this.data.foodBags.find(b => b.id === id);
        if (!bag) return;
        document.getElementById('foodBagModalTitle').textContent = 'Modifier Sac';
        document.getElementById('foodBagId').value = bag.id;
        document.getElementById('foodBagName').value = bag.name;
        document.getElementById('foodBagTotalWeight').value = bag.totalWeight;
        document.getElementById('foodBagPrice').value = bag.price;
        document.getElementById('foodBagRemaining').value = bag.remaining;
        document.getElementById('foodBagPurchaseDate').value = bag.purchaseDate;
        document.getElementById('deleteFoodBagSection').classList.add('hidden');
        document.getElementById('showDeleteFoodBagBtn').classList.remove('hidden');
        this.openModal('foodBagModal');
    },

    saveFoodBag(event) {
        event.preventDefault();
        const id = document.getElementById('foodBagId').value;
        const bag = {
            id: id || 'bag_' + Date.now(),
            name: document.getElementById('foodBagName').value,
            totalWeight: parseFloat(document.getElementById('foodBagTotalWeight').value).toFixed(3),
            remaining: parseFloat(document.getElementById('foodBagRemaining').value).toFixed(3),
            price: parseFloat(document.getElementById('foodBagPrice').value),
            purchaseDate: document.getElementById('foodBagPurchaseDate').value
        };
        if (id) { this.data.foodBags[this.data.foodBags.findIndex(b => b.id === id)] = bag; }
        else { this.data.foodBags.push(bag); }
        this.saveToLocalStorage(); this.syncToCloud();
        this.closeModal('foodBagModal'); this.renderAll();
    },

    showDeleteFoodBag() {
        document.getElementById('showDeleteFoodBagBtn').classList.add('hidden');
        document.getElementById('deleteFoodBagSection').classList.remove('hidden');
    },
    cancelDeleteFoodBag() {
        document.getElementById('deleteFoodBagSection').classList.add('hidden');
        document.getElementById('showDeleteFoodBagBtn').classList.remove('hidden');
    },
    confirmDeleteFoodBag() {
        const id = document.getElementById('foodBagId').value;
        this.data.animals.forEach(a => { if (a.foodBagId === id) a.foodBagId = null; });
        this.data.foodBags = this.data.foodBags.filter(b => b.id !== id);
        this.saveToLocalStorage(); this.syncToCloud();
        this.closeModal('foodBagModal'); this.renderAll();
    },

    // ─── STATS ────────────────────────────────────────────────────────────────

    renderStats() {
        document.getElementById('totalAnimals').textContent = this.data.animals.length;
        let annualCost = 0;
        this.data.foodBags.forEach(bag => {
            const associated = this.data.animals.filter(a => a.foodBagId === bag.id);
            if (associated.length > 0) {
                const dailyConsumption = associated.reduce((sum, a) => sum + (a.dailyFood / 1000), 0);
                annualCost += dailyConsumption * (bag.price / bag.totalWeight) * 365;
            }
        });
        document.getElementById('totalCost').textContent = Math.round(annualCost) + '€';
        this.renderWeeklyWidget();
        this.renderConsumptionChart();
        this.renderCostDetails();
        this.renderPriceChart();
    },

    // ── Widget progression hebdomadaire ──────────────────────────────────────

    renderWeeklyWidget() {
        const container = document.getElementById('weeklyWidget');
        if (!container) return;

        const today = new Date().toISOString().split('T')[0];
        const days = [];
        for (let i = 6; i >= 0; i--) days.push(this._dateOffset(today, -i));

        // Consommation théorique journalière totale (g)
        const totalDailyG = this.data.animals.reduce((sum, a) => {
            const hasBag = this.data.foodBags.find(b => b.id === a.foodBagId);
            return hasBag ? sum + parseFloat(a.dailyFood) : sum;
        }, 0);

        // Consommation réelle par jour depuis l'historique
        const histoByDay = {};
        (this.data.consumptionHistory || []).forEach(h => {
            if (!histoByDay[h.date]) histoByDay[h.date] = 0;
            histoByDay[h.date] += h.consumed * 1000; // → grammes
        });

        const DAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
        const maxVal = Math.max(totalDailyG, ...days.map(d => histoByDay[d] || 0), 1);

        const barsHtml = days.map(d => {
            const real = histoByDay[d] || 0;
            const isToday = d === today;
            const isFuture = d > today;
            const heightPct = isFuture ? 0 : Math.min(100, (real / maxVal) * 100);
            const theorHeightPct = Math.min(100, (totalDailyG / maxVal) * 100);
            const dayObj = new Date(d);
            const dayLabel = DAY_LABELS[(dayObj.getDay() + 6) % 7]; // Lun=0
            const dateLabel = dayObj.getDate();
            const barColor = isFuture ? 'rgba(255,255,255,0.06)'
                : real >= totalDailyG * 0.95 ? 'var(--ios-green)'
                : real >= totalDailyG * 0.5 ? 'var(--ios-orange)'
                : real > 0 ? 'var(--ios-red)'
                : 'rgba(255,255,255,0.08)';

            return `
                <div class="weekly-bar-col${isToday ? ' today' : ''}">
                    <div class="weekly-bar-wrap">
                        <div class="weekly-bar-theor" style="height:${theorHeightPct}%; opacity:0.15;"></div>
                        <div class="weekly-bar-real" style="height:${heightPct}%; background:${barColor};"></div>
                    </div>
                    <div class="weekly-day-label">${dayLabel}</div>
                    <div class="weekly-date-label">${dateLabel}</div>
                </div>`;
        }).join('');

        const totalWeekReal = days.reduce((s, d) => s + (histoByDay[d] || 0), 0);
        const totalWeekTheor = totalDailyG * 7;
        const pct = totalWeekTheor > 0 ? Math.round((totalWeekReal / totalWeekTheor) * 100) : 0;

        container.innerHTML = `
            <div class="weekly-summary">
                <span>${(totalWeekReal / 1000).toFixed(2)}kg / ${(totalWeekTheor / 1000).toFixed(2)}kg</span>
                <span style="color:${pct >= 90 ? 'var(--ios-green)' : pct >= 50 ? 'var(--ios-orange)' : 'var(--ios-gray)'}; font-weight:700;">${pct}% cette semaine</span>
            </div>
            <div class="weekly-bars">${barsHtml}</div>
            <div class="weekly-legend">
                <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:rgba(255,255,255,0.15);margin-right:4px;"></span>Théorique</span>
                <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:var(--ios-green);margin-right:4px;"></span>Objectif atteint</span>
                <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:var(--ios-orange);margin-right:4px;"></span>Partiel</span>
            </div>`;
    },

    renderConsumptionChart() {
        const container = document.getElementById('consumptionChart');
        const consumption = this.data.animals.map(animal => {
            const bag = this.data.foodBags.find(b => b.id === animal.foodBagId);
            if (!bag) return null;
            const consumed = parseFloat(bag.totalWeight) - parseFloat(bag.remaining);
            const associated = this.data.animals.filter(a => a.foodBagId === bag.id);
            const totalDaily = associated.reduce((sum, a) => sum + a.dailyFood, 0);
            const share = totalDaily > 0 ? animal.dailyFood / totalDaily : 0;
            return { animal, consumed: consumed * share, percentage: 0 };
        }).filter(item => item && item.consumed > 0);

        const total = consumption.reduce((sum, item) => sum + item.consumed, 0);
        if (total === 0) {
            container.innerHTML = '<div style="text-align: center; color: var(--ios-gray); padding: 40px;">Aucune donnée</div>';
            return;
        }
        consumption.forEach(item => item.percentage = (item.consumed / total) * 100);
        let angle = 0;
        const colors = ['#007AFF', '#34C759', '#FF9500', '#AF52DE', '#FF2D55', '#5AC8FA'];
        const segments = consumption.map((item, i) => {
            const segAngle = (item.percentage / 100) * 360;
            const start = angle; angle += segAngle; const end = angle;
            const x1 = 50 + 40 * Math.cos((start * Math.PI) / 180);
            const y1 = 50 + 40 * Math.sin((start * Math.PI) / 180);
            const x2 = 50 + 40 * Math.cos((end * Math.PI) / 180);
            const y2 = 50 + 40 * Math.sin((end * Math.PI) / 180);
            return { ...item, path: `M 50 50 L ${x1} ${y1} A 40 40 0 ${segAngle > 180 ? 1 : 0} 1 ${x2} ${y2} Z`, color: colors[i % colors.length] };
        });
        container.innerHTML = `
            <div class="donut-chart">
                <svg viewBox="0 0 100 100">
                    ${segments.map(s => `<path d="${s.path}" fill="${s.color}" stroke="rgba(0,0,0,0.3)" stroke-width="0.5"/>`).join('')}
                    <circle cx="50" cy="50" r="25" fill="#1c1c1e"/>
                </svg>
                <div class="donut-center">
                    <div class="donut-value">${total.toFixed(3)}kg</div>
                    <div class="donut-label">consommés</div>
                </div>
            </div>
            <div class="legend">
                ${segments.map(s => `<div class="legend-item"><div class="legend-color" style="background:${s.color}"></div><span>${s.animal.name} ${s.percentage.toFixed(1)}%</span></div>`).join('')}
            </div>`;
    },

    renderCostDetails() {
        const container = document.getElementById('costDetails');
        const costs = this.data.animals.map(animal => {
            const bag = this.data.foodBags.find(b => b.id === animal.foodBagId);
            if (!bag) return null;
            const pricePerKg = bag.price / parseFloat(bag.totalWeight);
            return { animal, bag, annual: (animal.dailyFood / 1000) * pricePerKg * 365 };
        }).filter(Boolean);

        if (costs.length === 0) {
            container.innerHTML = '<div style="color:var(--ios-gray); text-align:center; padding:20px;">Aucun animal associé</div>';
            return;
        }
        container.innerHTML = costs.map(c => `
            <div class="cost-item">
                <div class="cost-avatar">${c.animal.photo ? `<img src="${c.animal.photo}">` : (c.animal.type === 'dog' ? '🐕' : '🐈')}</div>
                <div class="cost-info">
                    <div class="cost-name">${c.animal.name}</div>
                    <div class="cost-detail">${c.bag.name} · ${c.animal.dailyFood}g/j</div>
                </div>
                <div class="cost-amount">
                    <div class="cost-price">${Math.round(c.annual)}€</div>
                    <div class="cost-unit">/an</div>
                </div>
            </div>`).join('') + `
            <div style="margin-top:16px; padding-top:16px; border-top:0.5px solid var(--glass-border); text-align:center;">
                <span style="color:var(--ios-gray); font-size:13px;">Total: </span>
                <span style="color:var(--ios-green); font-size:20px; font-weight:700;">${Math.round(costs.reduce((s, c) => s + c.annual, 0))}€/an</span>
            </div>`;
    },

    renderPriceChart() {
        const container = document.getElementById('priceChart');
        if (!container) return;
        const allBags = [
            ...this.data.foodBags.map(b => ({ ...b, archived: false })),
            ...this.data.archivedBags.map(b => ({ ...b, archived: true }))
        ].filter(b => b.purchaseDate && b.price && b.totalWeight)
         .sort((a, b) => new Date(a.purchaseDate) - new Date(b.purchaseDate));

        if (allBags.length < 1) {
            container.innerHTML = '<div style="text-align:center; color:var(--ios-gray); padding:30px 20px; font-size:13px;">Ajoutez des sacs pour voir l\'évolution des prix</div>';
            return;
        }
        const pts_data = allBags.map(b => ({
            name: b.name,
            dateStr: new Date(b.purchaseDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }),
            price: parseFloat((b.price / parseFloat(b.totalWeight)).toFixed(2)),
            archived: b.archived
        }));
        const maxPrice = Math.max(...pts_data.map(p => p.price));
        const minPrice = Math.min(...pts_data.map(p => p.price));
        const priceRange = maxPrice - minPrice || 1;
        const W = 300, H = 140, pL = 44, pR = 16, pT = 16, pB = 36;
        const iW = W - pL - pR, iH = H - pT - pB;
        const pts = pts_data.map((p, i) => ({
            x: pL + (pts_data.length === 1 ? iW / 2 : i * iW / (pts_data.length - 1)),
            y: pT + iH - ((p.price - minPrice) / priceRange) * iH, ...p
        }));
        const polyline = pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
        const area = `M${pts[0].x.toFixed(1)},${(pT+iH).toFixed(1)} ${pts.map(p=>`L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} L${pts[pts.length-1].x.toFixed(1)},${(pT+iH).toFixed(1)} Z`;
        const gridLines = [0, 0.5, 1].map(r => {
            const y = pT + iH - r * iH;
            return `<line x1="${pL}" y1="${y.toFixed(1)}" x2="${(W-pR).toFixed(1)}" y2="${y.toFixed(1)}" stroke="rgba(255,255,255,0.07)" stroke-width="1" stroke-dasharray="3,3"/>
                    <text x="${(pL-6).toFixed(1)}" y="${(y+4).toFixed(1)}" text-anchor="end" font-size="8.5" fill="rgba(255,255,255,0.4)" font-family="monospace">${(minPrice+r*priceRange).toFixed(2)}</text>`;
        }).join('');
        const pointsHtml = pts.map(p => `
            <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4.5" fill="${p.archived ? '#8E8E93' : 'var(--ios-orange)'}" stroke="#1c1c1e" stroke-width="2"/>
            <text x="${p.x.toFixed(1)}" y="${(pT+iH+18).toFixed(1)}" text-anchor="middle" font-size="8" fill="rgba(255,255,255,0.45)">${p.dateStr}</text>
            <text x="${p.x.toFixed(1)}" y="${(p.y-9).toFixed(1)}" text-anchor="middle" font-size="8.5" font-weight="600" fill="${p.archived ? '#8E8E93' : 'var(--ios-orange)'}">${p.price}€</text>`
        ).join('');
        const avg = (pts_data.reduce((s, p) => s + p.price, 0) / pts_data.length).toFixed(2);
        const avgY = pT + iH - ((parseFloat(avg) - minPrice) / priceRange) * iH;
        container.innerHTML = `
            <svg viewBox="0 0 ${W} ${H}" style="width:100%; height:${H}px; overflow:visible;">
                <defs><linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#FF9500" stop-opacity="0.25"/>
                    <stop offset="100%" stop-color="#FF9500" stop-opacity="0"/>
                </linearGradient></defs>
                ${gridLines}
                ${pts_data.length > 1 ? `<line x1="${pL}" y1="${avgY.toFixed(1)}" x2="${(W-pR).toFixed(1)}" y2="${avgY.toFixed(1)}" stroke="rgba(255,204,0,0.4)" stroke-width="1" stroke-dasharray="4,4"/>` : ''}
                <path d="${area}" fill="url(#priceGrad)"/>
                <polyline points="${polyline}" fill="none" stroke="var(--ios-orange)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
                ${pointsHtml}
            </svg>
            <div style="display:flex; gap:16px; justify-content:center; margin-top:6px; font-size:11px; color:var(--ios-gray); flex-wrap:wrap;">
                <span>🟠 Actif</span><span>⚫ Archivé</span>
                <span>Moyenne: <strong style="color:var(--ios-yellow);">${avg}€/kg</strong></span>
            </div>`;
    },

    renderAll() {
        this.renderAnimals();
        this.renderFoodBags();
    },

    showSettings() {
        document.getElementById('offlineToggle').classList.toggle('active', this.data.isOffline);
        this.openModal('settingsModal');
    },

    toggleOfflineMode() {
        this.data.isOffline = !this.data.isOffline;
        document.getElementById('offlineToggle').classList.toggle('active');
        this.updateSyncStatus(this.data.isOffline ? 'offline' : 'online');
    }
};

document.addEventListener('DOMContentLoaded', () => app.init());
