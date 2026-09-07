// ===== FIREBASE - SISTEM KEUANGAN =====
// Reuses same Firebase project: test-kesehatan-ijef-corp-7c278

const KFB_CONFIG = {
  apiKey: "AIzaSyAWlNi_iBOWxZBD6E20aHOSrRpPsirDdOM",
  authDomain: "test-kesehatan-ijef-corp-7c278.firebaseapp.com",
  projectId: "test-kesehatan-ijef-corp-7c278",
  storageBucket: "test-kesehatan-ijef-corp-7c278.firebasestorage.app",
  messagingSenderId: "48180557823",
  appId: "1:48180557823:web:47ea8db8126737dbc0d9ca"
};

let kfbReady = false;
let kdb = null;
let kfs = null;
let _kFirebaseReconnectPromise = null;

async function initKFirebase() {
  try {
    const { initializeApp, getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
    const fm = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
    // Use separate app name to avoid conflict with health app
    const apps = getApps();
    const existing = apps.find(a => a.name === 'keuangan');
    const app = existing || initializeApp(KFB_CONFIG, 'keuangan');
    kdb = fm.getFirestore(app);
    kfs = { doc: fm.doc, setDoc: fm.setDoc, getDoc: fm.getDoc, collection: fm.collection,
            getDocs: fm.getDocs, deleteDoc: fm.deleteDoc, query: fm.query,
            where: fm.where, orderBy: fm.orderBy, addDoc: fm.addDoc, updateDoc: fm.updateDoc,
            onSnapshot: fm.onSnapshot };
    kfbReady = true;
    console.log('[KFirebase] ✅ Connected');
    return true;
  } catch(e) {
    console.error('[KFirebase] ❌', e.message);
    return false;
  }
}

async function ensureKFirebaseReady() {
  if (kfbReady) return true;
  if (_kFirebaseReconnectPromise) return _kFirebaseReconnectPromise;
  _kFirebaseReconnectPromise = (async function() {
    try {
      var ok = await initKFirebase();
      if (ok) {
        if (typeof window !== 'undefined') window._kOfflineMode = false;
        if (typeof startRealtimeSync === 'function') startRealtimeSync();
      }
      return ok;
    } catch(e) {
      console.warn('[KFirebase] Reconnect failed:', e.message || e);
      return false;
    } finally {
      _kFirebaseReconnectPromise = null;
    }
  })();
  return _kFirebaseReconnectPromise;
}

function _kCollectLocalStorageKeys(filterFn) {
  var keys = [];
  try {
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      if (key && (!filterFn || filterFn(key))) keys.push(key);
    }
  } catch(e) {
    console.warn('[KFirebase] Storage iteration error:', e.message || e);
  }
  return keys;
}

// ===== KDB - Keuangan Database Layer =====
const KDB = {

  // ---- USERS ----
  async saveUser(u) {
    if (!u) return;
    const uname = String(u.username || '').toLowerCase().trim();
    if (!uname) return;
    u.username = uname;
    _klset('ku_' + uname, u);
    _klset('k_users_dirty_' + uname, Date.now());
    const list = _klget('kusers', []) || [];
    const i = list.findIndex(x => x && x.username && String(x.username).toLowerCase().trim() === uname);
    if (i >= 0) list[i] = u; else list.push(u);
    _klset('kusers', list);
    if (kfbReady) {
      try {
        await kfs.setDoc(kfs.doc(kdb, 'k_users', uname), u);
        localStorage.removeItem('k_users_dirty_' + uname);
      } catch(e) { console.warn(e); }
    }
  },

  async getUsers() {
    if (kfbReady) {
      try {
        const snap = await kfs.getDocs(kfs.collection(kdb, 'k_users'));
        var users = (snap.docs || []).map(d => d.data()).filter(Boolean);

        // Merge with local ku_ saved users to protect edited user roles from being overwritten by old FB cache
        var localList = _klget('kusers', []) || [];
        localList.forEach(function(lu) {
          if (lu && lu.username) {
            var uname = String(lu.username).toLowerCase().trim();
            var kuObj = _klget('ku_' + uname, null);
            var objToUse = kuObj || lu;
            var idx = users.findIndex(function(x){ return x && x.username && String(x.username).toLowerCase().trim() === uname; });
            if (idx >= 0) {
              users[idx] = Object.assign({}, users[idx], objToUse);
            } else {
              users.push(objToUse);
            }
          }
        });

        if (users.length > 0) {
          users.forEach(function(u) {
            if (u && u.username) {
              _klset('ku_' + String(u.username).toLowerCase().trim(), u);
            }
          });
          _klset('kusers', users);
          return users;
        }
      } catch(e) { console.warn(e); }
    }
    return _klget('kusers', []) || [];
  },

  async deleteUser(username) {
    const list = _klget('kusers', []).filter(u => u.username !== username);
    _klset('kusers', list);
    localStorage.removeItem('ku_' + username);
    if (kfbReady) {
      try { await kfs.deleteDoc(kfs.doc(kdb, 'k_users', username)); } catch(e) { console.warn(e); }
    }
  },

  // ---- GENERIC COLLECTION ----
  _recentSaves: {},

  async save(col, id, data) {
    data.id = id;
    _klset('k_' + col + '_' + id, data);
    // Also update the _all list cache to keep it in sync
    const all = _klget('k_' + col + '_all', []);
    const idx = all.findIndex(x => x.id === id || x._id === id);
    if (idx >= 0) { all[idx] = data; } else { all.push(data); }
    _klset('k_' + col + '_all', all);
    // Track dirty item to protect against Firebase read lag
    _klset('k_' + col + '_dirty_' + id, Date.now());
    if (!this._recentSaves[col]) this._recentSaves[col] = {};
    this._recentSaves[col][id] = Date.now();
    if (kfbReady) {
      try {
        await kfs.setDoc(kfs.doc(kdb, 'k_' + col, id), data);
        // Clear dirty flag after successful Firebase write
        localStorage.removeItem('k_' + col + '_dirty_' + id);
        if (this._recentSaves[col]) delete this._recentSaves[col][id];
      } catch(e) { console.warn(e); }
    }
  },

  async get(col, id) {
    // Check dirty flag - if item was recently saved locally, return local version
    var dirtyTime = _klget('k_' + col + '_dirty_' + id, 0);
    if (dirtyTime && (Date.now() - dirtyTime) < 10000) {
      var localItem = _klget('k_' + col + '_' + id, null);
      if (localItem) return localItem;
    }
    if (kfbReady) {
      try {
        const snap = await kfs.getDoc(kfs.doc(kdb, 'k_' + col, id));
        if (snap.exists()) { _klset('k_' + col + '_' + id, snap.data()); return snap.data(); }
      } catch(e) { console.warn(e); }
    }
    return _klget('k_' + col + '_' + id, null);
  },

  async getAll(col) {
    if (!kfbReady && typeof window !== 'undefined' && window._kOfflineMode) {
      var recovered = await ensureKFirebaseReady();
      if (recovered) return this.getAll(col);
    }
    if (kfbReady) {
      try {
        const snap = await kfs.getDocs(kfs.collection(kdb, 'k_' + col));
        var items = snap.docs.map(d => {
          const item = d.data();
          if (!item.id) item.id = d.id;
          return item;
        });

        var now = Date.now();
        // Collect dirty IDs
        var dirtyIdSet = {};
        if (this._recentSaves[col]) {
          Object.keys(this._recentSaves[col]).forEach(function(id) { dirtyIdSet[id] = true; });
        }
        var dirtyPrefix = 'k_' + col + '_dirty_';
        var deletedPrefix = 'k_' + col + '_deleted_';
        var deletedIdSet = {};

        _kCollectLocalStorageKeys(function(lsKey) {
          return lsKey.indexOf(dirtyPrefix) === 0 || lsKey.indexOf(deletedPrefix) === 0;
        }).forEach(function(lsKey) {
          if (!lsKey) return;
          if (lsKey.indexOf(dirtyPrefix) === 0) {
            dirtyIdSet[lsKey.substring(dirtyPrefix.length)] = true;
          } else if (lsKey.indexOf(deletedPrefix) === 0) {
            deletedIdSet[lsKey.substring(deletedPrefix.length)] = true;
          }
        });

        // Apply dirty saves
        Object.keys(dirtyIdSet).forEach(function(dirtyId) {
          var dirtyTime = _klget('k_' + col + '_dirty_' + dirtyId, 0);
          if (dirtyTime && (now - dirtyTime) < 10000) {
            var localItem = _klget('k_' + col + '_' + dirtyId, null);
            if (localItem) {
              var idx = items.findIndex(function(x) { return x.id === dirtyId || x._id === dirtyId; });
              if (idx >= 0) { items[idx] = localItem; } else { items.push(localItem); }
            }
          } else {
            localStorage.removeItem('k_' + col + '_dirty_' + dirtyId);
          }
        });

        // Apply dirty deletes (Ghost Fix)
        Object.keys(deletedIdSet).forEach(function(delId) {
          var delTime = _klget('k_' + col + '_deleted_' + delId, 0);
          if (delTime && (now - delTime) < 15000) {
            items = items.filter(function(x) { return x.id !== delId && x._id !== delId; });
          } else {
            localStorage.removeItem('k_' + col + '_deleted_' + delId);
          }
        });

        _klset('k_' + col + '_all', items);
        window._kFreshDataLoaded = window._kFreshDataLoaded || {};
        window._kFreshDataLoaded[col] = true;
        return items;
      } catch(e) { console.warn(e); }
    }
    return _klget('k_' + col + '_all', []);
  },

  async delete(col, id) {
    // Ghost Fix: Set a deletion flag locally for 15 seconds
    _klset('k_' + col + '_deleted_' + id, Date.now());

    // Remove from local list cache
    const all = _klget('k_' + col + '_all', []).filter(x => x.id !== id && x._id !== id);
    _klset('k_' + col + '_all', all);
    localStorage.removeItem('k_' + col + '_' + id);
    if (kfbReady) {
      try { await kfs.deleteDoc(kfs.doc(kdb, 'k_' + col, id)); } catch(e) { console.warn(e); }
    }
  },

  // ---- IMS COLLECTIONS (Cross-App Sync, no k_ prefix) ----
  async saveIMS(col, id, data) {
    data.id = id;
    _klset('ims_' + col + '_' + id, data);
    const all = _klget('ims_' + col + '_all', []);
    const idx = all.findIndex(x => x.id === id);
    if (idx >= 0) all[idx] = data; else all.push(data);
    _klset('ims_' + col + '_all', all);
    if (kfbReady) {
      try { await kfs.setDoc(kfs.doc(kdb, col, id), data); } catch(e) { console.warn(e); }
    }
  },

  async getAllIMS(col) {
    if (kfbReady) {
      try {
        const snap = await kfs.getDocs(kfs.collection(kdb, col));
        const items = snap.docs.map(d => {
          const item = d.data();
          if (!item.id) item.id = d.id;
          return item;
        });
        _klset('ims_' + col + '_all', items);
        return items;
      } catch(e) { console.warn(e); }
    }
    return _klget('ims_' + col + '_all', []);
  },

  async getIMS(col, id) {
    if (kfbReady) {
      try {
        const snap = await kfs.getDoc(kfs.doc(kdb, col, id));
        if (snap.exists()) return snap.data();
      } catch(e) { console.warn(e); }
    }
    return _klget('ims_' + col + '_' + id, null);
  },

  // ---- STANDARDIZED COLLECTIONS (Flutter-compatible, no k_ prefix) ----
  async saveTransaction(data) {
    var id = data.id || ('txn_' + Date.now());
    data.id = id;
    if (kfbReady) {
      try { await kfs.setDoc(kfs.doc(kdb, 'transactions', id), data); } catch(e) { console.warn(e); }
    }
    var all = _klget('std_transactions_all', []);
    var idx = all.findIndex(function(x) { return x.id === id; });
    if (idx >= 0) { all[idx] = data; } else { all.push(data); }
    _klset('std_transactions_all', all);
    return id;
  },

  async getTransactions() {
    if (kfbReady) {
      try {
        var snap = await kfs.getDocs(kfs.collection(kdb, 'transactions'));
        var items = snap.docs.map(function(d) { return d.data(); });
        _klset('std_transactions_all', items);
        return items;
      } catch(e) { console.warn(e); }
    }
    return _klget('std_transactions_all', []);
  },

  async saveApproval(data) {
    var id = data.id || ('appr_' + Date.now());
    data.id = id;
    if (kfbReady) {
      try { await kfs.setDoc(kfs.doc(kdb, 'approvals', id), data); } catch(e) { console.warn(e); }
    }
    var all = _klget('std_approvals_all', []);
    var idx = all.findIndex(function(x) { return x.id === id; });
    if (idx >= 0) { all[idx] = data; } else { all.push(data); }
    _klset('std_approvals_all', all);
    return id;
  },

  async getApprovals() {
    if (kfbReady) {
      try {
        var snap = await kfs.getDocs(kfs.collection(kdb, 'approvals'));
        var items = snap.docs.map(function(d) { return d.data(); });
        _klset('std_approvals_all', items);
        return items;
      } catch(e) { console.warn(e); }
    }
    return _klget('std_approvals_all', []);
  },

  async saveAIInsight(data) {
    var id = data.id || ('insight_' + Date.now());
    data.id = id;
    if (kfbReady) {
      try { await kfs.setDoc(kfs.doc(kdb, 'ai_insights', id), data); } catch(e) { console.warn(e); }
    }
    var all = _klget('std_ai_insights_all', []);
    var idx = all.findIndex(function(x) { return x.id === id; });
    if (idx >= 0) { all[idx] = data; } else { all.push(data); }
    _klset('std_ai_insights_all', all);
    return id;
  },

  async getLatestAIInsight() {
    if (kfbReady) {
      try {
        var snap = await kfs.getDocs(kfs.collection(kdb, 'ai_insights'));
        var items = snap.docs.map(function(d) { return d.data(); });
        _klset('std_ai_insights_all', items);
        var active = items.filter(function(x) { return x.status_aktif !== false; });
        active.sort(function(a, b) { return (b.tanggal || '').localeCompare(a.tanggal || ''); });
        return active.length > 0 ? active[0] : null;
      } catch(e) { console.warn(e); }
    }
    var all = _klget('std_ai_insights_all', []);
    var active = all.filter(function(x) { return x.status_aktif !== false; });
    active.sort(function(a, b) { return (b.tanggal || '').localeCompare(a.tanggal || ''); });
    return active.length > 0 ? active[0] : null;
  },

  // ---- SETTINGS ----
  async saveSetting(key, val) {
    _klset('ksetting_' + key, val);
    if (kfbReady) {
      try { await kfs.setDoc(kfs.doc(kdb, 'k_settings', key), { value: val, key }); } catch(e) { console.warn(e); }
    }
  },

  async getSetting(key, def) {
    if (kfbReady) {
      try {
        const snap = await kfs.getDoc(kfs.doc(kdb, 'k_settings', key));
        if (snap.exists()) { const v = snap.data().value; _klset('ksetting_' + key, v); return v; }
      } catch(e) { console.warn(e); }
    }
    return _klget('ksetting_' + key, def);
  },
};

// ===== REAL-TIME SYNC (onSnapshot) =====
var _kRealtimeUnsubs = [];
var _kRealtimeSyncActive = false;

/**
 * Subscribe to a Firestore collection for real-time updates.
 * When changes arrive from other users, update localStorage cache
 * and trigger a UI re-render via the provided callback.
 * Self-triggered changes (tracked in KDB._recentSaves) are skipped.
 */
function _kSubscribeCollection(col, onChange, usePrefix) {
  if (!kfbReady || !kfs.onSnapshot) return null;
  var colName = (usePrefix === false) ? col : 'k_' + col;
  var cachePrefix = (usePrefix === false) ? 'ims_' : 'k_';
  var colRef = kfs.collection(kdb, colName);
  var isFirstSnapshot = true;
  var unsub = kfs.onSnapshot(colRef, function(snapshot) {
    // Skip the initial snapshot ONLY if we already loaded fresh data via getAll()
    // This prevents stale cache (ghost transactions) from sticking around.
    if (isFirstSnapshot) {
      isFirstSnapshot = false;
      var freshLoaded = window._kFreshDataLoaded && window._kFreshDataLoaded[col];
      if (freshLoaded) return;
    }
    // Check if this change was triggered by current user's recent save
    var hasExternalChange = false;
    var now = Date.now();
    snapshot.docChanges().forEach(function(change) {
      var docId = change.doc.id;
      // If this doc is in _recentSaves (saved locally within last 3s), skip it
      if (KDB._recentSaves[col] && KDB._recentSaves[col][docId]) {
        var saveTime = KDB._recentSaves[col][docId];
        if ((now - saveTime) < 3000) {
          // This is a self-triggered change, skip
          return;
        }
      }
      hasExternalChange = true;
    });
    if (!hasExternalChange) return;
    // External change detected - update localStorage cache
    var items = snapshot.docs.map(function(d) {
      var item = d.data();
      if (!item.id) item.id = d.id;
      return item;
    });

    // Ghost Fix: Filter out locally deleted items
    var deletedPrefix = cachePrefix + col + '_deleted_';
    var now2 = Date.now();
    _kCollectLocalStorageKeys(function(lsKey) {
      return lsKey.indexOf(deletedPrefix) === 0;
    }).forEach(function(lsKey) {
      if (lsKey && lsKey.indexOf(deletedPrefix) === 0) {
        var delId = lsKey.substring(deletedPrefix.length);
        var delTime = _klget(lsKey, 0);
        if (delTime && (now2 - delTime) < 15000) {
          items = items.filter(function(x) { return x.id !== delId && x._id !== delId; });
        } else {
          localStorage.removeItem(lsKey);
        }
      }
    });

    _klset(cachePrefix + col + '_all', items);

    // Trigger UI refresh
    if (onChange) onChange(col, items);
  }, function(err) {
    console.warn('[KFirebase] onSnapshot error for ' + col + ':', err.message);
  });
  return unsub;
}

/**
 * Start real-time sync for critical collections.
 * Call after successful login (when kfbReady is true).
 */
function startRealtimeSync() {
  if (_kRealtimeSyncActive || !kfbReady) return;
  _kRealtimeSyncActive = true;

  // Core collections
  var coreCols = ['jurnal', 'permohonan', 'danamasuk', 'inventori_atk', 'atk_log', 'settings', 'utangpiutang', 'chat_messages', 'notifikasi', 'ims_transactions'];
  // IMS Live collections (matching HR & Legal app exactly)
  var imsCols = ['hrd_penggajian', 'hrd_insentif', 'hrd_reimbursement', 'hrd_kasbon', 'hrd_tunjangan', 'hrd_perjalanan_dinas', 'hrd_overtime', 'hrd_karyawan'];

  var onCollectionUpdate = function(col, items) {
    // Invoke app-level update hook if registered
    if (typeof window.onKDBUpdate === 'function') {
      window.onKDBUpdate(col, items);
    }
    
    if (typeof currentSection !== 'undefined' && currentSection && typeof navigate === 'function') {
      // NEVER auto-refresh the whole section for chat messages
      if (col === 'chat_messages') return;

      // If we are in the Communication Portal, we only want partial updates (handled in onKDBUpdate)
      // Auto-navigating would clear the user's current typed message.
      if (currentSection === 'portal-komunikasi') return;

      // Don't auto-refresh if user is currently filling a protected form
      var activeEl = document.activeElement;
      var isTyping = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT');
      var hasUnsavedProtectedForm = typeof hasProtectedUnsavedSectionState === 'function' && hasProtectedUnsavedSectionState(currentSection);

      var modalOverlay = document.getElementById('modal-overlay');
      if (isTyping || hasUnsavedProtectedForm || (modalOverlay && modalOverlay.classList.contains('open'))) {
        // Just flag it as updated so it can be refreshed later (e.g. after closing modal)
        window._kDataUpdated = true;
      } else {
        navigate(currentSection);
      }
    }
  };

  coreCols.forEach(function(col) {
    var unsub = _kSubscribeCollection(col, onCollectionUpdate, true);
    if (unsub) _kRealtimeUnsubs.push(unsub);
  });

  imsCols.forEach(function(col) {
    var unsub = _kSubscribeCollection(col, onCollectionUpdate, false);
    if (unsub) _kRealtimeUnsubs.push(unsub);
  });

  console.log('[KFirebase] Real-time sync started for ' + (coreCols.length + imsCols.length) + ' collections');
}

/**
 * Stop real-time sync - unsubscribe all listeners.
 * Call on logout.
 */
function stopRealtimeSync() {
  _kRealtimeUnsubs.forEach(function(unsub) {
    if (typeof unsub === 'function') unsub();
  });
  _kRealtimeUnsubs = [];
  _kRealtimeSyncActive = false;
  console.log('[KFirebase] Real-time sync stopped');
}

function _klget(key, def) {
  try {
    var val = JSON.parse(localStorage.getItem(key));
    return (val !== null && val !== undefined) ? val : def;
  } catch(e) { return def; }
}

function _klset(key, val) {
  try {
    var str = JSON.stringify(val);
    localStorage.setItem(key, str);
  } catch(e) {
    console.warn('[KFirebase] LocalStorage Error:', e.message);
    if (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014) {
      // Clear heavy caches and retry
      console.warn('[KFirebase] Quota exceeded, clearing heavy caches...');
      _kCollectLocalStorageKeys(function(k) {
        return k.indexOf('k_') === 0 && k.indexOf('_all') > 0;
      }).forEach(function(k) {
        localStorage.removeItem(k);
      });
      try { localStorage.setItem(key, JSON.stringify(val)); } catch(e2) {
        console.error('[KFirebase] Retry failed after clearing cache');
      }
    }
  }
}

// Global safe storage helper
window.kSetItem = _klset;
window.kGetItem = _klget;
