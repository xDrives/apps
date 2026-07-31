class CredentialManager {
    constructor() {
        // ========== 1. CORE PROPERTIES ==========
        this.credentials = [];
        this.serviceKeywords = {};
        this.showPasswords = false;
        
        // ========== 2. INDEXEDDB PROPERTIES ==========
        this.dbName = 'CredentialDatabase';
        this.dbVersion = 2;
        this.db = null;
        
        // ========== 3. FIREBASE SYNC PROPERTIES ==========
        this.syncInProgress = false;
        this.isInitialized = false;
        this.pendingOperations = new Map();
        this.firebaseListeners = {};
        
        // ========== 6. UI STATE PROPERTIES ==========
        this.currentPreviewFilter = 'all';
        this.currentSearchTerm = '';
        this.isUpdating = false;
        this.debounceTimer = null;
        this.searchDebounceTimer = null;
        this.syncTimer = null;
        this.previewUpdateTimer = null;
        
        // Initialize
        this.initializeServiceKeywords();
        this.init();

        // ========== 7. FORM STATE PROPERTIES ==========
        this.isEditing = false;
        this.editingRowIndex = null;
        this.currentFormData = {
            serviceTag: '',
            userid: '',
            password: '',
            note: ''
        };
    }

    // ========== INITIALIZATION & SETUP ==========
    async init() {
        console.log('Credential Manager initializing with Firebase primary storage');
        
        await this.initIndexedDB();
        await this.loadFromIndexedDB();
        
        if (document.getElementById('credentialContainer')) {
            this.render('credentialContainer');
        }
        
        await this.initFirebaseSync();
        this.updateFilterCount();
        this.isInitialized = true;
    }

    async initIndexedDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);
            
            request.onerror = (event) => {
                console.error('IndexedDB error:', event.target.error);
                reject(event.target.error);
            };
            
            request.onsuccess = (event) => {
                this.db = event.target.result;
                console.log('Credential IndexedDB initialized successfully');
                resolve();
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                if (!db.objectStoreNames.contains('credentials')) {
                    const credentialStore = db.createObjectStore('credentials', { keyPath: 'id' });
                    credentialStore.createIndex('lastUpdated', 'lastUpdated', { unique: false });
                    credentialStore.createIndex('syncVersion', 'syncVersion', { unique: false });
                }
                
                if (!db.objectStoreNames.contains('syncMetadata')) {
                    db.createObjectStore('syncMetadata', { keyPath: 'key' });
                }
                
                console.log('Credential IndexedDB schema created');
            };
        });
    }

    async loadFromIndexedDB() {
        try {
            const data = await this.getFromIndexedDB('credentials', 'main_credentials');
            if (data && data.credentials && data.credentials.length > 0) {
                this.credentials = data.credentials;
                this.showPasswords = data.showPasswords || false;
                
                if (this.credentials[0] && this.credentials[0].entries && this.credentials[0].entries.length > 0) {
                    console.log('Credential data loaded from IndexedDB cache, entries count:', this.credentials[0].entries.length);
                } else {
                    console.log('Cached credential data was invalid, initializing empty');
                    this.initializeEmptyData();
                }
            } else {
                console.log('No credential data found in IndexedDB cache, initializing empty');
                this.initializeEmptyData();
            }
            
            if (document.getElementById('credential')) {
                this.updatePreview();
            }

            this.updateFilterCount();

        } catch (error) {
            console.error('Error loading from IndexedDB:', error);
            this.initializeEmptyData();
        }
    }

    async getFromIndexedDB(storeName, id) {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                resolve(null);
                return;
            }
            
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.get(id);
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = (event) => reject(event.target.error);
        });
    }
    
    async saveSyncMetadataToIndexedDB(key, value) {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject(new Error('Database not initialized'));
                return;
            }
            
            const transaction = this.db.transaction(['syncMetadata'], 'readwrite');
            const store = transaction.objectStore('syncMetadata');
            const request = store.put({ key, value, timestamp: Date.now() });
            
            request.onsuccess = () => resolve();
            request.onerror = (event) => reject(event.target.error);
        });
    }

    async getSyncMetadataFromIndexedDB(key) {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                resolve(null);
                return;
            }
            
            const transaction = this.db.transaction(['syncMetadata'], 'readonly');
            const store = transaction.objectStore('syncMetadata');
            const request = store.get(key);
            
            request.onsuccess = (event) => {
                resolve(event.target.result ? event.target.result.value : null);
            };
            request.onerror = (event) => reject(event.target.error);
        });
    }

    async initFirebaseSync() {
        if (!window.authModule || !window.authModule.isLoggedIn()) {
            console.log('Firebase sync not available - user not authenticated');
            return;
        }

        try {
            const homeDb = window.authModule.getHomeDatabaseInstance();
            if (!homeDb || !homeDb.db) return;

            const encodedPhone = window.authModule.encodePhone(window.authModule.currentUser?.phone);
            if (!encodedPhone) return;

            console.log('Setting up Firebase real-time listeners for credentials...');

            const credRef = homeDb.db.ref(`userData/${encodedPhone}/credentialData`);
            this.setupFirebaseListener('credentials', credRef);

            await this.loadFromFirebase();

        } catch (error) {
            console.error('Error initializing Firebase sync:', error);
        }
    }

    setupFirebaseListener(type, ref) {
        if (this.firebaseListeners[type]) {
            if (this.firebaseListeners[type].value) {
                ref.off('value', this.firebaseListeners[type].value);
            }
        }

        const listener = (snapshot) => {
            const data = snapshot.val();
            if (data && this.pendingOperations.size === 0) {
                this.handleFirebaseUpdate(data);
            }
        };

        ref.on('value', listener);
        this.firebaseListeners[type] = { value: listener };
    }

    async loadFromFirebase() {
        if (!window.authModule || !window.authModule.isLoggedIn()) {
            console.log('Cannot load from Firebase - user not authenticated');
            return false;
        }

        try {
            const homeDb = window.authModule.getHomeDatabaseInstance();
            if (!homeDb || !homeDb.db) return false;

            const encodedPhone = window.authModule.encodePhone(window.authModule.currentUser?.phone);
            if (!encodedPhone) return false;

            console.log('Loading credential data from Firebase...');

            const ref = homeDb.db.ref(`userData/${encodedPhone}/credentialData`);
            const snapshot = await ref.once('value');
            const firebaseData = snapshot.val();

            if (firebaseData && Object.keys(firebaseData).length > 0) {
                const metadata = firebaseData._metadata || {};
                delete firebaseData._metadata;
                
                const entries = [];
                const rowIds = Object.keys(firebaseData).filter(key => key.startsWith('credential_'));
                
                const sortedRows = rowIds
                    .map(id => ({ id, data: firebaseData[id] }))
                    .sort((a, b) => (a.data.rowIndex || 0) - (b.data.rowIndex || 0));
                
                for (const { data } of sortedRows) {
                    const isRowPending = data.pending || false;
                    const pendingAt = data.pendingAt || null;
                    
                    // 4 fields per row: Service, UserID, Password, Note
                    entries.push({ 
                        value: data.serviceTag || '', 
                        display: data.serviceTag || '', 
                        pending: isRowPending,
                        pendingAt: pendingAt,
                        isEmpty: !data.serviceTag, 
                        isWhitespaceOnly: false, 
                        originalIndex: entries.length, 
                        lineNumber: Math.floor(entries.length / 4) + 1 
                    });
                    entries.push({ 
                        value: data.userid || '', 
                        display: data.userid || '', 
                        pending: isRowPending,
                        pendingAt: pendingAt,
                        isEmpty: !data.userid, 
                        isWhitespaceOnly: false, 
                        originalIndex: entries.length, 
                        lineNumber: Math.floor(entries.length / 4) + 1 
                    });
                    entries.push({ 
                        value: data.password || '', 
                        display: data.password || '', 
                        pending: isRowPending,
                        pendingAt: pendingAt,
                        isEmpty: !data.password, 
                        isWhitespaceOnly: false, 
                        originalIndex: entries.length, 
                        lineNumber: Math.floor(entries.length / 4) + 1 
                    });
                    entries.push({ 
                        value: data.note || '',
                        display: data.note || '', 
                        pending: isRowPending,
                        pendingAt: pendingAt,
                        isEmpty: !data.note, 
                        isWhitespaceOnly: false, 
                        originalIndex: entries.length, 
                        lineNumber: Math.floor(entries.length / 4) + 1 
                    });
                }
                
                const firebaseCredentials = [{
                    id: 1,
                    entries: entries.length > 0 ? entries : this.getDefaultEntries(),
                    lastUpdated: metadata.lastSync || 'Never'
                }];
                
                const needsUpdate = this.hasCredentialDataChanged(firebaseCredentials, this.credentials);
                
                if (needsUpdate) {
                    console.log('Firebase data differs from cache, updating...');
                    this.credentials = firebaseCredentials;
                    this.showPasswords = false;
                    
                    await this.saveToIndexedDB({
                        credentials: this.credentials,
                        showPasswords: this.showPasswords,
                        lastUpdated: metadata.lastSync,
                        syncVersion: metadata.version
                    });
                    
                    if (document.getElementById('credential')) {
                        this.updatePreview();
                    }

                    this.updateFilterCount();
                    console.log('Credential data updated from Firebase');
                } else {
                    console.log('Firebase data matches cache, no update needed');
                }
                return true;
                
            } else {
                console.log('No credential data in Firebase, uploading local cache...');
                await this.saveAllRowsToFirebase();
                return false;
            }
            
        } catch (error) {
            console.error('Error loading from Firebase:', error);
            return false;
        }
    }

    hasCredentialDataChanged(firebaseData, localData) {
        if (!firebaseData || !localData) return true;
        if (firebaseData.length !== localData.length) return true;
        
        const firebaseEntries = firebaseData[0]?.entries || [];
        const localEntries = localData[0]?.entries || [];
        
        if (firebaseEntries.length !== localEntries.length) return true;
        
        for (let i = 0; i < firebaseEntries.length; i++) {
            if (firebaseEntries[i]?.value !== localEntries[i]?.value) {
                return true;
            }
            if (firebaseEntries[i]?.pending !== localEntries[i]?.pending) {
                return true;
            }
        }
        
        return false;
    }

    initializeEmptyData() {
        console.log('Initializing empty credential data');
        
        const defaultEntries = [];
        for (let i = 0; i < 4; i++) {
            defaultEntries.push({
                value: '',
                display: '',
                pending: false,
                pendingAt: null,
                isEmpty: true,
                isWhitespaceOnly: false,
                originalIndex: i,
                lineNumber: 1
            });
        }
        
        this.credentials = [{
            id: 1,
            entries: defaultEntries,
            lastUpdated: "Never",
        }];
        
        this.saveToStorage();
        console.log('Empty credential data initialized');
    }

    getDefaultEntries() {
        const defaultEntries = [];
        for (let i = 0; i < 4; i++) {
            defaultEntries.push({
                value: '',
                display: '',
                pending: false,
                pendingAt: null,
                isEmpty: true,
                isWhitespaceOnly: false,
                originalIndex: i,
                lineNumber: 1
            });
        }
        return defaultEntries;
    }

    // ========== DATABASE OPERATIONS ==========
    async saveToIndexedDB(data) {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject(new Error('Database not initialized'));
                return;
            }
            
            const transaction = this.db.transaction(['credentials'], 'readwrite');
            const store = transaction.objectStore('credentials');
            
            const credentialData = {
                id: 'main_credentials',
                credentials: data.credentials,
                showPasswords: data.showPasswords,
                lastUpdated: data.lastUpdated || new Date().toISOString(),
                syncVersion: data.syncVersion || Date.now()
            };
            
            const request = store.put(credentialData);
            
            request.onsuccess = () => resolve();
            request.onerror = (event) => reject(event.target.error);
        });
    }

    async saveToFirebase() {
        if (!window.authModule || !window.authModule.isLoggedIn()) {
            console.log('Cannot save to Firebase - user not authenticated');
            return false;
        }

        try {
            const homeDb = window.authModule.getHomeDatabaseInstance();
            if (!homeDb || !homeDb.db) return false;

            const encodedPhone = window.authModule.encodePhone(window.authModule.currentUser?.phone);
            if (!encodedPhone) return false;

            this.pendingOperations.set('credential_sync', true);

            const firebaseData = {
                metadata: {
                    credentialCount: this.credentials.reduce((total, cred) => 
                        total + (cred.entries ? cred.entries.length : 0), 0),
                    lastUpdated: new Date().toISOString(),
                    syncVersion: Date.now(),
                    showPasswords: this.showPasswords
                },
                credentials: this.credentials.map(credential => ({
                    id: credential.id,
                    entries: credential.entries ? credential.entries.map(entry => ({
                        value: entry.value,
                        display: entry.display,
                        pending: entry.pending || false,
                        pendingAt: entry.pendingAt || null,
                        isEmpty: entry.isEmpty || false,
                        isWhitespaceOnly: entry.isWhitespaceOnly || false,
                        originalIndex: entry.originalIndex || 0,
                        lineNumber: entry.lineNumber || 0
                    })) : [],
                    lastUpdated: credential.lastUpdated || 'Never'
                }))
            };

            const ref = homeDb.db.ref(`userData/${encodedPhone}/credentialData`);
            await ref.set(firebaseData);

            await this.saveToIndexedDB({
                credentials: this.credentials,
                showPasswords: this.showPasswords,
                lastUpdated: firebaseData.metadata.lastUpdated,
                syncVersion: firebaseData.metadata.syncVersion
            });

            return true;

        } catch (error) {
            console.error('Error saving to Firebase:', error);
            this.showNotification('Error saving to cloud', 'error');
            return false;
        }
    }

    async saveToStorage() {
        if (this.isUpdating) return;
        
        try {
            this.isUpdating = true;
            
            await this.saveToIndexedDB({
                credentials: this.credentials,
                showPasswords: this.showPasswords,
                lastUpdated: new Date().toISOString(),
                syncVersion: Date.now()
            });
            
            console.log('Credential data saved to IndexedDB cache');
            
            setTimeout(() => this.syncToFirebase(), 100);
            
        } catch (error) {
            console.error('Error saving to IndexedDB:', error);
        } finally {
            this.isUpdating = false;
        }
    }

    // ========== FIREBASE SYNC OPERATIONS ==========
    async handleFirebaseUpdate(data) {
        if (this.pendingOperations.size > 0) return;
        
        console.log('Firebase credential data updated');
        
        if (data && typeof data === 'object') {
            const metadata = data._metadata;
            delete data._metadata;
            
            const rowIds = Object.keys(data).filter(key => key.startsWith('credential_'));
            
            if (rowIds.length > 0) {
                const entries = [];
                const sortedRows = rowIds
                    .map(id => ({ id, rowData: data[id] }))
                    .sort((a, b) => (a.rowData.rowIndex || 0) - (b.rowData.rowIndex || 0));
                
                for (const { rowData } of sortedRows) {
                    const isRowPending = rowData.pending || false;
                    const pendingAt = rowData.pendingAt || null;
                    
                    // 4 fields per row
                    entries.push({ 
                        value: rowData.serviceTag || '', 
                        display: rowData.serviceTag || '', 
                        pending: isRowPending,
                        pendingAt: pendingAt,
                        isEmpty: !rowData.serviceTag, 
                        isWhitespaceOnly: false, 
                        originalIndex: entries.length, 
                        lineNumber: Math.floor(entries.length / 4) + 1 
                    });
                    entries.push({ 
                        value: rowData.userid || '', 
                        display: rowData.userid || '', 
                        pending: isRowPending,
                        pendingAt: pendingAt,
                        isEmpty: !rowData.userid, 
                        isWhitespaceOnly: false, 
                        originalIndex: entries.length, 
                        lineNumber: Math.floor(entries.length / 4) + 1 
                    });
                    entries.push({ 
                        value: rowData.password || '', 
                        display: rowData.password || '', 
                        pending: isRowPending,
                        pendingAt: pendingAt,
                        isEmpty: !rowData.password, 
                        isWhitespaceOnly: false, 
                        originalIndex: entries.length, 
                        lineNumber: Math.floor(entries.length / 4) + 1 
                    });
                    entries.push({ 
                        value: rowData.note || '',
                        display: rowData.note || '', 
                        pending: isRowPending,
                        pendingAt: pendingAt,
                        isEmpty: !rowData.note, 
                        isWhitespaceOnly: false, 
                        originalIndex: entries.length, 
                        lineNumber: Math.floor(entries.length / 4) + 1 
                    });
                }
                
                const newCredentials = [{
                    id: 1,
                    entries: entries,
                    lastUpdated: metadata?.lastSync || 'Never'
                }];
                
                if (this.hasCredentialDataChanged(newCredentials, this.credentials)) {
                    this.credentials = newCredentials;
                    
                    await this.saveToIndexedDB({
                        credentials: this.credentials,
                        showPasswords: this.showPasswords,
                        lastUpdated: metadata?.lastSync,
                        syncVersion: metadata?.version
                    });
                    
                    if (document.getElementById('credential')) {
                        this.updatePreview();
                    }
                    
                    console.log('Credential data updated from Firebase real-time update');
                } else {
                    console.log('Firebase update received but data unchanged');
                }
            }
        }
    }

    async saveCredentialRowToFirebase(rowId, rowData) {
        if (!window.authModule || !window.authModule.isLoggedIn()) {
            return false;
        }

        try {
            const homeDb = window.authModule.getHomeDatabaseInstance();
            if (!homeDb || !homeDb.db) return false;

            const encodedPhone = window.authModule.encodePhone(window.authModule.currentUser?.phone);
            if (!encodedPhone) return false;

            this.pendingOperations.set(`credential_sync_${rowId}`, true);

            const ref = homeDb.db.ref(`userData/${encodedPhone}/credentialData/${rowId}`);
            await ref.set(rowData);

            setTimeout(() => {
                this.pendingOperations.delete(`credential_sync_${rowId}`);
            }, 500);

            console.log(`Credential row ${rowId} saved to Firebase`);
            return true;

        } catch (error) {
            console.error('Error saving credential row to Firebase:', error);
            this.showNotification('Error saving to cloud', 'error');
            return false;
        }
    }

    async saveAllRowsToFirebase() {
        if (!window.authModule || !window.authModule.isLoggedIn()) {
            return false;
        }

        try {
            const homeDb = window.authModule.getHomeDatabaseInstance();
            if (!homeDb || !homeDb.db) return false;

            const encodedPhone = window.authModule.encodePhone(window.authModule.currentUser?.phone);
            if (!encodedPhone) return false;

            const credentialSet = this.getCredentialSet();
            const entries = credentialSet.entries || [];
            const rows = Math.ceil(entries.length / 4);
            
            const updates = {};
            
            for (let rowIndex = 0; rowIndex < rows; rowIndex++) {
                const startIndex = rowIndex * 4;
                const rowId = `credential_${rowIndex}`;
                
                const isRowPending = entries[startIndex]?.pending || false;
                
                const rowData = {
                    serviceTag: entries[startIndex]?.value || '',
                    userid: entries[startIndex + 1]?.value || '',
                    password: entries[startIndex + 2]?.value || '',
                    note: entries[startIndex + 3]?.value || '',
                    pending: isRowPending,
                    pendingAt: entries[startIndex]?.pendingAt || null,
                    rowIndex: rowIndex,
                    lastUpdated: new Date().toISOString()
                };
                
                updates[`userData/${encodedPhone}/credentialData/${rowId}`] = rowData;
            }
            
            updates[`userData/${encodedPhone}/credentialData/_metadata`] = {
                totalRows: rows,
                lastSync: new Date().toISOString(),
                version: Date.now()
            };
            
            const ref = homeDb.db.ref();
            await ref.update(updates);
            
            console.log(`All ${rows} credential rows saved to Firebase (4 fields each)`);
            return true;

        } catch (error) {
            console.error('Error saving all rows to Firebase:', error);
            this.showNotification('Error saving to cloud', 'error');
            return false;
        }
    }

    async syncRowToFirebase(rowIndex) {
        if (!window.authModule || !window.authModule.isLoggedIn()) {
            return false;
        }
        
        const credentialSet = this.getCredentialSet();
        const entries = credentialSet.entries || [];
        const startIndex = rowIndex * 4;
        
        const isRowPending = entries[startIndex]?.pending || false;
        
        const rowData = {
            serviceTag: entries[startIndex]?.value || '',
            userid: entries[startIndex + 1]?.value || '',
            password: entries[startIndex + 2]?.value || '',
            note: entries[startIndex + 3]?.value || '',
            pending: isRowPending,
            pendingAt: entries[startIndex]?.pendingAt || null,
            rowIndex: rowIndex,
            lastUpdated: new Date().toISOString()
        };
        
        this.pendingOperations.set(`credential_sync_${rowIndex}`, true);
        const result = await this.saveCredentialRowToFirebase(`credential_${rowIndex}`, rowData);
        
        setTimeout(() => {
            this.pendingOperations.delete(`credential_sync_${rowIndex}`);
        }, 500);
        
        return result;
    }

    async syncAfterSingleRowDeletion(deletedRowIndex) {
        if (!window.authModule || !window.authModule.isLoggedIn()) {
            return;
        }
        
        try {
            const homeDb = window.authModule.getHomeDatabaseInstance();
            if (!homeDb || !homeDb.db) return;
            
            const encodedPhone = window.authModule.encodePhone(window.authModule.currentUser?.phone);
            if (!encodedPhone) return;
            
            const credentialSet = this.getCredentialSet();
            const entries = credentialSet.entries || [];
            const rowsCount = Math.ceil(entries.length / 4);
            
            this.pendingOperations.set('credential_sync', true);
            
            const updates = {};
            
            for (let rowIndex = 0; rowIndex < rowsCount; rowIndex++) {
                const startIndex = rowIndex * 4;
                const rowId = `credential_${rowIndex}`;
                
                const rowData = {
                    serviceTag: entries[startIndex]?.value || '',
                    userid: entries[startIndex + 1]?.value || '',
                    password: entries[startIndex + 2]?.value || '',
                    note: entries[startIndex + 3]?.value || '',
                    pending: entries.slice(startIndex, startIndex + 4).some(entry => entry?.pending),
                    pendingAt: entries[startIndex]?.pendingAt || null,
                    rowIndex: rowIndex,
                    lastUpdated: new Date().toISOString()
                };
                
                updates[`userData/${encodedPhone}/credentialData/${rowId}`] = rowData;
            }
            
            const deletedRowId = `credential_${deletedRowIndex}`;
            updates[`userData/${encodedPhone}/credentialData/${deletedRowId}`] = null;
            
            const oldRowCount = rowsCount + 1;
            for (let i = rowsCount; i < oldRowCount; i++) {
                updates[`userData/${encodedPhone}/credentialData/credential_${i}`] = null;
            }
            
            updates[`userData/${encodedPhone}/credentialData/_metadata`] = {
                totalRows: rowsCount,
                lastSync: new Date().toISOString(),
                version: Date.now()
            };
            
            const ref = homeDb.db.ref();
            await ref.update(updates);
            
            await this.saveToIndexedDB({
                credentials: this.credentials,
                showPasswords: this.showPasswords,
                lastUpdated: new Date().toISOString(),
                syncVersion: Date.now()
            });
            
            setTimeout(() => {
                this.pendingOperations.delete('credential_sync');
            }, 500);
            
            console.log(`Row ${deletedRowIndex + 1} deleted and synced to Firebase`);
            
        } catch (error) {
            console.error('Error syncing after row deletion:', error);
            this.showNotification('Error syncing to cloud', 'error');
        }
    }

    // ========== CORE CREDENTIAL OPERATIONS ==========
    updateCredentials(credentialData) {
        const credentialIndex = this.credentials.findIndex(cr => cr.id === 1);
        if (credentialIndex !== -1) {
            this.credentials[credentialIndex] = {
                ...this.credentials[credentialIndex],
                ...credentialData,
                id: 1,
                lastUpdated: 'Just now'
            };
        } else {
            this.credentials.push({
                id: 1,
                ...credentialData,
                lastUpdated: 'Just now'
            });
        }
        
        this.saveToStorage();
    }

    getCredentialSet() {
        if (!this.credentials || this.credentials.length === 0) {
            this.initializeEmptyData();
        }
        
        const credential = this.credentials.find(cr => cr.id === 1);
        if (!credential) {
            this.initializeEmptyData();
            return this.credentials[0];
        }
        
        return credential;
    }

    deleteRow(rowIndex) {
        const credentialSet = this.getCredentialSet();
        const entries = credentialSet.entries || [];
        const startIndex = rowIndex * 4;
        const rowEntries = entries.slice(startIndex, startIndex + 4);
        
        const hasData = rowEntries.some(entry => entry && entry.value && entry.value.trim());
        
        if (!hasData) {
            this.showNotification('Cannot delete empty row', 'warning');
            return;
        }
        
        this.removeDeleteConfirmationBar();
        
        const serviceName = rowEntries[0]?.value || 'Untitled';
        const rowNumber = rowIndex + 1;
        
        this.pendingDeleteRowIndex = rowIndex;
        
        const confirmationBar = this.createDeleteConfirmationBar(rowIndex, serviceName, rowNumber);
        
        const previewSection = document.querySelector('.preview-section');
        const previewContainer = document.getElementById('previewContainer');
        
        if (previewSection && previewContainer) {
            previewSection.insertBefore(confirmationBar, previewContainer);
        } else {
            const container = document.getElementById('previewContainer');
            if (container && container.parentNode) {
                container.parentNode.insertBefore(confirmationBar, container);
            }
        }
        
        confirmationBar.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    createDeleteConfirmationBar(rowIndex, serviceName, rowNumber) {
        const div = document.createElement('div');
        div.className = 'delete-confirmation-bar';
        div.setAttribute('data-row-index', rowIndex);
        div.style.cssText = `
            background: rgba(239, 68, 68, 0.08);
            border: 1px solid rgba(239, 68, 68, 0.3);
            border-radius: 8px;
            margin: 0 0 16px 0;
            padding: 12px 16px;
            animation: slideDown 0.2s ease;
        `;
        
        div.innerHTML = `
            <div style="display: flex; justify-content: space-between; gap: 12px;flex-direction: column;">
                <div style="display: flex; align-items: center; gap: 12px; flex: 1;">
                    <div style="
                        width: 32px;
                        height: 32px;
                        background: rgba(239, 68, 68, 0.15);
                        border-radius: 8px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                    ">
                        <i class="fas fa-exclamation-triangle" style="color: var(--danger, #ef4444); font-size: 16px;"></i>
                    </div>
                    <div>
                        <div style="color: var(--f-label); font-size: 0.85rem; font-weight: 500;">
                            Delete "<strong style="color: var(--danger, #ef4444);">${this.escapeHtml(serviceName)}</strong>" (Row ${rowNumber})?
                        </div>
                        <div style="color: var(--text-secondary, #a0a0b0); font-size: 0.7rem; margin-top: 2px;">
                            All data in this row will be permanently deleted.
                        </div>
                    </div>
                </div>

                <div style="display: flex; align-items: center; gap: 10px; justify-content: flex-end;">
                    <button class="delete-confirm-btn btn btn-danger">
                        <i class="fas fa-trash"></i> Delete
                    </button>
                    <button class="delete-cancel-btn btn btn-secondary">
                        Cancel
                    </button>
                </div>
            </div>
            <div class="delete-confirm-error" style="
                color: var(--danger, #ef4444);
                font-size: 0.65rem;
                margin-top: 10px;
                display: none;
            "></div>
        `;
        
        const confirmBtn = div.querySelector('.delete-confirm-btn');
        const cancelBtn = div.querySelector('.delete-cancel-btn');
        const errorDiv = div.querySelector('.delete-confirm-error');
        
        confirmBtn.addEventListener('click', () => {
            this.deleteRowConfirmed(rowIndex);
        });
        
        cancelBtn.addEventListener('click', () => {
            this.removeDeleteConfirmationBar();
            this.pendingDeleteRowIndex = null;
        });
        
        return div;
    }

    removeDeleteConfirmationBar() {
        const existingBar = document.querySelector('.delete-confirmation-bar');
        if (existingBar) {
            existingBar.style.animation = 'fadeOut 0.15s ease';
            setTimeout(() => {
                if (existingBar.parentNode) {
                    existingBar.remove();
                }
            }, 150);
        }
    }

    async deleteRowConfirmed(rowIndex) {
        const credentialIndex = this.credentials.findIndex(cr => cr.id === 1);
        if (credentialIndex !== -1) {
            const entries = this.credentials[credentialIndex].entries;
            const startIndex = rowIndex * 4;
            
            entries.splice(startIndex, 4);
            
            entries.forEach((entry, index) => {
                entry.originalIndex = index;
                entry.lineNumber = Math.floor(index / 4) + 1;
            });
            
            this.credentials[credentialIndex].lastUpdated = 'Just now';
            
            await this.saveToStorage();
            await this.syncAfterSingleRowDeletion(rowIndex);
            
            this.removeDeleteConfirmationBar();
            this.pendingDeleteRowIndex = null;
            this.updatePreview();
            this.showNotification(`Row ${rowIndex + 1} deleted successfully`, 'success');
        }
    }

    addDeleteStyles() {
        if (!document.getElementById('delete-styles')) {
            const style = document.createElement('style');
            style.id = 'delete-styles';
            style.textContent = `
                @keyframes slideDown {
                    from { opacity: 0; transform: translateY(-10px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                @keyframes fadeOut {
                    from { opacity: 1; transform: translateY(0); }
                    to { opacity: 0; transform: translateY(-10px); }
                }
                .delete-confirmation-bar {
                    animation: slideDown 0.2s ease;
                }
            `;
            document.head.appendChild(style);
        }
    }

    // ========== UI RENDERING ==========
    render(containerId) {
        const container = document.getElementById(containerId);
        if (!container) {
            console.error('Credential container not found:', containerId);
            return;
        }

        container.innerHTML = this.getManagerHTML();
        this.attachEventListeners();
        this.attachFormEventListeners();
        this.updatePreview();
    }

    getManagerHTML() {
        return `
            <div class="credential-container" style="padding: 0; margin: 0">
                ${this.getHeaderHTML()}
                ${this.credentialHTML()}
                ${this.getPreviewSectionHTML()}
            </div>
        `;
    }

    getHeaderHTML() {
        return `
            <div class="module-card">
                <div class="module-icon" style="color: var(--primary);">
                    <i class="fas fa-key"></i>
                </div>
                <div class="module-info">
                    <div class="module-title">Credential Manager</div>
                    <div class="module-description">Responsive sliding columns</div>
                </div>
                <div style="display: flex; gap: 8px; margin-right: 8px;">
                    <button onclick="credentialManager.copyAll()" class="btn btn-secondary">
                        <i class="fas fa-copy"></i> Copy All
                    </button>
                    <button id="toggleCredentialFormBtn" 
                        onclick="credentialManager.toggleCredentialForm()" 
                        class="btn btn-primary"
                        style="display: inline-flex; align-items: center; gap: 8px;">
                        <i class="fas fa-chevron-up"></i> Hide Form
                    </button>
                </div>
            </div>
        `;
    }

    // ========== UPDATED FORM HTML (NO 2FA, NO CUSTOM FIELD) ==========
    getCredentialFormHTML() {
        return `
            <div class="section-card" id="credentialFormCard" style="margin-bottom: 8px;">
                <div class="section-card-header">
                    <div class="section-card-title">
                        <i class="fas ${this.isEditing ? 'fa-edit' : 'fa-plus-circle'}"></i>
                        <span>${this.isEditing ? 'Edit Credential' : 'Add New Credential'}</span>
                    </div>
                    <span class="section-card-badge">
                        <i class="fas ${this.isEditing ? 'fa-pen' : 'fa-plus'}"></i>
                        ${this.isEditing ? 'Editing' : 'New'}
                    </span>
                    ${this.isEditing ? `
                        <button id="credentialFormCancelBtn" class="btn btn-secondary" style="margin-left: auto;">
                            Cancel
                        </button>
                    ` : ''}
                </div>
                <div class="section-card-content">
                    <form class="settings-form" id="credentialForm">
                        <div class="form-row">
                            <div class="form-group">
                                <label class="form-label" for="formServiceTag">
                                    Service Tag <span style="color: var(--danger);">*</span>
                                </label>
                                <input type="text" id="formServiceTag" class="form-input" placeholder="e.g., Google, GitHub" autocomplete="off">
                            </div>
                            <div class="form-group">
                                <label class="form-label" for="formUserID">
                                    User ID <span style="color: var(--danger);">*</span>
                                </label>
                                <input type="text" id="formUserID" class="form-input" placeholder="Email, phone, or username" autocomplete="off">
                            </div>
                        </div>
                        
                        <div class="form-row">
                            <div class="form-group">
                                <label class="form-label" for="formPassword">Password</label>
                                <div class="password-input-group">
                                    <input type="password" id="formPassword" class="form-input" placeholder="Enter password" autocomplete="off">
                                    <button type="button" class="toggle-password-btn" data-target="formPassword">
                                        <i class="fas fa-eye"></i>
                                    </button>
                                </div>
                            </div>
                        </div>

                        <!-- Note field - full width -->
                        <div class="form-row" style="margin-top: 8px;">
                            <div class="form-group" style="grid-column: 1 / -1;">
                                <label class="form-label" for="formNote">Note (max 500 chars)</label>
                                <textarea id="formNote" class="form-input" placeholder="Save any other credential details here (e.g., security questions, API keys, backup codes)" 
                                    rows="2" style="resize: vertical; min-height: 50px; font-family: inherit;"></textarea>
                                <div class="form-help" id="noteCharCount">0 / 500 characters</div>
                            </div>
                        </div>
                        
                        <div class="form-actions">
                            <button type="button" id="credentialFormClearBtn" class="btn btn-secondary">
                                <i class="fas fa-broom"></i> Clear
                            </button>
                            <button type="button" id="credentialFormAddBtn" class="btn btn-primary" style="${this.isEditing ? 'display: none;' : ''}">
                                <i class="fas fa-save"></i> Save Credential
                            </button>
                            <button type="button" id="credentialFormUpdateBtn" class="btn btn-primary" style="${this.isEditing ? '' : 'display: none;'}">
                                <i class="fas fa-pen"></i> Update Credential
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        `;
    }

    toggleCredentialForm() {
        const formCard = document.getElementById('credentialFormCard');
        const toggleBtn = document.getElementById('toggleCredentialFormBtn');
        
        if (formCard) {
            const isHidden = formCard.style.display === 'none';
            if (isHidden) {
                formCard.style.display = '';
                if (toggleBtn) {
                    toggleBtn.innerHTML = '<i class="fas fa-chevron-up"></i> Hide Form';
                }
            } else {
                formCard.style.display = 'none';
                if (toggleBtn) {
                    toggleBtn.innerHTML = '<i class="fas fa-chevron-down"></i> Add Credential';
                }
            }
        }
    }

    credentialHTML() {
        const credentialSet = this.getCredentialSet();
        const entries = credentialSet.entries || [];
        
        const rowsNeeded = Math.ceil(entries.length / 4);
        const needsVerticalScroll = rowsNeeded >= 5;
        const tableHeight = needsVerticalScroll ? '220px' : 'auto';
        
        return `
            <div class="table-wrapper" style="
                width: 100%;
                max-width: 100%;
                background: var(--panel);
                margin: 8px 0;
            ">
                ${this.getCredentialFormHTML()}
            </div>
        `;
    }

    // ========== FORM HANDLERS ==========
    getFormData() {
        return {
            serviceTag: document.getElementById('formServiceTag')?.value || '',
            userid: document.getElementById('formUserID')?.value || '',
            password: document.getElementById('formPassword')?.value || '',
            note: document.getElementById('formNote')?.value || ''
        };
    }

    clearForm() {
        const serviceTag = document.getElementById('formServiceTag');
        const userid = document.getElementById('formUserID');
        const password = document.getElementById('formPassword');
        const note = document.getElementById('formNote');
        
        if (serviceTag) serviceTag.value = '';
        if (userid) userid.value = '';
        if (password) {
            password.value = '';
            password.type = 'password';
            const toggleBtn = document.querySelector('.toggle-password-btn[data-target="formPassword"]');
            if (toggleBtn) {
                const icon = toggleBtn.querySelector('i');
                if (icon) icon.className = 'fas fa-eye';
            }
        }
        if (note) {
            note.value = '';
            const counterSpan = document.getElementById('noteCharCount');
            if (counterSpan) counterSpan.innerHTML = '0 / 500 characters';
        }
        
        if (serviceTag) serviceTag.focus();
    }

    toggleFormPasswordVisibility(inputId, button) {
        const input = document.getElementById(inputId);
        const icon = button.querySelector('i');
        
        if (input.type === 'password') {
            input.type = 'text';
            icon.className = 'fas fa-eye-slash';
        } else {
            input.type = 'password';
            icon.className = 'fas fa-eye';
        }
    }

    submitAdd() {
        const formData = this.getFormData();
        
        if (!formData.serviceTag.trim()) {
            this.showNotification('Please enter a service tag', 'warning');
            document.getElementById('formServiceTag')?.focus();
            return;
        }
        
        this.addCredentialForm(formData);
        this.showNotification(`Added "${formData.serviceTag}"`, 'success');
        this.clearForm();
    }

    submitUpdate() {
        const formData = this.getFormData();
        
        if (!formData.serviceTag.trim()) {
            this.showNotification('Please enter a service tag', 'warning');
            document.getElementById('formServiceTag')?.focus();
            return;
        }
        
        if (this.isEditing && this.editingRowIndex !== null) {
            this.updateCredentialRow(this.editingRowIndex, formData);
            this.showNotification(`Updated "${formData.serviceTag}"`, 'success');
            this.cancelEdit();
        } else {
            this.showNotification('No credential selected for update', 'warning');
        }
    }

    addCredentialForm(formData) {
        const credentialSet = this.getCredentialSet();
        const entries = credentialSet.entries || [];
        
        const noteValue = formData.note || '';
        if (formData.note && formData.note.length > 500) {
            this.showNotification('Note was truncated to 500 characters', 'warning');
        }
        
        const startIndex = entries.length;
        const newRowNumber = Math.floor(startIndex / 4) + 1;
        
        // 4 fields per row: Service, UserID, Password, Note
        const newEntries = [
            { value: formData.serviceTag, display: formData.serviceTag, pending: false, pendingAt: null, isEmpty: !formData.serviceTag, isWhitespaceOnly: false, originalIndex: startIndex, lineNumber: newRowNumber },
            { value: formData.userid, display: formData.userid, pending: false, pendingAt: null, isEmpty: !formData.userid, isWhitespaceOnly: false, originalIndex: startIndex + 1, lineNumber: newRowNumber },
            { value: formData.password, display: formData.password, pending: false, pendingAt: null, isEmpty: !formData.password, isWhitespaceOnly: false, originalIndex: startIndex + 2, lineNumber: newRowNumber },
            { value: noteValue, display: noteValue, pending: false, pendingAt: null, isEmpty: !noteValue, isWhitespaceOnly: false, originalIndex: startIndex + 3, lineNumber: newRowNumber }
        ];
        
        entries.push(...newEntries);
        
        this.updateCredentials({ entries: entries, lastUpdated: 'Just now' });
        this.updatePreview();
        
        const newRowIndex = Math.floor(startIndex / 4);
        setTimeout(() => this.syncRowToFirebase(newRowIndex), 100);
    }

    updateCredentialRow(rowIndex, formData) {
        const credentialIndex = this.credentials.findIndex(cr => cr.id === 1);
        if (credentialIndex !== -1) {
            const entries = this.credentials[credentialIndex].entries;
            const startIndex = rowIndex * 4;
            
            const noteValue = formData.note || '';
            if (formData.note && formData.note.length > 500) {
                this.showNotification('Note was truncated to 500 characters', 'warning');
            }

            if (startIndex + 3 < entries.length) {
                entries[startIndex].value = formData.serviceTag;
                entries[startIndex].display = formData.serviceTag;
                entries[startIndex].isEmpty = !formData.serviceTag;
                
                entries[startIndex + 1].value = formData.userid;
                entries[startIndex + 1].display = formData.userid;
                entries[startIndex + 1].isEmpty = !formData.userid;
                
                entries[startIndex + 2].value = formData.password;
                entries[startIndex + 2].display = formData.password;
                entries[startIndex + 2].isEmpty = !formData.password;
                
                entries[startIndex + 3].value = noteValue;
                entries[startIndex + 3].display = noteValue;
                entries[startIndex + 3].isEmpty = !noteValue;
                
                const allFieldsFilled = formData.serviceTag && formData.userid && formData.password;
                if (allFieldsFilled) {
                    for (let i = 0; i < 4; i++) {
                        if (entries[startIndex + i]) {
                            entries[startIndex + i].pending = false;
                            entries[startIndex + i].pendingAt = null;
                        }
                    }
                }
                
                this.credentials[credentialIndex].lastUpdated = 'Just now';
                this.saveToStorage();
                this.updatePreview();
                setTimeout(() => this.syncRowToFirebase(rowIndex), 100);
            }
        }
    }

    editCredential(rowIndex) {
        const credentialSet = this.getCredentialSet();
        const entries = credentialSet.entries || [];
        const startIndex = rowIndex * 4;
        
        if (startIndex + 3 < entries.length) {
            this.isEditing = true;
            this.editingRowIndex = rowIndex;
            
            this.currentFormData = {
                serviceTag: entries[startIndex]?.value || '',
                userid: entries[startIndex + 1]?.value || '',
                password: entries[startIndex + 2]?.value || '',
                note: entries[startIndex + 3]?.value || ''
            };
            
            this.updateFormToEditMode();

            const form = document.getElementById('credentialFormCard');
            if (form) {
                form.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
            
            const serviceTagField = document.getElementById('formServiceTag');
            if (serviceTagField) {
                serviceTagField.focus();
            }
            
            this.showNotification(`Editing "${this.currentFormData.serviceTag || 'credential'}"`, 'info');
        }
    }

    editCredentialFromPreview(rowIndex) {
        this.editCredential(rowIndex);
    }

    cancelEdit() {
        this.isEditing = false;
        this.editingRowIndex = null;
        this.currentFormData = { serviceTag: '', userid: '', password: '', note: '' };
        
        const formContainer = document.getElementById('credentialFormCard');
        if (formContainer) {
            const parent = formContainer.parentNode;
            const newFormHTML = this.getCredentialFormHTML();
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = newFormHTML;
            const newForm = tempDiv.firstElementChild;
            parent.replaceChild(newForm, formContainer);
            this.attachFormEventListeners();
            
            const updatedForm = document.getElementById('credentialFormCard');
            if (updatedForm) updatedForm.style.display = '';
            
            const toggleBtn = document.getElementById('toggleCredentialFormBtn');
            if (toggleBtn && toggleBtn.innerHTML.includes('Show')) {
                toggleBtn.innerHTML = '<i class="fas fa-chevron-up"></i> Hide Form';
            }
        } else {
            const container = document.getElementById('credentialContainer');
            if (container) {
                container.innerHTML = this.getManagerHTML();
                this.attachEventListeners();
                this.attachFormEventListeners();
            }
        }
        this.showNotification('Edit cancelled', 'info');
    }

    updateFormToEditMode() {
        const formContainer = document.getElementById('credentialFormCard');
        if (!formContainer) {
            const container = document.getElementById('credentialContainer');
            if (container) {
                container.innerHTML = this.getManagerHTML();
                this.attachEventListeners();
                this.attachFormEventListeners();
            }
            return;
        }
        
        formContainer.style.display = '';
        
        const toggleBtn = document.getElementById('toggleCredentialFormBtn');
        if (toggleBtn) {
            toggleBtn.innerHTML = '<i class="fas fa-chevron-up"></i> Hide Form';
        }
        
        const parent = formContainer.parentNode;
        const newFormHTML = this.getCredentialFormHTML();
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = newFormHTML;
        const newForm = tempDiv.firstElementChild;
        parent.replaceChild(newForm, formContainer);
        
        this.attachFormEventListeners();
        this.populateFormFields();
    }

    populateFormFields() {
        const serviceTagField = document.getElementById('formServiceTag');
        const useridField = document.getElementById('formUserID');
        const passwordField = document.getElementById('formPassword');
        const noteField = document.getElementById('formNote');
        
        if (serviceTagField) serviceTagField.value = this.currentFormData.serviceTag || '';
        if (useridField) useridField.value = this.currentFormData.userid || '';
        if (passwordField) passwordField.value = this.currentFormData.password || '';
        if (noteField) {
            const noteValue = (this.currentFormData.note || '').substring(0, 500);
            noteField.value = noteValue;
            const counterSpan = document.getElementById('noteCharCount');
            if (counterSpan) counterSpan.innerHTML = `${noteValue.length} / 500 characters`;
        }
        
        if (passwordField && passwordField.type !== 'password') {
            passwordField.type = 'password';
            const toggleBtn = document.querySelector('.toggle-password-btn[data-target="formPassword"]');
            if (toggleBtn) {
                const icon = toggleBtn.querySelector('i');
                if (icon) icon.className = 'fas fa-eye';
            }
        }
        
        const addBtn = document.getElementById('credentialFormAddBtn');
        const updateBtn = document.getElementById('credentialFormUpdateBtn');
        
        if (addBtn) addBtn.style.display = this.isEditing ? 'none' : 'inline-flex';
        if (updateBtn) updateBtn.style.display = this.isEditing ? 'inline-flex' : 'none';
    }

    attachFormEventListeners() {
        const form = document.getElementById('credentialForm');
        if (form) {
            form.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    const activeElement = document.activeElement;
                    if (activeElement && activeElement.tagName !== 'TEXTAREA') {
                        e.preventDefault();
                        if (this.isEditing) {
                            this.submitUpdate();
                        } else {
                            this.submitAdd();
                        }
                    }
                }
            });
        }
        
        const noteField = document.getElementById('formNote');
        if (noteField) {
            const maxNoteLength = 500;
            const updateCharCount = () => {
                const count = noteField.value.length;
                const counterSpan = document.getElementById('noteCharCount');
                if (counterSpan) {
                    counterSpan.innerHTML = `${count} / ${maxNoteLength} characters`;
                    counterSpan.style.color = count > maxNoteLength ? 'var(--danger)' : 'var(--muted)';
                }
                if (count > maxNoteLength) {
                    noteField.value = noteField.value.substring(0, maxNoteLength);
                    if (counterSpan) counterSpan.innerHTML = `${maxNoteLength} / ${maxNoteLength} characters (max reached)`;
                }
            };
            noteField.addEventListener('input', updateCharCount);
            noteField.addEventListener('keydown', updateCharCount);
            updateCharCount();
        }
        
        document.querySelectorAll('.toggle-password-btn').forEach(btn => {
            btn.removeEventListener('click', this.handlePasswordToggle);
            btn.addEventListener('click', (e) => {
                const targetId = btn.getAttribute('data-target');
                this.toggleFormPasswordVisibility(targetId, btn);
            });
        });
        
        const addBtn = document.getElementById('credentialFormAddBtn');
        if (addBtn) {
            const newAddBtn = addBtn.cloneNode(true);
            addBtn.parentNode.replaceChild(newAddBtn, addBtn);
            newAddBtn.onclick = (e) => {
                e.preventDefault();
                this.submitAdd();
            };
            newAddBtn.style.display = this.isEditing ? 'none' : 'inline-flex';
        }
        
        const updateBtn = document.getElementById('credentialFormUpdateBtn');
        if (updateBtn) {
            const newUpdateBtn = updateBtn.cloneNode(true);
            updateBtn.parentNode.replaceChild(newUpdateBtn, updateBtn);
            newUpdateBtn.onclick = (e) => {
                e.preventDefault();
                this.submitUpdate();
            };
            newUpdateBtn.style.display = this.isEditing ? 'inline-flex' : 'none';
        }
        
        const cancelBtn = document.getElementById('credentialFormCancelBtn');
        if (cancelBtn) {
            const newCancelBtn = cancelBtn.cloneNode(true);
            cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
            newCancelBtn.onclick = (e) => {
                e.preventDefault();
                this.cancelEdit();
            };
        }
        
        const clearBtn = document.getElementById('credentialFormClearBtn');
        if (clearBtn) {
            const newClearBtn = clearBtn.cloneNode(true);
            clearBtn.parentNode.replaceChild(newClearBtn, clearBtn);
            newClearBtn.onclick = (e) => {
                e.preventDefault();
                this.clearForm();
            };
        }
    }

    // ========== PREVIEW SECTION HTML ==========
    getPreviewSectionHTML() {
        return `
            <div class="preview-section" style="margin-top: 24px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <h3 style="margin: 0; color: var(--text); display: flex; align-items: center; gap: 8px; font-size: 0.96rem;">
                            <i class="fas fa-display" style="color: var(--active); font-size: 0.8rem;"></i>
                            Preview
                        </h3>
                        <button id="togglePasswordVisibility" style="
                            background: transparent;
                            border: 1px solid var(--active);
                            color: var(--active);
                            padding: 4px 6px;
                            border-radius: 4px;
                            cursor: pointer;
                            font-size: 0.65rem;
                            display: flex;
                            align-items: center;
                            gap: 4px;
                            transition: all 0.2s;
                        ">
                            <i class="fas fa-eye" style="font-size: 0.65rem;"></i> Show Passwords
                        </button>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <span style="font-size: 0.65rem; color: var(--muted); display: flex; align-items: center; gap: 4px;">
                            <i class="fas fa-circle" style="color: var(--primary); font-size: 0.48rem;"></i> Active
                        </span>
                        <span style="font-size: 0.65rem; color: var(--muted); display: flex; align-items: center; gap: 4px;">
                            <i class="fas fa-circle" style="color: var(--danger); font-size: 0.48rem;"></i> Pending
                        </span>
                    </div>
                </div>
                
                <!-- Search and Filter Bar -->
                <div class="preview-actions" style="
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 12px;
                    flex-wrap: wrap;
                    gap: 12px;
                ">
                    <div class="preview-search" style="
                        flex: 1;
                        min-width: 200px;
                        position: relative;
                        background: var(--card-bg);
                        border: 1px solid var(--border);
                        border-radius: 8px;
                        padding: 4px 8px;
                        display: flex;
                        align-items: center;
                        transition: all 0.3s;
                    ">
                        <i class="fas fa-search" style="
                            color: var(--text-secondary);
                            font-size: 0.85rem;
                            margin-right: 8px;
                        "></i>
                        <input type="text" 
                            id="previewSearchInput" 
                            placeholder="Search in preview..." 
                            style="
                                flex: 1;
                                background: transparent;
                                border: none;
                                color: var(--text-primary);
                                font-size: 0.8rem;
                                padding: 4px 0;
                                outline: none;
                                width: 100%;
                            "
                            oninput="credentialManager.handlePreviewSearch()">
                        <div id="searchResultsCount" class="search-results-count" style="
                            display: none;
                            align-items: center;
                            gap: 6px;
                            margin-left: 8px;
                            padding-left: 8px;
                            border-left: 1px solid var(--border);
                            color: var(--text-secondary);
                            font-size: 0.65rem;
                            font-weight: 500;
                            white-space: nowrap;
                        ">
                            <span id="searchResultCountValue">0</span>
                            <span>results</span>
                            <button id="clearSearchBtn" class="btn-clear-search" style="
                                background: transparent;
                                border: none;
                                color: var(--danger);
                                cursor: pointer;
                                padding: 2px 4px;
                                font-size: 0.7rem;
                                transition: all 0.2s;
                                display: flex;
                                align-items: center;
                                justify-content: center;
                                border-radius: 4px;
                            " title="Clear search">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                    </div>

                    <div class="preview-filter-container" style="
                        display: flex;
                        gap: 4px;
                        background: transparent;
                        border: none;
                        padding: 4px;
                        margin: 0;
                    ">
                        <button id="previewFilterAll" 
                                class="preview-filter-btn active"
                                onclick="credentialManager.setPreviewFilter('all')"
                                style="
                                    width: 28px;
                                    height: 28px;
                                    display: flex;
                                    align-items: center;
                                    justify-content: center;
                                    border-radius: 6px;
                                    background: var(--active);
                                    border: none;
                                    color: var(--primary);
                                    cursor: pointer;
                                    transition: all 0.3s;
                                    font-size: 0.85rem;
                                "
                                title="All Credentials">
                            <i class="fas fa-list-ol"></i>
                        </button>
                        <button id="previewFilterActive" 
                                class="preview-filter-btn"
                                onclick="credentialManager.setPreviewFilter('active')"
                                style="
                                    width: 28px;
                                    height: 28px;
                                    display: flex;
                                    align-items: center;
                                    justify-content: center;
                                    border-radius: 6px;
                                    background: transparent;
                                    border: none;
                                    color: var(--text-secondary);
                                    cursor: pointer;
                                    transition: all 0.3s;
                                    font-size: 0.85rem;
                                "
                                title="Active Credentials">
                            <i class="fas fa-user-shield"></i>
                        </button>
                        <button id="previewFilterPending" 
                                class="preview-filter-btn"
                                onclick="credentialManager.setPreviewFilter('pending')"
                                style="
                                    width: 28px;
                                    height: 28px;
                                    display: flex;
                                    align-items: center;
                                    justify-content: center;
                                    border-radius: 6px;
                                    background: transparent;
                                    border: none;
                                    color: var(--text-secondary);
                                    cursor: pointer;
                                    transition: all 0.3s;
                                    font-size: 0.85rem;
                                "
                                title="Pending Credentials">
                            <i class="fas fa-clock"></i>
                        </button>
                        
                        <div class="active-filter-count" id="credentialFilterCount" style="
                            margin-left: 8px;
                            display: flex;
                            align-items: center;
                            padding: 0 8px;
                            color: var(--primary);
                            background: transparent;
                            font-weight: 600;
                            font-size: 0.75rem;
                            justify-content: center;
                            transition: all 0.3s ease;
                        ">
                            <span id="filterCountValue">0</span>
                        </div>
                    </div>
                </div>
                
                <div id="deleteConfirmationContainer"></div>
                
                <div id="previewContainer" style="
                    border-top: 1px solid var(--border);
                    padding: 4px 0;
                    height: 100%;
                    overflow-y: auto;
                ">
                    ${this.getPreviewContentHTML()}
                </div>
            </div>
        `;
    }

    // ========== PREVIEW CONTENT HTML (UPDATED: 4 FIELDS) ==========
getPreviewContentHTML() {
    const credentialSet = this.getCredentialSet();
    let entries = credentialSet.entries || [];

    if (entries.length === 0) {
        return `
            <div style="text-align: center; padding: 32px 16px; color: var(--muted); font-size: 0.8rem;">
                <i class="fas fa-key" style="font-size: 2rem; margin-bottom: 12px; display: block; opacity: 0.3;"></i>
                <h4 style="margin: 0 0 8px; font-weight: 500; font-size: 0.8rem;">No credentials to preview</h4>
                <p style="margin: 0; font-size: 0.72rem;">Add credentials using the form above</p>
            </div>
        `;
    }

    let html = '';
    const rows = Math.ceil(entries.length / 4);
    const showPasswords = this.showPasswords || false;

    let filteredRows = [];
    for (let rowIndex = rows - 1; rowIndex >= 0; rowIndex--) {
        const startIndex = rowIndex * 4;
        const rowEntries = entries.slice(startIndex, startIndex + 4);

        let matchesSearch = true;
        if (this.currentSearchTerm) {
            matchesSearch = rowEntries.some(entry =>
                entry && entry.value && entry.value.toLowerCase().includes(this.currentSearchTerm)
            );
        }

        let matchesFilter = true;
        if (this.currentPreviewFilter !== 'all') {
            const hasData = rowEntries.some(entry => entry && entry.value && entry.value.trim());
            const isPending = rowEntries.some(entry => entry && entry.pending);

            switch (this.currentPreviewFilter) {
                case 'active':
                    matchesFilter = hasData && !isPending;
                    break;
                case 'pending':
                    matchesFilter = isPending;
                    break;
            }
        }

        if (matchesSearch && matchesFilter) {
            filteredRows.push({ rowIndex, rowEntries });
        }
    }

    if (filteredRows.length === 0) {
        return `
            <div style="text-align: center; padding: 32px 16px; color: var(--muted); font-size: 0.8rem;">
                <i class="fas fa-search" style="font-size: 2.4rem; margin-bottom: 12px; display: block; opacity: 0.3;"></i>
                <h4 style="margin: 0 0 8px; font-weight: 500; font-size: 0.8rem;">No matching credentials found</h4>
                <p style="margin: 0; font-size: 0.72rem;">Try a different search or filter</p>
            </div>
        `;
    }

    filteredRows.forEach(({ rowIndex, rowEntries }, index) => {
        const rowNumber = rowIndex + 1;
        const serviceEntry = rowEntries[0];
        const serviceInfo = serviceEntry && serviceEntry.value && serviceEntry.value.trim()
            ? this.getServiceInfo(serviceEntry.value)
            : null;
        const isRowPending = rowEntries.some(entry => entry && entry.pending);

        const userIDEntry = rowEntries[1];
        const passwordEntry = rowEntries[2];
        const noteEntry = rowEntries[3];

        // --- User ID ---
        let userIdDisplay = '';
        let userIdCopy = '';
        if (userIDEntry && userIDEntry.value && userIDEntry.value.trim()) {
            userIdDisplay = this.escapeHtml(userIDEntry.value);
            userIdCopy = userIDEntry.value;
        }

        // --- Password ---
        let passwordDisplay = '';
        let passwordCopy = '';
        const isPasswordPending = passwordEntry ? passwordEntry.pending : false;
        if (passwordEntry && passwordEntry.value && passwordEntry.value.trim()) {
            passwordCopy = passwordEntry.value;
            if (isPasswordPending || !this.showPasswords) {
                passwordDisplay = '••••••••••';
            } else {
                passwordDisplay = this.escapeHtml(passwordEntry.value);
            }
        }

        // --- Note (with line borders) ---
        let noteContent = '';
        const rawNote = noteEntry ? (noteEntry.value || '') : '';
        if (!rawNote.trim()) {
            noteContent = `<div style="color: var(--muted); font-style: italic; font-size: 0.7rem;">(empty)</div>`;
        } else {
            const lines = rawNote.split('\n');
            lines.forEach((line, lineIndex) => {
                const trimmed = line.trim();
                const isLast = (lineIndex === lines.length - 1);

                // --- SEPARATOR: line with 3+ dashes ---
                if (/^[-]{3,}$/.test(trimmed)) {
                    noteContent += `
                        <hr style="
                            border: none;
                            border-top: 1px solid rgba(255,255,255,0.15);
                            margin: 6px 0;
                            opacity: 0.6;
                        ">
                    `;
                    return;
                }

                // --- Empty line: preserve vertical space ---
                if (!trimmed) {
                    noteContent += `
                        <div style="
                            height: 1.2em; 
                            line-height: 1.2em; 
                            min-height: 1.2em;
                            border-bottom: ${isLast ? 'none' : '1px solid rgba(255,255,255,0.06)'};
                            padding-bottom: 2px;
                        ">
                            &nbsp;
                        </div>
                    `;
                    return;
                }

                // --- Parse the line for key-value patterns ---
                const parsed = this.parseNoteLine(line);
                let copyText = parsed.display;
                if (!parsed.icon) {
                    copyText = line;
                }
                const safeCopy = copyText.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
                const displayHtml = this.escapeHtml(parsed.display);
                const labelHtml = this.escapeHtml(parsed.label);

                if (parsed.icon) {
                    // Key-value line with icon + label + value
                    noteContent += `
                        <div onclick="event.stopPropagation(); credentialManager.copyToClipboard('${safeCopy}')" 
                            style="
                                display: flex; 
                                align-items: center; 
                                gap: 4px; 
                                margin: 1px 0; 
                                cursor: pointer; 
                                border-radius: 4px; 
                                padding: 0 2px 2px 2px;
                                transition: background 0.15s;
                                border-bottom: ${isLast ? 'none' : '1px solid rgba(255,255,255,0.06)'};
                            "
                            title="Click to copy value">
                            <i class="${parsed.icon}" style="font-size: 0.65rem; color: ${isRowPending ? 'var(--danger)' : 'var(--f-label)'}; min-width: 14px;"></i>
                            <span style="color: ${isRowPending ? 'var(--danger)' : 'var(--f-label)'}; font-size: 0.7rem; font-weight: 500;">${labelHtml}</span>
                            <span style="font-size: 0.75rem; word-break: break-all; color: ${isRowPending ? 'var(--danger)' : 'var(--f-label)'};">${displayHtml}</span>
                        </div>
                    `;
                } else {
                    // Plain text line
                    noteContent += `
                        <div onclick="event.stopPropagation(); credentialManager.copyToClipboard('${safeCopy}')" 
                            style="
                                font-size: 0.75rem; 
                                word-break: break-all; 
                                padding: 1px 2px 2px 2px; 
                                cursor: pointer; 
                                border-radius: 4px;
                                transition: background 0.15s;
                                border-bottom: ${isLast ? 'none' : '1px solid rgba(255,255,255,0.06)'};
                                color: ${isRowPending ? 'var(--danger)' : 'var(--f-label)'};
                            "
                            title="Click to copy">
                            ${displayHtml}
                        </div>
                    `;
                }
            });
        }

        // --- Build the preview card ---
        html += `
            <div class="preview-card" style="
                padding: 2px 0;
                margin-bottom: 4px;
                transition: all 0.3s ease;
                position: relative;
                overflow: hidden;
                font-size: 0.8rem;
            ">
                <!-- Row Header -->
                <div style="
                    display: flex; justify-content: space-between; 
                    align-items: flex-start; margin-bottom: 2px;
                    background: ${isRowPending ? 'rgba(239,68,68,0.05)' : 'rgba(255,255,255,0.04)'};
                    border: 1px solid ${isRowPending ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.1)'};
                    border-radius: 4px 4px 0 0;
                ">
                    <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                        <div style="
                            background: transparent;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            padding: 0 4px;
                            color: ${isRowPending ? 'var(--danger)' : 'var(--f-label)'};
                            font-weight: 700;
                            font-size: 0.75rem;
                        ">
                            #${rowNumber}
                        </div>

                        ${serviceInfo ? `
                            <div style="display: flex; align-items: center; gap: 6px; padding: 4px; background: transparent; border-radius: 4px;">
                                <i class="${serviceInfo.icon}" style="color: ${isRowPending ? 'var(--danger)' : 'var(--f-label)'}; font-size: 0.75rem;"></i>
                                <span style="color: ${isRowPending ? 'var(--danger)' : 'var(--f-label)'}; font-weight: 600; font-size: 0.75rem;">${serviceInfo.name}</span>
                            </div>
                        ` : serviceEntry && serviceEntry.value && serviceEntry.value.trim() ? `
                            <div style="display: flex; align-items: center; gap: 6px; padding: 4px; background: transparent; border-radius: 4px;">
                                <i class="fas fa-globe" style="color: ${isRowPending ? 'var(--danger)' : 'var(--f-label)'}; font-size: 0.75rem;"></i>
                                <span style="color: ${isRowPending ? 'var(--danger)' : 'var(--f-label)'}; font-weight: 600; font-size: 0.75rem;">
                                    ${this.escapeHtml(serviceEntry.value).substring(0, 20)}
                                </span>
                            </div>
                        ` : ''}

                        ${isRowPending ? `
                            <div style="display: flex; align-items: center; gap: 6px; padding: 4px; background: transparent; border-radius: 4px; color: var(--danger);">
                                <i class="fas fa-clock" style="font-size: 0.75rem;"></i>
                                <span style="font-weight: 600; font-size: 0.75rem;">Pending</span>
                            </div>
                        ` : ''}
                    </div>

                    <!-- Row Actions -->
                    <div style="display: flex; gap: 6.4px;">
                        <!-- Edit Button -->
                        ${isRowPending ? `
                            <button disabled title="Edit disabled for pending row" style="
                                width: 24px; height: 24px; background: transparent;
                                border: none; color: var(--danger); cursor: not-allowed;
                                display: flex; align-items: center; justify-content: center;
                                opacity: 0.5;
                            ">
                                <i class="fas fa-pen" style="font-size: 0.7rem;"></i>
                            </button>
                        ` : `
                            <button onclick="credentialManager.editCredentialFromPreview(${rowIndex})" title="Edit Credential" style="
                                width: 24px; height: 24px; background: transparent;
                                border: none; color: var(--f-label); cursor: pointer;
                                display: flex; align-items: center; justify-content: center;
                            ">
                                <i class="fas fa-pen" style="font-size: 0.7rem;"></i>
                            </button>
                        `}

                        <!-- Copy Button -->
                        ${isRowPending ? `
                            <button disabled title="Copy disabled for pending row" style="
                                width: 24px; height: 24px; background: transparent;
                                border: none; color: var(--danger); cursor: not-allowed;
                                display: flex; align-items: center; justify-content: center;
                                opacity: 0.5;
                            ">
                                <i class="fas fa-copy" style="font-size: 0.75rem;"></i>
                            </button>
                        ` : `
                            <button onclick="credentialManager.copyRow(${rowIndex})" title="Copy Row" style="
                                width: 24px; height: 24px; background: transparent;
                                border: none; color: var(--f-label); cursor: pointer;
                                display: flex; align-items: center; justify-content: center;
                            ">
                                <i class="fas fa-copy" style="font-size: 0.75rem;"></i>
                            </button>
                        `}

                        <!-- Toggle Button -->
                        <button onclick="credentialManager.toggleRowStatus(${rowIndex})" title="${isRowPending ? 'Activate Row' : 'Mark Pending'}" style="
                            width: 24px; height: 24px; background: transparent;
                            border: none; color: ${isRowPending ? 'var(--primary)' : 'var(--danger)'};
                            cursor: pointer; display: flex; align-items: center; justify-content: center;
                        ">
                            <i class="fas ${isRowPending ? 'fa-play-circle' : 'fa-pause-circle'}" style="font-size: 0.75rem;"></i>
                        </button>

                        <!-- Delete Button -->
                        <button onclick="credentialManager.deleteRow(${rowIndex})" title="Delete Row" style="
                            width: 24px; height: 24px; background: transparent;
                            border: none; color: var(--danger); cursor: pointer;
                            display: flex; align-items: center; justify-content: center;
                        ">
                            <i class="fas fa-trash" style="font-size: 0.75rem;"></i>
                        </button>
                    </div>
                </div>

                <!-- Row Fields -->
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0;">
                    <!-- User ID -->
                    <div class="preview-item"
                        data-value="${this.escapeHtml(userIdCopy)}"
                        onclick="${userIdCopy ? `credentialManager.copyToClipboard('${userIdCopy.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')` : ''}"
                        style="
                            background: ${isRowPending ? 'rgba(239,68,68,0.05)' : 'rgba(255,255,255,0.04)'};
                            border: 1px solid ${isRowPending ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.06)'};
                            border-right: 1px solid rgba(255,255,255,0.08);
                            border-radius: 0;
                            cursor: ${userIdCopy ? 'pointer' : 'default'};
                            transition: all 0.2s;
                            position: relative;
                            overflow: hidden;
                            font-size: 0.75rem;
                            opacity: ${isRowPending ? '0.7' : '1'};
                            min-height: auto;
                            padding: 2px 4px;
                        "
                        title="${userIdCopy ? 'Click to copy User ID' : ''}"
                    >
                        <div style="
                            font-size: 0.6rem;
                            font-weight: 600;
                            color: ${isRowPending ? 'var(--danger)' : 'var(--f-label)'};
                            text-transform: uppercase;
                            letter-spacing: 0.4px;
                            padding: 2px 0;
                        ">
                            User ID
                        </div>
                        <div style="
                            font-size: 0.75rem;
                            color: ${isRowPending ? 'var(--danger)' : 'var(--f-label)'};
                            font-family: monospace;
                            font-weight: 500;
                            word-break: break-all;
                            background: rgba(255, 255, 255, 0.05);
                            padding: 2px 4px;
                            border-radius: 4px;
                            border: 1px solid rgba(255,255,255,0.04);
                            ${isRowPending ? 'text-decoration: line-through;' : ''}
                        ">
                            ${userIdDisplay || '(empty)'}
                        </div>
                    </div>

                    <!-- Password -->
                    <div class="preview-item"
                        data-value="${this.escapeHtml(passwordCopy)}"
                        onclick="${passwordCopy ? `credentialManager.copyToClipboard('${passwordCopy.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')` : ''}"
                        style="
                            background: ${isRowPending ? 'rgba(239,68,68,0.05)' : 'rgba(255,255,255,0.04)'};
                            border: 1px solid ${isRowPending ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.06)'};
                            border-left: none;
                            border-radius: 0;
                            cursor: ${passwordCopy ? 'pointer' : 'default'};
                            transition: all 0.2s;
                            position: relative;
                            overflow: hidden;
                            font-size: 0.75rem;
                            opacity: ${isRowPending ? '0.7' : '1'};
                            min-height: auto;
                            padding: 2px 4px;
                        "
                        title="${passwordCopy ? 'Click to copy Password' : ''}"
                    >
                        <div style="
                            font-size: 0.6rem;
                            font-weight: 600;
                            color: ${isRowPending ? 'var(--danger)' : 'var(--f-label)'};
                            text-transform: uppercase;
                            letter-spacing: 0.4px;
                            padding: 2px 0;
                            display: flex;
                            justify-content: space-between;
                            align-items: center;
                        ">
                            <span>Password</span>
                            ${passwordCopy && !isRowPending ? `
                                <button onclick="event.stopPropagation(); credentialManager.toggleSinglePassword(this, '${this.escapeHtml(passwordCopy)}')"
                                    title="${this.showPasswords ? 'Hide' : 'Show'}"
                                    style="background: transparent; border: none; color: var(--f-label); cursor: pointer; padding: 1px; font-size: 0.65rem; line-height: 1;">
                                    <i class="fas ${this.showPasswords ? 'fa-eye-slash' : 'fa-eye'}"></i>
                                </button>
                            ` : ''}
                        </div>
                        <div style="
                            font-size: 0.75rem;
                            color: ${isRowPending ? 'var(--danger)' : 'var(--f-label)'};
                            font-family: monospace;
                            font-weight: 500;
                            word-break: break-all;
                            background: rgba(255, 255, 255, 0.05);
                            padding: 2px 4px;
                            border-radius: 4px;
                            border: 1px solid rgba(255,255,255,0.04);
                            ${isRowPending ? 'text-decoration: line-through;' : ''}
                        ">
                            ${passwordDisplay || '(empty)'}
                        </div>
                    </div>

                    <!-- Note -->
                    <div class="preview-item"
                        style="
                            grid-column: 1 / -1;
                            margin-top: 2px;
                            border-top: 1px solid rgba(255,255,255,0.08);
                            background: ${isRowPending ? 'rgba(239,68,68,0.05)' : 'rgba(255,255,255,0.04)'};
                            border: 1px solid ${isRowPending ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.06)'};
                            border-radius: 0 0 4px 4px;
                            cursor: default;
                            transition: all 0.2s;
                            position: relative;
                            overflow: hidden;
                            font-size: 0.75rem;
                            opacity: ${isRowPending ? '0.7' : '1'};
                            min-height: auto;
                            padding: 2px 4px;
                        ">
                        <div style="
                            font-size: 0.6rem;
                            font-weight: 600;
                            color: ${isRowPending ? 'var(--danger)' : 'var(--f-label)'};
                            text-transform: uppercase;
                            letter-spacing: 0.4px;
                            padding: 2px 0;
                        ">
                            Note <span style="font-size: 0.5rem; color: var(--muted);">(click line to copy)</span>
                        </div>
                        <div style="
                            margin: 2px 0;
                            font-family: monospace;
                            font-weight: 400;
                            word-break: break-all;
                            background: rgba(255, 255, 255, 0.05);
                            color: ${isRowPending ? 'var(--danger)' : 'var(--f-label)'};
                            padding: 4px 6px;
                            border-radius: 4px;
                            border: 1px solid rgba(255,255,255,0.04);
                            ${isRowPending ? 'text-decoration: line-through;' : ''}
                            max-height: 120px;
                            overflow-y: auto;
                        ">
                            ${noteContent}
                        </div>
                        ${isRowPending ? `
                            <div style="position: absolute; top: 0; right: 0; padding: 2px 6.4px; background: var(--danger); color: var(--f-label); font-size: 0.56rem; border-radius: 0 2px 0 6.4px;">
                                <i class="fas fa-clock" style="font-size: 0.56rem;"></i>
                            </div>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;
    });

    return html;
}

    // ========== SEARCH & FILTER ==========
    setPreviewFilter(filterType) {
        this.currentPreviewFilter = filterType;
        
        document.querySelectorAll('.preview-filter-btn').forEach(btn => {
            btn.classList.remove('active');
            btn.style.background = 'transparent';
            btn.style.borderColor = 'var(--border)';
            btn.style.color = 'var(--text-secondary)';
        });
        
        const activeBtn = document.getElementById(`previewFilter${filterType.charAt(0).toUpperCase() + filterType.slice(1)}`);
        if (activeBtn) {
            activeBtn.classList.add('active');
            activeBtn.style.background = 'var(--active)';
            activeBtn.style.borderColor = 'var(--active)';
            activeBtn.style.color = 'var(--primary)';
        }
        
        this.updatePreview();
        this.updateFilterCount();
        this.updateSearchResultsCount();
    }

    updateFilterCount() {
        const countElement = document.getElementById('filterCountValue');
        if (!countElement) return;
        
        const credentialSet = this.getCredentialSet();
        let entries = credentialSet.entries || [];
        
        let count = 0;
        const rows = Math.ceil(entries.length / 4);
        
        for (let rowIndex = 0; rowIndex < rows; rowIndex++) {
            const startIndex = rowIndex * 4;
            const rowEntries = entries.slice(startIndex, startIndex + 4);
            
            let matchesFilter = true;
            if (this.currentPreviewFilter !== 'all') {
                const hasData = rowEntries.some(entry => entry && entry.value && entry.value.trim());
                const isPending = rowEntries.some(entry => entry && entry.pending);
                
                switch(this.currentPreviewFilter) {
                    case 'active':
                        matchesFilter = hasData && !isPending;
                        break;
                    case 'pending':
                        matchesFilter = isPending;
                        break;
                }
            }
            
            const hasAnyData = rowEntries.some(entry => entry && entry.value && entry.value.trim());
            if (matchesFilter && hasAnyData) {
                count++;
            }
        }
        
        countElement.textContent = count;
        
        const filterCountDiv = document.getElementById('credentialFilterCount');
        if (filterCountDiv) {
            filterCountDiv.classList.add('pulse');
            setTimeout(() => {
                filterCountDiv.classList.remove('pulse');
            }, 300);
        }
    }

    handlePreviewSearch() {
        if (this.searchDebounceTimer) {
            clearTimeout(this.searchDebounceTimer);
        }
        this.searchDebounceTimer = setTimeout(() => {
            const searchInput = document.getElementById('previewSearchInput');
            if (searchInput) {
                this.currentSearchTerm = searchInput.value.toLowerCase().trim();
                this.updatePreview();
                this.updateFilterCount();
                this.updateSearchResultsCount();
            }
        }, 300);
    }

    updateSearchResultsCount() {
        const searchCountDiv = document.getElementById('searchResultsCount');
        const searchResultSpan = document.getElementById('searchResultCountValue');
        
        if (!searchCountDiv || !searchResultSpan) return;
        
        const credentialSet = this.getCredentialSet();
        let entries = credentialSet.entries || [];
        
        let matchingRowsCount = 0;
        const rows = Math.ceil(entries.length / 4);
        
        for (let rowIndex = 0; rowIndex < rows; rowIndex++) {
            const startIndex = rowIndex * 4;
            const rowEntries = entries.slice(startIndex, startIndex + 4);
            
            let matchesSearch = true;
            if (this.currentSearchTerm) {
                matchesSearch = rowEntries.some(entry => 
                    entry && entry.value && entry.value.toLowerCase().includes(this.currentSearchTerm)
                );
            }
            
            const hasAnyData = rowEntries.some(entry => entry && entry.value && entry.value.trim());
            
            if (matchesSearch && hasAnyData) {
                matchingRowsCount++;
            }
        }
        
        if (this.currentSearchTerm && matchingRowsCount > 0) {
            searchResultSpan.textContent = matchingRowsCount;
            searchCountDiv.style.display = 'flex';
            
            const clearBtn = document.getElementById('clearSearchBtn');
            if (clearBtn) {
                const newClearBtn = clearBtn.cloneNode(true);
                clearBtn.parentNode.replaceChild(newClearBtn, clearBtn);
                newClearBtn.addEventListener('click', () => {
                    const searchInput = document.getElementById('previewSearchInput');
                    if (searchInput) {
                        searchInput.value = '';
                        this.currentSearchTerm = '';
                        this.updatePreview();
                        this.updateFilterCount();
                        this.updateSearchResultsCount();
                        searchInput.focus();
                    }
                });
            }
        } else if (this.currentSearchTerm && matchingRowsCount === 0) {
            searchResultSpan.textContent = '0';
            searchCountDiv.style.display = 'flex';
        } else {
            searchCountDiv.style.display = 'none';
        }
    }

    // ========== PASSWORD VISIBILITY ==========
    toggleAllPasswords() {
        const toggleBtn = document.getElementById('togglePasswordVisibility');
        if (!toggleBtn) return;
        
        this.showPasswords = !this.showPasswords;
        
        if (this.showPasswords) {
            toggleBtn.innerHTML = '<i class="fas fa-eye-slash"></i> Hide Passwords';
        } else {
            toggleBtn.innerHTML = '<i class="fas fa-eye"></i> Show Passwords';
        }
        
        this.saveToStorage();
        this.updatePreview();
    }

    toggleSinglePassword(button, password) {
        if (event) event.stopPropagation();

        const previewItem = button.closest('.preview-item');
        const valueDisplay = previewItem.querySelector('div > div:nth-child(2)');
        const icon = button.querySelector('i');

        if (valueDisplay.textContent === '••••••••••') {
            valueDisplay.textContent = password;
            if (icon) icon.className = 'fas fa-eye-slash';
        } else {
            valueDisplay.textContent = '••••••••••';
            if (icon) icon.className = 'fas fa-eye';
        }
    }

    // ========== COPY OPERATIONS ==========
    copyAll() {
        const credentialSet = this.getCredentialSet();
        const entries = credentialSet.entries || [];
        
        if (entries.length === 0) {
            this.showNotification('No credentials to copy', 'warning');
            return;
        }
        
        let out = '';
        const rows = Math.ceil(entries.length / 4);
        
        for (let rowIndex = 0; rowIndex < rows; rowIndex++) {
            const startIndex = rowIndex * 4;
            const rowEntries = entries.slice(startIndex, startIndex + 4);
            
            if (rowEntries.some(entry => entry && entry.value && entry.value.trim())) {
                out += `Row ${rowIndex + 1}:\n`;
                out += `  Service: ${rowEntries[0]?.value || ''}\n`;
                out += `  User ID: ${rowEntries[1]?.value || ''}\n`;
                out += `  Password: ${rowEntries[2]?.value || ''}\n`;
                out += `  Note: ${rowEntries[3]?.value || ''}\n\n`;
            }
        }
        
        navigator.clipboard.writeText(out.trim()).then(() => {
            this.showNotification('All credentials copied to clipboard', 'success');
        });
    }

    copyRow(rowIndex) {
        const credentialSet = this.getCredentialSet();
        const entries = credentialSet.entries || [];
        const startIndex = rowIndex * 4;
        const rowEntries = entries.slice(startIndex, startIndex + 4);
        
        const hasData = rowEntries.some(entry => entry && entry.value && entry.value.trim());
        if (!hasData) {
            this.showNotification('Cannot copy empty row', 'warning');
            return;
        }
        
        let rowText = `Row ${rowIndex + 1}:\n`;
        rowText += `  Service: ${rowEntries[0]?.value || ''}\n`;
        rowText += `  User ID: ${rowEntries[1]?.value || ''}\n`;
        rowText += `  Password: ${rowEntries[2]?.value || ''}\n`;
        rowText += `  Note: ${rowEntries[3]?.value || ''}`;
        
        navigator.clipboard.writeText(rowText).then(() => {
            this.showNotification(`Row ${rowIndex + 1} copied to clipboard`, 'success');
        });
    }

    copyToClipboard(text) {
        if (!text) return;
        
        const clipboardText = text.includes(';') 
            ? text.split(';').map(line => line.trim()).join('\n')
            : text;
            
        navigator.clipboard.writeText(clipboardText).then(() => {
            this.showNotification('Copied to clipboard', 'success');
        });
    }

    // ========== ROW STATUS ==========
    toggleRowStatus(rowIndex) {
        const credentialIndex = this.credentials.findIndex(cr => cr.id === 1);
        if (credentialIndex !== -1) {
            const entries = this.credentials[credentialIndex].entries;
            const startIndex = rowIndex * 4;
            
            const rowHasData = entries.slice(startIndex, startIndex + 4)
                .some(entry => entry && entry.value && entry.value.trim());
            
            if (!rowHasData) {
                this.showNotification('Cannot toggle status for empty row', 'warning');
                return;
            }
            
            const isCurrentlyPending = entries[startIndex]?.pending || false;
            const newPendingStatus = !isCurrentlyPending;
            
            for (let i = 0; i < 4; i++) {
                const entryIndex = startIndex + i;
                if (entryIndex < entries.length && entries[entryIndex]) {
                    entries[entryIndex].pending = newPendingStatus;
                    entries[entryIndex].pendingAt = newPendingStatus ? new Date().toISOString() : null;
                }
            }
            
            this.credentials[credentialIndex].lastUpdated = 'Just now';
            
            this.saveToStorage().then(() => {
                this.updatePreview();
                this.syncRowToFirebase(rowIndex);
            });
            
            this.showNotification(`Row ${rowIndex + 1} ${newPendingStatus ? 'marked as pending' : 'activated'}`, 'success');
        }
    }

    // ========== SERVICE DETECTION ==========
    initializeServiceKeywords() {
        this.serviceKeywords = {
            'Google':        { keyword: 'google',        icon: 'fab fa-google',        color: '#DB4437' },
            'GitHub':        { keyword: 'github',        icon: 'fab fa-github',        color: '#4078c0' },
            'AWS':           { keyword: 'aws',           icon: 'fab fa-aws',           color: '#FF9900' },
            'Microsoft':     { keyword: 'microsoft',     icon: 'fab fa-microsoft',     color: '#00A4EF' },
            'Apple':         { keyword: 'apple',         icon: 'fab fa-apple',         color: '#000000' },
            'Amazon':        { keyword: 'amazon',        icon: 'fab fa-amazon',        color: '#FF9900' },
            'Facebook':      { keyword: 'facebook',      icon: 'fab fa-facebook',      color: '#1877F2' },
            'Twitter':       { keyword: 'twitter',       icon: 'fab fa-twitter',       color: '#1DA1F2' },
            'LinkedIn':      { keyword: 'linkedin',      icon: 'fab fa-linkedin',      color: '#0077B5' },
            'Netflix':       { keyword: 'netflix',       icon: 'fab fa-netflix',       color: '#E50914' },
            'YouTube':       { keyword: 'youtube',       icon: 'fab fa-youtube',       color: '#FF0000' },
            'Twitch':        { keyword: 'twitch',        icon: 'fab fa-twitch',        color: '#9146FF' },
            'Spotify':       { keyword: 'spotify',       icon: 'fab fa-spotify',       color: '#1DB954' },
            'SoundCloud':    { keyword: 'soundcloud',    icon: 'fab fa-soundcloud',    color: '#FF3300' },
            'Dropbox':       { keyword: 'dropbox',       icon: 'fab fa-dropbox',       color: '#0061FF' },
            'Salesforce':    { keyword: 'salesforce',    icon: 'fab fa-salesforce',    color: '#00A1E0' },
            'Slack':         { keyword: 'slack',         icon: 'fab fa-slack',         color: '#4A154B' },
            'Zoom':          { keyword: 'zoom',          icon: 'fab fa-zoom',          color: '#2D8CFF' },
            'Bitbucket':     { keyword: 'bitbucket',     icon: 'fab fa-bitbucket',     color: '#0052CC' },
            'GitLab':        { keyword: 'gitlab',        icon: 'fab fa-gitlab',        color: '#FC6D26' },
            'DigitalOcean':  { keyword: 'digitalocean',  icon: 'fab fa-digital-ocean', color: '#0080FF' },
            'Instagram':     { keyword: 'instagram',     icon: 'fab fa-instagram',     color: '#E4405F' },
            'TikTok':        { keyword: 'tiktok',        icon: 'fab fa-tiktok',        color: '#000000' },
            'Reddit':        { keyword: 'reddit',        icon: 'fab fa-reddit',        color: '#FF4500' },
            'Pinterest':     { keyword: 'pinterest',     icon: 'fab fa-pinterest',     color: '#E60023' },
            'Snapchat':      { keyword: 'snapchat',      icon: 'fab fa-snapchat',      color: '#FFFC00' },
            'Discord':       { keyword: 'discord',       icon: 'fab fa-discord',       color: '#5865F2' },
            'Telegram':      { keyword: 'telegram',      icon: 'fab fa-telegram',      color: '#0088CC' },
            'WhatsApp':      { keyword: 'whatsapp',      icon: 'fab fa-whatsapp',      color: '#25D366' },
            'WeChat':        { keyword: 'wechat',        icon: 'fab fa-weixin',        color: '#07C160' },
            'Steam':         { keyword: 'steam',         icon: 'fab fa-steam',         color: '#171A21' },
            'Xbox':          { keyword: 'xbox',          icon: 'fab fa-xbox',          color: '#107C10' },
            'PlayStation':   { keyword: 'playstation',   icon: 'fab fa-playstation',   color: '#003087' },
            'EpicGames':     { keyword: 'epic',          icon: 'fab fa-epic-games',    color: '#2A2A2A' },
            'PayPal':        { keyword: 'paypal',        icon: 'fab fa-paypal',        color: '#00457C' },
            'Stripe':        { keyword: 'stripe',        icon: 'fab fa-stripe',        color: '#008CDD' },
            'Visa':          { keyword: 'visa',          icon: 'fab fa-cc-visa',       color: '#1A1F71' },
            'MasterCard':    { keyword: 'mastercard',    icon: 'fab fa-cc-mastercard', color: '#EB001B' },
            'Amex':          { keyword: 'amex',          icon: 'fab fa-cc-amex',       color: '#2E77BC' },
            'Bitcoin':       { keyword: 'bitcoin',       icon: 'fab fa-bitcoin',       color: '#F7931A' },
            'eBay':          { keyword: 'ebay',          icon: 'fab fa-ebay',          color: '#E53238' },
            'Shopify':       { keyword: 'shopify',       icon: 'fab fa-shopify',       color: '#7AB55C' },
            'Coursera':      { keyword: 'coursera',      icon: 'fab fa-leanpub',       color: '#0056D2' },
            'Udemy':         { keyword: 'udemy',         icon: 'fab fa-udemy',         color: '#A435F0' },
            'KhanAcademy':   { keyword: 'khan',          icon: 'fab fa-leanpub',       color: '#14BF96' },
            'Gmail':         { keyword: 'gmail',         icon: 'far fa-envelope',      color: '#D14836' },
            'YahooMail':     { keyword: 'yahoo',         icon: 'fab fa-yahoo',         color: '#720E9E' },
            'Outlook':       { keyword: 'outlook',       icon: 'fab fa-microsoft',     color: '#0072C6' },
            'ProtonMail':    { keyword: 'protonmail',    icon: 'fas fa-shield-alt',    color: '#8B89CC' },
            'Uber':          { keyword: 'uber',          icon: 'fab fa-uber',          color: '#000000' },
            'Airbnb':        { keyword: 'airbnb',        icon: 'fab fa-airbnb',        color: '#FF5A5F' },
            'Medium':        { keyword: 'medium',        icon: 'fab fa-medium',        color: '#000000' },
            'WordPress':     { keyword: 'wordpress',     icon: 'fab fa-wordpress',     color: '#21759B' },
            'Blogger':       { keyword: 'blogger',       icon: 'fab fa-blogger',       color: '#FF5722' },
            'StackOverflow': { keyword: 'stackoverflow', icon: 'fab fa-stack-overflow',color: '#F48024' },
            'Quora':         { keyword: 'quora',         icon: 'fab fa-quora',         color: '#B92B27' },
            'Vimeo':         { keyword: 'vimeo',         icon: 'fab fa-vimeo',         color: '#1AB7EA' },
            'DeviantArt':    { keyword: 'deviantart',    icon: 'fab fa-deviantart',    color: '#05CC47' },
            'Dribbble':      { keyword: 'dribbble',      icon: 'fab fa-dribbble',      color: '#EA4C89' },
        };
    }

    getServiceInfo(serviceName) {
        if (!serviceName) return null;
        
        const lowerName = serviceName.toLowerCase();
        for (const [name, info] of Object.entries(this.serviceKeywords)) {
            if (info.keyword.toLowerCase() === lowerName) {
                return {
                    name: name,
                    icon: info.icon,
                    color: info.color
                };
            }
        }
        return null;
    }

    // ========== UTILITY METHODS ==========
    escapeHtml(unsafe) {
        if (!unsafe) return '';
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    showNotification(message, type = 'success') {
        if (window.toastManager) {
            window.toastManager.show(message, type);
        } else {
            console.log(`[${type.toUpperCase()}] ${message}`);
        }
    }

    // ========== STYLES & CSS ==========
    addPreviewStyles() {
        if (!document.getElementById('preview-styles')) {
            const style = document.createElement('style');
            style.id = 'preview-styles';
            style.textContent = `
                #previewContainer {
                    transition: opacity 0.1s ease;
                }
                .preview-card {
                    transition: all 0.2s ease;
                }
                .preview-item {
                    transition: all 0.15s ease;
                }
                .preview-item.note-field {
                    cursor: pointer;
                }
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes fadeOut {
                    from { opacity: 1; }
                    to { opacity: 0; }
                }
                @keyframes slideUp {
                    from { opacity: 0; transform: translateY(20px); }
                    to { opacity: 1; transform: translateY(0); }
                }
            `;
            document.head.appendChild(style);
        }
    }

    // ========== RESET & CLEANUP ==========
    async clearLocalData() {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        if (this.syncTimer) clearTimeout(this.syncTimer);
        if (this.previewUpdateTimer) clearTimeout(this.previewUpdateTimer);
        
        try {
            if (this.db) {
                const transaction = this.db.transaction(['credentials', 'syncMetadata'], 'readwrite');
                transaction.objectStore('credentials').clear();
                transaction.objectStore('syncMetadata').clear();
            }
            
            this.credentials = [];
            this.showPasswords = false;
            this.currentPreviewFilter = 'all';
            this.currentSearchTerm = '';
            this.pendingOperations.clear();
            
            if (this.firebaseListeners.credentials) {
                const homeDb = window.authModule?.getHomeDatabaseInstance();
                if (homeDb && homeDb.db) {
                    const encodedPhone = window.authModule.encodePhone(window.authModule.currentUser?.phone);
                    if (encodedPhone) {
                        const ref = homeDb.db.ref(`userData/${encodedPhone}/credentialData`);
                        ref.off('value', this.firebaseListeners.credentials.value);
                    }
                }
            }
            this.firebaseListeners = {};
            
            this.initializeEmptyData();
            console.log('Credential manager local data cleared');
            
            if (document.getElementById('credential')) {
                this.updatePreview();
            }
            
            return true;
        } catch (error) {
            console.error('Error clearing credential manager local data:', error);
            return false;
        }
    }

    async resetDataForLogout() {
        return this.clearLocalData();
    }

    // ========== EVENT HANDLERS ==========
    attachEventListeners() {
        this.attachButtonListeners();
        this.updatePreview();
        this.addPreviewStyles();
        this.addDeleteStyles();
    }

    attachButtonListeners() {
        const toggleBtn = document.getElementById('togglePasswordVisibility');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => this.toggleAllPasswords());
        }
    }

    updatePreview() {
        const previewContainer = document.getElementById('previewContainer');
        if (!previewContainer) return;
        
        this.removeDeleteConfirmationBar();
        previewContainer.innerHTML = this.getPreviewContentHTML();
        this.updateFilterCount();
    }

parseNoteLine(line) {
    line = line.trim();
    if (!line) return { icon: null, display: '', label: '' };

    const patterns = [
        // ----- IDENTITY & LOGIN -----
        { prefix: 'username:', icon: 'fas fa-user', label: 'Username' },
        { prefix: 'user:', icon: 'fas fa-user', label: 'User' },
        { prefix: 'email:', icon: 'fas fa-envelope', label: 'Email' },
        { prefix: 'login:', icon: 'fas fa-sign-in-alt', label: 'Login' },
        { prefix: 'uid:', icon: 'fas fa-id-badge', label: 'UID' },
        { prefix: 'userid:', icon: 'fas fa-id-card', label: 'User ID' },
        { prefix: 'account:', icon: 'fas fa-user-cog', label: 'Account' },

        // ----- SECURITY & SECRETS -----
        { prefix: 'password:', icon: 'fas fa-lock', label: 'Password' },
        { prefix: 'pass:', icon: 'fas fa-lock', label: 'Password' },
        { prefix: 'pwd:', icon: 'fas fa-lock', label: 'Password' },
        { prefix: 'secret:', icon: 'fas fa-shield-alt', label: 'Secret' },
        { prefix: 'accesskey:', icon: 'fas fa-key', label: 'Access Key' },
        { prefix: 'secretkey:', icon: 'fas fa-key', label: 'Secret Key' },
        { prefix: 'privatekey:', icon: 'fas fa-key', label: 'Private Key' },
        { prefix: 'publickey:', icon: 'fas fa-key', label: 'Public Key' },
        { prefix: 'totp:', icon: 'fas fa-mobile-screen-button', label: 'TOTP' },
        { prefix: '2fa:', icon: 'fas fa-shield-halved', label: '2FA' },
        { prefix: 'mfa:', icon: 'fas fa-shield-halved', label: 'MFA' },
        { prefix: 'otp:', icon: 'fas fa-clock', label: 'OTP' },
        { prefix: 'recovery:', icon: 'fas fa-rotate-left', label: 'Recovery' },
        { prefix: 'backup:', icon: 'fas fa-cloud-upload-alt', label: 'Backup' },
        { prefix: 'cert:', icon: 'fas fa-certificate', label: 'Certificate' },
        { prefix: 'certificate:', icon: 'fas fa-certificate', label: 'Certificate' },
        { prefix: 'ssh:', icon: 'fas fa-terminal', label: 'SSH' },
        { prefix: 'fingerprint:', icon: 'fas fa-fingerprint', label: 'Fingerprint' },
        { prefix: 'passphrase:', icon: 'fas fa-lock', label: 'Passphrase' },

        // ----- NETWORK & HOSTS -----
        { prefix: 'host:', icon: 'fas fa-server', label: 'Host' },
        { prefix: 'hostname:', icon: 'fas fa-server', label: 'Hostname' },
        { prefix: 'server:', icon: 'fas fa-server', label: 'Server' },
        { prefix: 'domain:', icon: 'fas fa-globe', label: 'Domain' },
        { prefix: 'ip:', icon: 'fas fa-network-wired', label: 'IP Address' },
        { prefix: 'port:', icon: 'fas fa-plug', label: 'Port' },
        { prefix: 'url:', icon: 'fas fa-link', label: 'URL' },
        { prefix: 'uri:', icon: 'fas fa-link', label: 'URI' },
        { prefix: 'redirect:', icon: 'fas fa-arrow-right', label: 'Redirect' },
        { prefix: 'webhook:', icon: 'fas fa-bolt', label: 'Webhook' },
        { prefix: 'callback:', icon: 'fas fa-arrows-spin', label: 'Callback' },

        // ----- DATABASE & CLOUD -----
        { prefix: 'database:', icon: 'fas fa-database', label: 'Database' },
        { prefix: 'db:', icon: 'fas fa-database', label: 'DB' },
        { prefix: 'connection:', icon: 'fas fa-plug', label: 'Connection' },
        { prefix: 'dsn:', icon: 'fas fa-database', label: 'DSN' },
        { prefix: 'jdbc:', icon: 'fas fa-database', label: 'JDBC' },
        { prefix: 'bucket:', icon: 'fas fa-archive', label: 'Bucket' },
        { prefix: 'region:', icon: 'fas fa-map-pin', label: 'Region' },
        { prefix: 'table:', icon: 'fas fa-table', label: 'Table' },
        { prefix: 'collection:', icon: 'fas fa-layer-group', label: 'Collection' },

        // ----- CLOUD PROVIDERS -----
        { prefix: 'aws:', icon: 'fab fa-aws', label: 'AWS' },
        { prefix: 'azure:', icon: 'fab fa-microsoft', label: 'Azure' },
        { prefix: 'gcp:', icon: 'fab fa-google', label: 'GCP' },
        { prefix: 'heroku:', icon: 'fas fa-cloud', label: 'Heroku' },
        { prefix: 'digitalocean:', icon: 'fab fa-digital-ocean', label: 'DigitalOcean' },

        // ----- DEVELOPMENT & APIS -----
        { prefix: 'api:', icon: 'fas fa-code', label: 'API' },
        { prefix: 'apikey:', icon: 'fas fa-key', label: 'API Key' },
        { prefix: 'client_id:', icon: 'fas fa-id-card', label: 'Client ID' },
        { prefix: 'clientid:', icon: 'fas fa-id-card', label: 'Client ID' },
        { prefix: 'clientsecret:', icon: 'fas fa-key', label: 'Client Secret' },
        { prefix: 'appid:', icon: 'fas fa-id-card', label: 'App ID' },
        { prefix: 'appkey:', icon: 'fas fa-key', label: 'App Key' },
        { prefix: 'appsecret:', icon: 'fas fa-key', label: 'App Secret' },
        { prefix: 'token:', icon: 'fas fa-token', label: 'Token' },
        { prefix: 'refreshtoken:', icon: 'fas fa-rotate', label: 'Refresh Token' },
        { prefix: 'accesstoken:', icon: 'fas fa-badge-check', label: 'Access Token' },
        { prefix: 'endpoint:', icon: 'fas fa-network-wired', label: 'Endpoint' },
        { prefix: 'version:', icon: 'fas fa-tag', label: 'Version' },
        { prefix: 'branch:', icon: 'fas fa-code-branch', label: 'Branch' },
        { prefix: 'repo:', icon: 'fas fa-folder-open', label: 'Repository' },

        // ----- ENVIRONMENT & MISC -----
        { prefix: 'env:', icon: 'fas fa-cog', label: 'Environment' },
        { prefix: 'environment:', icon: 'fas fa-cog', label: 'Environment' },
        { prefix: 'stage:', icon: 'fas fa-layer-group', label: 'Stage' },
        { prefix: 'prod:', icon: 'fas fa-server', label: 'Production' },
        { prefix: 'dev:', icon: 'fas fa-laptop-code', label: 'Development' },
        { prefix: 'test:', icon: 'fas fa-flask', label: 'Test' },
        { prefix: 'qa:', icon: 'fas fa-check-double', label: 'QA' },
        { prefix: 'staging:', icon: 'fas fa-server', label: 'Staging' },
        { prefix: 'sandbox:', icon: 'fas fa-box', label: 'Sandbox' },
    ];

    const lower = line.toLowerCase();
    for (const p of patterns) {
        if (lower.startsWith(p.prefix)) {
            const value = line.substring(p.prefix.length).trim();
            // Return the label (capitalized prefix) + value
            return { 
                icon: p.icon, 
                label: p.label + ':',  // e.g., "API:"
                display: value || line 
            };
        }
    }

    // No pattern matched – plain text, no icon or label
    return { icon: null, display: line, label: '' };
}

}

// Initialize credential manager globally
let credentialManager;

document.addEventListener('DOMContentLoaded', async function() {
    credentialManager = new CredentialManager();
    window.credentialManager = credentialManager;
    
    window.addEventListener('authLogout', function() {
        if (credentialManager) {
            credentialManager.clearLocalData();
        }
    });
    
    setInterval(() => {
        if (credentialManager) {
            credentialManager.saveToStorage();
        }
    }, 30000);
    
    window.addEventListener('authSuccess', async () => {
        if (credentialManager) {
            await credentialManager.initFirebaseSync();
        }
    });
});