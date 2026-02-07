const app = {
    data: {
        animals: [],
        foodBags: [],
        currentUser: null,
        isOffline: false,
        db: null,
        currentSection: 'animals'
    },

    init() {
        this.loadFromLocalStorage();
        this.setupFirebase();
        this.checkAuthState();
        this.setupNetworkListeners();
        
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('animalBirthDate').value = today;
        document.getElementById('foodBagPurchaseDate').value = today;
        
        // Prevent bounce on iOS
        document.addEventListener('touchmove', function(e) {
            if (e.target.closest('.modal-content')) return;
            if (e.target.closest('.content')) return;
            e.preventDefault();
        }, { passive: false });
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
                uid: result.user.uid,
                displayName: result.user.displayName,
                email: result.user.email,
                photoURL: result.user.photoURL
            }));
            await this.syncFromCloud();
            this.showMainApp();
        } catch (error) {
            alert("Erreur de connexion: " + error.message);
        }
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

    loadFromLocalStorage() {
        const saved = localStorage.getItem('petcare_data');
        if (saved) {
            const data = JSON.parse(saved);
            this.data.animals = data.animals || [];
            this.data.foodBags = data.foodBags || [];
        }
    },

    saveToLocalStorage() {
        localStorage.setItem('petcare_data', JSON.stringify({
            animals: this.data.animals,
            foodBags: this.data.foodBags
        }));
    },

    async syncToCloud() {
        if (this.data.isOffline || !this.data.db) return;
        this.updateSyncStatus('syncing');
        try {
            await this.data.db.collection('users').doc(this.data.currentUser.uid).set({
                animals: this.data.animals,
                foodBags: this.data.foodBags,
                lastUpdate: new Date()
            });
            this.updateSyncStatus('online');
        } catch (error) {
            this.updateSyncStatus('offline');
        }
    },

    async syncFromCloud() {
        if (this.data.isOffline || !this.data.db) return;
        try {
            const doc = await this.data.db.collection('users').doc(this.data.currentUser.uid).get();
            if (doc.exists) {
                const data = doc.data();
                this.data.animals = data.animals || [];
                this.data.foodBags = data.foodBags || [];
                this.saveToLocalStorage();
                this.renderAll();
            }
        } catch (error) {
            console.error("Sync error:", error);
        }
    },

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
        if (this.data.currentSection === 'animals') {
            this.showAddAnimal();
        } else {
            this.showAddFoodBag();
        }
    },

    handlePhotoSelect(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const photoData = e.target.result;
            document.getElementById('animalPhotoData').value = photoData;
            
            const preview = document.getElementById('photoPreview');
            preview.src = photoData;
            preview.classList.remove('hidden');
            
            document.getElementById('photoPlaceholder').classList.add('hidden');
            document.getElementById('photoUploadContainer').classList.add('has-image');
        };
        reader.readAsDataURL(file);
    },

    openModal(id) {
        const modal = document.getElementById(id);
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    },

    closeModal(id) {
        const modal = document.getElementById(id);
        modal.classList.remove('active');
        document.body.style.overflow = '';
    },

    closeModalOnOverlay(event, modalId) {
        if (event.target === event.currentTarget) {
            this.closeModal(modalId);
        }
    },

    renderAnimals() {
        const container = document.getElementById('animalsList');
        
        if (this.data.animals.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">
                        <img src="icon3.png" alt="Krokets" onerror="this.style.display='none'; this.parentElement.textContent='🐾'">
                    </div>
                    <div class="empty-title">Aucun animal</div>
                    <div class="empty-text">Commencez par ajouter votre compagnon à quatre pattes</div>
                    <button class="btn btn-primary" onclick="app.showAddAnimal()" style="max-width: 250px;">
                        Ajouter un animal
                    </button>
                </div>
            `;
            return;
        }
        
        container.innerHTML = this.data.animals.map(animal => {
            const age = this.calculateAge(animal.birthDate);
            const foodBag = this.data.foodBags.find(fb => fb.id === animal.foodBagId);
            
            let bagHtml = '';
            if (foodBag) {
                const status = this.getBagStatus(foodBag);
                bagHtml = `
                    <div class="progress-section">
                        <div class="progress-header">
                            <span class="progress-label">🍖 ${foodBag.name}</span>
                            <span class="progress-value">${status.percentage}%</span>
                        </div>
                        <div class="progress-bar">
                            <div class="progress-fill ${status.color}" style="width: ${status.percentage}%"></div>
                        </div>
                        <div class="progress-details">
                            <span>${foodBag.remaining}kg / ${foodBag.totalWeight}kg</span>
                            <span>${status.daysLeft > 0 ? `⏱️ ${status.daysLeft}j restants` : '⚠️ Vide'}</span>
                        </div>
                    </div>
                `;
            } else {
                bagHtml = `
                    <div class="alert-box alert-warning" style="margin-top: 8px;">
                        ⚠️ Aucun sac associé
                    </div>
                `;
            }
            
            const avatarContent = animal.photo ? 
                `<img src="${animal.photo}" alt="${animal.name}">` : 
                `<div class="animal-avatar-placeholder">${animal.type === 'dog' ? '🐕' : '🐈'}</div>`;
            
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
                            </div>
                        </div>
                    </div>
                    ${bagHtml}
                </div>
            `;
        }).join('');
    },

    calculateAge(birthDate) {
        const today = new Date();
        const birth = new Date(birthDate);
        let age = today.getFullYear() - birth.getFullYear();
        const monthDiff = today.getMonth() - birth.getMonth();
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age--;
        return age;
    },

    getBagStatus(bag) {
        const total = parseFloat(bag.totalWeight);
        const remaining = parseFloat(bag.remaining);
        const percentage = Math.round((remaining / total) * 100);
        
        const associated = this.data.animals.filter(a => a.foodBagId === bag.id);
        const dailyConsumption = associated.reduce((sum, a) => sum + (parseInt(a.dailyFood) / 1000), 0);
        const daysLeft = dailyConsumption > 0 ? Math.floor(remaining / dailyConsumption) : 0;
        
        let color = 'progress-green';
        if (percentage < 25) color = 'progress-red';
        else if (percentage < 50) color = 'progress-orange';
        else if (percentage < 75) color = 'progress-blue';
        
        return { percentage, daysLeft, color };
    },

    showAddAnimal() {
        document.getElementById('animalModalTitle').textContent = 'Nouvel Animal';
        document.getElementById('animalForm').reset();
        document.getElementById('animalId').value = '';
        document.getElementById('deleteAnimalSection').classList.add('hidden');
        document.getElementById('showDeleteAnimalBtn').classList.add('hidden');
        
        document.getElementById('photoPreview').classList.add('hidden');
        document.getElementById('photoPlaceholder').classList.remove('hidden');
        document.getElementById('photoUploadContainer').classList.remove('has-image');
        document.getElementById('animalPhotoData').value = '';
        
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
        
        if (animal.photo) {
            document.getElementById('photoPreview').src = animal.photo;
            document.getElementById('photoPreview').classList.remove('hidden');
            document.getElementById('photoPlaceholder').classList.add('hidden');
            document.getElementById('photoUploadContainer').classList.add('has-image');
            document.getElementById('animalPhotoData').value = animal.photo;
        } else {
            document.getElementById('photoPreview').classList.add('hidden');
            document.getElementById('photoPlaceholder').classList.remove('hidden');
            document.getElementById('photoUploadContainer').classList.remove('has-image');
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
        
        if (this.data.foodBags.length === 0) {
            select.innerHTML = options + '<option disabled>Aucun sac disponible</option>';
        } else {
            select.innerHTML = options + this.data.foodBags.map(bag => 
                `<option value="${bag.id}">${bag.name} (${bag.remaining}kg)</option>`
            ).join('');
        }
    },

    saveAnimal(event) {
        event.preventDefault();
        
        const id = document.getElementById('animalId').value;
        const animal = {
            id: id || 'animal_' + Date.now(),
            name: document.getElementById('animalName').value,
            type: document.getElementById('animalType').value,
            birthDate: document.getElementById('animalBirthDate').value,
            dailyFood: parseInt(document.getElementById('animalDailyFood').value),
            foodBagId: document.getElementById('animalFoodBag').value || null,
            photo: document.getElementById('animalPhotoData').value || null
        };
        
        if (id) {
            const index = this.data.animals.findIndex(a => a.id === id);
            this.data.animals[index] = animal;
        } else {
            this.data.animals.push(animal);
        }
        
        this.saveToLocalStorage();
        this.syncToCloud();
        this.closeModal('animalModal');
        this.renderAll();
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
        this.data.animals = this.data.animals.filter(a => a.id !== id);
        this.saveToLocalStorage();
        this.syncToCloud();
        this.closeModal('animalModal');
        this.renderAll();
    },

    renderFoodBags() {
        const container = document.getElementById('foodBagsList');
        
        if (this.data.foodBags.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">
                        <img src="icon3.png" alt="Krokets" onerror="this.style.display='none'; this.parentElement.textContent='🍖'">
                    </div>
                    <div class="empty-title">Aucun sac</div>
                    <div class="empty-text">Ajoutez un sac de croquettes pour suivre la consommation</div>
                    <button class="btn btn-primary" onclick="app.showAddFoodBag()" style="max-width: 250px;">
                        Ajouter un sac
                    </button>
                </div>
            `;
            return;
        }
        
        container.innerHTML = this.data.foodBags.map(bag => {
            const status = this.getBagStatus(bag);
            const associated = this.data.animals.filter(a => a.foodBagId === bag.id);
            const totalDaily = associated.reduce((sum, a) => sum + a.dailyFood, 0);
            
            let alertHtml = '';
            if (status.percentage < 10) {
                alertHtml = `<div class="alert-box alert-critical">⚠️ Stock critique - Rachetez maintenant !</div>`;
            } else if (status.daysLeft <= 7 && status.daysLeft > 0) {
                alertHtml = `<div class="alert-box alert-warning">⏱️ Fin dans ${status.daysLeft} jour${status.daysLeft > 1 ? 's' : ''}</div>`;
            }
            
            return `
                <div class="card food-card" onclick="app.editFoodBag('${bag.id}')">
                    <div class="food-header">
                        <div>
                            <div class="food-title">${bag.name}</div>
                            <div class="food-subtitle">${associated.map(a => a.name).join(', ') || 'Aucun animal'}</div>
                        </div>
                        <div class="food-icon">🍖</div>
                    </div>
                    
                    <div class="progress-bar" style="margin-bottom: 8px;">
                        <div class="progress-fill ${status.color}" style="width: ${status.percentage}%"></div>
                    </div>
                    
                    <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 12px;">
                        <span style="color: var(--ios-gray);">${bag.remaining}kg / ${bag.totalWeight}kg</span>
                        <span style="font-weight: 600;">${status.percentage}%</span>
                    </div>
                    
                    <div class="food-stats">
                        <div class="stat-box">
                            <div class="stat-number">${status.daysLeft}</div>
                            <div class="stat-desc">Jours restants</div>
                        </div>
                        <div class="stat-box">
                            <div class="stat-number">${bag.price}€</div>
                            <div class="stat-desc">Prix du sac</div>
                        </div>
                        <div class="stat-box">
                            <div class="stat-number">${totalDaily}g</div>
                            <div class="stat-desc">/jour (${associated.length})</div>
                        </div>
                        <div class="stat-box">
                            <div class="stat-number">${Math.round((bag.price/bag.totalWeight)*100)/100}€</div>
                            <div class="stat-desc">Prix/kg</div>
                        </div>
                    </div>
                    ${alertHtml}
                </div>
            `;
        }).join('');
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
            totalWeight: parseFloat(document.getElementById('foodBagTotalWeight').value),
            remaining: parseFloat(document.getElementById('foodBagRemaining').value),
            price: parseFloat(document.getElementById('foodBagPrice').value),
            purchaseDate: document.getElementById('foodBagPurchaseDate').value
        };
        
        if (id) {
            const index = this.data.foodBags.findIndex(b => b.id === id);
            this.data.foodBags[index] = bag;
        } else {
            this.data.foodBags.push(bag);
        }
        
        this.saveToLocalStorage();
        this.syncToCloud();
        this.closeModal('foodBagModal');
        this.renderAll();
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
        this.saveToLocalStorage();
        this.syncToCloud();
        this.closeModal('foodBagModal');
        this.renderAll();
    },

    renderStats() {
        document.getElementById('totalAnimals').textContent = this.data.animals.length;
        
        let annualCost = 0;
        this.data.foodBags.forEach(bag => {
            const associated = this.data.animals.filter(a => a.foodBagId === bag.id);
            if (associated.length > 0) {
                const dailyConsumption = associated.reduce((sum, a) => sum + (a.dailyFood / 1000), 0);
                const pricePerKg = bag.price / bag.totalWeight;
                annualCost += dailyConsumption * pricePerKg * 365;
            }
        });
        document.getElementById('totalCost').textContent = Math.round(annualCost) + '€';
        
        this.renderConsumptionChart();
        this.renderCostDetails();
    },

    renderConsumptionChart() {
        const container = document.getElementById('consumptionChart');
        const consumption = this.data.animals.map(animal => {
            const bag = this.data.foodBags.find(b => b.id === animal.foodBagId);
            if (!bag) return null;
            const consumed = bag.totalWeight - bag.remaining;
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
            const start = angle;
            angle += segAngle;
            const end = angle;
            const x1 = 50 + 40 * Math.cos((start * Math.PI) / 180);
            const y1 = 50 + 40 * Math.sin((start * Math.PI) / 180);
            const x2 = 50 + 40 * Math.cos((end * Math.PI) / 180);
            const y2 = 50 + 40 * Math.sin((end * Math.PI) / 180);
            const large = segAngle > 180 ? 1 : 0;
            return {
                ...item,
                path: `M 50 50 L ${x1} ${y1} A 40 40 0 ${large} 1 ${x2} ${y2} Z`,
                color: colors[i % colors.length]
            };
        });
        
        container.innerHTML = `
            <div class="donut-chart">
                <svg viewBox="0 0 100 100">
                    ${segments.map(s => `<path d="${s.path}" fill="${s.color}" stroke="rgba(0,0,0,0.3)" stroke-width="0.5"/>`).join('')}
                    <circle cx="50" cy="50" r="25" fill="#1c1c1e"/>
                </svg>
                <div class="donut-center">
                    <div class="donut-value">${total.toFixed(1)}kg</div>
                    <div class="donut-label">consommés</div>
                </div>
            </div>
            <div class="legend">
                ${segments.map(s => `
                    <div class="legend-item">
                        <div class="legend-color" style="background: ${s.color}"></div>
                        <span>${s.animal.name} ${s.percentage.toFixed(0)}%</span>
                    </div>
                `).join('')}
            </div>
        `;
    },

    renderCostDetails() {
        const container = document.getElementById('costDetails');
        const costs = this.data.animals.map(animal => {
            const bag = this.data.foodBags.find(b => b.id === animal.foodBagId);
            if (!bag) return null;
            const pricePerKg = bag.price / bag.totalWeight;
            const annual = ((animal.dailyFood / 1000) * pricePerKg * 365);
            return { animal, bag, annual, pricePerKg };
        }).filter(Boolean);
        
        if (costs.length === 0) {
            container.innerHTML = '<div style="color: var(--ios-gray); text-align: center; padding: 20px;">Aucun animal associé</div>';
            return;
        }
        
        container.innerHTML = costs.map(c => `
            <div class="cost-item">
                <div class="cost-avatar">
                    ${c.animal.photo ? `<img src="${c.animal.photo}">` : (c.animal.type === 'dog' ? '🐕' : '🐈')}
                </div>
                <div class="cost-info">
                    <div class="cost-name">${c.animal.name}</div>
                    <div class="cost-detail">${c.bag.name} • ${c.animal.dailyFood}g/j</div>
                </div>
                <div class="cost-amount">
                    <div class="cost-price">${Math.round(c.annual)}€</div>
                    <div class="cost-unit">/an</div>
                </div>
            </div>
        `).join('') + `
            <div style="margin-top: 16px; padding-top: 16px; border-top: 0.5px solid var(--glass-border); text-align: center;">
                <span style="color: var(--ios-gray); font-size: 13px;">Total: </span>
                <span style="color: var(--ios-green); font-size: 20px; font-weight: 700;">
                    ${Math.round(costs.reduce((s, c) => s + c.annual, 0))}€/an
                </span>
            </div>
        `;
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
