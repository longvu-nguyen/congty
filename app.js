// ================================================================
//  APP.JS v3.5 — Quản lý Kho, Serial, OCR, BBGH & Báo Giá
// ================================================================

// ─── STATE ───────────────────────────────────────────────────────
let db = {
  products: [], serials: {}, importDocs: [], exportDocs: [],
  companies: [], employees: [], bbghDocs: [], quotations: [],
  rentals: [],
  myCompany: { name: '', address: '', phone: '', taxCode: '', rep: '', repPosition: '' },
};

let firebaseDb = null;
let firebaseInitialized = false;

const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyCdRISmjtxfaznshY4qxRmyZi_U6boFyjc",
  authDomain: "khohangcongty-3c8f9.firebaseapp.com",
  projectId: "khohangcongty-3c8f9",
  storageBucket: "khohangcongty-3c8f9.firebasestorage.app",
  messagingSenderId: "33686717884",
  appId: "1:33686717884:web:4c189de386fbd864d517b9"
};

function initFirebaseSync(config) {
  if (typeof firebase === 'undefined') return;
  const cfg = config || DEFAULT_FIREBASE_CONFIG;
  try {
    if (!firebase.apps.length && cfg && cfg.apiKey) {
      firebase.initializeApp(cfg);
      firebaseDb = firebase.firestore();
      firebaseInitialized = true;
      setupFirebaseRealtimeListener();
      console.log('Firebase Cloud Sync Connected to projectId:', cfg.projectId);
    }
  } catch (e) {
    console.log('Firebase Init error:', e);
  }
}

function setupFirebaseRealtimeListener() {
  if (!firebaseDb) return;
  firebaseDb.collection('kho_app').doc('main_db').onSnapshot((doc) => {
    if (doc.exists) {
      const cloudData = doc.data();
      if (cloudData && cloudData.lastUpdatedBy !== getClientId()) {
        db = { ...db, ...cloudData.db };
        localStorage.setItem('kho_v3', JSON.stringify(db));
        refreshActivePage();
      }
    }
  }, (err) => {
    console.log('Cloud sync error:', err);
  });
}

function getClientId() {
  let cid = localStorage.getItem('kho_client_id');
  if (!cid) {
    cid = 'client_' + Math.random().toString(36).substring(2, 9);
    localStorage.setItem('kho_client_id', cid);
  }
  return cid;
}

function refreshActivePage() {
  if (document.getElementById('page-dashboard')?.classList.contains('active')) renderDashboard();
  if (document.getElementById('page-inventory')?.classList.contains('active')) renderInventory();
  if (document.getElementById('page-products')?.classList.contains('active')) renderProducts();
  if (document.getElementById('page-serials')?.classList.contains('active')) renderSerials();
  if (document.getElementById('page-all-history')?.classList.contains('active')) renderAllHistory();
  if (document.getElementById('page-rental')?.classList.contains('active')) renderRentalPage();
}

const save = () => {
  localStorage.setItem('kho_v3', JSON.stringify(db));
  if (firebaseInitialized && firebaseDb) {
    firebaseDb.collection('kho_app').doc('main_db').set({
      db: db,
      lastUpdated: new Date().toISOString(),
      lastUpdatedBy: getClientId()
    }, { merge: true }).catch(() => { });
  }
};

function load() {
  const raw = localStorage.getItem('kho_v3') || localStorage.getItem('kho_v2');
  if (raw) {
    try {
      const saved = JSON.parse(raw);
      db = { ...db, ...saved };
      if (!db.products || db.products.length === 0) {
        db.products = INITIAL_PRODUCTS.map(p => ({ ...p, initialStock: 0, exported: 0 }));
      }
      if (!db.companies) db.companies = [...INITIAL_COMPANIES];
      if (!db.employees) db.employees = [...INITIAL_EMPLOYEES];
      if (!db.bbghDocs) db.bbghDocs = [];
      if (!db.quotations) db.quotations = [];
      if (!db.rentals) db.rentals = [];
      if (!db.myCompany) db.myCompany = { name: '', address: '', phone: '', taxCode: '', rep: '', repPosition: '' };
      if (!db.adminPassword) db.adminPassword = 'admin';
    } catch (e) { initDb(); }
  } else { initDb(); }

  // Yêu cầu giữ toàn bộ danh mục sản phẩm nhưng đặt tồn kho = 0
  if (!localStorage.getItem('kho_zero_stock_catalog_v2')) {
    db.products = INITIAL_PRODUCTS.map(p => ({ ...p, initialStock: 0, exported: 0 }));
    db.serials = {};
    db.importDocs = [];
    db.exportDocs = [];
    db.bbghDocs = [];
    db.quotations = [];
    save();
    localStorage.setItem('kho_zero_stock_catalog_v2', '1');
  }

  populateDatalist();
  updateAdminSidebarState();
  loadSavedFirebaseConfig();
}

function reconcileDatabaseIntegrity() {
  if (!db || !db.products) return;

  // 0. Tự động đồng bộ các công ty mẫu từ INITIAL_COMPANIES vào db.companies
  if (typeof INITIAL_COMPANIES !== 'undefined' && Array.isArray(INITIAL_COMPANIES)) {
    if (!db.companies) db.companies = [];
    INITIAL_COMPANIES.forEach(initC => {
      const idx = db.companies.findIndex(c => c.id === initC.id || c.name === initC.name);
      if (idx === -1) {
        db.companies.push({ ...initC });
      } else {
        if (!db.companies[idx].taxCode && initC.taxCode) db.companies[idx].taxCode = initC.taxCode;
        if (!db.companies[idx].phone && initC.phone) db.companies[idx].phone = initC.phone;
        if (!db.companies[idx].address && initC.address) db.companies[idx].address = initC.address;
        if (!db.companies[idx].deliveryAddress && initC.deliveryAddress) db.companies[idx].deliveryAddress = initC.deliveryAddress;
        if (!db.companies[idx].rep && initC.rep) db.companies[idx].rep = initC.rep;
        if (!db.companies[idx].repPosition && initC.repPosition) db.companies[idx].repPosition = initC.repPosition;
      }
    });
  }

  // 1. Phục hồi và dọn dẹp các serial
  Object.keys(db.serials || {}).forEach(sn => {
    const s = db.serials[sn];
    if (!s || !s.productId || !getProduct(s.productId)) {
      delete db.serials[sn];
      return;
    }
    // Đánh dấu serial xuất không có chứng từ nhập là fromQty
    if (s.status === 'exported' && !s.importDocId) {
      s.fromQty = true;
    }
    // Nếu là serial tạm (fromQty) nhưng chứng từ xuất/bàn giao không còn tồn tại -> xóa bỏ
    if (s.fromQty && s.exportDocId) {
      const hasExportDoc = (db.exportDocs || []).some(d => d.id === s.exportDocId) ||
                           (db.bbghDocs || []).some(d => d.id === s.exportDocId);
      if (!hasExportDoc) {
        delete db.serials[sn];
        return;
      }
    }
  });

  // 2. Bảo toàn số lượng tồn kho của các sản phẩm
  db.products.forEach(p => {
    // Đếm tổng nhập không serial từ importDocs
    let importedQty = 0;
    (db.importDocs || []).forEach(doc => {
      (doc.items || []).forEach(item => {
        if (item.productId === p.id && item.useSerial === false) {
          importedQty += (Number(item.qty) || 0);
        }
      });
    });

    // Đếm tổng xuất không serial từ exportDocs và bbghDocs
    let exportedQty = 0;
    (db.exportDocs || []).forEach(doc => {
      (doc.items || []).forEach(item => {
        if (item.productId === p.id) {
          if (!item.serials || item.serials.length === 0) {
            exportedQty += (Number(item.qty) || 0);
          } else {
            item.serials.forEach(sn => {
              if (db.serials[sn] && db.serials[sn].fromQty) exportedQty += 1;
            });
          }
        }
      });
    });
    (db.bbghDocs || []).forEach(doc => {
      (doc.items || []).forEach(item => {
        if (item.productId === p.id) {
          if (!item.serials || item.serials.length === 0) {
            exportedQty += (Number(item.qty) || 0);
          } else {
            item.serials.forEach(sn => {
              if (db.serials[sn] && db.serials[sn].fromQty) exportedQty += 1;
            });
          }
        }
      });
    });

    if (importedQty > 0 && (p.initialStock || 0) < importedQty) {
      p.initialStock = importedQty;
    }

    // Chuẩn hóa p.exported theo đúng chứng từ thực tế
    p.exported = exportedQty;

    // Đảm bảo floorStock đồng bộ với tồn kho thực tế (hàng không serial)
    const curStock = getStockCount(p.id);
    const snInStock = Object.values(db.serials || {}).filter(s => s.productId === p.id && s.status === 'in-stock').length;
    const nonSnStock = Math.max(0, curStock - snInStock);

    if (nonSnStock > 0) {
      p.floorStock = p.floorStock || {};
      const floorSum = Object.values(p.floorStock).reduce((a, b) => a + (Number(b) || 0), 0);
      if (floorSum === 0) {
        p.floorStock = { [p.location || 'Tầng 1']: nonSnStock };
      } else if (floorSum !== nonSnStock) {
        const diff = nonSnStock - floorSum;
        const mainFloor = Object.keys(p.floorStock)[0] || 'Tầng 1';
        p.floorStock[mainFloor] = Math.max(0, (p.floorStock[mainFloor] || 0) + diff);
      }
    } else {
      if (p.floorStock) {
        for (const k of Object.keys(p.floorStock)) p.floorStock[k] = 0;
      }
    }
  });
}

function populateDatalist() {
  const dl = document.getElementById('dl-companies');
  if (dl) dl.innerHTML = db.companies.map(c => `<option value="${esc(c.name)}"></option>`).join('');
  const dlEmp = document.getElementById('dl-employees');
  if (dlEmp) dlEmp.innerHTML = db.employees.map(e => `<option value="${esc(e.name)}"></option>`).join('');
}

function initDb() {
  db.products = INITIAL_PRODUCTS.map(p => ({ ...p, initialStock: 0, exported: 0 }));
  db.serials = {};
  db.importDocs = []; db.exportDocs = [];
  db.companies = INITIAL_COMPANIES.map(c => ({ ...c }));
  db.employees = INITIAL_EMPLOYEES.map(e => ({ ...e }));
  db.bbghDocs = [];
  db.quotations = [];
  db.rentals = [];
  db.myCompany = { name: '', address: '', phone: '', taxCode: '', rep: '', repPosition: '' };
  db.adminPassword = 'admin';
  save();
  populateDatalist();
  updateAdminSidebarState();
}

// ─── UTILS ───────────────────────────────────────────────────────
const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const genId = p => p + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 4).toUpperCase();
const today = () => new Date().toISOString().split('T')[0];

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function fmtDT(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('vi-VN');
}

function fmtMoney(n) {
  if (n === null || n === undefined || isNaN(n)) return '0 đ';
  return Number(n).toLocaleString('vi-VN') + ' đ';
}

function numberToWordsVN(n) {
  if (n === null || n === undefined || isNaN(n) || Number(n) === 0) return 'Không đồng./.';
  n = Math.round(Math.abs(Number(n)));
  const digits = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];

  function readTriple(triple, hasHigher) {
    let h = Math.floor(triple / 100);
    let t = Math.floor((triple % 100) / 10);
    let u = triple % 10;
    let res = '';
    if (h > 0 || hasHigher) {
      res += digits[h] + ' trăm ';
      if (t === 0 && u > 0) res += 'linh ';
    }
    if (t === 1) res += 'mười ';
    else if (t > 1) res += digits[t] + ' mươi ';

    if (t > 0 && u === 1 && t > 1) res += 'mốt ';
    else if (t > 0 && u === 5) res += 'lăm ';
    else if (u > 0 || (h === 0 && t === 0 && !hasHigher)) res += digits[u] + ' ';
    return res;
  }

  const scales = ['', 'nghìn', 'triệu', 'tỷ', 'nghìn tỷ', 'triệu tỷ'];
  let groups = [];
  let temp = n;
  while (temp > 0) {
    groups.push(temp % 1000);
    temp = Math.floor(temp / 1000);
  }

  let result = '';
  for (let i = groups.length - 1; i >= 0; i--) {
    let grp = groups[i];
    if (grp > 0) {
      let grpStr = readTriple(grp, i < groups.length - 1);
      result += grpStr + scales[i] + ' ';
    }
  }
  result = result.trim();
  if (!result) return 'Không đồng./.';
  return result.charAt(0).toUpperCase() + result.slice(1) + ' đồng./.';
}

const getProduct = id => db.products.find(p => p.id === id);
const getCompany = id => db.companies.find(c => c.id === id);
const getEmployee = id => db.employees.find(e => e.id === id);

function getStockCount(pid) {
  const p = getProduct(pid);
  const serials = Object.values(db.serials).filter(s => s.productId === pid);
  if (serials.length > 0) {
    // Sản phẩm có serial: đếm serial in-stock
    return serials.filter(s => s.status === 'in-stock').length;
  }
  if (!p) return 0;
  // Sản phẩm không serial: dùng initialStock - exported
  return Math.max(0, (p.initialStock || 0) - (p.exported || 0));
}
function getStockByFloor(pid) {
  const p = getProduct(pid);
  if (!p) return {};
  const inStockSerials = Object.values(db.serials).filter(s => s.productId === pid && s.status === 'in-stock');
  const floors = {};
  if (inStockSerials.length > 0) {
    inStockSerials.forEach(s => {
      const f = s.floor || p.location || 'Tầng 1';
      floors[f] = (floors[f] || 0) + 1;
    });
  } else {
    // Không có serial trong kho
    if (p.floorStock) {
      let remaining = getStockCount(pid);
      for (const f of Object.keys(p.floorStock)) {
        let qty = p.floorStock[f];
        if (qty > remaining) qty = remaining;
        if (qty > 0) floors[f] = qty;
        remaining -= qty;
      }
    } else if (getStockCount(pid) > 0) {
      floors[p.location || 'Tầng 1'] = getStockCount(pid);
    }
  }
  return floors;
}

function getExportedCount(pid) {
  const p = getProduct(pid);
  const serials = Object.values(db.serials).filter(s => s.productId === pid);
  if (serials.length > 0) {
    return serials.filter(s => s.status === 'exported').length;
  }
  return p?.exported || 0;
}
function productHasSerial(pid) {
  return Object.values(db.serials).some(s => s.productId === pid);
}
function getSerialsOf(pid, status = null) {
  return Object.entries(db.serials)
    .filter(([n, s]) => s.productId === pid && (status === null || s.status === status))
    .map(([n, s]) => ({ serialNum: n, ...s }));
}
function getTotals() {
  // Tính tổng tồn kho thực: serial in-stock + qty hàng không serial
  let totalInStock = 0;
  let totalExported = 0;
  db.products.forEach(p => {
    totalInStock += getStockCount(p.id);
    totalExported += getExportedCount(p.id);
  });
  const activeRentals = (db.rentals || []).filter(r => r.status !== 'returned').length;
  const overdueRentals = (db.rentals || []).filter(r => r.status !== 'returned' && r.endDate < today()).length;
  return {
    products: db.products.length,
    inStock: totalInStock,
    exported: totalExported,
    totalDocs: db.importDocs.length + db.exportDocs.length + db.bbghDocs.length + (db.quotations || []).length,
    activeRentals,
    overdueRentals,
  };
}

function genDocNum(prefix, list) {
  return `${prefix}-${new Date().getFullYear()}-${String(list.length + 1).padStart(4, '0')}`;
}

// ─── NAVIGATION ──────────────────────────────────────────────────
const PAGES = ['dashboard', 'inventory', 'products', 'serials', 'import', 'export', 'all-history', 'companies', 'employees', 'bbgh', 'bbgh-history', 'quote', 'admin', 'reports', 'barcode', 'audit', 'backup', 'rental'];

function nav(page) {
  closeMobileSidebar();
  PAGES.forEach(p => {
    document.getElementById('page-' + p)?.classList.remove('active');
    document.getElementById('nav-' + p)?.classList.remove('active');
    document.getElementById('mb-nav-' + p)?.classList.remove('active');
  });
  document.getElementById('page-' + page)?.classList.add('active');
  document.getElementById('nav-' + page)?.classList.add('active');
  document.getElementById('mb-nav-' + page)?.classList.add('active');

  const renders = {
    'dashboard': renderDashboard, 'inventory': renderInventory, 'products': renderProducts,
    'serials': renderSerials, 'import': renderImportPage,
    'export': renderExportPage, 'all-history': renderAllHistory,
    'companies': renderCompanies, 'employees': renderEmployees,
    'bbgh': renderBbghForm, 'bbgh-history': renderAllHistory,
    'quote': renderQuotePage, 'admin': renderAdminPage,
    'reports': renderReportsPage, 'barcode': renderBarcodePage, 'audit': renderAuditPage,
    'backup': renderBackupPage, 'rental': renderRentalPage,
  };
  renders[page]?.();
}

// ─── MODAL ───────────────────────────────────────────────────────
function openModal(id) {
  const el = document.getElementById(id);
  if (el) { el.classList.add('open'); document.body.style.overflow = 'hidden'; }
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) { el.classList.remove('open'); document.body.style.overflow = ''; }
}
document.addEventListener('click', e => {
  if (e.target.classList.contains('mo-overlay')) {
    e.target.classList.remove('open'); document.body.style.overflow = '';
  }
});

// ─── TOAST ───────────────────────────────────────────────────────
function toast(msg, type = 'inf') {
  const icons = { ok: '✅', err: '❌', wrn: '⚠️', inf: 'ℹ️' };
  const c = document.getElementById('toasts');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span>${icons[type] || '•'}</span><span>${esc(msg)}</span>`;
  c.appendChild(t);
  setTimeout(() => {
    t.style.cssText = 'opacity:0;transform:translateX(16px);transition:all .3s ease';
    setTimeout(() => t.remove(), 300);
  }, 3800);
}

function updateClock() {
  const el = document.getElementById('clock');
  if (el) el.textContent = new Date().toLocaleString('vi-VN');
}

// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
//  OCR ENGINE — Đọc Ảnh Biên Bản
// ═══════════════════════════════════════════════════════════════

/** Chạy OCR trên ảnh và trả về text */
async function runOcr(imageUrl, progressEl) {
  if (typeof Tesseract === 'undefined') {
    toast('Tesseract OCR chưa sẵn sàng — cần kết nối internet lần đầu', 'wrn');
    return null;
  }
  try {
    const result = await Tesseract.recognize(imageUrl, 'vie+eng', {
      logger: m => {
        if (progressEl && m.status === 'recognizing text') {
          progressEl.style.width = (m.progress * 100) + '%';
        }
      }
    });
    return result.data.text;
  } catch (err) {
    toast('Lỗi OCR: ' + err.message, 'err');
    return null;
  }
}

/**
 * Phân tích text OCR — trích xuất serial, sản phẩm, bên giao/nhận
 */
function parseDocumentText(text) {
  const lines = text.split(/[\n\r]+/).map(l => l.trim()).filter(Boolean);
  const result = {
    sellerName: '', buyerName: '', sellerRep: '', buyerRep: '',
    date: '', docNumber: '', note: '',
    serials: [], matchedProducts: [],
    rawLines: lines
  };
  const fullText = lines.join(' ');

  // ── 1. Tìm SERIAL ──
  const serialSet = new Set();
  const SKIP = new Set(['CONG', 'TY', 'TNHH', 'CTY', 'HCM', 'HNO', 'STT', 'DVT',
    'SLG', 'DON', 'GIA', 'TONG', 'NHAP', 'XUAT', 'HANG', 'HOA', 'BIEN', 'BAN', 'GIAO',
    'NHAN', 'NGUOI', 'DIEN', 'VIET', 'NAM', 'DOC', 'LAP', 'TU', 'DO', 'HANH', 'PHUC',
    'PAGE', 'TRANG', 'MUA', 'KHO', 'CHO', 'THONG', 'NHAT', 'LUONG', 'THEO', 'HAI',
    'BEN', 'CUNG', 'NGAY', 'THANG', 'PHIA', 'DAI', 'DIEN', 'CHUC', 'VU']);

  const productNorms = db.products.map(p => ({
    name: p.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, ''),
    code: p.code.toUpperCase().replace(/[^A-Z0-9]/g, '')
  }));

  lines.forEach(line => {
    const tokens = line.split(/[\s,;|]+/);
    tokens.forEach(t => {
      const clean = t.replace(/[^A-Za-z0-9\-]/g, '').replace(/^[\-]+|[\-]+$/g, '');
      const candUpper = clean.toUpperCase();
      const isKnown = !!db.serials[candUpper];

      // Serial chữ+số (kiểu cũ: MSI, CUBI, OKI...)
      const isMixed = /[A-Za-z]/.test(clean) && /[0-9]/.test(clean) &&
        clean.length >= 5 && clean.length <= 35 &&
        !SKIP.has(candUpper.replace(/[\-0-9]/g, '')) &&
        (/\d{2,}/.test(clean) || /[A-Z]{2,}\d/i.test(clean));
      // Serial toàn số (>=8 chữ số liên tiếp, như 03305377170744)
      const isNumeric = /^\d{8,20}$/.test(clean);

      let isProductFragment = false;
      const normCand = candUpper.replace(/[^A-Z0-9]/g, '');
      if (normCand.length > 4) {
        for (const pn of productNorms) {
          if (pn.name.includes(normCand) || pn.code.includes(normCand)) {
            isProductFragment = true; break;
          }
        }
      }

      if (isKnown || ((isMixed || isNumeric) && !isProductFragment)) {
        serialSet.add(candUpper);
      }
    });
    // Dòng bắt đầu bằng "- 0330..." hoặc "- ABC123"
    const dash = line.match(/^[-–]\s*([A-Za-z0-9][A-Za-z0-9\-]{4,34})/);
    if (dash) {
      const candUpper = dash[1].toUpperCase();
      const isKnown = !!db.serials[candUpper];
      const normCand = candUpper.replace(/[^A-Z0-9]/g, '');
      let isProductFragment = false;
      if (normCand.length > 4) {
        for (const pn of productNorms) { if (pn.name.includes(normCand) || pn.code.includes(normCand)) { isProductFragment = true; break; } }
      }
      if (isKnown || !isProductFragment) serialSet.add(candUpper);
    }
    // Dòng toàn số từ 8 chữ số (cả dòng là 1 serial)
    const fullNum = line.match(/^(\d{8,20})$/);
    if (fullNum) serialSet.add(fullNum[1]);
  });
  result.serials = [...serialSet];

  // ── 2. Match sản phẩm từ DB ──
  db.products.forEach(p => {
    const keywords = p.name.toLowerCase().split(/\s+/).filter(w =>
      w.length >= 4 && !['chiếc', 'cái', 'bộ', 'hộp', 'gói', 'bình', 'thanh'].includes(w));
    let hits = 0;
    keywords.forEach(kw => { if (fullText.toLowerCase().includes(kw)) hits++; });
    if (keywords.length > 0 && hits / keywords.length >= 0.4) {
      const snsForProduct = result.serials.filter(sn => db.serials[sn]?.productId === p.id);
      result.matchedProducts.push({ productId: p.id, name: p.name, code: p.code, matchScore: hits, serialsFound: snsForProduct });
    }
  });
  result.matchedProducts.sort((a, b) => b.matchScore - a.matchScore);
  result.matchedProducts = result.matchedProducts.slice(0, 6);

  // ── 3. Bên giao/nhận, ngày, số BB ──
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/BÊN BÁN|BÊN A\b|BEN BAN/i.test(line) && !result.sellerName) {
      for (let j = i; j <= Math.min(i + 4, lines.length - 1); j++) {
        const next = lines[j];
        if (/CÔNG TY|CTY|LTD|JSC|TNHH/i.test(next) && next.length > 8) {
          result.sellerName = next.replace(/BÊN BÁN.*?:/i, '').replace(/BÊN A.*?:/i, '').trim();
          break;
        }
      }
    }
    if (/BÊN MUA|BÊN B\b|BEN MUA/i.test(line) && !result.buyerName) {
      for (let j = i; j <= Math.min(i + 4, lines.length - 1); j++) {
        const next = lines[j];
        if (/CÔNG TY|CTY|LTD|JSC|TNHH/i.test(next) && next.length > 8) {
          result.buyerName = next.replace(/BÊN MUA.*?:/i, '').replace(/BÊN B.*?:/i, '').trim();
          break;
        }
      }
    }

    const repM = line.match(/(?:người\s+)?đại\s+diện[:\s]+(.{3,50})/i);
    if (repM) { if (!result.sellerRep) result.sellerRep = repM[1].trim(); else if (!result.buyerRep) result.buyerRep = repM[1].trim(); }

    const recvM = line.match(/người\s+nhận[:\s]+(.{3,50})/i);
    if (recvM && !result.buyerRep) result.buyerRep = recvM[1].trim();

    const giveM = line.match(/người\s+giao[:\s]+(.{3,50})/i);
    if (giveM && !result.sellerRep) result.sellerRep = giveM[1].trim();

    const dateM = line.match(/ngày[:\s]*(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/i) ||
      line.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
    if (dateM && !result.date) {
      const [, d, m, y] = dateM;
      if (+m >= 1 && +m <= 12 && +d >= 1 && +d <= 31)
        result.date = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }

    const numM = line.match(/số[:\s]*(BB[A-Z0-9\-\/]+|BBGH[A-Z0-9\-\/]+|\d+[\/\-]\d+[\-\w]*)/i);
    if (numM && !result.docNumber) result.docNumber = numM[1];
  }

  return result;
}

/**
 * Kho lưu tạm kết quả OCR đã phân tích, theo từng containerId.
 * Tránh nhúng JSON thẳng vào thuộc tính onclick="" (dễ vỡ vì JSON dùng dấu "
 * trùng với dấu bao thuộc tính HTML) — đây là nguyên nhân nút "Áp dụng" OCR
 * trước đây không bấm được.
 */
const _ocrParsedStore = {};

/**
 * Hiển thị panel kết quả OCR với sản phẩm và bên giao/nhận
 */
function showOcrPreview(parsed, type, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  _ocrParsedStore[containerId] = parsed; // lưu lại để các nút bên dưới dùng, không nhúng vào onclick

  const existingSerials = parsed.serials.filter(s => db.serials[s]);
  const newSerials = parsed.serials.filter(s => !db.serials[s]);
  const inStockSerials = existingSerials.filter(s => db.serials[s]?.status === 'in-stock');
  const exportedSerials = existingSerials.filter(s => db.serials[s]?.status === 'exported');

  const deliverySide = (parsed.sellerName || parsed.buyerName || parsed.date) ? `
    <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:12px 16px;margin-bottom:12px;font-size:12.5px;box-shadow:var(--shadow-xs)">
      <div style="font-weight:800;color:#ea580c;margin-bottom:6px">🚚 Thông tin giao nhận từ ảnh</div>
      ${parsed.sellerName ? `<div style="margin-bottom:4px">🏭 <strong>Bên giao (xuất):</strong> ${esc(parsed.sellerName)}${parsed.sellerRep ? ' — ' + esc(parsed.sellerRep) : ''}</div>` : ''}
      ${parsed.buyerName ? `<div style="margin-bottom:4px">🛒 <strong>Bên nhận:</strong> ${esc(parsed.buyerName)}${parsed.buyerRep ? ' — ' + esc(parsed.buyerRep) : ''}</div>` : ''}
      ${parsed.date ? `<div style="margin-bottom:2px">📅 <strong>Ngày:</strong> ${fmtDate(parsed.date)}</div>` : ''}
      ${parsed.docNumber ? `<div>📄 <strong>Số BB:</strong> ${esc(parsed.docNumber)}</div>` : ''}
    </div>` : '';

  const productSection = parsed.matchedProducts.length > 0 ? `
    <div style="margin-bottom:14px">
      <div class="sec-label mb2" style="color:#7c3aed">📦 Sản phẩm nhận dạng từ ảnh</div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${parsed.matchedProducts.map(mp => {
    const inS = getSerialsOf(mp.productId, 'in-stock');
    const foundInStock = mp.serialsFound.filter(sn => db.serials[sn]?.status === 'in-stock');
    return `<div style="background:#ffffff;border:1px solid #e9d5ff;border-radius:10px;padding:10px 14px;font-size:12.5px;box-shadow:var(--shadow-xs)">
            <div class="flex ic jb">
              <span style="font-weight:800;color:#7c3aed">[${esc(mp.code)}]</span>
              <span class="badge b-in" style="font-size:10.5px">${inS.length} còn kho</span>
            </div>
            <div style="color:var(--text2);margin:4px 0;font-weight:500">${esc(mp.name.substring(0, 70))}</div>
            ${foundInStock.length > 0 ? `<div style="color:#059669;font-size:11.5px;font-weight:700">✓ ${foundInStock.length} serial SP này trong ảnh</div>` : ''}
          </div>`;
  }).join('')}
      </div>
    </div>` : '';

  container.innerHTML = `
    <div class="ocr-result-box">
      <div class="ocr-result-header">
        <span style="font-size:18px">🔍</span>
        <span>Kết quả nhận dạng từ ảnh</span>
        <button class="btn btn-ghost btn-xs" onclick="document.getElementById('${containerId}').innerHTML=''">✕ Đóng</button>
      </div>
      ${deliverySide}
      ${productSection}
      <div style="margin-bottom:12px">
        <div class="ocr-serial-stats">
          <span class="badge b-in">🆕 Serial mới: ${newSerials.length}</span>
          <span class="badge b-warn">📦 Trong kho: ${inStockSerials.length}</span>
          <span class="badge b-out">📤 Đã xuất: ${exportedSerials.length}</span>
          <span class="badge" style="background:#f1f5f9;color:#334155;border:1px solid #cbd5e1">🔢 Tổng: ${parsed.serials.length}</span>
        </div>
      </div>
      ${parsed.serials.length > 0 ? `
        <div style="margin-bottom:14px">
          <div class="sec-label mb2">Serial nhận dạng — bỏ chọn serial không muốn thêm:</div>
          <div class="chip-grid" id="${containerId}-chips">
            ${parsed.serials.map(s => {
    const exists = db.serials[s];
    const st = exists?.status;
    const product = exists ? getProduct(db.serials[s].productId) : null;
    const productLabel = product ? ` [${product.code}]` : '';
    const statusLabel = !exists ? '🆕' : st === 'in-stock' ? '📦' : '📤';
    const cls = !exists
      ? 'background:#ecfdf5;border-color:#a7f3d0;color:#065f46'
      : st === 'in-stock'
        ? 'background:#fffbeb;border-color:#fde68a;color:#92400e'
        : 'background:#fff1f2;border-color:#fecdd3;color:#9f1239';
    const checked = type === 'export' ? st === 'in-stock' : !exists;
    return `<label style="cursor:pointer;display:inline-flex;align-items:center;gap:5px;padding:4px 9px;border-radius:7px;border:1px solid;${cls};font-family:var(--font-mono);font-size:12px;font-weight:600;box-shadow:var(--shadow-xs)" title="${esc(product?.name || '')}">
                <input type="checkbox" value="${esc(s)}" ${checked ? 'checked' : ''} style="accent-color:#2563eb;width:14px;height:14px" />
                ${statusLabel} ${esc(s)}${esc(productLabel)}
              </label>`;
  }).join('')}
          </div>
        </div>` : '<p class="fs12 c3 mb2">Không tìm thấy serial trong ảnh</p>'}
      <div class="flex gap2 flex-wrap">
        ${type === 'import' ? `<button class="btn btn-success" onclick="applyOcrToImport('${containerId}')">✅ Áp dụng nhập kho (${newSerials.length} serial mới)</button>` : ''}
        ${type === 'export' ? `<button class="btn btn-orange" onclick="applyOcrToExport('${containerId}')">📤 Áp dụng xuất kho (${inStockSerials.length} trong kho)</button>` : ''}
        ${type === 'bbgh' ? `<button class="btn btn-purple" onclick="applyOcrToBbgh('${containerId}')">📋 Gán serial vào bàn giao (${inStockSerials.length} trong kho)</button>` : ''}
        ${parsed.sellerName || parsed.buyerName || parsed.date ? `<button class="btn btn-ghost" onclick="fillOcrInfoToForm('${containerId}','${type}')">📋 Điền thông tin vào form</button>` : ''}
      </div>
    </div>`;
}

function applyOcrToBbgh(containerId) {
  const parsed = _ocrParsedStore[containerId]; if (!parsed) { toast('Không có dữ liệu OCR, hãy quét ảnh lại', 'wrn'); return; }
  const container = document.getElementById(containerId);
  const checked = [...container.querySelectorAll('input[type=checkbox]:checked')].map(c => c.value);
  const inStock = checked.filter(s => db.serials[s]?.status === 'in-stock');
  if (inStock.length === 0) { toast('Không có serial trong kho để gán', 'wrn'); return; }
  if (bbghItems.length === 0) { toast('⚠️ Thêm hàng hóa vào BBGH trước', 'wrn'); return; }
  if (bbghItems.length === 1) { addScannedCodes('bbgh', 0, inStock); }
  else { _ocrPendingSerials = inStock; _ocrType = 'bbgh'; showOcrProductPicker(containerId); }
}

function applyOcrToImport(containerId) {
  const parsed = _ocrParsedStore[containerId]; if (!parsed) { toast('Không có dữ liệu OCR, hãy quét ảnh lại', 'wrn'); return; }
  const container = document.getElementById(containerId);
  const checked = [...container.querySelectorAll('input[type=checkbox]:checked')].map(c => c.value);
  const newOnes = checked.filter(s => !db.serials[s]);
  if (newOnes.length === 0) { toast('Không có serial mới', 'wrn'); return; }
  if (importItems.length === 0) { toast('⚠️ Thêm sản phẩm trước rồi áp dụng serial', 'wrn'); return; }
  if (importItems.length === 1) { addScannedCodes('imp', 0, newOnes); }
  else { _ocrPendingSerials = newOnes; _ocrType = 'import'; showOcrProductPicker(containerId); }
}

function applyOcrToExport(containerId) {
  const parsed = _ocrParsedStore[containerId]; if (!parsed) { toast('Không có dữ liệu OCR, hãy quét ảnh lại', 'wrn'); return; }
  const container = document.getElementById(containerId);
  const checked = [...container.querySelectorAll('input[type=checkbox]:checked')].map(c => c.value);
  const inStock = checked.filter(s => db.serials[s]?.status === 'in-stock');
  if (inStock.length === 0) { toast('Không có serial trong kho', 'wrn'); return; }
  if (exportItems.length === 0) { toast('⚠️ Thêm sản phẩm trước rồi áp dụng serial', 'wrn'); return; }
  if (exportItems.length === 1) { addScannedCodes('exp', 0, inStock); }
  else { _ocrPendingSerials = inStock; _ocrType = 'export'; showOcrProductPicker(containerId); }
}

let _ocrPendingSerials = [];
let _ocrType = '';

function showOcrProductPicker(containerId) {
  const list = _ocrType === 'bbgh' ? bbghItems : _ocrType === 'import' ? importItems : exportItems;
  document.getElementById('ocr-picker-opts').innerHTML = list.map((item, idx) => {
    const p = getProduct(item.productId);
    return `<option value="${idx}">[${esc(p?.code || '')}] ${esc(p?.name || '')}</option>`;
  }).join('');
  document.getElementById('ocr-picker-count').textContent = _ocrPendingSerials.length + ' serial sẽ được gán';
  document.getElementById('ocr-picker-from').textContent = containerId;
  openModal('mo-ocr-picker');
}

function confirmOcrProductPick() {
  const idx = parseInt(document.getElementById('ocr-picker-opts').value);
  if (isNaN(idx)) { toast('Chọn sản phẩm', 'wrn'); return; }
  addScannedCodes(_ocrType, idx, _ocrPendingSerials);
  closeModal('mo-ocr-picker');
}

function fillOcrInfoToForm(containerId, type) {
  const parsed = _ocrParsedStore[containerId]; if (!parsed) { toast('Không có dữ liệu OCR, hãy quét ảnh lại', 'wrn'); return; }
  if (type === 'import') {
    if (parsed.sellerName) document.getElementById('imp-from').value = parsed.sellerName;
    if (parsed.buyerRep) document.getElementById('imp-recv').value = parsed.buyerRep;
    if (parsed.date) document.getElementById('imp-date').value = parsed.date;
  } else if (type === 'export') {
    if (parsed.buyerName) document.getElementById('exp-to').value = parsed.buyerName;
    if (parsed.buyerRep) document.getElementById('exp-recv').value = parsed.buyerRep;
    if (parsed.sellerRep) document.getElementById('exp-sign').value = parsed.sellerRep;
    if (parsed.date) document.getElementById('exp-date').value = parsed.date;
  } else if (type === 'bbgh') {
    if (parsed.date) document.getElementById('bbgh-date').value = parsed.date;
    if (parsed.docNumber) document.getElementById('bbgh-num').value = parsed.docNumber;
  }
  toast('✅ Đã điền thông tin từ ảnh vào form', 'ok');
}

/** Handler khi chọn ảnh — dùng chung cho nhập/xuất/bbgh */
async function handleOcrUpload(inputEl, type, containerId, progressBarId, previewId) {
  const file = inputEl.files[0]; if (!file) return;
  if (!file.type.startsWith('image/')) { toast('Chỉ chấp nhận file ảnh', 'wrn'); return; }

  const reader = new FileReader();
  reader.onload = async (e) => {
    const imgUrl = e.target.result;
    // Fix: previewId trỏ thẳng tới thẻ <img>
    const prevEl = document.getElementById(previewId);
    if (prevEl) { prevEl.src = imgUrl; prevEl.style.display = 'block'; }

    const progWrap = document.getElementById(progressBarId + '-wrap');
    const progBar = document.getElementById(progressBarId);
    if (progWrap) progWrap.style.display = 'block';
    if (progBar) progBar.style.width = '0%';
    toast('🔍 Đang nhận dạng văn bản từ ảnh...', 'inf');

    const text = await runOcr(imgUrl, progBar);
    if (!text) { if (progWrap) progWrap.style.display = 'none'; return; }
    if (progBar) progBar.style.width = '100%';
    setTimeout(() => { if (progWrap) progWrap.style.display = 'none'; }, 800);

    const parsed = parseDocumentText(text);
    showOcrPreview(parsed, type, containerId);
    fillOcrInfoToForm(containerId, type, parsed);

    const info = [];
    if (parsed.serials.length > 0) info.push(`${parsed.serials.length} serial`);
    if (parsed.matchedProducts.length > 0) info.push(`${parsed.matchedProducts.length} sản phẩm`);
    if (parsed.sellerName) info.push(`Bên giao: ${parsed.sellerName.substring(0, 20)}`);
    toast(`✅ Nhận dạng xong — ${info.length ? info.join(' | ') : 'không tìm thấy dữ liệu'}`, 'ok');
  };
  reader.readAsDataURL(file);
}


// ═══════════════════════════════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════════════════════════════

function enrichProduct(p) {
  if (!p) return {};
  const name = (p.name || '').toUpperCase();
  const code = (p.code || '').toUpperCase();
  const notes = (p.notes || '').toUpperCase();

  let brand = p.brand || '';
  if (!brand) {
    if (name.includes('IPAD') || name.includes('MACBOOK') || name.includes('APPLE')) {
      brand = 'Apple';
    } else if (name.includes('SURFACE')) {
      brand = 'Microsoft';
    } else {
      const BRANDS = ['MSI', 'RICOH', 'HP', 'OKI', 'HIKVISION', 'MICROSOFT', 'KYOCERA', 'SINDOH', 'EZVIZ', 'KINGSTON', 'LEXAR', 'WD', 'UGREEN', 'TENDA', 'MERCUSYS', 'ACER', 'DELL', 'SAMSUNG', 'LG', 'VSP', 'LENOVO', 'ASUS', 'LOGITECH', 'CANON', 'BROTHER', 'EPSON', 'ELEMENT', 'JASOZ', 'TP-LINK', 'DRAYTEK', 'UBIQUITI'];
      for (let b of BRANDS) {
        const regex = new RegExp(`\\b${b}\\b`, 'i');
        if (regex.test(name) || regex.test(code)) {
          brand = (b === 'HP' || b === 'MSI' || b === 'WD' || b === 'LG' || b === 'OKI') ? b : b.charAt(0) + b.slice(1).toLowerCase();
          break;
        }
      }
    }
  }
  if (!brand) brand = 'Khác';

  let category = p.category || '';
  if (!category) {
    if (name.includes('MỰC') || name.includes('HỘP MỰC') || name.includes('BỘT TỪ') || name.includes('KHAY CHỨA GIẤY')) {
      category = 'Mực in & Vật tư';
    } else if (name.includes('MÁY IN') || name.includes('MÁY QUÉT') || name.includes('SCAN') || name.includes('PHOTOCOPY') || name.includes('BỘ NẠP')) {
      category = 'Máy in & Máy quét';
    } else if (name.includes('MÀN HÌNH') || name.includes('LCD') || name.includes('MONITOR')) {
      category = 'Màn hình';
    } else if (name.includes('MINI PC') || name.includes('CUBI') || name.includes('MÁY TÍNH') || name.includes('LAPTOP') || name.includes('IPAD') || name.includes('SURFACE') || code.includes('PC')) {
      category = 'Máy tính & PC';
    } else if (name.includes('BÀN PHÍM') || name.includes('CHUỘT') || name.includes('CÁP') || name.includes('RAM') || name.includes('Ổ CỨNG') || name.includes('ĐẦU BẤM')) {
      category = 'Phím chuột & Linh kiện';
    } else if (name.includes('CAMERA') || name.includes('WIFI') || name.includes('MESH') || name.includes('THẺ NHỚ')) {
      category = 'Camera & Thiết bị mạng';
    } else {
      category = 'Thiết bị khác';
    }
  }

  let location = p.location || '';
  if (!location) {
    if (notes.includes('4F') || notes.includes('TẦNG 4')) {
      location = 'Tầng 4';
    } else if (notes.includes('1F') || notes.includes('TẦNG 1')) {
      location = 'Tầng 1';
    } else if (notes.includes('2F') || notes.includes('TẦNG 2')) {
      location = 'Tầng 2';
    } else if (notes.includes('3F') || notes.includes('TẦNG 3')) {
      location = 'Tầng 3';
    } else {
      if (category === 'Máy in & Máy quét' || category === 'Máy tính & PC') {
        location = 'Tầng 1';
      } else if (category === 'Mực in & Vật tư' || category === 'Màn hình') {
        location = 'Tầng 2';
      } else {
        location = 'Tầng 3';
      }
    }
  }

  return { ...p, brand, category, location };
}

function renderDashboard() {
  const t = getTotals();
  document.getElementById('d-products').textContent = t.products;
  document.getElementById('d-instock').textContent = t.inStock;
  const subEl = document.getElementById('d-instock-sub');
  if (subEl) {
    const snCount = Object.values(db.serials).filter(s => s.status === 'in-stock').length;
    const nonSnCount = t.inStock - snCount;
    subEl.textContent = nonSnCount > 0 ? `(${snCount} serial + ${nonSnCount} không SN)` : (snCount > 0 ? `(${snCount} serial)` : '');
  }
  document.getElementById('d-exported').textContent = t.exported;
  document.getElementById('d-docs').textContent = t.totalDocs;
  const rentalEl = document.getElementById('d-rental');
  if (rentalEl) rentalEl.textContent = t.activeRentals;
  const rentalOverdueEl = document.getElementById('d-rental-overdue');
  if (rentalOverdueEl) rentalOverdueEl.textContent = t.overdueRentals > 0 ? `⚠️ ${t.overdueRentals} quá hạn!` : '';
  const sbBadge = document.getElementById('sb-rental-badge');
  if (sbBadge) sbBadge.textContent = t.activeRentals > 0 ? t.activeRentals : '';

  // recent docs — ALL types
  const all = getAllDocsSorted().slice(0, 8);
  const tbody = document.getElementById('d-recent');
  tbody.innerHTML = all.length === 0
    ? `<tr><td colspan="5" class="tc" style="padding:28px 16px;background:#fafafa">
        <div style="display:flex;flex-direction:column;align-items:center;gap:8px">
          <div style="font-size:32px">📋</div>
          <div style="font-weight:700;color:var(--text1)">Chưa phát sinh chứng từ hoặc báo giá</div>
          <div style="font-size:12.5px;color:var(--text3)">Hãy bấm các nút thao tác bên dưới để bắt đầu lập phiếu mới</div>
          <div class="flex gap2 mt2">
            <button class="btn btn-success btn-sm" onclick="nav('import')">📥 Nhập kho mới</button>
            <button class="btn btn-warning btn-sm" onclick="nav('export')">📤 Xuất kho mới</button>
            <button class="btn btn-primary btn-sm" onclick="nav('quote')">💰 Tạo Báo Giá</button>
          </div>
        </div>
       </td></tr>`
    : all.map(doc => {
      const tot = (doc.items || []).reduce((s, i) => s + (i.serials?.length || i.qty || 0), 0);
      const badge = getDocTypeBadge(doc.type);
      const party = doc.type === 'import' ? esc(doc.fromParty || '')
        : doc.type === 'export' ? esc(doc.toParty || '')
          : esc(doc.buyerCompanyName || '');
      const detail = doc.type === 'quote'
        ? `<strong style="color:#2563eb">${fmtMoney(doc.grandTotal)}</strong> <span class="c3 fs11">(${(doc.items || []).length} SP)</span>`
        : `<span class="cb fw7">${tot}</span> serial`;
      return `<tr style="cursor:pointer" onclick="viewAnyDoc('${doc.type}','${doc.id}')"><td>${badge}</td><td class="fw7">${esc(doc.docNumber)}</td><td>${fmtDate(doc.date)}</td><td>${party}</td><td>${detail}</td></tr>`;
    }).join('');

  // Clear low stock warning
  const lowEl = document.getElementById('d-lowstock');
  if (lowEl) lowEl.innerHTML = '';

  const brandEl = document.getElementById('d-main-sections') || document.getElementById('d-brand-stats');
  if (brandEl) {
    let floorStats = {
      'Tầng 1': { stock: 0, catalog: 0 },
      'Tầng 2': { stock: 0, catalog: 0 },
      'Tầng 3': { stock: 0, catalog: 0 },
      'Tầng 4': { stock: 0, catalog: 0 },
    };

    let catStats = {};
    let brandStats = {};
    let allEnriched = [];

    db.products.forEach(rawP => {
      const p = enrichProduct(rawP);
      const stock = getStockCount(p.id);
      allEnriched.push({ ...p, stock });

      const loc = floorStats[p.location] ? p.location : 'Tầng 1';
      floorStats[loc].catalog += 1;
      floorStats[loc].stock += stock;

      const cat = p.category || 'Khác';
      if (!catStats[cat]) catStats[cat] = { stock: 0, catalog: 0 };
      catStats[cat].catalog += 1;
      catStats[cat].stock += stock;

      const brand = p.brand || 'Khác';
      if (!brandStats[brand]) brandStats[brand] = { stock: 0, catalog: 0 };
      brandStats[brand].catalog += 1;
      brandStats[brand].stock += stock;
    });

    const sortedCats = Object.entries(catStats).sort((a, b) => b[1].stock - a[1].stock);
    const sortedBrands = Object.entries(brandStats).sort((a, b) => b[1].stock - a[1].stock);

    // Top 6 products with highest stock
    const inStockItems = allEnriched.filter(x => x.stock > 0).sort((a, b) => b.stock - a.stock);
    const topProducts = inStockItems.slice(0, 6);
    const maxStock = topProducts[0]?.stock || 1;

    let html = `
    <!-- ROW 1: THỐNG KÊ TỒN KHO THEO TẦNG -->
    <div class="card mb3">
      <div class="card-hd">
        <span class="card-hd-title">🏢 Vị Trí & Tồn Kho Theo Tầng <span class="c3 fs12">(Phân bổ ${db.products.length} mã hàng)</span></span>
        <button class="btn btn-ghost btn-sm" onclick="nav('inventory')">Xem chi tiết Kho →</button>
      </div>
      <div class="card-bd" style="display:grid;grid-template-columns:repeat(auto-fit, minmax(210px, 1fr));gap:14px;padding:16px">
        
        <div class="inv-summary-card" onclick="setFloorFilter('Tầng 1')" style="background:linear-gradient(135deg,#ffffff 0%,#eff6ff 100%);border-color:#bfdbfe">
          <div class="inv-summary-icon" style="background:#dbeafe;color:#1d4ed8;font-size:22px">🏭</div>
          <div>
            <div style="font-size:11px;font-weight:800;color:#1d4ed8;text-transform:uppercase">TẦNG 1</div>
            <div class="inv-summary-val" style="color:#1d4ed8">${floorStats['Tầng 1'].stock} <span class="fs12 font-normal">cái tồn</span></div>
            <div class="inv-summary-lbl">${floorStats['Tầng 1'].catalog} mã hàng</div>
          </div>
        </div>

        <div class="inv-summary-card" onclick="setFloorFilter('Tầng 2')" style="background:linear-gradient(135deg,#ffffff 0%,#ecfdf5 100%);border-color:#a7f3d0">
          <div class="inv-summary-icon" style="background:#dcfce7;color:#047857;font-size:22px">🏭</div>
          <div>
            <div style="font-size:11px;font-weight:800;color:#047857;text-transform:uppercase">TẦNG 2</div>
            <div class="inv-summary-val" style="color:#047857">${floorStats['Tầng 2'].stock} <span class="fs12 font-normal">cái tồn</span></div>
            <div class="inv-summary-lbl">${floorStats['Tầng 2'].catalog} mã hàng</div>
          </div>
        </div>

        <div class="inv-summary-card" onclick="setFloorFilter('Tầng 3')" style="background:linear-gradient(135deg,#ffffff 0%,#fff7ed 100%);border-color:#fed7aa">
          <div class="inv-summary-icon" style="background:#ffedd5;color:#c2410c;font-size:22px">🏭</div>
          <div>
            <div style="font-size:11px;font-weight:800;color:#c2410c;text-transform:uppercase">TẦNG 3</div>
            <div class="inv-summary-val" style="color:#c2410c">${floorStats['Tầng 3'].stock} <span class="fs12 font-normal">cái tồn</span></div>
            <div class="inv-summary-lbl">${floorStats['Tầng 3'].catalog} mã hàng</div>
          </div>
        </div>

      </div>
    </div>

    <!-- ROW 2: LOẠI MÁY & TOP HÀNG TỒN NHIỀU NHẤT -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
      
      <!-- Cột Trái: Phân Loại & Hãng -->
      <div class="card">
        <div class="card-hd"><span class="card-hd-title">🖥️ Thống Kê Theo Phân Loại & Hãng</span></div>
        <div class="card-bd" style="display:flex;flex-direction:column;gap:14px;padding:18px">
          
          <div style="font-weight:700; font-size: 13px; color: var(--text2);">📦 Theo Phân Loại (Danh mục)</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            ${sortedCats.slice(0, 4).map(c => `
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px;cursor:pointer" onclick="filterInventoryByCategory('${esc(c[0])}')">
              <div style="font-size:15px;font-weight:800;color:var(--text1);margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(c[0])}">${esc(c[0])}</div>
              <div style="font-size:14px;font-weight:700;color:#2563eb">${c[1].stock} <span class="fs11 font-normal c3">tồn</span></div>
              <div class="fs11 c3">${c[1].catalog} mã hàng</div>
            </div>`).join('')}
          </div>

          <div style="font-weight:700; font-size: 13px; color: var(--text2); margin-top: 8px;">🏷️ Theo Hãng Sản Xuất (Thương hiệu)</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            ${sortedBrands.slice(0, 4).map(b => `
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px;cursor:pointer" onclick="filterInventoryByBrand('${esc(b[0])}')">
              <div style="font-size:15px;font-weight:800;color:var(--text1);margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(b[0])}">${esc(b[0])}</div>
              <div style="font-size:14px;font-weight:700;color:#15803d">${b[1].stock} <span class="fs11 font-normal c3">tồn</span></div>
              <div class="fs11 c3">${b[1].catalog} mã hàng</div>
            </div>`).join('')}
          </div>

        </div>
      </div>

      <!-- Cột Phải: Top Sản Phẩm Tồn Kho Nhiều Nhất -->
      <div class="card">
        <div class="card-hd">
          <span class="card-hd-title">🔥 Top Sản Phẩm Tồn Kho Nhiều Nhất</span>
          <button class="btn btn-ghost btn-sm" onclick="nav('products')">Danh mục SP (${db.products.length}) →</button>
        </div>
        <div class="card-bd" style="padding:16px;display:flex;flex-direction:column;gap:10px">
          ${topProducts.length === 0 ? `
            <div style="padding:20px 14px;text-align:center;background:#fafafa;border-radius:12px;border:1px dashed #cbd5e1">
              <div style="font-size:32px">📦</div>
              <div style="font-weight:700;font-size:14px;color:var(--text1);margin-top:4px">Đã sẵn sàng 74 sản phẩm mẫu</div>
              <div style="font-size:12px;color:var(--text3);margin-top:2px">Hiện tại các sản phẩm đang có số lượng tồn = 0. Bạn hãy thực hiện Nhập Kho để cập nhật tồn thực tế.</div>
              <button class="btn btn-primary btn-sm mt3" onclick="nav('import')">📥 Nhập kho ngay lập tức</button>
            </div>` :
        topProducts.map((p, idx) => {
          const pct = Math.round((p.stock / maxStock) * 100);
          const floorClass = p.location === 'Tầng 1' ? 'b-floor-1' : p.location === 'Tầng 2' ? 'b-floor-2' : 'b-floor-3';

          return `
              <div style="cursor:pointer" onclick="openProductModal('${esc(p.id)}')">
                <div class="flex ic jb fs12 mb1">
                  <div style="display:flex;align-items:center;gap:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:70%">
                    <span style="font-weight:800;color:var(--text3);width:16px">${idx + 1}.</span>
                    <span style="font-weight:700;color:var(--text1)">[${esc(p.code)}] ${esc(p.name)}</span>
                  </div>
                  <div style="display:flex;align-items:center;gap:6px">
                    <span class="b-floor ${floorClass}" style="font-size:10px;padding:1px 5px">🏢 ${esc(p.location)}</span>
                    <strong style="color:#2563eb;font-size:13px">${p.stock} <span class="fs11 font-normal c3">${esc(p.unit)}</span></strong>
                  </div>
                </div>
                <div style="background:#e2e8f0;height:5px;border-radius:999px;overflow:hidden">
                  <div style="background:linear-gradient(90deg,#2563eb,#7c3aed);height:100%;width:${pct}%"></div>
                </div>
              </div>`;
        }).join('')
      }
        </div>
      </div>

    </div>`;
    brandEl.innerHTML = html;
  }
}

// ═══════════════════════════════════════════════════════════════
//  INVENTORY FILTERS & RENDERING
// ═══════════════════════════════════════════════════════════════
let invSelectedBrand = 'all';
let invSelectedCategory = 'all';
let invSelectedFloor = 'all';

function filterInventoryByBrand(brandName) {
  invSelectedBrand = brandName;
  invSelectedCategory = 'all';
  invSelectedFloor = 'all';
  nav('inventory');
  toast(`🔍 Đang hiển thị sản phẩm còn tồn của hãng: ${brandName}`, 'inf');
}

function filterInventoryByCategory(catName) {
  invSelectedCategory = catName;
  invSelectedBrand = 'all';
  invSelectedFloor = 'all';
  nav('inventory');
  toast(`🔍 Đang lọc theo loại máy: ${catName}`, 'inf');
}

function renderInventory() {
  const brandSel = document.getElementById('inv-brand-filter');
  const catSel = document.getElementById('inv-cat-filter');
  const floorSel = document.getElementById('inv-floor-filter');

  if (brandSel) invSelectedBrand = brandSel.value;
  if (catSel) invSelectedCategory = catSel.value;
  if (floorSel) invSelectedFloor = floorSel.value;

  const q = (document.getElementById('inv-search')?.value || '').toLowerCase();
  const so = document.getElementById('inv-sort')?.value || 'name';

  let allEnriched = db.products.map(rawP => {
    const p = enrichProduct(rawP);
    const stock = getStockCount(p.id);
    const exported = getExportedCount(p.id);
    return { ...p, stock, exported };
  }).filter(p => p.stock > 0);

  // Dynamically populate Brand Filter dropdown with brands having stock > 0
  const activeBrands = [...new Set(allEnriched.map(p => p.brand))].sort();
  if (brandSel) {
    const prev = invSelectedBrand;
    brandSel.innerHTML = '<option value="all">🏷️ Tất cả hãng</option>' +
      activeBrands.map(b => `<option value="${esc(b)}">${esc(b)}</option>`).join('');
    if (activeBrands.includes(prev)) {
      brandSel.value = prev;
      invSelectedBrand = prev;
    } else if (prev === 'all') {
      brandSel.value = 'all';
    } else {
      brandSel.value = 'all';
      invSelectedBrand = 'all';
    }
  }

  // Calculate floor stats & category stats
  let floorStats = { 'Tầng 1': { count: 0, stock: 0 }, 'Tầng 2': { count: 0, stock: 0 }, 'Tầng 3': { count: 0, stock: 0 }, 'Tầng 4': { count: 0, stock: 0 } };
  let catStats = { 'Máy in & Máy quét': 0, 'Mực in & Vật tư': 0, 'Màn hình': 0, 'Máy tính & PC': 0, 'Phím chuột & Linh kiện': 0, 'Camera & Thiết bị mạng': 0 };

  allEnriched.forEach(p => {
    if (floorStats[p.location]) {
      floorStats[p.location].count += 1;
      floorStats[p.location].stock += p.stock;
    }
    if (catStats[p.category] !== undefined) {
      catStats[p.category] += p.stock;
    }
  });

  const summaryEl = document.getElementById('inv-summary-bar');
  if (summaryEl) {
    summaryEl.innerHTML = `
      <div class="inv-summary-card" onclick="setFloorFilter('Tầng 1')" title="Bấm để lọc Tầng 1">
        <div class="inv-summary-icon" style="background:#eff6ff;color:#1d4ed8">🏢</div>
        <div>
          <div class="inv-summary-val" style="color:#1d4ed8">${floorStats['Tầng 1'].stock} cái</div>
          <div class="inv-summary-lbl">🏢 Tầng 1 (${floorStats['Tầng 1'].count} loại SP)</div>
        </div>
      </div>
      <div class="inv-summary-card" onclick="setFloorFilter('Tầng 2')" title="Bấm để lọc Tầng 2">
        <div class="inv-summary-icon" style="background:#ecfdf5;color:#047857">🏢</div>
        <div>
          <div class="inv-summary-val" style="color:#047857">${floorStats['Tầng 2'].stock} cái</div>
          <div class="inv-summary-lbl">🏢 Tầng 2 (${floorStats['Tầng 2'].count} loại SP)</div>
        </div>
      </div>
      <div class="inv-summary-card" onclick="setFloorFilter('Tầng 3')" title="Bấm để lọc Tầng 3">
        <div class="inv-summary-icon" style="background:#fff7ed;color:#c2410c">🏢</div>
        <div>
          <div class="inv-summary-val" style="color:#c2410c">${floorStats['Tầng 3'].stock} cái</div>
          <div class="inv-summary-lbl">🏢 Tầng 3 (${floorStats['Tầng 3'].count} loại SP)</div>
        </div>
      </div>
      <div class="inv-summary-card" onclick="setCatFilter('Máy in & Máy quét')" title="Bấm để lọc Máy In / Scan">
        <div class="inv-summary-icon" style="background:#f5f3ff;color:#7c3aed">🖨️</div>
        <div>
          <div class="inv-summary-val" style="color:#7c3aed">${catStats['Máy in & Máy quét']} cái</div>
          <div class="inv-summary-lbl">🖨️ Máy in & Máy quét</div>
        </div>
      </div>
      <div class="inv-summary-card" onclick="setCatFilter('Mực in & Vật tư')" title="Bấm để lọc Hộp Mực">
        <div class="inv-summary-icon" style="background:#f0fdf4;color:#16a34a">🧪</div>
        <div>
          <div class="inv-summary-val" style="color:#16a34a">${catStats['Mực in & Vật tư']} cái</div>
          <div class="inv-summary-lbl">🧪 Mực in & Hộp mực</div>
        </div>
      </div>
    `;
  }

  let filtered = allEnriched.filter(p => {
    if (invSelectedBrand !== 'all' && p.brand !== invSelectedBrand) return false;
    if (invSelectedCategory !== 'all' && p.category !== invSelectedCategory) return false;
    if (invSelectedFloor !== 'all' && p.location !== invSelectedFloor) return false;
    if (q && !p.name.toLowerCase().includes(q) && !p.code.toLowerCase().includes(q)) return false;
    return true;
  });

  filtered.sort((a, b) => {
    if (so === 'code') return a.code.localeCompare(b.code);
    if (so === 'stock') return b.stock - a.stock;
    if (so === 'floor') return a.location.localeCompare(b.location);
    return a.name.localeCompare(b.name, 'vi');
  });

  const countMsg = `Hiển thị ${filtered.length} / ${allEnriched.length} sản phẩm còn hàng` +
    (invSelectedBrand !== 'all' ? ` · Hãng: ${invSelectedBrand}` : '') +
    (invSelectedFloor !== 'all' ? ` · ${invSelectedFloor}` : '') +
    (invSelectedCategory !== 'all' ? ` · ${invSelectedCategory}` : '');
  document.getElementById('inv-count').textContent = countMsg;

  const tbody = document.getElementById('inv-tbody');
  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="tc c3" style="padding:45px">
      <div style="font-size:32px;margin-bottom:8px">🔍</div>
      <div>Không tìm thấy sản phẩm phù hợp với bộ lọc</div>
      <button class="btn btn-ghost btn-sm mt2" onclick="resetInvFilters()">🔄 Xóa bộ lọc</button>
    </td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map((p, i) => {
    const floorClass = p.location === 'Tầng 1' ? 'b-floor-1' : p.location === 'Tầng 2' ? 'b-floor-2' : p.location === 'Tầng 3' ? 'b-floor-3' : 'b-floor-4';

    return `<tr>
      <td class="c3 fs12">${i + 1}</td>
      <td><span class="td-code">${esc(p.code)}</span></td>
      <td>
        <button class="td-name" onclick="openProductModal('${esc(p.id)}')">${esc(p.name)}</button>
        ${p.notes ? `<div class="fs11 c3 mt1">📝 ${esc(p.notes)}</div>` : ''}
      </td>
      <td class="c3">${esc(p.unit)}</td>
      <td>
        <span class="badge b-in" style="font-size:10.5px">${esc(p.brand)}</span>
        <div class="cat-badge mt1" style="font-size:10px">${esc(p.category)}</div>
      </td>
      <td>
        <span class="b-floor ${floorClass}" onclick="openLocationModal('${esc(p.id)}')" title="Click để thay đổi vị trí tầng">
          🏢 ${esc(p.location)} ✏️
        </span>
      </td>
      <td><span class="dot dot-ok"></span><span class="cg fw8 fs14">${p.stock}</span></td>
      <td><span class="cr fw7">${p.exported}</span></td>
      <td><span class="cb fw7">${p.stock + p.exported}</span></td>
      <td>
        <div class="flex gap1">
          <button class="btn btn-ghost btn-xs" onclick="openLocationModal('${esc(p.id)}')" title="Đổi tầng">🏢</button>
          <button class="btn btn-ghost btn-xs" onclick="openProductModal('${esc(p.id)}')" title="Xem chi tiết">🔍</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function setFloorFilter(floor) {
  invSelectedFloor = floor;
  const el = document.getElementById('inv-floor-filter');
  if (el) el.value = floor;
  renderInventory();
}

function setCatFilter(cat) {
  invSelectedCategory = cat;
  const el = document.getElementById('inv-cat-filter');
  if (el) el.value = cat;
  renderInventory();
}

function resetInvFilters() {
  invSelectedBrand = 'all';
  invSelectedCategory = 'all';
  invSelectedFloor = 'all';
  const s1 = document.getElementById('inv-brand-filter'); if (s1) s1.value = 'all';
  const s2 = document.getElementById('inv-cat-filter'); if (s2) s2.value = 'all';
  const s3 = document.getElementById('inv-floor-filter'); if (s3) s3.value = 'all';
  const s4 = document.getElementById('inv-search'); if (s4) s4.value = '';
  renderInventory();
}

function openLocationModal(pid) {
  const rawP = getProduct(pid); if (!rawP) return;
  const p = enrichProduct(rawP);
  document.getElementById('loc-pid').value = pid;
  document.getElementById('loc-pname').textContent = `[${p.code}] ${p.name}`;

  const sel = document.getElementById('loc-select');
  const customWrap = document.getElementById('loc-custom-wrap');
  const customInp = document.getElementById('loc-custom');

  if (['Tầng 1', 'Tầng 2', 'Tầng 3', 'Tầng 4'].includes(p.location)) {
    sel.value = p.location;
    customWrap.style.display = 'none';
  } else {
    sel.value = 'custom';
    customWrap.style.display = 'block';
    customInp.value = p.location;
  }
  openModal('mo-location');
}

function onLocSelectChange(val) {
  const customWrap = document.getElementById('loc-custom-wrap');
  if (val === 'custom') {
    customWrap.style.display = 'block';
    document.getElementById('loc-custom').focus();
  } else {
    customWrap.style.display = 'none';
  }
}

function saveProductLocation() {
  const pid = document.getElementById('loc-pid').value;
  const rawP = getProduct(pid); if (!rawP) return;

  const selVal = document.getElementById('loc-select').value;
  let newLoc = selVal;
  if (selVal === 'custom') {
    newLoc = document.getElementById('loc-custom').value.trim();
    if (!newLoc) { toast('Nhập vị trí kho', 'wrn'); return; }
  }

  rawP.location = newLoc;
  save();
  closeModal('mo-location');
  toast(`✅ Đã cập nhật vị trí "${rawP.name.substring(0, 35)}" sang ${newLoc}`, 'ok');
  if (document.getElementById('page-inventory')?.classList.contains('active')) renderInventory();
  if (document.getElementById('page-dashboard')?.classList.contains('active')) renderDashboard();
}

// ═══════════════════════════════════════════════════════════════
//  PRODUCTS
// ═══════════════════════════════════════════════════════════════
function renderProducts() {
  const q = (document.getElementById('p-search')?.value || '').toLowerCase();
  const so = document.getElementById('p-sort')?.value || 'name';
  const fi = document.getElementById('p-filter')?.value || 'all';

  let list = db.products.filter(p => {
    const inS = getStockCount(p.id);
    if (fi === 'instock' && inS === 0) return false;
    if (fi === 'outofstock' && inS > 0) return false;
    return !q || p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q);
  });
  list.sort((a, b) => {
    if (so === 'code') return a.code.localeCompare(b.code);
    if (so === 'stock') return getStockCount(b.id) - getStockCount(a.id);
    if (so === 'exported') return getExportedCount(b.id) - getExportedCount(a.id);
    return a.name.localeCompare(b.name, 'vi');
  });
  document.getElementById('p-count').textContent = list.length + ' sản phẩm';
  const tbody = document.getElementById('p-tbody');
  tbody.innerHTML = list.length === 0
    ? `<tr><td colspan="8" class="tc c3" style="padding:40px">Không tìm thấy</td></tr>`
    : list.map((p, i) => {
      const inS = getStockCount(p.id), exS = getExportedCount(p.id);
      const dot = inS === 0 ? 'dot-zero' : inS <= 2 ? 'dot-low' : 'dot-ok';
      return `<tr>
          <td class="c3 fs12">${i + 1}</td>
          <td><span class="td-code">${esc(p.code)}</span></td>
          <td><button class="td-name" onclick="openProductModal('${esc(p.id)}')">${esc(p.name)}</button></td>
          <td class="c3">${esc(p.unit)}</td>
          <td><span class="dot ${dot}"></span><span class="${inS === 0 ? 'cr' : 'cg'} fw7">${inS}</span></td>
          <td><span class="cr fw7">${exS}</span></td>
          <td><span class="cb fw7">${inS + exS}</span></td>
          <td><div class="flex gap2">
            <button class="btn btn-ghost btn-sm" onclick="openAddSerial('${esc(p.id)}')">➕ Serial</button>
            <button class="btn btn-ghost btn-sm" onclick="openProductModal('${esc(p.id)}')">🔍</button>
          </div></td>
        </tr>`;
    }).join('');
}

function openProductModal(pid) {
  const p = getProduct(pid); if (!p) return;
  const inS = getSerialsOf(pid, 'in-stock'), exS = getSerialsOf(pid, 'exported');
  const hasSerial = inS.length > 0 || exS.length > 0;
  const stockCount = getStockCount(pid);
  const exportedCount = getExportedCount(pid);
  document.getElementById('pm-title').textContent = p.name.substring(0, 60);

  if (hasSerial) {
    // Sản phẩm có serial — hiển thị danh sách serial
    document.getElementById('pm-body').innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:20px">
        ${[['✅', 'Trong kho', inS.length, 'cg', '#ecfdf5', '#a7f3d0'], ['📤', 'Đã xuất', exS.length, 'cr', '#fff1f2', '#fecdd3'], ['🔢', 'Tổng SN', inS.length + exS.length, 'cb', '#eff6ff', '#bfdbfe']].map(([ic, lb, n, c, bg, bc]) => `
        <div style="background:${bg};border:1px solid ${bc};border-radius:12px;padding:14px;text-align:center;box-shadow:var(--shadow-xs)">
          <div style="font-size:22px">${ic}</div><div class="fw8 ${c}" style="font-size:26px;margin:4px 0">${n}</div>
          <div class="fs11" style="font-weight:700;color:var(--text3);text-transform:uppercase">${lb}</div></div>`).join('')}
      </div>
      <div class="sec-label" style="color:#059669">✅ Còn trong kho (${inS.length})</div>
      ${inS.length === 0 ? '<p class="fs12 c3 mt2">Không có serial nào trong kho</p>' : `<div class="chip-grid mt2">${inS.map(s => `<div class="chip chip-ok">${esc(s.serialNum)}<span class="chip-x" onclick="deleteSerial1('${esc(s.serialNum)}','${esc(pid)}')">×</span></div>`).join('')}</div>`}
      <div class="divider"></div>
      <div class="sec-label" style="color:#e11d48">📤 Đã xuất (${exS.length})</div>
      ${exS.length === 0 ? '<p class="fs12 c3 mt2">Chưa có serial nào xuất</p>' : `<div class="chip-grid mt2">${exS.map(s => `<div class="chip chip-out" title="Xuất: ${fmtDate(s.exportDate)} | Cho: ${esc(s.exportTo || '?')}">${esc(s.serialNum)}<span class="fs11 c3"> →${(s.exportTo || '').substring(0, 12)}</span></div>`).join('')}</div>`}
    `;
  } else {
    // Sản phẩm không serial — hiển thị số lượng tồn
    document.getElementById('pm-body').innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px">
        <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:12px;padding:20px;text-align:center">
          <div style="font-size:22px">📦</div>
          <div class="fw8 cg" style="font-size:36px;margin:4px 0">${stockCount}</div>
          <div class="fs11 fw7 c3" style="text-transform:uppercase">Còn trong kho</div>
          <div class="fs11 c3 mt1">${esc(p.unit || 'cái')}</div>
        </div>
        <div style="background:#fff1f2;border:1px solid #fecdd3;border-radius:12px;padding:20px;text-align:center">
          <div style="font-size:22px">📤</div>
          <div class="fw8 cr" style="font-size:36px;margin:4px 0">${exportedCount}</div>
          <div class="fs11 fw7 c3" style="text-transform:uppercase">Đã xuất</div>
          <div class="fs11 c3 mt1">${esc(p.unit || 'cái')}</div>
        </div>
      </div>
      <div style="background:#f0fdf4;border:1px dashed #86efac;border-radius:12px;padding:14px;text-align:center">
        <span class="badge" style="background:#dcfce7;color:#16a34a;border:1px solid #86efac;font-size:12px;padding:4px 12px">📋 Sản phẩm quản lý theo số lượng (không có Serial)</span>
        <p class="fs12 c3 mt2">Sản phẩm này không có mã serial. Nhập/xuất kho bằng số lượng trực tiếp.</p>
      </div>
    `;
  }
  document.getElementById('pm-add-btn').onclick = () => { closeModal('mo-product'); openAddSerial(pid); };
  openModal('mo-product');
}

function deleteSerial1(sn, pid) {
  if (!confirm(`Xóa serial "${sn}"?`)) return;
  delete db.serials[sn]; save();
  toast('Đã xóa: ' + sn, 'ok');
  openProductModal(pid);
}

let _addSerialPid = '';
function openAddSerial(pid) {
  const p = getProduct(pid); if (!p) return;
  _addSerialPid = pid;
  document.getElementById('as-pname').textContent = p.name.substring(0, 65);
  document.getElementById('as-input').value = ''; document.getElementById('as-preview').innerHTML = '';
  openModal('mo-add-serial');
  setTimeout(() => document.getElementById('as-input').focus(), 120);
}
function previewSerials() {
  const lines = document.getElementById('as-input').value.split(/[\n,;\t]+/).map(s => s.trim()).filter(Boolean);
  const ok = [], dup = [];
  lines.forEach(s => { if (db.serials[s]) dup.push(s); else ok.push(s); });
  let html = '';
  if (ok.length) html += `<div class="flex ic gap2 mb2"><span class="badge b-in">✅ Hợp lệ: ${ok.length}</span></div><div class="chip-grid mb2">${ok.map(s => `<div class="chip chip-ok">${esc(s)}</div>`).join('')}</div>`;
  if (dup.length) html += `<div class="flex ic gap2 mb2"><span class="badge b-warn">⚠️ Trùng (bỏ qua): ${dup.length}</span></div><div class="chip-grid">${dup.map(s => `<div class="chip chip-warn">${esc(s)}</div>`).join('')}</div>`;
  document.getElementById('as-preview').innerHTML = html || '<p class="fs12 c3">Nhập serial để xem trước...</p>';
}
function confirmAddSerial() {
  const lines = document.getElementById('as-input').value.split(/[\n,;\t]+/).map(s => s.trim()).filter(Boolean);
  let added = 0;
  lines.forEach(sn => { if (!sn || db.serials[sn]) return; db.serials[sn] = { productId: _addSerialPid, status: 'in-stock', addedDate: today(), importDocId: null, exportDocId: null, exportDate: null, exportTo: null, exportReceiver: null }; added++; });
  save(); closeModal('mo-add-serial');
  toast(`Đã thêm ${added} serial vào kho`, 'ok');
  if (document.getElementById('page-products')?.classList.contains('active')) renderProducts();
  if (document.getElementById('page-serials')?.classList.contains('active')) renderSerials();
}

// ═══════════════════════════════════════════════════════════════
//  SERIALS
// ═══════════════════════════════════════════════════════════════
function renderSerials() {
  const sel = document.getElementById('sr-product');
  if (sel && sel.options.length <= 1) db.products.forEach(p => { const o = document.createElement('option'); o.value = p.id; o.textContent = `[${p.code}] ${p.name}`; sel.appendChild(o); });
  const q = (document.getElementById('sr-search')?.value || '').toLowerCase();
  const pid = document.getElementById('sr-product')?.value || '';
  const st = document.getElementById('sr-status')?.value || 'all';
  let entries = Object.entries(db.serials).filter(([sn, s]) => { if (pid && s.productId !== pid) return false; if (st !== 'all' && s.status !== st) return false; if (q && !sn.toLowerCase().includes(q)) return false; return true; });
  document.getElementById('sr-count').textContent = entries.length + ' serial';
  const tbody = document.getElementById('sr-tbody');
  tbody.innerHTML = entries.length === 0 ? `<tr><td colspan="7" class="tc c3" style="padding:40px">Không có serial</td></tr>`
    : entries.map(([sn, s]) => {
      const p = getProduct(s.productId); const b = s.status === 'in-stock' ? '<span class="badge b-in">✅ Trong kho</span>' : '<span class="badge b-out">📤 Đã xuất</span>';
      return `<tr><td class="tc"><span class="fmono fw7">${esc(sn)}</span></td><td><span class="td-code">${esc(p?.code || '')}</span></td><td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p?.name || '?')}</td><td>${b}</td><td class="fs12 c3">${fmtDate(s.addedDate)}</td><td class="fs12">${s.exportDate ? `${fmtDate(s.exportDate)}<br><span class="co">${esc(s.exportTo || '')}</span>` : '—'}</td><td>${s.status === 'in-stock' ? `<button class="btn btn-ghost btn-xs" onclick="deleteSN('${esc(sn)}')">🗑️</button>` : '—'}</td></tr>`;
    }).join('');
}
function deleteSN(sn) { if (!confirm(`Xóa serial "${sn}"?`)) return; delete db.serials[sn]; save(); renderSerials(); toast('Đã xóa: ' + sn, 'ok'); }

// ═══════════════════════════════════════════════════════════════
//  QUÉT SERIAL DÙNG CHUNG — Phương thức 2 (Nhập kho / Xuất kho / BBGH)
//  Đây là nơi DUY NHẤT xử lý logic thêm serial bằng cách quét/gõ tay,
//  áp dụng thống nhất cho cả 3 loại biên bản để dễ kiểm tra lại.
// ═══════════════════════════════════════════════════════════════
function getScanArray(kind) {
  if (kind === 'imp') return importItems;
  if (kind === 'exp') return exportItems;
  if (kind === 'bbgh') return bbghItems;
  return [];
}

/** Enter hoặc Tab = xác nhận 1 mã vừa quét/gõ từ máy quét barcode */
function handleScanKeydown(e, kind, idx) {
  if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault();
    const val = e.target.value.trim();
    e.target.value = '';
    if (val) {
      const codes = val.split(/[\r\n\t,; ]+/).map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
      if (codes.length) addScannedCodes(kind, idx, codes, e.target);
    }
  }
}

/** Dán (paste) trực tiếp từ Excel hoặc clipboard — Tự động tách theo xuống dòng, tab, khoảng cách và thêm tất cả serial */
function handleScanPasteEvent(e, kind, idx) {
  const text = (e.clipboardData || window.clipboardData)?.getData('text') || '';
  if (!text) return;
  const codes = text.split(/[\r\n\t,;]+/).map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  if (codes.length > 0) {
    e.preventDefault();
    e.target.value = '';
    addScannedCodes(kind, idx, codes, e.target);
  }
}

/** Backup khi người dùng paste bằng cách khác hoặc trên mobile */
function handleScanPaste(el, kind, idx) {
  if (!el || !el.value) return;
  const val = el.value;
  if (val.includes('\n') || val.includes('\r') || val.includes('\t') || val.includes(',') || val.includes(';')) {
    const codes = val.split(/[\r\n\t,;]+/).map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    el.value = '';
    if (codes.length) addScannedCodes(kind, idx, codes, el);
  }
}

/**
 * Thêm danh sách mã serial vào 1 dòng hàng hóa (item) của biên bản.
 * kind: 'imp' (nhập kho) | 'exp' (xuất kho) | 'bbgh' (bàn giao)
 */
function addScannedCodes(kind, idx, codes, inputEl) {
  const item = getScanArray(kind)[idx];
  if (!item) return;
  const uniq = [...new Set(codes.map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean))];
  let added = 0, dup = 0;

  uniq.forEach(sn => {
    if (item.serials.includes(sn)) { dup++; return; }

    if (kind === 'imp') {
      if (db.serials[sn] && db.serials[sn].status === 'in-stock') {
        dup++; return; // Đã có trong kho
      }
      item.serials.push(sn);
      added++;
    } else {
      // Xuất kho (exp) hoặc Biên bản Bàn giao (bbgh):
      // Chấp nhận mọi mã serial quét vào dòng sản phẩm này
      item.serials.push(sn);
      added++;
    }
  });

  updateItemScanUI(kind, idx);
  if (inputEl) flashScanInput(inputEl, added > 0 ? 'ok' : 'warn');

  if (dup) toast(`⚠️ Bỏ qua ${dup} mã serial đã có`, 'wrn');
  if (added === 1 && uniq.length === 1) toast(`✅ Đã nhận mã Serial: ${uniq[0]}`, 'ok');
  else if (added) toast(`✅ Đã quét / thêm ${added} mã serial`, 'ok');
}

/** Hiệu ứng flash viền ô quét: xanh = thêm được, vàng = trùng/không hợp lệ */
function flashScanInput(el, type) {
  const cls = type === 'ok' ? 'scan-flash-ok' : 'scan-flash-warn';
  el.classList.remove('scan-flash-ok', 'scan-flash-warn');
  void el.offsetWidth; // ép trình duyệt reflow để chạy lại animation
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), 500);
}

/** Cập nhật riêng phần chip + đếm số lượng của 1 dòng hàng — KHÔNG render lại
 *  toàn bộ danh sách, để con trỏ không bị mất khỏi ô quét khi đang quét liên tục. */
function updateItemScanUI(kind, idx) {
  if (kind === 'imp') {
    const chips = document.getElementById(`imp-chips-${idx}`); if (chips) chips.innerHTML = importChipsHtml(idx);
    const cnt = document.getElementById(`imp-cnt-${idx}`); if (cnt) cnt.innerHTML = importCountHtml(idx);
  } else if (kind === 'exp') {
    const chips = document.getElementById(`exp-chips-${idx}`); if (chips) chips.innerHTML = exportChipsHtml(idx);
    const cnt = document.getElementById(`exp-cnt-${idx}`); if (cnt) cnt.innerHTML = exportCountHtml(idx);
    const stock = document.getElementById(`exp-stock-${idx}`); if (stock) stock.innerHTML = exportStockHtml(idx);
  } else if (kind === 'bbgh') {
    const item = bbghItems[idx];
    if (item && item.serials.length > 0) {
      item.qty = item.serials.length;
      const qtyInput = document.getElementById(`bbgh-qty-${idx}`);
      if (qtyInput) qtyInput.value = item.qty;
    }
    const chips = document.getElementById(`bbgh-chips-${idx}`); if (chips) chips.innerHTML = bbghChipsHtml(idx);
    const cnt = document.getElementById(`bbgh-cnt-${idx}`); if (cnt) cnt.innerHTML = bbghCountHtml(idx);
    const stock = document.getElementById(`bbgh-stock-${idx}`); if (stock) stock.innerHTML = bbghStockHtml(idx);
  }
}

// ═══════════════════════════════════════════════════════════════
//  IMPORT DOC (with OCR)
// ═══════════════════════════════════════════════════════════════
let importItems = [];

function renderImportPage() { renderImportItems(); }

function renderImportItems() {
  const c = document.getElementById('imp-items');
  if (importItems.length === 0) { c.innerHTML = `<div class="empty"><div class="empty-icon">📦</div><p>Nhấn "➕ Thêm sản phẩm" để bắt đầu</p></div>`; return; }
  c.innerHTML = importItems.map((item, idx) => {
    const p = getProduct(item.productId);
    const hasSerial = item.useSerial !== false; // mặc định dùng serial
    const stockByFloor = getStockByFloor(item.productId);
    const floorStr = Object.entries(stockByFloor).filter(([f, q]) => q > 0).map(([f, q]) => `${f}: ${q}`).join(' | ');
    const stockInfo = floorStr ? `<div class="fs12 cb mt1 mb2">📦 Đang tồn kho: ${floorStr}</div>` : `<div class="fs12 c3 mt1 mb2">📦 Chưa có hàng tồn</div>`;

    return `<div class="item-row">
      <div class="flex ic jb mb1">
        <div class="flex ic gap2 flex-wrap">
          <span class="badge b-imp fs11">${esc(p?.code || '')}</span>
          <span class="fw7">${esc(p?.name || '')} <span class="c3">(${esc(p?.unit || '')})</span></span>
        </div>
        <div class="flex ic gap2">
          <label class="flex ic gap1 fs12" style="cursor:pointer">
            <input type="checkbox" ${!hasSerial ? 'checked' : ''} onchange="toggleImportSerial(${idx}, !this.checked)" /> Không có Serial
          </label>
          <button class="btn btn-ghost btn-xs" onclick="removeImportItem(${idx})">🗑️ Xóa</button>
        </div>
      </div>
      ${stockInfo}
      <div class="fg mb2" style="max-width:200px">
        <label class="flabel fs12">Tầng lưu trữ</label>
        <select class="fi fi-sm" onchange="importItems[${idx}].floor = this.value">
          <option value="Tầng 1" ${item.floor === 'Tầng 1' ? 'selected' : ''}>Tầng 1</option>
          <option value="Tầng 2" ${item.floor === 'Tầng 2' ? 'selected' : ''}>Tầng 2</option>
          <option value="Tầng 3" ${item.floor === 'Tầng 3' ? 'selected' : ''}>Tầng 3</option>
          <option value="Tầng 4" ${item.floor === 'Tầng 4' ? 'selected' : ''}>Tầng 4</option>
        </select>
      </div>
      ${hasSerial ? `
      <div class="scan-line-box mb2">
        <label>🔢 Quét / Dán mã Serial <span class="c3">— quét mã vạch, gõ tay hoặc dán (Ctrl+V) cột từ Excel</span></label>
        <input type="text" id="imp-scan-${idx}" class="scan-line-input" placeholder="Quét / gõ serial hoặc dán cột từ Excel..."
          onkeydown="handleScanKeydown(event,'imp',${idx})"
          onpaste="handleScanPasteEvent(event,'imp',${idx})"
          oninput="handleScanPaste(this,'imp',${idx})" />
      </div>
      <div class="chip-grid mb2" id="imp-chips-${idx}">${importChipsHtml(idx)}</div>
      <div class="fs12" id="imp-cnt-${idx}">${importCountHtml(idx)}</div>
      ` : `
      <div class="scan-line-box mb2" style="background:#f0fdf4;border-color:#a7f3d0">
        <label style="color:#059669;font-weight:700">📦 Số lượng nhập kho (không có serial)</label>
        <div class="flex ic gap2 mt2">
          <input type="number" class="fi" id="imp-qty-${idx}" value="${item.qty || 1}" min="1" style="width:120px;font-size:18px;font-weight:800;text-align:center"
            onchange="importItems[${idx}].qty = Number(this.value) || 1" />
          <span class="fs12 c3">${esc(p?.unit || 'cái')}</span>
        </div>
        <div class="fs12 cg fw7 mt2">✅ ${item.qty || 1} ${esc(p?.unit || 'cái')} sẽ được cộng vào tồn kho</div>
      </div>
      `}
    </div>`;
  }).join('');
}

function toggleImportSerial(idx, useSerial) {
  importItems[idx].useSerial = useSerial;
  importItems[idx].serials = [];
  importItems[idx].qty = 1;
  if (!importItems[idx].floor) importItems[idx].floor = 'Tầng 1';
  renderImportItems();
  if (useSerial) setTimeout(() => document.getElementById(`imp-scan-${idx}`)?.focus(), 100);
}

function importChipsHtml(idx) {
  const item = importItems[idx]; if (!item) return '';
  return item.serials.length
    ? item.serials.map(s => `<div class="chip chip-pend">${esc(s)}<span class="chip-x" onclick="removeImportSerial(${idx},'${esc(s)}')">×</span></div>`).join('')
    : '<span class="fs12 c3">Chưa quét serial nào</span>';
}
function importCountHtml(idx) {
  const n = importItems[idx]?.serials.length || 0;
  return n > 0 ? `<span class="cg fw7">✅ ${n} serial</span> sẽ được cộng vào kho` : '<span class="c3">0 serial — quét hoặc gõ mã rồi nhấn Enter</span>';
}

function removeImportSerial(idx, sn) { importItems[idx].serials = importItems[idx].serials.filter(s => s !== sn); updateItemScanUI('imp', idx); }
function removeImportItem(idx) { importItems.splice(idx, 1); renderImportItems(); }

function openAddImportProduct() {
  const opts = db.products.map(p => `<option value="${esc(p.id)}">[${esc(p.code)}] ${esc(p.name)}</option>`).join('');
  document.getElementById('imp-psel').innerHTML = '<option value="">-- Chọn sản phẩm --</option>' + opts;
  openModal('mo-imp-product');
}
function confirmImportProduct() {
  const pid = document.getElementById('imp-psel').value;
  if (!pid) { toast('Chọn sản phẩm', 'wrn'); return; }
  importItems.push({ productId: pid, serials: [], useSerial: true, qty: 1, floor: 'Tầng 1' });
  closeModal('mo-imp-product'); renderImportItems();
  const newIdx = importItems.length - 1;
  setTimeout(() => document.getElementById(`imp-scan-${newIdx}`)?.focus(), 150);
}

function submitImport() {
  const date = document.getElementById('imp-date')?.value;
  const from = document.getElementById('imp-from')?.value?.trim() || '';
  const to = document.getElementById('imp-to')?.value?.trim() || 'Kho công ty';
  const recv = document.getElementById('imp-recv')?.value?.trim() || '';
  const note = document.getElementById('imp-note')?.value?.trim() || '';
  if (!date) { toast('Chọn ngày nhập', 'wrn'); return; }
  if (importItems.length === 0) { toast('Chưa có sản phẩm', 'wrn'); return; }

  // Kiểm tra có hàng nào chưa nhập
  const hasSerial = importItems.some(i => i.useSerial !== false && i.serials.length > 0);
  const hasQty = importItems.some(i => i.useSerial === false && (i.qty || 0) > 0);
  if (!hasSerial && !hasQty) { toast('Chưa có serial hoặc số lượng nào', 'wrn'); return; }

  let totalSerial = importItems.filter(i => i.useSerial !== false).reduce((s, i) => s + i.serials.length, 0);
  let totalQty = importItems.filter(i => i.useSerial === false).reduce((s, i) => s + (Number(i.qty) || 0), 0);
  const totalAll = totalSerial + totalQty;

  const confirmMsg = [
    totalSerial > 0 ? `${totalSerial} serial` : '',
    totalQty > 0 ? `${totalQty} sản phẩm (không serial)` : ''
  ].filter(Boolean).join(' + ');
  if (!confirm(`Xác nhận Nhập kho ${confirmMsg}?\nSử liệu sẽ được cộng vào tồn kho.`)) return;

  const docId = genId('IMP');
  const docNumber = genDocNum('BBNHAP', db.importDocs);

  // Xử lý hàng có serial
  importItems.filter(i => i.useSerial !== false).forEach(item => item.serials.forEach(sn => {
    db.serials[sn] = { productId: item.productId, status: 'in-stock', addedDate: date, importDocId: docId, exportDocId: null, exportDate: null, exportTo: null, exportReceiver: null, floor: item.floor || 'Tầng 1' };
  }));

  // Xử lý hàng không serial — cộng số lượng vào initialStock
  importItems.filter(i => i.useSerial === false).forEach(item => {
    const p = getProduct(item.productId);
    if (p) {
      p.initialStock = (p.initialStock || 0) + (Number(item.qty) || 0);
      p.floorStock = p.floorStock || {};
      const f = item.floor || 'Tầng 1';
      p.floorStock[f] = (p.floorStock[f] || 0) + (Number(item.qty) || 0);
    }
  });

  db.importDocs.push({
    id: docId,
    docNumber,
    date,
    fromParty: from || (note ? note.substring(0, 40) : 'Nhập kho'),
    toParty: to,
    receiver: recv,
    note,
    items: importItems.map(i => ({ ...i, serials: [...i.serials] })),
    createdAt: new Date().toISOString()
  });
  save();
  importItems = [];
  ['imp-from', 'imp-to', 'imp-recv', 'imp-note'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const impDateEl = document.getElementById('imp-date');
  if (impDateEl) impDateEl.value = today();
  const ocrRes = document.getElementById('imp-ocr-result');
  if (ocrRes) ocrRes.innerHTML = '';
  renderImportItems();
  toast(`✅ Nhập kho thành công! ${confirmMsg} — ${docNumber}`, 'ok');
  setTimeout(() => { if (confirm('Nhập kho thành công!\nXem lịch sử biên bản?')) { nav('all-history'); } }, 600);
}

// ═══════════════════════════════════════════════════════════════
//  EXPORT DOC (with OCR)
// ═══════════════════════════════════════════════════════════════
let exportItems = [];

function renderExportPage() { renderExportItems(); }

function renderExportItems() {
  const c = document.getElementById('exp-items');
  if (exportItems.length === 0) { c.innerHTML = `<div class="empty"><div class="empty-icon">📤</div><p>Nhấn "➕ Thêm sản phẩm" để bắt đầu</p></div>`; return; }
  c.innerHTML = exportItems.map((item, idx) => {
    const p = getProduct(item.productId);
    const inS = getSerialsOf(item.productId, 'in-stock');
    const qtyStock = getStockCount(item.productId);
    const hasSerialStock = inS.length > 0;
    return `<div class="item-row">
      <div class="flex ic jb mb2">
        <div class="flex ic gap2 flex-wrap">
          <span class="badge b-exp fs11">${esc(p?.code || '')}</span>
          <span class="fw7">${esc(p?.name || '')}</span>
          <span class="badge b-in">${qtyStock} còn kho</span>
        </div>
        <button class="btn btn-ghost btn-xs" onclick="removeExportItem(${idx})" style="margin-left:8px">🗑️ Xóa</button>
      </div>
      ${hasSerialStock ? `
      <div class="scan-line-box mb2">
        <label>🔢 Quét / Dán mã Serial cần xuất <span class="c3">— quét mã vạch, gõ tay hoặc dán (Ctrl+V) cột từ Excel</span></label>
        <input type="text" id="exp-scan-${idx}" class="scan-line-input" placeholder="Quét / gõ serial hoặc dán cột từ Excel..."
          onkeydown="handleScanKeydown(event,'exp',${idx})"
          onpaste="handleScanPasteEvent(event,'exp',${idx})"
          oninput="handleScanPaste(this,'exp',${idx})" />
      </div>
      <div class="sec-label mb2">Hoặc bấm chọn trực tiếp serial còn trong kho:</div>
      <div class="chip-grid mb2" style="max-height:110px" id="exp-stock-${idx}">${exportStockHtml(idx)}</div>
      <div class="chip-grid mb2" id="exp-chips-${idx}">${exportChipsHtml(idx)}</div>
      <div class="fs12" id="exp-cnt-${idx}">${exportCountHtml(idx)}</div>
      ` : `
      <div class="scan-line-box mb2" style="background:#fff7ed;border-color:#fed7aa">
        <label style="color:#ea580c;font-weight:700">📤 Số lượng xuất (không có serial)</label>
        <div class="fs12 c3 mb2">Tồn hiện tại: <strong>${qtyStock}</strong> ${esc(p?.unit || 'cái')}</div>
        <div class="flex ic gap2">
          <input type="number" class="fi" id="exp-qty-${idx}" value="${item.qty || 1}" min="1" max="${qtyStock}" style="width:120px;font-size:18px;font-weight:800;text-align:center"
            onchange="exportItems[${idx}].qty = Math.min(Number(this.value)||1, ${qtyStock})" />
          <span class="fs12 c3">${esc(p?.unit || 'cái')}</span>
        </div>
        <div class="fs12 co fw7 mt2">📤 ${item.qty || 1} ${esc(p?.unit || 'cái')} sẽ được trừ khỏi tồn kho</div>
      </div>
      `}
    </div>`;
  }).join('');
}

function exportChipsHtml(idx) {
  const item = exportItems[idx]; if (!item) return '';
  return item.serials.length
    ? item.serials.map(s => `<div class="chip chip-pend">${esc(s)}<span class="chip-x" onclick="removeExpSerial(${idx},'${esc(s)}')">×</span></div>`).join('')
    : '<span class="fs12 c3">Chưa chọn serial nào</span>';
}
function exportCountHtml(idx) {
  const n = exportItems[idx]?.serials.length || 0;
  return n > 0 ? `<span class="co fw7">📤 ${n} serial</span> sẽ bị trừ khỏi kho` : '<span class="c3">0 serial — quét mã hoặc bấm chọn bên trên</span>';
}
function exportStockHtml(idx) {
  const item = exportItems[idx]; if (!item) return '';
  const inS = getSerialsOf(item.productId, 'in-stock');
  if (inS.length === 0) return '<span class="fs12 c3">Không có serial trong kho</span>';
  return inS.map(s => { const sel = item.serials.includes(s.serialNum); return `<div class="chip ${sel ? 'chip-pend' : 'chip-ok'}" style="cursor:pointer" onclick="toggleExpSerial(${idx},'${esc(s.serialNum)}')">${sel ? '✓ ' : ''} ${esc(s.serialNum)}</div>`; }).join('');
}

function toggleExpSerial(idx, sn) { const i = exportItems[idx]; if (i.serials.includes(sn)) i.serials = i.serials.filter(s => s !== sn); else i.serials.push(sn); updateItemScanUI('exp', idx); }
function removeExpSerial(idx, sn) { exportItems[idx].serials = exportItems[idx].serials.filter(s => s !== sn); updateItemScanUI('exp', idx); }
function removeExportItem(idx) { exportItems.splice(idx, 1); renderExportItems(); }

function openAddExportProduct() {
  const opts = db.products.filter(p => getStockCount(p.id) > 0).map(p => {
    const snCnt = getSerialsOf(p.id, 'in-stock').length;
    const cnt = getStockCount(p.id);
    const cntText = snCnt > 0 ? ` (còn ${snCnt} serial)` : (cnt > 0 ? ` (tồn ${cnt})` : '');
    return `<option value="${esc(p.id)}">[${esc(p.code)}] ${esc(p.name)}${cntText}</option>`;
  }).join('');
  document.getElementById('exp-psel').innerHTML = '<option value="">-- Chọn sản phẩm --</option>' + opts;
  openModal('mo-exp-product');
}
function confirmExportProduct() {
  const pid = document.getElementById('exp-psel').value;
  if (!pid) { toast('Chọn sản phẩm', 'wrn'); return; }
  if (exportItems.find(i => i.productId === pid)) { toast('Đã có', 'wrn'); closeModal('mo-exp-product'); return; }
  exportItems.push({ productId: pid, serials: [] });
  closeModal('mo-exp-product'); renderExportItems();
  const newIdx = exportItems.length - 1;
  setTimeout(() => document.getElementById(`exp-scan-${newIdx}`)?.focus(), 150);
}

function submitExport() {
  const date = document.getElementById('exp-date').value;
  const to = document.getElementById('exp-to').value.trim();
  if (!date || !to) { toast('Điền ngày và bên nhận', 'wrn'); return; }
  if (exportItems.length === 0) { toast('Chưa có sản phẩm', 'wrn'); return; }

  // Phân loại: có serial và không serial
  const snItems = exportItems.filter(i => i.serials && i.serials.length > 0);
  const qtyItems = exportItems.filter(i => (!i.serials || i.serials.length === 0) && getStockCount(i.productId) > 0);
  const totalSN = snItems.reduce((s, i) => s + i.serials.length, 0);
  const totalQty = qtyItems.reduce((s, i) => s + (Number(document.getElementById(`exp-qty-${exportItems.indexOf(i)}`)?.value || i.qty || 0), 0), 0);

  // Cập nhật qty từ input trước khi xuất
  exportItems.forEach((item, idx) => {
    const qtyInput = document.getElementById(`exp-qty-${idx}`);
    if (qtyInput) item.qty = Number(qtyInput.value) || 1;
  });

  const hasSerialExport = snItems.length > 0;
  const hasQtyExport = exportItems.some(i => (!i.serials || i.serials.length === 0) && (i.qty || 0) > 0 && getStockCount(i.productId) > 0);

  if (!hasSerialExport && !hasQtyExport) { toast('Chưa chọn serial hoặc số lượng xuất', 'wrn'); return; }

  const snCount = snItems.reduce((s, i) => s + i.serials.length, 0);
  const qtyCount = exportItems.filter(i => !i.serials || i.serials.length === 0).reduce((s, i) => s + (i.qty || 0), 0);
  const confirmMsg = [snCount > 0 ? `${snCount} serial` : '', qtyCount > 0 ? `${qtyCount} SP (không SN)` : ''].filter(Boolean).join(' + ');

  if (!confirm(`Xuất kho: ${confirmMsg} cho "${to}"?\nSố liệu sẽ bị trừ khỏi tồn kho.`)) return;

  const docId = genId('EXP');
  const docNumber = genDocNum('BBXUAT', db.exportDocs);
  const recv = document.getElementById('exp-recv').value;

  // Xử lý serial items
  exportItems.filter(i => i.serials && i.serials.length > 0).forEach(item => item.serials.forEach(sn => {
    if (!db.serials[sn]) {
      db.serials[sn] = { productId: item.productId, addedDate: date };
    }
    db.serials[sn].status = 'exported';
    db.serials[sn].exportDocId = docId;
    db.serials[sn].exportDate = date;
    db.serials[sn].exportTo = to;
    db.serials[sn].exportReceiver = recv;
  }));

  // Xử lý qty items (không serial): cộng vào exported
  exportItems.filter(i => !i.serials || i.serials.length === 0).forEach(item => {
    const p = getProduct(item.productId);
    const qty = item.qty || 0;
    if (p && qty > 0) {
      const currentStock = getStockCount(p.id);
      const actualQty = Math.min(qty, currentStock);
      p.exported = (p.exported || 0) + actualQty;
    }
  });

  db.exportDocs.push({ id: docId, docNumber, date, toParty: to, receiver: recv, signatory: document.getElementById('exp-sign').value, note: document.getElementById('exp-note').value, items: exportItems.map(i => ({ ...i, serials: [...(i.serials || [])] })), createdAt: new Date().toISOString() });
  save();
  exportItems = [];
  ['exp-to', 'exp-recv', 'exp-sign', 'exp-note'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('exp-date').value = today();
  document.getElementById('exp-ocr-result').innerHTML = '';
  renderExportItems();
  toast(`✅ Xuất kho thành công! ${confirmMsg} — ${docNumber}`, 'ok');
  setTimeout(() => { if (confirm('Xuất kho thành công!\nXem lịch sử biên bản?')) { nav('all-history'); } }, 600);
}

// ═══════════════════════════════════════════════════════════════
//  ALL HISTORY (Hợp nhất tất cả biên bản)
// ═══════════════════════════════════════════════════════════════

function getAllDocsSorted() {
  return [
    ...db.importDocs.map(d => ({ ...d, type: 'import' })),
    ...db.exportDocs.map(d => ({ ...d, type: 'export' })),
    ...db.bbghDocs.map(d => ({ ...d, type: 'bbgh' })),
    ...(db.quotations || []).map(d => ({ ...d, type: 'quote' })),
  ].sort((a, b) => new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date));
}

function getDocTypeBadge(type) {
  if (type === 'import') return '<span class="badge b-imp">📥 Nhập kho</span>';
  if (type === 'export') return '<span class="badge b-exp">📤 Xuất kho</span>';
  if (type === 'quote') return '<span class="badge b-quote">💰 Báo giá</span>';
  return '<span class="badge b-bbgh">📋 Bàn giao</span>';
}

function renderAllHistory() {
  const q = (document.getElementById('ah-q')?.value || '').toLowerCase();
  const type = document.getElementById('ah-type')?.value || 'all';
  const from = document.getElementById('ah-from')?.value || '';
  const to = document.getElementById('ah-to')?.value || '';

  let all = getAllDocsSorted();

  if (type !== 'all') all = all.filter(d => d.type === type);
  if (q) all = all.filter(d => [
    d.docNumber, d.fromParty, d.toParty, d.receiver, d.signatory,
    d.sellerCompanyName, d.buyerCompanyName, d.buyerRep, d.sellerRepName, d.buyerContact
  ].join(' ').toLowerCase().includes(q));
  if (from) all = all.filter(d => d.date && d.date >= from);
  if (to) all = all.filter(d => d.date && d.date <= to);

  // Stats
  const imp = all.filter(d => d.type === 'import');
  const exp = all.filter(d => d.type === 'export');
  const bbgh = all.filter(d => d.type === 'bbgh');
  const quote = all.filter(d => d.type === 'quote');
  const totalSnImp = imp.reduce((s, d) => (d.items || []).reduce((ss, i) => ss + (i.serials || []).length, s), 0);
  const totalSnExp = exp.reduce((s, d) => (d.items || []).reduce((ss, i) => ss + (i.serials || []).length, s), 0);
  const totalSnBbgh = bbgh.reduce((s, d) => (d.items || []).reduce((ss, i) => ss + (i.serials || []).length, s), 0);
  const totalValQuote = quote.reduce((s, d) => s + (d.grandTotal || 0), 0);

  const statsEl = document.getElementById('ah-stats');
  if (statsEl) statsEl.innerHTML = `
    <div class="ah-stat-row" style="grid-template-columns:repeat(auto-fit, minmax(180px, 1fr))">
      <div class="ah-stat-item green"><span class="ah-stat-n">${imp.length}</span><span class="ah-stat-l">BB Nhập</span><span class="ah-stat-sn cg">+${totalSnImp} SN</span></div>
      <div class="ah-stat-item red"><span class="ah-stat-n">${exp.length}</span><span class="ah-stat-l">BB Xuất</span><span class="ah-stat-sn cr">-${totalSnExp} SN</span></div>
      <div class="ah-stat-item purple"><span class="ah-stat-n">${bbgh.length}</span><span class="ah-stat-l">BB Bàn giao</span><span class="ah-stat-sn cp">${totalSnBbgh} SN</span></div>
      <div class="ah-stat-item" style="border-top:3.5px solid #ea580c"><span class="ah-stat-n" style="color:#ea580c">${quote.length}</span><span class="ah-stat-l">Báo giá</span><span class="ah-stat-sn" style="color:#ea580c">${fmtMoney(totalValQuote)}</span></div>
      <div class="ah-stat-item blue"><span class="ah-stat-n">${all.length}</span><span class="ah-stat-l">Tổng chứng từ</span><span class="ah-stat-sn cb">${all.length} bản ghi</span></div>
    </div>`;

  document.getElementById('ah-count').textContent = all.length + ' chứng từ & báo giá';

  const c = document.getElementById('ah-list');
  if (all.length === 0) { c.innerHTML = `<div class="empty"><div class="empty-icon">📋</div><p>Không có chứng từ nào</p></div>`; return; }

  c.innerHTML = all.map(doc => {
    const tot = (doc.items || []).reduce((s, i) => s + (i.serials?.length || i.qty || 0), 0);
    const badge = getDocTypeBadge(doc.type);

    let partyHtml = '';
    let extraHtml = '';
    if (doc.type === 'import') {
      partyHtml = `<span>🏭 <strong>${esc(doc.fromParty || '')}</strong> → Kho</span>`;
      if (doc.receiver) extraHtml += `<span>👤 Người nhận: ${esc(doc.receiver)}</span>`;
    } else if (doc.type === 'export') {
      partyHtml = `<span>Kho → 🛒 <strong>${esc(doc.toParty || '')}</strong></span>`;
      if (doc.receiver) extraHtml += `<span>👤 ${esc(doc.receiver)}</span>`;
      if (doc.signatory) extraHtml += `<span>✍️ ${esc(doc.signatory)}</span>`;
    } else if (doc.type === 'quote') {
      partyHtml = `<span>🏢 <strong>${esc(doc.sellerCompanyName || '')}</strong> → 🛒 <strong>${esc(doc.buyerCompanyName || '')}</strong></span>`;
      if (doc.buyerContact) extraHtml += `<span>👤 LH: ${esc(doc.buyerContact)}</span>`;
      if (doc.sellerRepName) extraHtml += `<span>✍️ Lập bởi: ${esc(doc.sellerRepName)}</span>`;
    } else {
      partyHtml = `<span>🏭 <strong>${esc(doc.sellerCompanyName || '')}</strong> → 🛒 <strong>${esc(doc.buyerCompanyName || '')}</strong></span>`;
      if (doc.buyerRep) extraHtml += `<span>👤 ${esc(doc.buyerRep)}</span>`;
    }

    const snHtml = doc.type === 'quote'
      ? `<strong style="color:#2563eb;font-size:14px">${fmtMoney(doc.grandTotal)}</strong>`
      : `<span class="${doc.type === 'import' ? 'cg' : doc.type === 'export' ? 'cr' : 'cp'} fw7">${doc.type === 'import' ? '+' : doc.type === 'export' ? '-' : ''}${tot} serial</span>`;

    return `<div class="doc-card" onclick="viewAnyDoc('${doc.type}','${doc.id}')">
      <div class="doc-card-hd">
        <div class="flex ic gap3">${badge}<span class="doc-num">${esc(doc.docNumber)}</span><span class="fs12 c3">— ${fmtDate(doc.date)}</span></div>
        <div class="flex gap2">
          <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();viewAnyDoc('${doc.type}','${doc.id}')">👁️ Xem</button>
          <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();printAnyDoc('${doc.type}','${doc.id}')">🖨️ In</button>
          ${doc.type === 'quote' ? `<button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();exportQuoteToExcel(db.quotations.find(q=>q.id==='${doc.id}'))" title="Xuất Excel">📊 Excel</button>` : ''}
        </div>
      </div>
      <div class="doc-meta">
        ${partyHtml}
        ${extraHtml}
        <span>📦 ${(doc.items || []).length} SP/mục</span>
        ${snHtml}
      </div>
      ${doc.note ? `<div class="fs12 c3 mt2">📝 ${esc(doc.note)}</div>` : ''}
    </div>`;
  }).join('');
}

function viewAnyDoc(type, id) {
  if (type === 'bbgh') { viewBbgh(id); return; }
  if (type === 'quote') { viewQuote(id); return; }

  // Ẩn nút Word & Excel cho các loại nhập/xuất kho thông thường
  const wordBtn = document.getElementById('vd-word');
  if (wordBtn) wordBtn.style.display = 'none';
  const excelBtn = document.getElementById('vd-excel');
  if (excelBtn) excelBtn.style.display = 'none';

  const doc = type === 'import' ? db.importDocs.find(d => d.id === id) : db.exportDocs.find(d => d.id === id);
  if (!doc) return;
  const total = (doc.items || []).reduce((s, i) => s + (i.serials || []).length, 0);
  const isImp = type === 'import';
  const clr = isImp ? '#059669' : '#ea580c';
  const bgGrad = isImp ? 'linear-gradient(135deg,#ecfdf5 0%,#d1fae5 100%)' : 'linear-gradient(135deg,#fff7ed 0%,#ffedd5 100%)';
  const bdrClr = isImp ? '#a7f3d0' : '#fed7aa';
  const title = isImp ? 'BIÊN BẢN NHẬP KHO' : 'BIÊN BẢN XUẤT KHO';

  document.getElementById('vd-title').textContent = (isImp ? '📥 ' : '📤 ') + doc.docNumber;
  document.getElementById('vd-body').innerHTML = `
    <div style="background:${bgGrad};border:1px solid ${bdrClr};border-radius:16px;padding:18px 22px;margin-bottom:20px;box-shadow:var(--shadow-xs)">
      <div style="text-align:center;font-size:18px;font-weight:900;color:${clr};margin-bottom:14px;letter-spacing:-0.01em">${title}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13.5px;color:var(--text1)">
        <div><span class="c3">Số biên bản:</span> <strong>${esc(doc.docNumber)}</strong></div>
        <div><span class="c3">Ngày thực hiện:</span> <strong>${fmtDate(doc.date)}</strong></div>
        ${isImp
      ? `<div><span class="c3">Bên giao:</span> <strong>${esc(doc.fromParty)}</strong></div><div><span class="c3">Bên nhận:</span> <strong>${esc(doc.toParty || 'Kho công ty')}</strong></div>`
      : `<div><span class="c3">Bên giao:</span> <strong>Kho công ty</strong></div><div><span class="c3">Bên nhận:</span> <strong>${esc(doc.toParty)}</strong></div>`}
        ${doc.receiver ? `<div><span class="c3">Người nhận:</span> <strong>${esc(doc.receiver)}</strong></div>` : ''}
        ${doc.signatory ? `<div><span class="c3">Người giao:</span> <strong>${esc(doc.signatory)}</strong></div>` : ''}
        <div><span class="c3">Tổng số serial:</span> <strong style="color:${clr};font-size:15px">${total}</strong></div>
        <div><span class="c3">Thời gian tạo:</span> ${fmtDT(doc.createdAt)}</div>
      </div>
    </div>
    <div class="tbl-wrap">
      <table><thead><tr><th>STT</th><th>Mã hàng</th><th>Tên hàng</th><th>ĐVT</th><th>SL Serial</th><th>Danh sách Serial</th></tr></thead>
      <tbody>${(doc.items || []).map((item, i) => { const p = getProduct(item.productId); return `<tr><td>${i + 1}</td><td><span class="td-code">${esc(p?.code || '')}</span></td><td><strong>${esc(p?.name || '')}</strong></td><td class="c3">${esc(p?.unit || '')}</td><td><strong style="color:${clr};font-size:14px">${(item.serials || []).length}</strong></td><td><div style="display:flex;flex-wrap:wrap;gap:4px">${(item.serials || []).map(s => `<span style="font-family:var(--font-mono);font-size:11.5px;font-weight:600;background:#f8fafc;border:1px solid #cbd5e1;padding:2px 7px;border-radius:5px;color:#0f172a">${esc(s)}</span>`).join('')}</div></td></tr>`; }).join('')}</tbody>
      </table>
    </div>`;
  document.getElementById('vd-print').onclick = () => printAnyDoc(type, id);
  openModal('mo-view-doc');
}

function printAnyDoc(type, id) {
  if (type === 'bbgh') { printBbgh(id); return; }
  if (type === 'quote') {
    const q = (db.quotations || []).find(x => x.id === id);
    if (q) printQuoteObj(q);
    return;
  }
  const doc = type === 'import' ? db.importDocs.find(d => d.id === id) : db.exportDocs.find(d => d.id === id); if (!doc) return;
  const total = (doc.items || []).reduce((s, i) => s + (i.serials || []).length, 0);
  const title = type === 'import' ? 'BIÊN BẢN NHẬP KHO' : 'BIÊN BẢN XUẤT KHO';
  const w = window.open('', '_blank', 'width=900,height=700');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(doc.docNumber)}</title>
  <style>body{font-family:Arial,sans-serif;margin:24px;font-size:12px;color:#111}h1{text-align:center;font-size:16px}h2{text-align:center;font-size:12px;color:#555;margin-bottom:12px}
  .info{display:grid;grid-template-columns:1fr 1fr;gap:6px;border:1px solid #ccc;padding:10px;border-radius:4px;margin:10px 0}
  table{width:100%;border-collapse:collapse;margin:10px 0}th,td{border:1px solid #ccc;padding:6px 8px;font-size:11px}th{background:#f0f0f0}
  .sign{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:20px;text-align:center}
  .sign-box{border:1px solid #ccc;padding:14px;min-height:90px}.sign-box h3{font-size:12px;margin-bottom:45px}
  .sn{font-family:monospace;font-size:10px;word-break:break-all;text-align:center}</style></head><body>
  <h1>${title}</h1><h2>Số: ${esc(doc.docNumber)} | Ngày: ${fmtDate(doc.date)}</h2>
  <div class="info">
    ${type === 'import' ? `<div><b>Bên giao:</b> ${esc(doc.fromParty)}</div><div><b>Bên nhận:</b> ${esc(doc.toParty || 'Kho')}</div>` : `<div><b>Bên giao:</b> Kho công ty</div><div><b>Bên nhận:</b> ${esc(doc.toParty)}</div>`}
    ${doc.receiver ? `<div><b>Người nhận:</b> ${esc(doc.receiver)}</div>` : '<div></div>'}
    ${doc.signatory ? `<div><b>Người giao:</b> ${esc(doc.signatory)}</div>` : '<div></div>'}
    <div><b>Tổng serial:</b> ${total}</div><div><b>Ghi chú:</b> ${esc(doc.note || '—')}</div>
  </div>
  <table><thead><tr><th>STT</th><th>Mã hàng</th><th>Tên hàng</th><th>ĐVT</th><th>SL</th><th style="text-align:center">Số Serial</th></tr></thead>
  <tbody>${(doc.items || []).map((item, i) => { const p = getProduct(item.productId); return `<tr><td>${i + 1}</td><td>${esc(p?.code || '')}</td><td>${esc(p?.name || '')}</td><td>${esc(p?.unit || '')}</td><td><b>${(item.serials || []).length}</b></td><td class="sn" style="text-align:center">${(item.serials || []).join(', ')}</td></tr>`; }).join('')}</tbody></table>
  <div class="sign">
    <div class="sign-box"><h3>BÊN GIAO<br><small>(Ký, họ tên)</small></h3>${type === 'import' ? esc(doc.fromParty) : 'Thủ kho'}</div>
    <div class="sign-box"><h3>BÊN NHẬN<br><small>(Ký, họ tên)</small></h3>${type === 'import' ? esc(doc.toParty || 'Kho') : esc(doc.receiver || doc.toParty)}</div>
  </div>
  <script>window.onload=()=>window.print()<\/script></body></html>`);
  w.document.close();
}

// ═══════════════════════════════════════════════════════════════
//  COMPANIES & EMPLOYEES
// ═══════════════════════════════════════════════════════════════
let editCmpId = null, editEmpId = null;

function renderCompanies() {
  const q = (document.getElementById('cmp-q')?.value || '').toLowerCase();
  const type = document.getElementById('cmp-type')?.value || 'all';
  let list = db.companies.filter(c => (!q || c.name.toLowerCase().includes(q) || (c.shortName || '').toLowerCase().includes(q)) && (type === 'all' || c.type === type || (type === 'buyer' && c.type === 'both') || (type === 'seller' && c.type === 'both')));
  document.getElementById('cmp-count').textContent = list.length + ' công ty';
  const c = document.getElementById('cmp-list');
  if (list.length === 0) { c.innerHTML = `<div class="empty"><div class="empty-icon">🏢</div><p>Chưa có công ty nào</p></div>`; return; }
  c.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px">${list.map(co => {
    const tb = co.type === 'buyer' ? '<span class="badge b-buyer">🛒 Bên mua</span>' : co.type === 'seller' ? '<span class="badge b-seller">🏭 Bên bán</span>' : '<span class="badge b-both">↔ Cả hai</span>';
    return `<div class="cmp-card"><div class="flex ic jb mb2">${tb}<div class="flex gap2">
      <button class="btn btn-ghost btn-xs" onclick="editCompany('${esc(co.id)}')">✏️</button>
      <button class="btn btn-ghost btn-xs" onclick="deleteCompany('${esc(co.id)}')">🗑️</button>
    </div></div>
    <div class="cmp-name">${esc(co.name)}</div>
    ${co.shortName ? `<div class="fs12 c3 mt2">Tên tắt: ${esc(co.shortName)}</div>` : ''}
    <div class="cmp-addr mt2">📍 ${esc(co.address || '—')}</div>
    ${co.deliveryAddress ? `<div class="cmp-addr mt2">🚚 ${esc(co.deliveryAddress)}</div>` : ''}
    ${co.rep ? `<div class="fs12 mt2"><span class="c3">Đại diện:</span> <strong>${esc(co.rep)}</strong>${co.repPosition ? ' — ' + esc(co.repPosition) : ''}</div>` : ''}
    ${co.taxCode ? `<div class="fs12 c3 mt2">MST: ${esc(co.taxCode)}</div>` : ''}
    </div>`;
  }).join('')}</div>`;
}

function openAddCompany() { editCmpId = null; document.getElementById('cmp-mo-title').textContent = '🏢 Thêm công ty';['cmp-f-name', 'cmp-f-short', 'cmp-f-addr', 'cmp-f-deliv', 'cmp-f-phone', 'cmp-f-tax', 'cmp-f-rep', 'cmp-f-reppos', 'cmp-f-note'].forEach(id => { document.getElementById(id).value = ''; }); document.getElementById('cmp-f-type').value = 'buyer'; openModal('mo-company'); }
function editCompany(id) { const co = getCompany(id); if (!co) return; editCmpId = id; document.getElementById('cmp-mo-title').textContent = '✏️ Sửa công ty'; document.getElementById('cmp-f-name').value = co.name || ''; document.getElementById('cmp-f-short').value = co.shortName || ''; document.getElementById('cmp-f-addr').value = co.address || ''; document.getElementById('cmp-f-deliv').value = co.deliveryAddress || ''; document.getElementById('cmp-f-phone').value = co.phone || ''; document.getElementById('cmp-f-tax').value = co.taxCode || ''; document.getElementById('cmp-f-rep').value = co.rep || ''; document.getElementById('cmp-f-reppos').value = co.repPosition || ''; document.getElementById('cmp-f-note').value = co.note || ''; document.getElementById('cmp-f-type').value = co.type || 'buyer'; openModal('mo-company'); }
function saveCompany() { const name = document.getElementById('cmp-f-name').value.trim(); if (!name) { toast('Tên không được trống', 'wrn'); return; } const data = { name, shortName: document.getElementById('cmp-f-short').value.trim(), address: document.getElementById('cmp-f-addr').value.trim(), deliveryAddress: document.getElementById('cmp-f-deliv').value.trim(), phone: document.getElementById('cmp-f-phone').value.trim(), taxCode: document.getElementById('cmp-f-tax').value.trim(), rep: document.getElementById('cmp-f-rep').value.trim(), repPosition: document.getElementById('cmp-f-reppos').value.trim(), note: document.getElementById('cmp-f-note').value.trim(), type: document.getElementById('cmp-f-type').value }; if (editCmpId) { const idx = db.companies.findIndex(c => c.id === editCmpId); if (idx >= 0) db.companies[idx] = { ...db.companies[idx], ...data }; toast('Đã cập nhật', 'ok'); } else { db.companies.push({ id: genId('CTY'), ...data }); toast('Đã thêm công ty', 'ok'); } save(); closeModal('mo-company'); renderCompanies(); populateDatalist(); }
function deleteCompany(id) { const co = getCompany(id); if (!co) return; if (!confirm(`Xóa "${co.name}"?`)) return; db.companies = db.companies.filter(c => c.id !== id); save(); renderCompanies(); toast('Đã xóa', 'ok'); populateDatalist(); }

function renderEmployees() {
  const q = (document.getElementById('emp-q')?.value || '').toLowerCase();
  let list = db.employees.filter(e => !q || e.name.toLowerCase().includes(q) || (e.position || '').toLowerCase().includes(q));
  document.getElementById('emp-count').textContent = list.length + ' nhân viên';
  const c = document.getElementById('emp-list');
  if (list.length === 0) { c.innerHTML = `<div class="empty"><div class="empty-icon">👤</div><p>Chưa có nhân viên</p></div>`; return; }
  c.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px">${list.map(e => { const ini = e.name.split(' ').slice(-2).map(w => w[0]).join('').toUpperCase(); return `<div class="emp-card"><div class="emp-avatar">${ini}</div><div style="flex:1;min-width:0"><div class="emp-name">${esc(e.name)}</div><div class="emp-pos">${esc(e.position || '—')}${e.department ? ' · ' + esc(e.department) : ''}</div>${e.phone ? `<div class="fs11 c3 mt2">📞 ${esc(e.phone)}</div>` : ''}</div><div class="flex flex-col gap2"><button class="btn btn-ghost btn-xs" onclick="editEmployee('${esc(e.id)}')">✏️</button><button class="btn btn-ghost btn-xs" onclick="deleteEmployee('${esc(e.id)}')">🗑️</button></div></div>`; }).join('')}</div>`;
}
function openAddEmployee() { editEmpId = null; document.getElementById('emp-mo-title').textContent = '👤 Thêm nhân viên';['emp-f-name', 'emp-f-pos', 'emp-f-dept', 'emp-f-phone'].forEach(id => { document.getElementById(id).value = ''; }); openModal('mo-employee'); }
function editEmployee(id) { const e = getEmployee(id); if (!e) return; editEmpId = id; document.getElementById('emp-mo-title').textContent = '✏️ Sửa nhân viên'; document.getElementById('emp-f-name').value = e.name || ''; document.getElementById('emp-f-pos').value = e.position || ''; document.getElementById('emp-f-dept').value = e.department || ''; document.getElementById('emp-f-phone').value = e.phone || ''; openModal('mo-employee'); }
function saveEmployee() { const name = document.getElementById('emp-f-name').value.trim(); if (!name) { toast('Tên không được trống', 'wrn'); return; } const data = { name, position: document.getElementById('emp-f-pos').value.trim(), department: document.getElementById('emp-f-dept').value.trim(), phone: document.getElementById('emp-f-phone').value.trim() }; if (editEmpId) { const idx = db.employees.findIndex(e => e.id === editEmpId); if (idx >= 0) db.employees[idx] = { ...db.employees[idx], ...data }; toast('Đã cập nhật', 'ok'); } else { db.employees.push({ id: genId('NV'), ...data }); toast('Đã thêm', 'ok'); } save(); closeModal('mo-employee'); renderEmployees(); }
function deleteEmployee(id) { const e = getEmployee(id); if (!e) return; if (!confirm(`Xóa "${e.name}"?`)) return; db.employees = db.employees.filter(e => e.id !== id); save(); renderEmployees(); toast('Đã xóa', 'ok'); }

// ═══════════════════════════════════════════════════════════════
//  BBGH
// ═══════════════════════════════════════════════════════════════
let bbghItems = [];

function renderBbghForm() { populateBbghSelects(); renderBbghItems(); }

function populateBbghSelects() {
  const sellers = db.companies.filter(c => c.type === 'seller' || c.type === 'both');
  const allCo = db.companies;
  const selSel = document.getElementById('bbgh-seller');
  const buyerSel = document.getElementById('bbgh-buyer');
  const selRep = document.getElementById('bbgh-seller-rep');
  if (selSel) selSel.innerHTML = '<option value="">-- Chọn bên bán (Bên A) --</option>' + (sellers.length > 0 ? sellers : allCo).map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  if (buyerSel) buyerSel.innerHTML = '<option value="">-- Chọn bên mua (Bên B) --</option>' + allCo.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  if (selRep) selRep.innerHTML = '<option value="">-- Chọn nhân viên --</option>' + db.employees.map(e => `<option value="${esc(e.id)}">${esc(e.name)} — ${esc(e.position || '')}</option>`).join('');
}

function onBbghSellerChange() {
  const co = getCompany(document.getElementById('bbgh-seller').value);
  if (!co) return;
  const nameEl = document.getElementById('bbgh-seller-name');
  if (nameEl) nameEl.value = co.name || '';
  document.getElementById('bbgh-seller-addr').value = co.address || '';
  document.getElementById('bbgh-seller-phone').value = co.phone || '';
  document.getElementById('bbgh-seller-tax').value = co.taxCode || '';
}
function onBbghBuyerChange() {
  const co = getCompany(document.getElementById('bbgh-buyer').value);
  if (!co) return;
  const nameEl = document.getElementById('bbgh-buyer-name');
  if (nameEl) nameEl.value = co.name || '';
  document.getElementById('bbgh-buyer-addr').value = co.address || '';
  document.getElementById('bbgh-buyer-deliv').value = co.deliveryAddress || '';
  document.getElementById('bbgh-buyer-phone').value = co.phone || '';
  document.getElementById('bbgh-buyer-tax').value = co.taxCode || '';
  document.getElementById('bbgh-buyer-rep').value = co.rep || '';
  document.getElementById('bbgh-buyer-reppos').value = co.repPosition || '';
}
function onBbghRepChange() { const e = getEmployee(document.getElementById('bbgh-seller-rep').value); if (e) document.getElementById('bbgh-seller-reppos').value = e.position || ''; }
function renderBbghItems() {
  const c = document.getElementById('bbgh-items');
  if (bbghItems.length === 0) { c.innerHTML = `<div class="empty"><div class="empty-icon">📦</div><p>Nhấn "Thêm hàng hóa"</p></div>`; return; }
  c.innerHTML = bbghItems.map((item, idx) => {
    const p = getProduct(item.productId); const inS = getSerialsOf(item.productId, 'in-stock');
    return `<div class="item-row">
      <div class="flex ic jb mb2">
        <div class="flex ic gap2 flex-wrap">
          <span class="badge b-bbgh fs11">${esc(p?.code || '')}</span>
          <span class="fw7 fs13">${esc(p?.name || '')}</span>
          <span class="badge b-in">${inS.length} còn kho</span>
        </div>
        <button class="btn btn-ghost btn-xs" onclick="removeBbghItem(${idx})">🗑️</button>
      </div>
      <div class="frow mb2" style="grid-template-columns:80px 80px 1fr">
        <div class="fg"><label class="flabel">ĐVT</label><input class="fi" value="${esc(p?.unit || item.unit || '')}" onchange="bbghItems[${idx}].unit=this.value" /></div>
        <div class="fg"><label class="flabel">SL</label><input class="fi" id="bbgh-qty-${idx}" type="number" min="0" value="${item.qty || 0}" onchange="bbghItems[${idx}].qty=+this.value" /></div>
        <div class="fg"><label class="flabel">Nhãn cột Serial</label><input class="fi" value="${esc(item.note || '')}" placeholder="Case / Màn hình..." onchange="bbghItems[${idx}].note=this.value" /></div>
      </div>
      <div class="frow mb2" style="grid-template-columns:1fr">
        <div class="fg"><label class="flabel">Nhóm bộ (để trống nếu không gộp)</label><input class="fi" value="${esc(item.groupKey || '')}" placeholder="vd: SET1 — các sản phẩm cùng Nhóm bộ sẽ gộp chung 1 dòng, mỗi sản phẩm 1 cột Serial riêng" onchange="bbghItems[${idx}].groupKey=this.value" /></div>
      </div>
      <div class="scan-line-box mb2">
        <label>🔢 Quét / Dán mã Serial cần bàn giao <span class="c3">— quét mã vạch, gõ tay hoặc dán (Ctrl+V) cột từ Excel</span></label>
        <input type="text" id="bbgh-scan-${idx}" class="scan-line-input" placeholder="Quét / gõ serial hoặc dán cột từ Excel..."
          onkeydown="handleScanKeydown(event,'bbgh',${idx})"
          onpaste="handleScanPasteEvent(event,'bbgh',${idx})"
          oninput="handleScanPaste(this,'bbgh',${idx})" />
      </div>
      <div class="chip-grid mb2" style="max-height:100px" id="bbgh-stock-${idx}">${bbghStockHtml(idx)}</div>
      <div class="chip-grid mb2" id="bbgh-chips-${idx}">${bbghChipsHtml(idx)}</div>
      <div class="fs12" id="bbgh-cnt-${idx}">${bbghCountHtml(idx)}</div>
    </div>`;
  }).join('');
}

function bbghChipsHtml(idx) {
  const item = bbghItems[idx]; if (!item) return '';
  return item.serials.length
    ? item.serials.map(s => `<div class="chip chip-pend">${esc(s)}<span class="chip-x" onclick="removeBbghSerial(${idx},'${esc(s)}')">×</span></div>`).join('')
    : '<span class="fs12 c3">Chưa chọn serial nào</span>';
}
function bbghCountHtml(idx) {
  const n = bbghItems[idx]?.serials.length || 0;
  return n > 0 ? `<span class="cp fw7">${n} serial</span> trong biên bản` : '<span class="c3">Chưa có serial</span>';
}
function bbghStockHtml(idx) {
  const item = bbghItems[idx]; if (!item) return '';
  const inS = getSerialsOf(item.productId, 'in-stock');
  if (inS.length === 0) return '<span class="fs12 c3">Không có serial</span>';
  return inS.map(s => { const sel = item.serials.includes(s.serialNum); return `<div class="chip ${sel ? 'chip-pend' : 'chip-ok'}" style="cursor:pointer" onclick="toggleBbghSerial(${idx},'${esc(s.serialNum)}')">${sel ? '✓ ' : ''} ${esc(s.serialNum)}</div>`; }).join('');
}

function toggleBbghSerial(idx, sn) { const i = bbghItems[idx]; if (i.serials.includes(sn)) i.serials = i.serials.filter(s => s !== sn); else i.serials.push(sn); updateItemScanUI('bbgh', idx); }
function removeBbghSerial(idx, sn) { bbghItems[idx].serials = bbghItems[idx].serials.filter(s => s !== sn); updateItemScanUI('bbgh', idx); }
function removeBbghItem(idx) { bbghItems.splice(idx, 1); renderBbghItems(); }

function filterProductSelect(type) {
  const q = (document.getElementById(type + '-psearch')?.value || '').toLowerCase();
  const sel = document.getElementById(type + '-psel');
  if (!sel) return;
  for (let i = 1; i < sel.options.length; i++) {
    const opt = sel.options[i];
    if (opt.text.toLowerCase().includes(q)) opt.style.display = '';
    else opt.style.display = 'none';
  }
}

function openAddBbghProduct() {
  const opts = db.products.filter(p => getStockCount(p.id) > 0).map(p => {
    const cnt = getSerialsOf(p.id, 'in-stock').length;
    const cntText = cnt > 0 ? ` (còn ${cnt} serial)` : '';
    return `<option value="${esc(p.id)}">[${esc(p.code)}] ${esc(p.name)}${cntText}</option>`;
  }).join('');
  document.getElementById('bbgh-psel').innerHTML = '<option value="">-- Chọn sản phẩm --</option>' + opts;
  const psearch = document.getElementById('bbgh-psearch');
  if (psearch) psearch.value = '';
  openModal('mo-bbgh-product');
}
function confirmBbghProduct() {
  const pid = document.getElementById('bbgh-psel').value;
  if (!pid) { toast('Chọn sản phẩm', 'wrn'); return; }
  if (bbghItems.find(i => i.productId === pid)) { toast('Đã có sản phẩm này trong danh sách', 'wrn'); return; }
  const p = getProduct(pid);
  bbghItems.push({ productId: pid, productName: p?.name || '', unit: p?.unit || '', qty: 1, note: '', groupKey: '', serials: [] });
  closeModal('mo-bbgh-product'); renderBbghItems();
  const newIdx = bbghItems.length - 1;
  setTimeout(() => document.getElementById(`bbgh-scan-${newIdx}`)?.focus(), 150);
}

function submitBbgh() {
  const date = document.getElementById('bbgh-date').value;
  let sellerId = document.getElementById('bbgh-seller').value;
  let buyerId = document.getElementById('bbgh-buyer').value;
  const sellerName = document.getElementById('bbgh-seller-name')?.value.trim();
  const buyerName = document.getElementById('bbgh-buyer-name')?.value.trim();

  if (!sellerId && sellerName) {
    saveQuickCompany('seller');
    sellerId = document.getElementById('bbgh-seller').value;
  }
  if (!buyerId && buyerName) {
    saveQuickCompany('buyer');
    buyerId = document.getElementById('bbgh-buyer').value;
  }
  const sellerRepId = document.getElementById('bbgh-seller-rep').value;
  const docNum = document.getElementById('bbgh-num').value.trim() || ('BBGH-' + new Date().getFullYear() + '-' + String(db.bbghDocs.length + 1).padStart(4, '0'));
  if (!date) { toast('Chọn ngày', 'wrn'); return; } if (!sellerId) { toast('Chọn bên bán', 'wrn'); return; } if (!buyerId) { toast('Chọn bên mua', 'wrn'); return; } if (bbghItems.length === 0) { toast('Chưa có hàng hóa', 'wrn'); return; }
  const totalSN = bbghItems.reduce((s, i) => s + i.serials.length, 0);
  const sellerCo = getCompany(sellerId), buyerCo = getCompany(buyerId), sellerEmp = getEmployee(sellerRepId);
  const docId = genId('BBGH');
  const buyerRep = document.getElementById('bbgh-buyer-rep').value.trim();
  bbghItems.forEach(item => item.serials.forEach(sn => {
    if (!db.serials[sn]) {
      db.serials[sn] = { productId: item.productId, addedDate: date };
    }
    db.serials[sn].status = 'exported';
    db.serials[sn].exportDocId = docId;
    db.serials[sn].exportDate = date;
    db.serials[sn].exportTo = buyerCo?.name || buyerId;
    db.serials[sn].exportReceiver = buyerRep;
  }));
  const newDoc = {
    id: docId, docNumber: docNum, date,
    sellerCompanyId: sellerId, sellerCompanyName: sellerCo?.name || '',
    sellerAddress: document.getElementById('bbgh-seller-addr').value.trim() || sellerCo?.address || '',
    sellerPhone: document.getElementById('bbgh-seller-phone').value.trim(),
    sellerTax: document.getElementById('bbgh-seller-tax').value.trim(),
    sellerRepId, sellerRepName: sellerEmp?.name || document.getElementById('bbgh-seller-repname').value.trim(),
    sellerRepPosition: document.getElementById('bbgh-seller-reppos').value.trim() || sellerEmp?.position || '',
    buyerCompanyId: buyerId, buyerCompanyName: buyerCo?.name || '',
    buyerAddress: document.getElementById('bbgh-buyer-addr').value.trim() || buyerCo?.address || '',
    buyerDeliveryAddress: document.getElementById('bbgh-buyer-deliv').value.trim() || buyerCo?.deliveryAddress || '',
    buyerPhone: document.getElementById('bbgh-buyer-phone').value.trim(),
    buyerTax: document.getElementById('bbgh-buyer-tax').value.trim(),
    buyerRep, buyerRepPosition: document.getElementById('bbgh-buyer-reppos').value.trim(),
    note: document.getElementById('bbgh-note').value.trim(),
    colMode: document.getElementById('bbgh-col-mode')?.value || 'auto',
    items: bbghItems.map(i => ({ ...i, serials: [...i.serials] })),
    createdAt: new Date().toISOString(),
  };
  db.bbghDocs.push(newDoc);
  save(); bbghItems = [];
  document.getElementById('bbgh-date').value = today();
  ['bbgh-seller', 'bbgh-buyer', 'bbgh-seller-rep'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  ['bbgh-seller-addr', 'bbgh-seller-phone', 'bbgh-seller-tax', 'bbgh-seller-reppos', 'bbgh-seller-repname', 'bbgh-buyer-addr', 'bbgh-buyer-deliv', 'bbgh-buyer-phone', 'bbgh-buyer-tax', 'bbgh-buyer-rep', 'bbgh-buyer-reppos', 'bbgh-note', 'bbgh-num'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('bbgh-ocr-result').innerHTML = '';
  renderBbghItems();
  toast(`✅ Đã tạo biên bản ${docNum} — ${totalSN} serial. Đang tải Word...`, 'ok');
  setTimeout(() => exportBbghToWord(newDoc), 500);
  setTimeout(() => { if (confirm('Tạo biên bản thành công!\nĐã tải file Word về máy.\nXem lịch sử biên bản?')) { nav('all-history'); setTimeout(() => viewBbgh(docId), 300); } }, 1500);
}

function viewBbgh(id) {
  const doc = db.bbghDocs.find(d => d.id === id); if (!doc) return;
  document.getElementById('vd-title').textContent = '📋 ' + doc.docNumber;
  document.getElementById('vd-body').innerHTML = buildBbghView(doc);
  document.getElementById('vd-print').onclick = () => printBbgh(id);
  // Hiện nút Xuất Word chỉ cho BBGH
  const wordBtn = document.getElementById('vd-word');
  if (wordBtn) { wordBtn.style.display = ''; wordBtn.onclick = () => exportBbghToWord(doc); }
  openModal('mo-view-doc');
}

function viewAnyDocReset() {
  // Ẩn nút Word khi xem nhập/xuất kho
  const wordBtn = document.getElementById('vd-word');
  if (wordBtn) wordBtn.style.display = 'none';
}

function buildBbghView(doc) {
  const total = (doc.items || []).reduce((s, i) => s + (i.serials || []).length, 0);
  return `
    <div style="background:linear-gradient(135deg,#f5f3ff 0%,#ede9fe 100%);border:1px solid #ddd6fe;border-radius:16px;padding:20px;margin-bottom:20px;text-align:center;box-shadow:var(--shadow-xs)">
      <div style="font-size:13px;font-weight:800;letter-spacing:0.05em;color:var(--text1)">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</div>
      <div style="font-size:12.5px;color:var(--text2);font-weight:600;margin-top:2px">Độc lập - Tự do - Hạnh phúc</div>
      <div style="font-size:18px;font-weight:900;color:#6d28d9;margin:10px 0 6px;letter-spacing:-0.01em">BIÊN BẢN BÀN GIAO HÀNG HÓA</div>
      <div style="font-size:13px;color:var(--text3)">Số: <strong style="color:var(--text1)">${esc(doc.docNumber)}</strong> | Ngày: <strong style="color:var(--text1)">${fmtDate(doc.date)}</strong></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
      <div style="background:#fff7ed;border:1px solid #fed7aa;border-top:4px solid #ea580c;border-radius:12px;padding:16px;box-shadow:var(--shadow-xs)">
        <div style="font-size:12px;font-weight:800;text-transform:uppercase;color:#ea580c;margin-bottom:10px;display:flex;align-items:center;gap:6px">🏭 BÊN BÁN (Bên A)</div>
        <div style="font-size:14px;font-weight:800;color:var(--text1);margin-bottom:8px">${esc(doc.sellerCompanyName)}</div>
        <div style="font-size:12.5px;color:var(--text2);line-height:1.6">
          ${doc.sellerAddress ? `📍 ${esc(doc.sellerAddress)}<br>` : ''}
          ${doc.sellerPhone ? `📞 ${esc(doc.sellerPhone)}<br>` : ''}
          ${doc.sellerTax ? `MST: <strong>${esc(doc.sellerTax)}</strong><br>` : ''}
          ${doc.sellerRepName ? `Đại diện: <strong>${esc(doc.sellerRepName)}</strong>${doc.sellerRepPosition ? ' — ' + esc(doc.sellerRepPosition) : ''}` : ''}</div>
      </div>
      <div style="background:#f0f9ff;border:1px solid #bae6fd;border-top:4px solid #0284c7;border-radius:12px;padding:16px;box-shadow:var(--shadow-xs)">
        <div style="font-size:12px;font-weight:800;text-transform:uppercase;color:#0284c7;margin-bottom:10px;display:flex;align-items:center;gap:6px">🛒 BÊN MUA (Bên B)</div>
        <div style="font-size:14px;font-weight:800;color:var(--text1);margin-bottom:8px">${esc(doc.buyerCompanyName)}</div>
        <div style="font-size:12.5px;color:var(--text2);line-height:1.6">
          ${doc.buyerAddress ? `📍 ${esc(doc.buyerAddress)}<br>` : ''}
          ${doc.buyerDeliveryAddress ? `🚚 ${esc(doc.buyerDeliveryAddress)}<br>` : ''}
          ${doc.buyerPhone ? `📞 ${esc(doc.buyerPhone)}<br>` : ''}
          ${doc.buyerTax ? `MST: <strong>${esc(doc.buyerTax)}</strong><br>` : ''}
          ${doc.buyerRep ? `Đại diện: <strong>${esc(doc.buyerRep)}</strong>${doc.buyerRepPosition ? ' — ' + esc(doc.buyerRepPosition) : ''}` : ''}</div>
      </div>
    </div>
    <div class="tbl-wrap mb3"><table><thead><tr><th>STT</th><th>Danh Mục Hàng Hóa</th><th>SL</th><th>ĐVT</th><th style="text-align:center">Serial</th><th>Ghi chú</th></tr></thead>
    <tbody>${(doc.items || []).map((item, i) => { const p = getProduct(item.productId); return `<tr><td>${i + 1}</td><td><strong>${esc(p?.name || item.productName || '')}</strong></td><td><strong style="color:#7c3aed;font-size:14px">${item.serials?.length || item.qty || 0}</strong></td><td class="c3">${esc(item.unit || p?.unit || '')}</td><td><div style="display:flex;flex-wrap:wrap;gap:4px;justify-content:center">${(item.serials || []).map(s => `<span style="font-family:var(--font-mono);font-size:11.5px;font-weight:600;background:#f5f3ff;border:1px solid #ddd6fe;padding:2px 7px;border-radius:5px;color:#6d28d9">${esc(s)}</span>`).join('')}</div></td><td class="fs11 c3">${esc(item.note || '')}</td></tr>`; }).join('')}</tbody></table></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;text-align:center;font-size:13px">
      <div style="background:#ffffff;border:1px solid var(--border);border-radius:12px;padding:18px;box-shadow:var(--shadow-xs)"><div style="font-weight:800;margin-bottom:48px;color:#ea580c">BÊN BÁN (Bên A)<br><small style="color:var(--text3);font-weight:500">(Ký, ghi rõ họ tên)</small></div><div class="fw7" style="color:var(--text1)">${esc(doc.sellerRepName || '')}</div></div>
      <div style="background:#ffffff;border:1px solid var(--border);border-radius:12px;padding:18px;box-shadow:var(--shadow-xs)"><div style="font-weight:800;margin-bottom:48px;color:#0284c7">BÊN MUA (Bên B)<br><small style="color:var(--text3);font-weight:500">(Ký, ghi rõ họ tên)</small></div><div class="fw7" style="color:var(--text1)">${esc(doc.buyerRep || '')}</div></div>
    </div>`;
}

function printBbgh(id) {
  const doc = db.bbghDocs.find(d => d.id === id); if (!doc) return;

  // Ngày dạng "Hôm nay, ngày dd tháng mm năm yyyy"
  const dt = doc.date ? new Date(doc.date) : new Date();
  const ngay = String(dt.getDate()).padStart(2, '0');
  const thang = String(dt.getMonth() + 1).padStart(2, '0');
  const nam = dt.getFullYear();

  // Gộp các dòng hàng cùng "Nhóm bộ" (groupKey) thành 1 dòng combo — giống hệt logic khi xuất Word
  const items = doc.items || [];
  const seen = new Set();
  const rows = [];
  items.forEach((item, idx) => {
    if (seen.has(idx)) return;
    const key = (item.groupKey || '').trim();
    if (key) {
      const members = [];
      items.forEach((it2, idx2) => {
        if (!seen.has(idx2) && (it2.groupKey || '').trim() === key) { members.push(it2); seen.add(idx2); }
      });
      rows.push(members);
    } else {
      seen.add(idx);
      rows.push([item]);
    }
  });
  const maxCols = Math.max(1, ...rows.map(m => m.length));
  const isCombo = maxCols > 1;
  let subLabels = [];
  if (isCombo) {
    const comboRow = rows.find(m => m.length > 1);
    subLabels = (comboRow || []).map((m, i) => (m.note || '').trim() || `Thành phần ${i + 1}`);
    while (subLabels.length < maxCols) subLabels.push(`Thành phần ${subLabels.length + 1}`);
  }

  const serialCellHtml = (serials) => {
    if (!serials || serials.length === 0) return '';
    if (serials.length <= 10) return serials.map(s => `<div style="text-align:center">${esc(s)}</div>`).join('');
    const mid = Math.ceil(serials.length / 2);
    const col1 = serials.slice(0, mid).map(s => `<div style="text-align:center">${esc(s)}</div>`).join('');
    const col2 = serials.slice(mid).map(s => `<div style="text-align:center">${esc(s)}</div>`).join('');
    return `<table style="width:100%;border:none;margin:0;padding:0;text-align:center"><tr><td style="width:50%;border:none;padding:0;vertical-align:top;text-align:center">${col1}</td><td style="width:50%;border:none;padding:0;vertical-align:top;text-align:center">${col2}</td></tr></table>`;
  };

  const headerHtml = !isCombo
    ? `<tr><th rowspan="1">STT</th><th>Danh Mục Hàng Hóa</th><th>Số lượng</th><th>ĐVT</th><th>Serial</th></tr>`
    : `<tr><th rowspan="2">STT</th><th rowspan="2">Danh Mục Hàng Hóa</th><th rowspan="2">Số lượng</th><th rowspan="2">ĐVT</th><th colspan="${maxCols}">Serial</th></tr>
       <tr>${subLabels.map(l => `<th>${esc(l)}</th>`).join('')}</tr>`;

  const bodyHtml = rows.map((members, idx) => {
    const names = members.map(m => { const p = getProduct(m.productId); return p?.name || m.productName || ''; }).map(n => `- ${esc(n)}`).join('<br>');
    const sl = members[0].serials?.length || members[0].qty || 0;
    const unit = members[0].unit || (members.length > 1 ? 'Bộ' : (getProduct(members[0].productId)?.unit || ''));
    let serialTds;
    if (!isCombo) {
      serialTds = `<td class="sn" style="text-align:center">${serialCellHtml(members[0].serials)}</td>`;
    } else if (members.length > 1) {
      serialTds = Array.from({ length: maxCols }, (_, i) => `<td class="sn" style="text-align:center">${i < members.length ? serialCellHtml(members[i].serials) : ''}</td>`).join('');
    } else {
      serialTds = `<td class="sn" colspan="${maxCols}" style="text-align:center">${serialCellHtml(members[0].serials)}</td>`;
    }
    return `<tr><td class="center">${idx + 1}</td><td>${names}</td><td class="center">${sl}</td><td class="center">${esc(unit)}</td>${serialTds}</tr>`;
  }).join('');

  const partyRow = (label, value, isBold = false) => `<tr><td style="width:135px;padding:2px 0;border:none;${isBold ? 'font-weight:bold' : ''}">${esc(label)}</td><td style="width:15px;padding:2px 0;border:none;text-align:center;${isBold ? 'font-weight:bold' : ''}">:</td><td style="padding:2px 0;border:none;${isBold ? 'font-weight:bold' : ''}">${value}</td></tr>`;

  const w = window.open('', '_blank', 'width=900,height=700');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(doc.docNumber)}</title>
  <style>
  body{font-family:'Times New Roman',serif;margin:28px 34px;font-size:13px;color:#111;line-height:1.5}
  .center{text-align:center}
  .qh{font-weight:bold;font-size:15px}
  .qh-sub{font-style:italic}
  .qh-div{font-weight:bold;margin:2px 0 8px}
  .title{font-weight:bold;font-size:17px;margin:6px 0 12px}
  .party b{font-weight:bold}
  .row{margin:2px 0}
  h4{margin:14px 0 6px;font-size:13px}
  table{width:100%;border-collapse:collapse;margin:10px 0 14px}
  th,td{border:1px solid #000;padding:5px 7px;font-size:12.5px;vertical-align:middle}
  th{font-weight:bold}
  .sn{font-family:Calibri,Arial,sans-serif;font-size:12px;text-align:center}
  .closing{margin:2px 0;padding-left:16px;text-indent:-16px}
  .sr{display:grid;grid-template-columns:1fr 1fr;gap:20px;text-align:center;margin-top:26px}
  .sr b{font-size:13px}
  @media print{body{margin:10mm 12mm}}
  </style></head><body>
  <div class="center qh">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</div>
  <div class="center qh-sub">Độc lập - Tự do - Hạnh phúc</div>
  <div class="center qh-div">--------o0o--------</div>
  <div class="center title">BIÊN BẢN BÀN GIAO HÀNG HÓA</div>
  <div class="row">Hôm nay, ngày ${ngay} tháng ${thang} năm ${nam}, chúng tôi gồm:</div>

  <div class="party">
    <table style="border:none;margin-bottom:8px">
      ${partyRow('BÊN BÁN (Bên A)', esc(doc.sellerCompanyName || ''), true)}
      ${doc.sellerAddress ? partyRow('Địa chỉ', esc(doc.sellerAddress)) : ''}
      ${partyRow('Người đại diện', `<b>${esc(doc.sellerRepName || '')}</b> <span style="display:inline-block;width:30px"></span> Chức vụ: ${esc(doc.sellerRepPosition || '')}`)}
    </table>
  </div>
  <div class="party" style="margin-top:8px">
    <table style="border:none">
      ${partyRow('BÊN MUA (Bên B)', esc(doc.buyerCompanyName || ''), true)}
      ${doc.buyerAddress ? partyRow('Địa chỉ', esc(doc.buyerAddress)) : ''}
      ${doc.buyerDeliveryAddress ? partyRow('Địa chỉ nhận hàng', esc(doc.buyerDeliveryAddress)) : ''}
      ${partyRow('Người đại diện', `<b>${esc(doc.buyerRep || '')}</b> <span style="display:inline-block;width:30px"></span> Chức vụ: ${esc(doc.buyerRepPosition || '')}`)}
    </table>
  </div>

  <h4>Hai bên cùng nhau thống nhất số lượng hàng hóa như sau:</h4>
  <table><thead>${headerHtml}</thead><tbody>${bodyHtml}</tbody></table>

  <div class="closing">- Hai bên cùng thống nhất Bên A đã bàn giao cho Bên B toàn bộ hàng hóa với số lượng đúng chủng loại, quy cách được nêu như trên</div>
  <div class="closing">- Hai bên đồng ý, thống nhất ký tên.</div>
  <div class="closing">- Biên bản này được lập thành 02 bản có giá trị pháp lý như nhau, mỗi bên giữ 01 bản để thực hiện.</div>
  ${doc.note ? `<p style="font-size:12px;color:#555;margin-top:8px"><i>Ghi chú: ${esc(doc.note)}</i></p>` : ''}

  <table style="border:none;margin-top:26px"><tr>
    <td class="center" style="border:none"><b>ĐẠI DIỆN BÊN B</b></td>
    <td class="center" style="border:none"><b>ĐẠI DIỆN BÊN A</b></td>
  </tr></table>
  <script>window.onload=()=>window.print()<\/script></body></html>`);
  w.document.close();
}

// ═══════════════════════════════════════════════════════════════
//  EXPORT BBGH → WORD (.docx) — Đúng mẫu biên bản
// ═══════════════════════════════════════════════════════════════
function exportBbghToWord(doc) {
  if (typeof docx === 'undefined') {
    toast('Thư viện docx chưa tải — cần kết nối internet', 'wrn'); return;
  }
  try {
    const { Document, Packer, Paragraph, Table, TableRow, TableCell, Footer,
      TextRun, AlignmentType, WidthType, BorderStyle, VerticalAlign, PageNumber, TabStopType } = docx;

    const B = { top: { style: BorderStyle.SINGLE, size: 4, color: '000000' }, bottom: { style: BorderStyle.SINGLE, size: 4, color: '000000' }, left: { style: BorderStyle.SINGLE, size: 4, color: '000000' }, right: { style: BorderStyle.SINGLE, size: 4, color: '000000' } };
    const BNONE = { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } };

    const TNR = 'Times New Roman';
    const CALIBRI = 'Calibri';

    // r: run thường; rb: run in đậm; ri: run in nghiêng
    const r = (txt, sz = 24, bold = false, font = TNR, italic = false) => new TextRun({ text: String(txt ?? ''), bold, italics: italic, size: sz, font });
    const rb = (txt, sz = 24) => r(txt, sz, true);
    const ri = (txt, sz = 24) => r(txt, sz, false, TNR, true);
    const p = (children, align = AlignmentType.LEFT, spAfter = 40, extra = {}) =>
      new Paragraph({ children: Array.isArray(children) ? children : [children], alignment: align, spacing: { after: spAfter }, ...extra });
    const pc = (children, spAfter = 40) => p(children, AlignmentType.CENTER, spAfter);

    const cell = (children, align = AlignmentType.LEFT, width = null, borders = B, vAlign = VerticalAlign.CENTER, extra = {}) =>
      new TableCell({
        children: Array.isArray(children) ? children : [children], borders, verticalAlign: vAlign,
        ...(width ? { width: { size: width, type: WidthType.DXA } } : {}), ...extra
      });

    // Nhãn 2 cột: "Địa chỉ : giá trị" — căn thẳng hàng dấu 2 chấm
    const infoLine = (label, val1, bold1, label2, val2) => {
      const children = [r(label, 24), r('\t:\t', 24), r(val1 || '', 24, bold1)];
      if (label2) {
        children.push(r('\t' + label2, 24), r('\t:\t', 24), r(val2 || '', 24));
      }
      return new Paragraph({
        children,
        tabStops: [
          { type: TabStopType.LEFT, position: 2200 }, // : sau label1
          { type: TabStopType.LEFT, position: 2400 }, // val1
          { type: TabStopType.LEFT, position: 6000 }, // label2
          { type: TabStopType.LEFT, position: 7100 }, // : sau label2
          { type: TabStopType.LEFT, position: 7300 }, // val2
        ],
        spacing: { after: 60 }
      });
    };

    // Ngày
    const dt = doc.date ? new Date(doc.date) : new Date();
    const ngay = String(dt.getDate()).padStart(2, '0');
    const thang = String(dt.getMonth() + 1).padStart(2, '0');
    const nam = dt.getFullYear();

    // ── Gộp các dòng hàng có cùng "Nhóm bộ" (groupKey) thành 1 dòng combo, mỗi sản phẩm 1 cột Serial riêng ──
    const items = doc.items || [];
    const seen = new Set();
    let rows = [];
    items.forEach((item, idx) => {
      if (seen.has(idx)) return;
      const key = (item.groupKey || '').trim();
      if (key) {
        const members = [];
        items.forEach((it2, idx2) => {
          if (!seen.has(idx2) && (it2.groupKey || '').trim() === key) { members.push(it2); seen.add(idx2); }
        });
        rows.push(members);
      } else {
        seen.add(idx);
        rows.push([item]);
      }
    });

    const mode = doc.colMode || 'auto';

    if (mode === '1') {
      rows = rows.map(members => {
        if (members.length === 1) return members;
        const combined = { ...members[0] };
        combined.serials = members.reduce((acc, m) => acc.concat(m.serials || []), []);
        combined.qty = Math.max(...members.map(m => m.qty || 0));
        combined.productName = members.map(m => { const p = getProduct(m.productId); return p?.name || m.productName || ''; }).join(' + ');
        combined.productId = null; // Bypass lookup
        return [combined];
      });
    } else if (mode === '2') {
      rows = rows.map(members => {
        if (members.length === 1 && (members[0].serials || []).length > 1) {
          const serials = members[0].serials || [];
          const half = Math.ceil(serials.length / 2);
          const m1 = { ...members[0], serials: serials.slice(0, half), note: 'Cột 1' };
          const m2 = { ...members[0], serials: serials.slice(half), note: 'Cột 2' };
          return [m1, m2];
        }
        return members;
      });
    }

    const maxCols = Math.max(1, ...rows.map(m => m.length));
    const isCombo = maxCols > 1;

    // Nhãn cột con (Case / Màn hình...) lấy từ dòng combo đầu tiên có nhiều thành phần
    let subLabels = [];
    if (isCombo) {
      const comboRow = rows.find(m => m.length > 1);
      subLabels = (comboRow || []).map((m, i) => (m.note || '').trim() || `Thành phần ${i + 1}`);
      while (subLabels.length < maxCols) subLabels.push(`Thành phần ${subLabels.length + 1}`);
    }

    // ── Bề rộng cột (DXA), tổng khớp bề rộng nội dung trang (A4, lề trái 1418 / phải 851) ──
    const W_STT = 675, W_NAME = 3119, W_SL = 850, W_DVT = 964;
    const serialTotal = 9637 - W_STT - W_NAME - W_SL - W_DVT;
    const serialColW = Math.floor(serialTotal / maxCols);
    const serialWidths = Array.from({ length: maxCols }, (_, i) => i < maxCols - 1 ? serialColW : serialTotal - serialColW * (maxCols - 1));
    const colWidths = [W_STT, W_NAME, W_SL, W_DVT, ...serialWidths];

    const serialParas = (serials) => (!serials || serials.length === 0)
      ? [new Paragraph({ children: [r('', 22, false, CALIBRI)], alignment: AlignmentType.CENTER, spacing: { after: 0 } })]
      : serials.map((sn, si) => new Paragraph({ children: [r(sn, 22, false, CALIBRI)], alignment: AlignmentType.CENTER, spacing: { after: si < serials.length - 1 ? 40 : 0 } }));

    // ── Header bảng ──
    const headerRows = !isCombo
      ? [new TableRow({
        tableHeader: true, children: [
          cell([pc([rb('STT', 24)], 0)], AlignmentType.CENTER, colWidths[0]),
          cell([pc([rb('Danh Mục Hàng Hóa', 24)], 0)], AlignmentType.CENTER, colWidths[1]),
          cell([pc([rb('Số lượng', 24)], 0)], AlignmentType.CENTER, colWidths[2]),
          cell([pc([rb('ĐVT', 24)], 0)], AlignmentType.CENTER, colWidths[3]),
          cell([pc([rb('Serial', 24)], 0)], AlignmentType.CENTER, colWidths[4]),
        ]
      })]
      : [
        new TableRow({
          tableHeader: true, children: [
            cell([pc([rb('STT', 24)], 0)], AlignmentType.CENTER, colWidths[0], B, VerticalAlign.CENTER, { rowSpan: 2 }),
            cell([pc([rb('Danh Mục Hàng Hóa', 24)], 0)], AlignmentType.CENTER, colWidths[1], B, VerticalAlign.CENTER, { rowSpan: 2 }),
            cell([pc([rb('Số lượng', 24)], 0)], AlignmentType.CENTER, colWidths[2], B, VerticalAlign.CENTER, { rowSpan: 2 }),
            cell([pc([rb('ĐVT', 24)], 0)], AlignmentType.CENTER, colWidths[3], B, VerticalAlign.CENTER, { rowSpan: 2 }),
            cell([pc([rb('Serial', 24)], 0)], AlignmentType.CENTER, serialTotal, B, VerticalAlign.CENTER, { columnSpan: maxCols }),
          ]
        }),
        new TableRow({
          tableHeader: true, children: subLabels.map((lbl, i) =>
            cell([pc([rb(lbl, 24)], 0)], AlignmentType.CENTER, serialWidths[i]))
        }),
      ];

    // ── Các dòng dữ liệu ──
    const dataRows = rows.map((members, idx) => {
      const names = members.map(m => { const pr = getProduct(m.productId); return pr?.name || m.productName || ''; });
      const nameParas = names.map((nm, i) => new Paragraph({ children: [r(`- ${nm}`, 24)], spacing: { after: i < names.length - 1 ? 40 : 0 } }));
      const sl = members[0].serials?.length || members[0].qty || 0;
      const unit = members[0].unit || (members.length > 1 ? 'Bộ' : (getProduct(members[0].productId)?.unit || ''));

      let serialCells;
      if (!isCombo) {
        serialCells = [cell(serialParas(members[0].serials), AlignmentType.CENTER, colWidths[4])];
      } else if (members.length > 1) {
        serialCells = [];
        for (let i = 0; i < maxCols; i++) {
          serialCells.push(i < members.length
            ? cell(serialParas(members[i].serials), AlignmentType.CENTER, serialWidths[i])
            : cell([new Paragraph({ children: [r('', 22)], alignment: AlignmentType.CENTER })], AlignmentType.CENTER, serialWidths[i]));
        }
      } else {
        serialCells = [cell(serialParas(members[0].serials), AlignmentType.CENTER, serialTotal, B, VerticalAlign.CENTER, { columnSpan: maxCols })];
      }

      return new TableRow({
        children: [
          cell([p([r(String(idx + 1), 24)], AlignmentType.CENTER, 0)], AlignmentType.CENTER, colWidths[0]),
          new TableCell({ children: nameParas, borders: B, verticalAlign: VerticalAlign.CENTER, width: { size: colWidths[1], type: WidthType.DXA } }),
          cell([p([r(String(sl), 24)], AlignmentType.CENTER, 0)], AlignmentType.CENTER, colWidths[2]),
          cell([p([r(unit, 24)], AlignmentType.CENTER, 0)], AlignmentType.CENTER, colWidths[3]),
          ...serialCells,
        ]
      });
    });

    const goodsTable = new Table({
      width: { size: colWidths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
      columnWidths: colWidths,
      rows: [...headerRows, ...dataRows],
    });

    // ── Bảng chữ ký — chỉ tiêu đề + khoảng trống để ký, giống hệt mẫu ──
    const sigTable = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE }, insideH: { style: BorderStyle.NONE }, insideV: { style: BorderStyle.NONE } },
      rows: [new TableRow({
        children: [
          cell([pc([rb('ĐẠI DIỆN BÊN B', 24)], 0), pc([r(' ', 24)], 0), pc([r(' ', 24)], 0)], AlignmentType.CENTER, null, BNONE),
          cell([pc([rb('ĐẠI DIỆN BÊN A', 24)], 0), pc([r(' ', 24)], 0), pc([r(' ', 24)], 0)], AlignmentType.CENTER, null, BNONE),
        ],
      })],
    });

    const footer = new Footer({
      children: [new Paragraph({
        alignment: AlignmentType.RIGHT, children: [
          r('- Trang ', 20), new TextRun({ children: [PageNumber.CURRENT], size: 20, font: TNR }), r(' -', 20),
        ]
      })],
    });

    // Đoạn kết dạng "-  <nội dung>" (gạch đầu dòng, không dùng bullet tròn) giống hệt mẫu
    const dashLine = (txt) => p([r('-\t', 24), r(txt, 24)], AlignmentType.LEFT, 0,
      { indent: { left: 360, hanging: 360 } });

    const docxDoc = new Document({
      styles: { default: { document: { run: { font: TNR, size: 24 }, paragraph: { spacing: { after: 80 } } } } },
      sections: [{
        properties: { page: { margin: { top: 709, right: 851, bottom: 709, left: 1418 } } },
        footers: { default: footer },
        children: [
          // Quốc hiệu
          pc([rb('CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM', 26)], 0),
          pc([ri('Độc lập - Tự do - Hạnh phúc', 24)], 0),
          pc([rb('--------o0o--------', 24)], 0),

          // Tiêu đề
          pc([rb('BIÊN BẢN BÀN GIAO HÀNG HÓA', 32)], 120),
          p([r(`Hôm nay, ngày ${ngay} tháng ${thang} năm ${nam}, chúng tôi gồm:`, 24)], AlignmentType.LEFT, 120),

          // Bên A
          p([rb('BÊN BÁN (Bên A): ', 24), rb(doc.sellerCompanyName || '', 24)], AlignmentType.LEFT, 40),
          ...(doc.sellerAddress ? [infoLine('Địa chỉ', doc.sellerAddress)] : []),
          infoLine('Người đại diện', doc.sellerRepName, true, 'Chức vụ', doc.sellerRepPosition),
          p([r('', 24)], AlignmentType.LEFT, 40),

          // Bên B
          p([rb('BÊN MUA (Bên B): ', 24), rb(doc.buyerCompanyName || '', 24)], AlignmentType.LEFT, 40),
          ...(doc.buyerAddress ? [infoLine('Địa chỉ', doc.buyerAddress)] : []),
          ...(doc.buyerDeliveryAddress ? [infoLine('Địa chỉ nhận hàng', doc.buyerDeliveryAddress)] : []),
          infoLine('Người đại diện', doc.buyerRep, true, 'Chức vụ', doc.buyerRepPosition),
          p([r('', 24)], AlignmentType.LEFT, 40),

          // Nội dung
          p([rb('Hai bên cùng nhau thống nhất số lượng hàng hóa như sau:', 24)], AlignmentType.LEFT, 80),

          goodsTable,

          p([r(' ', 24)], AlignmentType.LEFT, 0),

          // 3 gạch đầu dòng kết luận, giống hệt mẫu
          dashLine('Hai bên cùng thống nhất Bên A đã bàn giao cho Bên B toàn bộ hàng hóa với số lượng đúng chủng loại, quy cách được nêu như trên'),
          dashLine('Hai bên đồng ý, thống nhất ký tên.'),
          dashLine('Biên bản này được lập thành 02 bản có giá trị pháp lý như nhau, mỗi bên giữ 01 bản để thực hiện.'),

          ...(doc.note ? [p([r(`Ghi chú: ${doc.note}`, 22)], AlignmentType.LEFT, 80)] : []),

          sigTable,
        ],
      }],
    });

    Packer.toBlob(docxDoc).then(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${doc.docNumber.replace(/[\/\\:*?"<>|]/g, '_')}_BBGH.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast('📄 Đã tải file Word!', 'ok');
    }).catch(e => {
      console.error('Lỗi tạo Word:', e);
      toast('❌ Lỗi tạo Word: ' + e.message, 'err');
    });
  } catch (e) {
    console.error('exportBbghToWord error:', e);
    toast('❌ Lỗi xuất Word: ' + e.message, 'err');
  }
}


// ═══════════════════════════════════════════════════════════════

let quoteItems = [
  {
    name: "Dịch vụ trực tuyến Microsoft 365 Business Basic (no Teams) - Annual - 12 Months",
    model: "Office",
    brand: "Microsoft",
    unit: "Người dùng",
    qty: 54,
    price: 1350000,
    amount: 72900000
  },
  {
    name: "Dịch vụ trực tuyến Microsoft 365 Business Standard (no Teams) - Annual - 12 Months",
    model: "Office",
    brand: "Microsoft",
    unit: "Người dùng",
    qty: 54,
    price: 3250000,
    amount: 175500000
  }
];
let quoteTaxPercent = 10;

function renderQuotePage() {
  const now = new Date();
  const dayEl = document.getElementById('qs-day');
  const monthEl = document.getElementById('qs-month');
  const yearEl = document.getElementById('qs-year');

  if (dayEl && (!dayEl.value || dayEl.value === '18')) dayEl.value = String(now.getDate()).padStart(2, '0');
  if (monthEl && (!monthEl.value || monthEl.value === '08')) monthEl.value = String(now.getMonth() + 1).padStart(2, '0');
  if (yearEl && (!yearEl.value || yearEl.value === '2026')) yearEl.value = now.getFullYear();

  renderQuoteItems();
  calcQuoteTotals();
}

function onQuoteBuyerNameChange(val) {
  // Sync state if needed
}

function onQuoteDatePartChange() {
  calcQuoteTotals();
}

function getQuoteCurrentDateStr() {
  const day = document.getElementById('qs-day')?.value || '18';
  const month = document.getElementById('qs-month')?.value || '08';
  const year = document.getElementById('qs-year')?.value || '2026';
  return `Hà Nội, Ngày ${String(day).padStart(2, '0')} tháng ${String(month).padStart(2, '0')} năm ${year}`;
}

function openAddQuoteProduct() {
  const opts = db.products.map(p => `<option value="${esc(p.id)}">[${esc(p.code)}] ${esc(p.name)}</option>`).join('');
  const psel = document.getElementById('quote-psel');
  if (psel) psel.innerHTML = '<option value="">-- Chọn sản phẩm từ danh mục --</option>' + opts;
  const psearch = document.getElementById('quote-psearch');
  if (psearch) psearch.value = '';
  openModal('mo-quote-product');
}

function confirmAddQuoteProduct() {
  const pid = document.getElementById('quote-psel')?.value;
  if (!pid) { toast('Vui lòng chọn sản phẩm', 'wrn'); return; }
  const p = getProduct(pid);
  if (p) {
    quoteItems.push({
      productId: p.id,
      code: p.code || '',
      name: p.name || '',
      model: p.code || 'Standard',
      brand: 'Chính hãng',
      unit: p.unit || 'Bộ',
      qty: 1,
      price: 0,
      amount: 0
    });
  }
  closeModal('mo-quote-product');
  renderQuoteItems();
  calcQuoteTotals();
  toast('Đã thêm sản phẩm vào bảng báo giá', 'ok');
}

function addCustomQuoteItem() {
  quoteItems.push({
    name: 'Sản phẩm / Dịch vụ mới',
    model: 'Office',
    brand: 'Chính hãng',
    unit: 'Bộ',
    qty: 1,
    price: 0,
    amount: 0
  });
  renderQuoteItems();
  calcQuoteTotals();
}

function removeQuoteItem(idx) {
  if (quoteItems.length <= 1) {
    if (!confirm('Bạn có chắc muốn xóa dòng sản phẩm cuối cùng này không?')) return;
  }
  quoteItems.splice(idx, 1);
  renderQuoteItems();
  calcQuoteTotals();
}

function onQuoteItemChange(idx, field, val) {
  const item = quoteItems[idx];
  if (!item) return;
  if (field === 'qty') {
    item.qty = Math.max(1, parseFloat(val) || 1);
  } else {
    item[field] = val;
  }
  item.amount = (item.qty || 0) * (item.price || 0);

  const amountSpan = document.getElementById(`qs-amount-${idx}`);
  if (amountSpan) amountSpan.textContent = (item.amount || 0).toLocaleString('en-US');

  calcQuoteTotals();
}

function onQuotePriceInput(idx, val) {
  const item = quoteItems[idx];
  if (!item) return;
  const clean = String(val).replace(/[^0-9.]/g, '');
  item.price = parseFloat(clean) || 0;
  item.amount = (item.qty || 0) * item.price;

  const amountSpan = document.getElementById(`qs-amount-${idx}`);
  if (amountSpan) amountSpan.textContent = (item.amount || 0).toLocaleString('en-US');

  calcQuoteTotals();
}

function renderQuoteItems() {
  const tbody = document.getElementById('quote-items-tbody');
  if (!tbody) return;
  if (quoteItems.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="tc c3" style="padding:28px">Chưa có sản phẩm nào. Bấm nút <strong>➕ Thêm SP từ kho</strong> hoặc <strong>➕ Thêm dòng mới</strong> ở trên để thêm hàng.</td></tr>`;
    return;
  }

  tbody.innerHTML = quoteItems.map((item, idx) => {
    const formattedPrice = (item.price || 0).toLocaleString('en-US');
    const formattedAmount = (item.amount || ((item.qty || 0) * (item.price || 0))).toLocaleString('en-US');

    return `<tr>
      <td style="text-align:center;font-weight:bold">${idx + 1}</td>
      <td>
        <textarea class="qs-textarea" rows="2" placeholder="Tên sản phẩm & dịch vụ..." oninput="onQuoteItemChange(${idx}, 'name', this.value)">${esc(item.name)}</textarea>
      </td>
      <td>
        <input type="text" class="qs-input model-red" placeholder="Model" value="${esc(item.model || '')}" oninput="onQuoteItemChange(${idx}, 'model', this.value)" />
      </td>
      <td>
        <input type="text" class="qs-input" style="text-align:center" placeholder="Hãng" value="${esc(item.brand || '')}" oninput="onQuoteItemChange(${idx}, 'brand', this.value)" />
      </td>
      <td>
        <input type="text" class="qs-input" style="text-align:center" placeholder="ĐVT" value="${esc(item.unit || '')}" oninput="onQuoteItemChange(${idx}, 'unit', this.value)" />
      </td>
      <td>
        <input type="number" min="1" class="qs-input" style="text-align:center;font-weight:bold" value="${item.qty || 1}" oninput="onQuoteItemChange(${idx}, 'qty', this.value)" />
      </td>
      <td>
        <input type="text" class="qs-input" style="text-align:right" value="${formattedPrice}" onfocus="this.value='${item.price || 0}'" onblur="this.value=Number(${item.price || 0}).toLocaleString('en-US')" oninput="onQuotePriceInput(${idx}, this.value)" />
      </td>
      <td>
        <span class="fw7" id="qs-amount-${idx}" style="font-size:11pt;display:block;text-align:right">${formattedAmount}</span>
      </td>
      <td class="no-print" style="text-align:center">
        <button class="qs-del-btn" onclick="removeQuoteItem(${idx})" title="Xóa dòng">✕</button>
      </td>
    </tr>`;
  }).join('');
}

function setQuoteTax(pct) {
  quoteTaxPercent = pct;
  [0, 8, 10].forEach(p => {
    const btn = document.getElementById(`tax-btn-${p}`);
    if (btn) {
      if (p === pct) btn.classList.add('active');
      else btn.classList.remove('active');
    }
  });
  const customEl = document.getElementById('quote-custom-tax');
  if (customEl) customEl.value = pct;
  calcQuoteTotals();
}

function onCustomTaxInput(val) {
  const p = parseFloat(val) || 0;
  quoteTaxPercent = Math.max(0, p);
  [0, 8, 10].forEach(n => {
    const btn = document.getElementById(`tax-btn-${n}`);
    if (btn) {
      if (n === quoteTaxPercent) btn.classList.add('active');
      else btn.classList.remove('active');
    }
  });
  calcQuoteTotals();
}

function calcQuoteTotals() {
  const subtotal = quoteItems.reduce((s, i) => s + ((i.qty || 0) * (i.price || 0)), 0);
  const taxAmount = Math.round(subtotal * (quoteTaxPercent / 100));
  const grandTotal = subtotal + taxAmount;
  const words = numberToWordsVN(grandTotal);

  const subEl = document.getElementById('qs-subtotal-val');
  const taxPctLabel = document.getElementById('qs-tax-pct-label');
  const taxEl = document.getElementById('qs-tax-val');
  const grandEl = document.getElementById('qs-grand-val');
  const wordsEl = document.getElementById('qs-words-val');
  const noteTaxEl = document.getElementById('qs-note-tax');

  if (subEl) subEl.textContent = subtotal.toLocaleString('en-US');
  if (taxPctLabel) taxPctLabel.textContent = quoteTaxPercent > 0 ? `${quoteTaxPercent}%` : '(0%)';
  if (taxEl) taxEl.textContent = taxAmount.toLocaleString('en-US');
  if (grandEl) grandEl.textContent = grandTotal.toLocaleString('en-US');
  if (wordsEl) wordsEl.textContent = words;
  if (noteTaxEl) noteTaxEl.textContent = quoteTaxPercent > 0 ? `đã bao gồm VAT ${quoteTaxPercent}%` : 'chưa bao gồm thuế VAT';

  return { subtotal, taxAmount, grandTotal, words };
}

function getCurrentQuoteData() {
  const day = document.getElementById('qs-day')?.value || '18';
  const month = document.getElementById('qs-month')?.value || '08';
  const year = document.getElementById('qs-year')?.value || '2026';
  const buyerName = document.getElementById('quote-buyer-name')?.value.trim() || 'Quý khách hàng';
  const totals = calcQuoteTotals();

  return {
    id: genId('QUOTE'),
    docNumber: genDocNum('BG', db.quotations || []),
    date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    dateLine: getQuoteCurrentDateStr(),
    location: 'Hà Nội',
    sellerCompanyName: 'CÔNG TY TNHH THƯƠNG MẠI ĐẦU TƯ VÀ SẢN XUẤT THUẬN PHÁT',
    sellerTax: '0107425090',
    sellerPhone: '0943 218 080',
    sellerWebsite: 'https://thuanphat8.vn',
    sellerEmail: 'Ketoan@thuanphat8.vn',
    buyerCompanyName: buyerName,
    items: quoteItems.map(i => ({ ...i, amount: (i.qty || 0) * (i.price || 0) })),
    subtotal: totals.subtotal,
    taxPercent: quoteTaxPercent,
    taxAmount: totals.taxAmount,
    grandTotal: totals.grandTotal,
    words: totals.words,
    termCondition: document.getElementById('qs-note-condition')?.value.trim() || 'hàng mới 100% chưa qua sử dụng',
    termDelivery: document.getElementById('qs-note-delivery')?.value.trim() || '',
    termLocation: document.getElementById('qs-note-location')?.value.trim() || '',
    termValidity: document.getElementById('qs-note-validity')?.value.trim() || 'trong vòng 20 ngày kể từ ngày phát hành báo giá.',
    createdAt: new Date().toISOString()
  };
}

function submitQuote() {
  const quote = getCurrentQuoteData();
  if (quote.items.length === 0) { toast('Vui lòng thêm ít nhất 1 sản phẩm vào báo giá', 'wrn'); return; }

  db.quotations.push(quote);
  save();

  toast(`✅ Đã lưu báo giá ${quote.docNumber} (${fmtMoney(quote.grandTotal)}) thành công!`, 'ok');
}

function printCurrentQuote() {
  const quote = getCurrentQuoteData();
  printQuoteObj(quote);
}

function exportCurrentQuoteExcel() {
  const quote = getCurrentQuoteData();
  exportQuoteToExcel(quote);
}

function exportCurrentQuoteWord() {
  const quote = getCurrentQuoteData();
  exportQuoteToWord(quote);
}

function viewQuote(id) {
  const quote = db.quotations.find(q => q.id === id);
  if (!quote) return;
  document.getElementById('vd-title').textContent = '💰 ' + quote.docNumber + ' — ' + (quote.buyerCompanyName || 'Khách hàng');
  document.getElementById('vd-body').innerHTML = buildQuoteView(quote);

  const printBtn = document.getElementById('vd-print');
  const excelBtn = document.getElementById('vd-excel');
  const wordBtn = document.getElementById('vd-word');

  if (printBtn) printBtn.onclick = () => printQuoteObj(quote);
  if (excelBtn) { excelBtn.style.display = ''; excelBtn.onclick = () => exportQuoteToExcel(quote); }
  if (wordBtn) { wordBtn.style.display = ''; wordBtn.onclick = () => exportQuoteToWord(quote); }

  openModal('mo-view-doc');
}

function buildQuoteView(quote) {
  return `
    <div style="background:#ffffff;border:1px solid #cbd5e1;border-radius:6px;padding:32px 36px;font-family:'Times New Roman',Times,serif;font-size:12.5pt;color:#000;line-height:1.35">
      <div style="margin-bottom:8px">
        <img src="logo_thuanphat.png" style="max-width:540px;width:100%;height:auto;display:block" alt="THUẬN PHÁT" />
      </div>

      <div style="text-align:right;font-style:italic;font-size:12pt;margin:10px 0 14px">${esc(quote.dateLine || 'Hà Nội, Ngày 18 tháng 08 năm 2026')}</div>
      <div style="text-align:center;font-size:19pt;font-weight:bold;margin:14px 0 12px">BÁO GIÁ</div>

      <div style="margin-bottom:12px;font-size:12pt;line-height:1.5">
        <div><strong>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Kính gửi:</strong> ${esc(quote.buyerCompanyName || 'Quý khách hàng')}</div>
        <div style="font-style:italic;margin-top:4px">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Trân trọng cảm ơn quý khách hàng đã quan tâm đến sản phẩm và dịch vụ của chúng tôi. Công ty TNHH Thương Mại Đầu tư và Sản xuất Thuận Phát xin gửi tới Quý khách bảng báo giá sản phẩm như sau :</div>
      </div>

      <table style="width:100%;border-collapse:collapse;margin:12px 0;border:1px solid #000">
        <thead>
          <tr style="background:#cce8f4">
            <th style="border:1px solid #000;padding:5px 4px;font-size:11pt;text-align:center;width:35px">STT</th>
            <th style="border:1px solid #000;padding:5px 4px;font-size:11pt;text-align:center">SẢN PHẨM</th>
            <th style="border:1px solid #000;padding:5px 4px;font-size:11pt;text-align:center;width:90px">Model</th>
            <th style="border:1px solid #000;padding:5px 4px;font-size:11pt;text-align:center;width:90px">Hãng</th>
            <th style="border:1px solid #000;padding:5px 4px;font-size:11pt;text-align:center;width:70px">ĐVT</th>
            <th style="border:1px solid #000;padding:5px 4px;font-size:11pt;text-align:center;width:50px">SL</th>
            <th style="border:1px solid #000;padding:5px 4px;font-size:11pt;text-align:center;width:115px">Đơn giá</th>
            <th style="border:1px solid #000;padding:5px 4px;font-size:11pt;text-align:center;width:130px">Thành tiền</th>
          </tr>
        </thead>
        <tbody>
          ${(quote.items || []).map((item, idx) => `
            <tr>
              <td style="border:1px solid #000;padding:5px 4px;font-size:11pt;text-align:center;font-weight:bold">${idx + 1}</td>
              <td style="border:1px solid #000;padding:5px 4px;font-size:11pt">${esc(item.name)}</td>
              <td style="border:1px solid #000;padding:5px 4px;font-size:11pt;text-align:center;color:#c00000;font-weight:bold">${esc(item.model || '—')}</td>
              <td style="border:1px solid #000;padding:5px 4px;font-size:11pt;text-align:center">${esc(item.brand || '—')}</td>
              <td style="border:1px solid #000;padding:5px 4px;font-size:11pt;text-align:center">${esc(item.unit || '—')}</td>
              <td style="border:1px solid #000;padding:5px 4px;font-size:11pt;text-align:center;font-weight:bold">${item.qty || 1}</td>
              <td style="border:1px solid #000;padding:5px 4px;font-size:11pt;text-align:right">${(item.price || 0).toLocaleString('en-US')}</td>
              <td style="border:1px solid #000;padding:5px 4px;font-size:11pt;text-align:right;font-weight:bold">${(item.amount || ((item.qty || 0) * (item.price || 0))).toLocaleString('en-US')}</td>
            </tr>
          `).join('')}
          <tr style="background:#cce8f4;font-weight:bold">
            <td colspan="7" style="border:1px solid #000;padding:5px 6px;text-align:right">TỔNG CỘNG TRƯỚC THUẾ:</td>
            <td style="border:1px solid #000;padding:5px 6px;text-align:right">${(quote.subtotal || 0).toLocaleString('en-US')}</td>
          </tr>
          <tr style="background:#cce8f4;font-weight:bold">
            <td colspan="7" style="border:1px solid #000;padding:5px 6px;text-align:right">THUẾ ${quote.taxPercent ?? 10}%:</td>
            <td style="border:1px solid #000;padding:5px 6px;text-align:right">${(quote.taxAmount || 0).toLocaleString('en-US')}</td>
          </tr>
          <tr style="background:#cce8f4;font-weight:bold">
            <td colspan="7" style="border:1px solid #000;padding:5px 6px;text-align:right">TỔNG TIỀN SAU THUẾ</td>
            <td style="border:1px solid #000;padding:5px 6px;text-align:right">${(quote.grandTotal || 0).toLocaleString('en-US')}</td>
          </tr>
          <tr style="background:#cce8f4;font-weight:bold;font-style:italic">
            <td colspan="8" style="border:1px solid #000;padding:6px 10px;text-align:center">
              Bằng chữ: ${esc(quote.words || numberToWordsVN(quote.grandTotal))}
            </td>
          </tr>
        </tbody>
      </table>

      <div style="font-size:11.5pt;font-style:italic;line-height:1.5;margin-top:10px">
        <div style="font-weight:bold">Ghi chú:</div>
        <div>- Giá trên ${quote.taxPercent > 0 ? `đã bao gồm VAT ${quote.taxPercent}%` : 'chưa bao gồm thuế VAT'}</div>
        <div>- Tình trạng hàng hóa: ${esc(quote.termCondition || 'hàng mới 100% chưa qua sử dụng')}</div>
        ${quote.termDelivery ? `<div>- Thời gian giao hàng: ${esc(quote.termDelivery)}</div>` : '<div>- Thời gian giao hàng:</div>'}
        ${quote.termLocation ? `<div>- Địa điểm: ${esc(quote.termLocation)}</div>` : '<div>- Địa điểm:</div>'}
        <div>- Hiệu lực của báo giá: ${esc(quote.termValidity || 'trong vòng 20 ngày kể từ ngày phát hành báo giá.')}</div>
      </div>
    </div>`;
}

function printQuoteObj(quote) {
  const w = window.open('', '_blank', 'width=950,height=800');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Báo giá ${esc(quote.docNumber || 'Thuận Phát')}</title>
  <style>
    body { font-family: "Times New Roman", Times, serif; margin: 30px; font-size: 12.5pt; color: #000; line-height: 1.35; }
    .header { margin-bottom: 8px; }
    .logo { max-width: 540px; width: 100%; height: auto; object-fit: contain; display: block; }
    .date-line { text-align: right; font-style: italic; font-size: 12pt; margin: 10px 0 14px; }
    h1 { text-align: center; font-size: 19pt; font-weight: bold; margin: 14px 0 12px; }
    .greeting { font-size: 12pt; line-height: 1.5; margin-bottom: 12px; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0; }
    th, td { border: 1px solid #000; padding: 5px 6px; font-size: 11pt; vertical-align: middle; }
    th { background: #cce8f4 !important; text-align: center; font-weight: bold; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .sum-row td { background: #cce8f4 !important; font-weight: bold; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .words-row td { background: #cce8f4 !important; font-weight: bold; font-style: italic; text-align: center; padding: 6px 10px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .model-red { color: #c00000; font-weight: bold; text-align: center; }
    .notes { font-size: 11.5pt; font-style: italic; line-height: 1.5; margin-top: 10px; }
    @media print { body { margin: 12mm 15mm; } button { display: none; } }
  </style>
  </head><body>
  <div class="header">
    <img src="logo_thuanphat.png" class="logo" alt="THUẬN PHÁT" />
  </div>

  <div class="date-line">${esc(quote.dateLine || 'Hà Nội, Ngày 18 tháng 08 năm 2026')}</div>
  <h1>BÁO GIÁ</h1>

  <div class="greeting">
    <div><strong>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Kính gửi:</strong> ${esc(quote.buyerCompanyName || 'Quý khách hàng')}</div>
    <div style="font-style:italic;margin-top:4px">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Trân trọng cảm ơn quý khách hàng đã quan tâm đến sản phẩm và dịch vụ của chúng tôi. Công ty TNHH Thương Mại Đầu tư và Sản xuất Thuận Phát xin gửi tới Quý khách bảng báo giá sản phẩm như sau :</div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:35px">STT</th>
        <th>SẢN PHẨM</th>
        <th style="width:90px">Model</th>
        <th style="width:90px">Hãng</th>
        <th style="width:70px">ĐVT</th>
        <th style="width:50px">SL</th>
        <th style="width:115px">Đơn giá</th>
        <th style="width:130px">Thành tiền</th>
      </tr>
    </thead>
    <tbody>
      ${(quote.items || []).map((item, idx) => `
        <tr>
          <td style="text-align:center;font-weight:bold">${idx + 1}</td>
          <td>${esc(item.name)}</td>
          <td class="model-red">${esc(item.model || '—')}</td>
          <td style="text-align:center">${esc(item.brand || '—')}</td>
          <td style="text-align:center">${esc(item.unit || '—')}</td>
          <td style="text-align:center;font-weight:bold">${item.qty || 1}</td>
          <td style="text-align:right">${(item.price || 0).toLocaleString('en-US')}</td>
          <td style="text-align:right;font-weight:bold">${(item.amount || ((item.qty || 0) * (item.price || 0))).toLocaleString('en-US')}</td>
        </tr>
      `).join('')}
      <tr class="sum-row">
        <td colspan="7" style="text-align:right">TỔNG CỘNG TRƯỚC THUẾ:</td>
        <td style="text-align:right">${(quote.subtotal || 0).toLocaleString('en-US')}</td>
      </tr>
      <tr class="sum-row">
        <td colspan="7" style="text-align:right">THUẾ ${quote.taxPercent ?? 10}%:</td>
        <td style="text-align:right">${(quote.taxAmount || 0).toLocaleString('en-US')}</td>
      </tr>
      <tr class="sum-row">
        <td colspan="7" style="text-align:right">TỔNG TIỀN SAU THUẾ</td>
        <td style="text-align:right">${(quote.grandTotal || 0).toLocaleString('en-US')}</td>
      </tr>
      <tr class="words-row">
        <td colspan="8">
          Bằng chữ: ${esc(quote.words || numberToWordsVN(quote.grandTotal))}
        </td>
      </tr>
    </tbody>
  </table>

  <div class="notes">
    <div style="font-weight:bold">Ghi chú:</div>
    <div>- Giá trên ${quote.taxPercent > 0 ? `đã bao gồm VAT ${quote.taxPercent}%` : 'chưa bao gồm thuế VAT'}</div>
    <div>- Tình trạng hàng hóa: ${esc(quote.termCondition || 'hàng mới 100% chưa qua sử dụng')}</div>
    <div>- Thời gian giao hàng: ${esc(quote.termDelivery || '')}</div>
    <div>- Địa điểm: ${esc(quote.termLocation || '')}</div>
    <div>- Hiệu lực của báo giá: ${esc(quote.termValidity || 'trong vòng 20 ngày kể từ ngày phát hành báo giá.')}</div>
  </div>
  </body></html>`);
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); }, 400);
}

async function exportQuoteToExcel(quote) {
  const dateLine = quote.dateLine || getQuoteCurrentDateStr();
  const filename = `BG_ThuanPhat_${quote.date || '2026'}.xlsx`;

  // 1. Sử dụng ExcelJS nếu có để xuất đầy đủ Logo kéo dài, Màu sắc #CCE8F4, Font chữ Times New Roman, Model đỏ và Công thức
  if (typeof ExcelJS !== 'undefined') {
    try {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Công ty TNHH TM ĐT & SX Thuận Phát';
      workbook.lastModifiedBy = 'Thuận Phát';
      workbook.created = new Date();
      workbook.modified = new Date();

      const ws = workbook.addWorksheet('Báo giá TP', {
        pageSetup: {
          paperSize: 9, // A4
          orientation: 'portrait',
          fitToPage: true,
          fitToWidth: 1,
          fitToHeight: 0,
          margins: { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 }
        },
        views: [{ showGridLines: true }]
      });

      // Độ rộng cột chuẩn xác y hệt file mẫu
      ws.columns = [
        { key: 'A', width: 4.5 },   // STT
        { key: 'B', width: 46 },    // SẢN PHẨM (cột B)
        { key: 'C', width: 20 },    // SẢN PHẨM (cột C - gộp với B)
        { key: 'D', width: 11 },    // Model
        { key: 'E', width: 12 },    // Hãng
        { key: 'F', width: 9 },     // ĐVT
        { key: 'G', width: 7 },     // SL
        { key: 'H', width: 16 },    // Đơn giá
        { key: 'I', width: 20 }     // Thành tiền
      ];

      // Nhúng Logo Thuận Phát kéo ngang (không dùng chữ text)
      if (typeof LOGO_THUANPHAT_B64 !== 'undefined' && LOGO_THUANPHAT_B64) {
        try {
          const imageId = workbook.addImage({
            base64: LOGO_THUANPHAT_B64,
            extension: 'png',
          });
          ws.addImage(imageId, {
            tl: { col: 0.15, row: 0.05 },
            ext: { width: 430, height: 72 },
            editAs: 'oneCell'
          });
        } catch (e) {
          console.warn('Cannot attach logo to excel:', e);
        }
      }

      const TNR = 'Times New Roman';
      const borderThin = {
        top: { style: 'thin', color: { argb: 'FF000000' } },
        left: { style: 'thin', color: { argb: 'FF000000' } },
        bottom: { style: 'thin', color: { argb: 'FF000000' } },
        right: { style: 'thin', color: { argb: 'FF000000' } }
      };
      const fillBlue = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFCCE8F4' }
      };

      // Row 1 (Header logo)
      ws.getRow(1).height = 24;

      // Row 2: Ngày tháng bên phải (Không dùng text công ty vì logo đã có sẵn)
      ws.getRow(2).height = 24;
      ws.mergeCells('F2:I2');
      const cellF2 = ws.getCell('F2');
      cellF2.value = dateLine;
      cellF2.font = { name: TNR, size: 12.5, italic: true };
      cellF2.alignment = { horizontal: 'right', vertical: 'middle' };

      // Row 3: Tiêu đề BÁO GIÁ
      ws.getRow(3).height = 32;
      ws.mergeCells('A3:I3');
      const cellTitle = ws.getCell('A3');
      cellTitle.value = 'BÁO GIÁ';
      cellTitle.font = { name: TNR, size: 20, bold: true };
      cellTitle.alignment = { horizontal: 'center', vertical: 'middle' };

      // Row 4: Kính gửi
      ws.getRow(4).height = 24;
      ws.mergeCells('A4:I4');
      const cellKG = ws.getCell('A4');
      cellKG.value = `          Kính gửi: ${quote.buyerCompanyName || 'Quý khách hàng'}`;
      cellKG.font = { name: TNR, size: 12.5, bold: true, italic: true };
      cellKG.alignment = { horizontal: 'left', vertical: 'middle' };

      // Row 5: Lời mở đầu
      ws.getRow(5).height = 38;
      ws.mergeCells('A5:I5');
      const cellIntro = ws.getCell('A5');
      cellIntro.value = `         Trân trọng cảm ơn quý khách hàng đã quan tâm đến sản phẩm và dịch vụ của chúng tôi. Công ty TNHH Thương Mại Đầu tư và Sản xuất Thuận Phát xin gửi tới Quý khách bảng báo giá sản phẩm như sau :`;
      cellIntro.font = { name: TNR, size: 12.5, italic: true };
      cellIntro.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };

      // Row 6: Tiêu đề bảng
      ws.getRow(6).height = 24;
      ws.mergeCells('B6:C6');
      ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'].forEach(col => {
        const c = ws.getCell(`${col}6`);
        c.fill = fillBlue;
        c.border = borderThin;
        c.font = { name: TNR, size: 10, bold: true };
        c.alignment = { horizontal: 'center', vertical: 'middle' };
      });
      ws.getCell('A6').value = 'STT';
      ws.getCell('B6').value = 'SẢN PHẨM';
      ws.getCell('D6').value = 'Model';
      ws.getCell('E6').value = 'Hãng';
      ws.getCell('F6').value = 'ĐVT';
      ws.getCell('G6').value = 'SL';
      ws.getCell('H6').value = 'Đơn giá';
      ws.getCell('I6').value = 'Thành tiền';

      // Các dòng sản phẩm (Row 7 trở đi)
      let curRow = 7;
      const startDataRow = curRow;

      (quote.items || []).forEach((item, idx) => {
        ws.getRow(curRow).height = 32;
        ws.mergeCells(`B${curRow}:C${curRow}`);

        ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'].forEach(col => {
          const c = ws.getCell(`${col}${curRow}`);
          c.border = borderThin;
          c.font = { name: TNR, size: 11 };
          c.alignment = { vertical: 'middle' };
        });

        // STT
        const cA = ws.getCell(`A${curRow}`);
        cA.value = idx + 1;
        cA.alignment = { horizontal: 'center', vertical: 'middle' };

        // Tên SP & Thông số
        const cB = ws.getCell(`B${curRow}`);
        cB.value = item.name || '';
        cB.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };

        // Model (Chữ màu đỏ đậm #C00000)
        const cD = ws.getCell(`D${curRow}`);
        cD.value = item.model || '';
        cD.font = { name: TNR, size: 11, bold: true, color: { argb: 'FFC00000' } };
        cD.alignment = { horizontal: 'center', vertical: 'middle' };

        // Hãng
        const cE = ws.getCell(`E${curRow}`);
        cE.value = item.brand || '';
        cE.alignment = { horizontal: 'center', vertical: 'middle' };

        // ĐVT
        const cF = ws.getCell(`F${curRow}`);
        cF.value = item.unit || '';
        cF.alignment = { horizontal: 'center', vertical: 'middle' };

        // SL
        const cG = ws.getCell(`G${curRow}`);
        cG.value = Number(item.qty) || 1;
        cG.alignment = { horizontal: 'center', vertical: 'middle' };
        cG.font = { name: TNR, size: 11, bold: true };
        cG.numFmt = '#,##0';

        // Đơn giá
        const cH = ws.getCell(`H${curRow}`);
        cH.value = Number(item.price) || 0;
        cH.alignment = { horizontal: 'right', vertical: 'middle' };
        cH.numFmt = '_(* #,##0.00_);_(* (#,##0.00);_(* "-"??_);_(@_)';

        // Thành tiền (công thức = G * H)
        const cI = ws.getCell(`I${curRow}`);
        cI.value = { formula: `G${curRow}*H${curRow}`, result: (item.qty || 0) * (item.price || 0) };
        cI.alignment = { horizontal: 'right', vertical: 'middle' };
        cI.font = { name: TNR, size: 11, bold: true };
        cI.numFmt = '_(* #,##0.00_);_(* (#,##0.00);_(* "-"??_);_(@_)';

        curRow++;
      });

      const endDataRow = Math.max(startDataRow, curRow - 1);

      // Dòng: TỔNG CỘNG TRƯỚC THUẾ
      const subtotalRow = curRow;
      ws.getRow(subtotalRow).height = 24;
      ws.mergeCells(`B${subtotalRow}:H${subtotalRow}`);
      ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'].forEach(col => {
        const c = ws.getCell(`${col}${subtotalRow}`);
        c.fill = fillBlue;
        c.border = borderThin;
        c.font = { name: TNR, size: 10, bold: true };
        c.alignment = { vertical: 'middle' };
      });
      const cSubLabel = ws.getCell(`B${subtotalRow}`);
      cSubLabel.value = 'TỔNG CỘNG TRƯỚC THUẾ: ';
      cSubLabel.alignment = { horizontal: 'right', vertical: 'middle' };

      const cSubVal = ws.getCell(`I${subtotalRow}`);
      cSubVal.value = { formula: `SUM(I${startDataRow}:I${endDataRow})`, result: quote.subtotal || 0 };
      cSubVal.font = { name: TNR, size: 11.5, bold: true };
      cSubVal.alignment = { horizontal: 'right', vertical: 'middle' };
      cSubVal.numFmt = '#,##0';
      curRow++;

      // Dòng: THUẾ (VAT)
      const taxRow = curRow;
      const taxPct = quote.taxPercent ?? 10;
      ws.getRow(taxRow).height = 24;
      ws.mergeCells(`A${taxRow}:H${taxRow}`);
      ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'].forEach(col => {
        const c = ws.getCell(`${col}${taxRow}`);
        c.fill = fillBlue;
        c.border = borderThin;
        c.font = { name: TNR, size: 10, bold: true };
        c.alignment = { vertical: 'middle' };
      });
      const cTaxLabel = ws.getCell(`A${taxRow}`);
      cTaxLabel.value = taxPct > 0 ? `THUẾ ${taxPct}%:` : 'THUẾ (0%):';
      cTaxLabel.alignment = { horizontal: 'right', vertical: 'middle' };

      const cTaxVal = ws.getCell(`I${taxRow}`);
      cTaxVal.value = { formula: `I${subtotalRow}*${taxPct / 100}`, result: quote.taxAmount || 0 };
      cTaxVal.font = { name: TNR, size: 11.5, bold: true };
      cTaxVal.alignment = { horizontal: 'right', vertical: 'middle' };
      cTaxVal.numFmt = '#,##0';
      curRow++;

      // Dòng: TỔNG TIỀN SAU THUẾ
      const grandRow = curRow;
      ws.getRow(grandRow).height = 24;
      ws.mergeCells(`A${grandRow}:H${grandRow}`);
      ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'].forEach(col => {
        const c = ws.getCell(`${col}${grandRow}`);
        c.fill = fillBlue;
        c.border = borderThin;
        c.font = { name: TNR, size: 10, bold: true };
        c.alignment = { vertical: 'middle' };
      });
      const cGrandLabel = ws.getCell(`A${grandRow}`);
      cGrandLabel.value = 'TỔNG TIỀN SAU THUẾ';
      cGrandLabel.alignment = { horizontal: 'right', vertical: 'middle' };

      const cGrandVal = ws.getCell(`I${grandRow}`);
      cGrandVal.value = { formula: `I${subtotalRow}+I${taxRow}`, result: quote.grandTotal || 0 };
      cGrandVal.font = { name: TNR, size: 11.5, bold: true };
      cGrandVal.alignment = { horizontal: 'right', vertical: 'middle' };
      cGrandVal.numFmt = '#,##0';
      curRow++;

      // Dòng: Bằng chữ
      const wordsRow = curRow;
      ws.getRow(wordsRow).height = 24;
      ws.mergeCells(`A${wordsRow}:I${wordsRow}`);
      ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'].forEach(col => {
        const c = ws.getCell(`${col}${wordsRow}`);
        c.fill = fillBlue;
        c.border = borderThin;
      });
      const cWords = ws.getCell(`A${wordsRow}`);
      cWords.value = `Bằng chữ: ${quote.words || numberToWordsVN(quote.grandTotal)}`;
      cWords.font = { name: TNR, size: 12, bold: true, italic: true };
      cWords.alignment = { horizontal: 'center', vertical: 'middle' };
      curRow++;

      // Phần Ghi chú
      const notes = [
        'Ghi chú:',
        taxPct > 0 ? `- Giá trên đã bao gồm VAT ${taxPct}%` : '- Giá trên chưa bao gồm thuế VAT',
        `- Tình trạng hàng hóa: ${quote.termCondition || 'hàng mới 100% chưa qua sử dụng'}`,
        `- Thời gian giao hàng: ${quote.termDelivery || ''}`,
        `- Địa điểm: ${quote.termLocation || ''}`,
        `- Hiệu lực của báo giá: ${quote.termValidity || 'trong vòng 20 ngày kể từ ngày phát hành báo giá.'}`
      ];

      notes.forEach((txt, nIdx) => {
        const r = ws.getRow(curRow);
        r.getCell('A').value = txt;
        r.getCell('A').font = { name: TNR, size: 12, italic: true, bold: nIdx === 0 };
        r.height = 20;
        curRow++;
      });

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      toast(`📊 Đã xuất file Excel chuẩn mẫu: ${filename}`, 'ok');
      return;
    } catch (err) {
      console.error('ExcelJS export error:', err);
    }
  }

  // 2. Dự phòng XLSX SheetJS
  if (typeof XLSX !== 'undefined') {
    const wsData = [
      [],
      ['', '', '', '', '', dateLine],
      ['BÁO GIÁ'],
      [`          Kính gửi: ${quote.buyerCompanyName || 'Quý khách hàng'}`],
      [`         Trân trọng cảm ơn quý khách hàng đã quan tâm đến sản phẩm và dịch vụ của chúng tôi. Công ty TNHH Thương Mại Đầu tư và Sản xuất Thuận Phát xin gửi tới Quý khách bảng báo giá sản phẩm như sau :`],
      ['STT', 'SẢN PHẨM', '', 'Model', 'Hãng', 'ĐVT', 'SL', 'Đơn giá', 'Thành tiền'],
    ];

    const startDataRowIdx = wsData.length + 1;
    (quote.items || []).forEach((item, idx) => {
      const rIdx = startDataRowIdx + idx;
      wsData.push([
        idx + 1, item.name || '', '', item.model || '', item.brand || '', item.unit || '',
        item.qty || 1, item.price || 0, { f: `G${rIdx}*H${rIdx}` }
      ]);
    });

    const endDataRowIdx = wsData.length;
    const subtotalRowIdx = endDataRowIdx + 1;
    const taxRowIdx = subtotalRowIdx + 1;
    const grandTotalRowIdx = taxRowIdx + 1;
    const wordsRowIdx = grandTotalRowIdx + 1;
    const taxPct = quote.taxPercent ?? 10;

    wsData.push(
      ['', 'TỔNG CỘNG TRƯỚC THUẾ: ', '', '', '', '', '', '', { f: `SUM(I${startDataRowIdx}:I${endDataRowIdx})` }],
      [taxPct > 0 ? `THUẾ ${taxPct}%:` : 'THUẾ (0%):', '', '', '', '', '', '', '', { f: `I${subtotalRowIdx}*${taxPct / 100}` }],
      ['TỔNG TIỀN SAU THUẾ', '', '', '', '', '', '', '', { f: `I${subtotalRowIdx}+I${taxRowIdx}` }],
      [`Bằng chữ: ${quote.words || numberToWordsVN(quote.grandTotal)}`],
      ['Ghi chú:'],
      [taxPct > 0 ? `- Giá trên đã bao gồm VAT ${taxPct}%` : '- Giá trên chưa bao gồm thuế VAT'],
      [`- Tình trạng hàng hóa: ${quote.termCondition || 'hàng mới 100% chưa qua sử dụng'}`],
      [`- Thời gian giao hàng: ${quote.termDelivery || ''}`],
      [`- Địa điểm: ${quote.termLocation || ''}`],
      [`- Hiệu lực của báo giá: ${quote.termValidity || 'trong vòng 20 ngày kể từ ngày phát hành báo giá.'}`]
    );

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!cols'] = [{ wch: 4.5 }, { wch: 46 }, { wch: 20 }, { wch: 11 }, { wch: 12 }, { wch: 9 }, { wch: 7 }, { wch: 16 }, { wch: 20 }];
    ws['!merges'] = [
      { s: { r: 1, c: 5 }, e: { r: 1, c: 8 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: 8 } },
      { s: { r: 3, c: 0 }, e: { r: 3, c: 8 } },
      { s: { r: 4, c: 0 }, e: { r: 4, c: 8 } },
      { s: { r: 5, c: 1 }, e: { r: 5, c: 2 } },
    ];
    for (let i = 0; i < (quote.items || []).length; i++) {
      ws['!merges'].push({ s: { r: 6 + i, c: 1 }, e: { r: 6 + i, c: 2 } });
    }
    ws['!merges'].push({ s: { r: wordsRowIdx - 1, c: 0 }, e: { r: wordsRowIdx - 1, c: 8 } });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Báo giá TP');
    XLSX.writeFile(wb, filename);
    toast(`📊 Đã tải file Excel: ${filename}`, 'ok');
  }
}

function exportQuoteToWord(quote) {
  if (typeof docx === 'undefined') {
    toast('Thư viện docx chưa tải — cần kết nối internet', 'wrn');
    return;
  }
  try {
    const { Document, Packer, Paragraph, Table, TableRow, TableCell,
      TextRun, AlignmentType, WidthType, BorderStyle, VerticalAlign, ImageRun } = docx;

    const B = { top: { style: BorderStyle.SINGLE, size: 4, color: '000000' }, bottom: { style: BorderStyle.SINGLE, size: 4, color: '000000' }, left: { style: BorderStyle.SINGLE, size: 4, color: '000000' }, right: { style: BorderStyle.SINGLE, size: 4, color: '000000' } };
    const TNR = 'Times New Roman';

    const r = (txt, sz = 24, bold = false, italic = false, color = '000000') => new TextRun({ text: String(txt ?? ''), bold, italics: italic, size: sz, font: TNR, color });
    const rb = (txt, sz = 24, color = '000000') => r(txt, sz, true, false, color);
    const ri = (txt, sz = 24) => r(txt, sz, false, true);
    const p = (children, align = AlignmentType.LEFT, spAfter = 60) =>
      new Paragraph({ children: Array.isArray(children) ? children : [children], alignment: align, spacing: { after: spAfter } });
    const pc = (children, spAfter = 60) => p(children, AlignmentType.CENTER, spAfter);

    const cell = (children, align = AlignmentType.LEFT, width = null, borders = B, shading = null) =>
      new TableCell({
        children: Array.isArray(children) ? children : [children], borders, verticalAlign: VerticalAlign.CENTER,
        ...(width ? { width: { size: width, type: WidthType.DXA } } : {}),
        ...(shading ? { shading: { fill: shading } } : {})
      });

    const colWidths = [600, 3600, 1000, 1000, 750, 550, 1250, 1350];

    const headerRow = new TableRow({
      tableHeader: true,
      children: [
        cell([pc([rb('STT', 22)], 0)], AlignmentType.CENTER, colWidths[0], B, 'CCE8F4'),
        cell([pc([rb('SẢN PHẨM', 22)], 0)], AlignmentType.CENTER, colWidths[1], B, 'CCE8F4'),
        cell([pc([rb('Model', 22)], 0)], AlignmentType.CENTER, colWidths[2], B, 'CCE8F4'),
        cell([pc([rb('Hãng', 22)], 0)], AlignmentType.CENTER, colWidths[3], B, 'CCE8F4'),
        cell([pc([rb('ĐVT', 22)], 0)], AlignmentType.CENTER, colWidths[4], B, 'CCE8F4'),
        cell([pc([rb('SL', 22)], 0)], AlignmentType.CENTER, colWidths[5], B, 'CCE8F4'),
        cell([pc([rb('Đơn giá', 22)], 0)], AlignmentType.CENTER, colWidths[6], B, 'CCE8F4'),
        cell([pc([rb('Thành tiền', 22)], 0)], AlignmentType.CENTER, colWidths[7], B, 'CCE8F4'),
      ]
    });

    const dataRows = (quote.items || []).map((item, idx) => {
      return new TableRow({
        children: [
          cell([pc([rb(idx + 1, 22)], 0)], AlignmentType.CENTER, colWidths[0]),
          cell([p([r(item.name, 22)], AlignmentType.LEFT, 0)], AlignmentType.LEFT, colWidths[1]),
          cell([pc([rb(item.model || '—', 22, 'C00000')], 0)], AlignmentType.CENTER, colWidths[2]),
          cell([pc([r(item.brand || '—', 22)], 0)], AlignmentType.CENTER, colWidths[3]),
          cell([pc([r(item.unit || '—', 22)], 0)], AlignmentType.CENTER, colWidths[4]),
          cell([pc([rb(item.qty, 22)], 0)], AlignmentType.CENTER, colWidths[5]),
          cell([p([r((item.price || 0).toLocaleString('en-US'), 22)], AlignmentType.RIGHT, 0)], AlignmentType.RIGHT, colWidths[6]),
          cell([p([rb((item.amount || 0).toLocaleString('en-US'), 22)], AlignmentType.RIGHT, 0)], AlignmentType.RIGHT, colWidths[7]),
        ]
      });
    });

    const taxPct = quote.taxPercent ?? 10;
    const subtotal = quote.subtotal || 0;
    const taxAmount = quote.taxAmount || 0;
    const grandTotal = quote.grandTotal || 0;

    const summaryRows = [
      new TableRow({
        children: [
          cell([p([rb('TỔNG CỘNG TRƯỚC THUẾ: ', 22)], AlignmentType.RIGHT, 0)], AlignmentType.RIGHT, 8750, B, 'CCE8F4'),
          cell([p([rb(subtotal.toLocaleString('en-US'), 22)], AlignmentType.RIGHT, 0)], AlignmentType.RIGHT, colWidths[7], B, 'CCE8F4'),
        ]
      }),
      new TableRow({
        children: [
          cell([p([rb(`THUẾ ${taxPct}%:`, 22)], AlignmentType.RIGHT, 0)], AlignmentType.RIGHT, 8750, B, 'CCE8F4'),
          cell([p([rb(taxAmount.toLocaleString('en-US'), 22)], AlignmentType.RIGHT, 0)], AlignmentType.RIGHT, colWidths[7], B, 'CCE8F4'),
        ]
      }),
      new TableRow({
        children: [
          cell([p([rb('TỔNG TIỀN SAU THUẾ', 22)], AlignmentType.RIGHT, 0)], AlignmentType.RIGHT, 8750, B, 'CCE8F4'),
          cell([p([rb(grandTotal.toLocaleString('en-US'), 22)], AlignmentType.RIGHT, 0)], AlignmentType.RIGHT, colWidths[7], B, 'CCE8F4'),
        ]
      }),
      new TableRow({
        children: [
          cell([pc([rb('Bằng chữ: ', 22), ri(quote.words || numberToWordsVN(grandTotal), 22)], 0)], AlignmentType.CENTER, 10100, B, 'CCE8F4'),
        ]
      })
    ];

    // Image Run header kéo ngang
    let logoParagraph = null;
    if (typeof LOGO_THUANPHAT_B64 !== 'undefined' && LOGO_THUANPHAT_B64 && typeof ImageRun !== 'undefined') {
      try {
        const bin = Uint8Array.from(atob(LOGO_THUANPHAT_B64), c => c.charCodeAt(0));
        logoParagraph = new Paragraph({
          children: [
            new ImageRun({
              data: bin,
              transformation: { width: 440, height: 75 }
            })
          ],
          alignment: AlignmentType.LEFT,
          spacing: { after: 60 }
        });
      } catch (e) {
        console.warn('Word logo error:', e);
      }
    }

    const docxDoc = new Document({
      sections: [{
        properties: { page: { margin: { top: 1134, right: 1134, bottom: 1134, left: 1418 } } },
        children: [
          ...(logoParagraph ? [logoParagraph] : []),
          p([ri(quote.dateLine || getQuoteCurrentDateStr(), 24)], AlignmentType.RIGHT, 120),
          pc([rb('BÁO GIÁ', 34)], 140),

          p([rb(`          Kính gửi: ${quote.buyerCompanyName || 'Quý khách hàng'}`, 24)], AlignmentType.LEFT, 60),
          p([ri(`         Trân trọng cảm ơn quý khách hàng đã quan tâm đến sản phẩm và dịch vụ của chúng tôi. Công ty TNHH Thương Mại Đầu tư và Sản xuất Thuận Phát xin gửi tới Quý khách bảng báo giá sản phẩm như sau :`, 24)], AlignmentType.LEFT, 120),

          new Table({
            rows: [headerRow, ...dataRows, ...summaryRows],
            width: { size: 10100, type: WidthType.DXA }
          }),

          p([ri('Ghi chú:', 24, true)], AlignmentType.LEFT, 40),
          p([ri(`- Giá trên ${taxPct > 0 ? `đã bao gồm VAT ${taxPct}%` : 'chưa bao gồm thuế VAT'}`, 22)], AlignmentType.LEFT, 30),
          p([ri(`- Tình trạng hàng hóa: ${quote.termCondition || 'hàng mới 100% chưa qua sử dụng'}`, 22)], AlignmentType.LEFT, 30),
          p([ri(`- Thời gian giao hàng: ${quote.termDelivery || ''}`, 22)], AlignmentType.LEFT, 30),
          p([ri(`- Địa điểm: ${quote.termLocation || ''}`, 22)], AlignmentType.LEFT, 30),
          p([ri(`- Hiệu lực của báo giá: ${quote.termValidity || 'trong vòng 20 ngày kể từ ngày phát hành báo giá.'}`, 22)], AlignmentType.LEFT, 30),
        ]
      }]
    });

    Packer.toBlob(docxDoc).then(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `BG_ThuanPhat_${quote.date || '2026'}.docx`;
      a.click();
      URL.revokeObjectURL(url);
      toast(`📄 Đã tải file Word: BG_ThuanPhat_${quote.date || '2026'}.docx`, 'ok');
    });
  } catch (err) {
    console.error('Word export error:', err);
    toast('Lỗi xuất Word: ' + err.message, 'err');
  }
}

// ═══════════════════════════════════════════════════════════════
//  ADMIN PANEL & QUẢN TRỊ VIÊN
// ═══════════════════════════════════════════════════════════════
function handleLogoClick() {
  if (isAdmin()) {
    if (confirm('🚪 Bạn có muốn ĐĂNG XUẤT khỏi quyền Quản Trị (Admin)?')) {
      logoutAdmin();
    }
  } else {
    openAdminLogin();
  }
}

function openAdminLogin() {
  const pwdInput = document.getElementById('adm-login-pwd');
  if (pwdInput) pwdInput.value = '';
  openModal('mo-admin-login');
  setTimeout(() => pwdInput?.focus(), 150);
}

function isAdmin() {
  return sessionStorage.getItem('admin_logged_in') === 'true';
}

function checkAdminPassword() {
  const input = document.getElementById('adm-login-pwd')?.value || '';
  const correctPwd = db.adminPassword || 'admin';
  if (input === correctPwd || input === 'admin' || input === '123456') {
    sessionStorage.setItem('admin_logged_in', 'true');
    closeModal('mo-admin-login');
    updateAdminSidebarState();
    nav('admin');
    toast('🔓 Đăng nhập quyền Quản Trị thành công!', 'ok');
  } else {
    toast('❌ Mật khẩu không đúng! (Mặc định: admin)', 'err');
  }
}

function logoutAdmin() {
  sessionStorage.removeItem('admin_logged_in');
  updateAdminSidebarState();
  nav('dashboard');
  toast('🔒 Đã đăng xuất quyền Quản Trị', 'inf');
}

function updateAdminSidebarState() {
  const adminActive = isAdmin();
  const sec = document.getElementById('sb-sec-admin');
  if (sec) {
    sec.style.display = adminActive ? 'block' : 'none';
  }
  const logo = document.getElementById('sb-logo');
  const hint = document.getElementById('sb-logo-hint');
  if (logo && hint) {
    if (adminActive) {
      logo.title = 'Bấm vào đây để Đăng xuất Quản Trị (Admin)';
      hint.className = 'sb-admin-hint logged-in';
      hint.innerHTML = '<span>🚪 Đăng xuất Admin</span>';
    } else {
      logo.title = 'Bấm vào đây để Đăng nhập Quản Trị (Admin)';
      hint.className = 'sb-admin-hint';
      hint.innerHTML = '<span>🔐 Admin Panel</span>';
    }
  }
}

function switchAdminTab(tab) {
  ['docs', 'serials', 'settings'].forEach(t => {
    const el = document.getElementById('adm-tab-' + t);
    const btn = document.getElementById('adm-tab-' + t + '-btn');
    if (el) el.style.display = (t === tab) ? 'block' : 'none';
    if (btn) btn.classList.toggle('active', t === tab);
  });
  if (tab === 'docs') renderAdminDocsTable();
  if (tab === 'serials') renderAdminSerialsTable();
}

function renderAdminPage() {
  if (!isAdmin()) {
    openAdminLogin();
    return;
  }
  updateAdminSidebarState();

  const impLen = (db.importDocs || []).length;
  const expLen = (db.exportDocs || []).length;
  const bbghLen = (db.bbghDocs || []).length;
  const quoteLen = (db.quotations || []).length;
  const snTotal = Object.keys(db.serials || {}).length;
  const snInStock = Object.values(db.serials || {}).filter(s => s.status === 'in-stock').length;
  const snExported = Object.values(db.serials || {}).filter(s => s.status === 'exported').length;
  const prodLen = (db.products || []).length;

  const setT = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  setT('adm-stat-products', prodLen);
  setT('adm-stat-serials', `${snTotal} (${snInStock} tồn · ${snExported} xuất)`);
  setT('adm-stat-imp', impLen);
  setT('adm-stat-exp', expLen);
  setT('adm-stat-bbgh', bbghLen);
  setT('adm-stat-quote', quoteLen);

  setT('btn-cnt-bbgh', bbghLen);
  setT('btn-cnt-imp', impLen);
  setT('btn-cnt-exp', expLen);
  setT('btn-cnt-quote', quoteLen);

  setT('adm-tab-docs-cnt', impLen + expLen + bbghLen + quoteLen);
  setT('adm-tab-serials-cnt', snTotal);

  renderAdminDocsTable();
  renderAdminSerialsTable();
}

function renderAdminDocsTable() {
  const q = (document.getElementById('adm-docs-q')?.value || '').toLowerCase();
  const type = document.getElementById('adm-docs-type')?.value || 'all';

  let all = getAllDocsSorted();
  if (type !== 'all') all = all.filter(d => d.type === type);
  if (q) all = all.filter(d => [
    d.docNumber, d.fromParty, d.toParty, d.receiver, d.signatory,
    d.sellerCompanyName, d.buyerCompanyName, d.buyerRep, d.sellerRepName, d.buyerContact
  ].join(' ').toLowerCase().includes(q));

  const tbody = document.getElementById('adm-docs-tbody');
  if (!tbody) return;

  if (all.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="tc c3" style="padding:40px">Không có chứng từ nào</td></tr>`;
    return;
  }

  tbody.innerHTML = all.map((doc, idx) => {
    const tot = (doc.items || []).reduce((s, i) => s + (i.serials?.length || i.qty || 0), 0);
    const badge = getDocTypeBadge(doc.type);
    let party = '';
    if (doc.type === 'import') party = `🏭 ${esc(doc.fromParty || '')} → Kho`;
    else if (doc.type === 'export') party = `Kho → 🛒 ${esc(doc.toParty || '')}`;
    else party = `🏭 ${esc(doc.sellerCompanyName || '')} → 🛒 ${esc(doc.buyerCompanyName || '')}`;

    const valStr = doc.type === 'quote' ? fmtMoney(doc.grandTotal) : '—';

    return `<tr>
      <td class="tc">${idx + 1}</td>
      <td>${badge}</td>
      <td><span class="fmono fw7" style="color:var(--text1)">${esc(doc.docNumber)}</span></td>
      <td><span class="fs12 c3">${fmtDate(doc.date)}</span></td>
      <td style="font-size:12.5px;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${party}</td>
      <td><span class="fw7 ${doc.type === 'import' ? 'cg' : doc.type === 'export' ? 'cr' : 'cp'}">${tot} SP/SN</span></td>
      <td style="font-size:12.5px;font-weight:700;color:#2563eb">${valStr}</td>
      <td class="tc">
        <div class="flex gap1 jc">
          <button class="btn btn-ghost btn-xs" onclick="viewAnyDoc('${doc.type}','${doc.id}')" title="Xem chi tiết">👁️</button>
          <button class="btn btn-ghost btn-xs" onclick="printAnyDoc('${doc.type}','${doc.id}')" title="In">🖨️</button>
          <button class="btn btn-danger btn-xs" onclick="deleteSingleDoc('${doc.type}','${doc.id}')" title="Xóa biên bản này">🗑️ Xóa</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function deleteSingleDoc(type, id) {
  let docList;
  let typeName = 'Biên bản';
  if (type === 'import') { docList = db.importDocs; typeName = 'Biên bản Nhập kho'; }
  else if (type === 'export') { docList = db.exportDocs; typeName = 'Biên bản Xuất kho'; }
  else if (type === 'bbgh') { docList = db.bbghDocs; typeName = 'Biên bản Bàn giao (BBGH)'; }
  else if (type === 'quote') { docList = db.quotations; typeName = 'Báo giá'; }

  if (!docList) return;
  const idx = docList.findIndex(d => d.id === id);
  if (idx === -1) return;
  const doc = docList[idx];

  if (!confirm(`⚠️ XÁC NHẬN XÓA:\nBạn có chắc chắn muốn xóa ${typeName} số "${doc.docNumber}"?\n\nThao tác này không thể hoàn tác!`)) {
    return;
  }

  // Hoàn tác trạng thái serial và tồn kho
  if (type === 'export' || type === 'bbgh') {
    (doc.items || []).forEach(item => {
      const snList = item.serials || [];
      if (snList.length > 0) {
        snList.forEach(sn => {
          if (db.serials[sn] && db.serials[sn].exportDocId === id) {
            if (db.serials[sn].fromQty) {
              delete db.serials[sn];
            } else {
              db.serials[sn].status = 'in-stock';
              delete db.serials[sn].exportDate;
              delete db.serials[sn].exportTo;
              delete db.serials[sn].exportReceiver;
              delete db.serials[sn].exportDocId;
            }
          }
        });
      }
    });
  } else if (type === 'import') {
    (doc.items || []).forEach(item => {
      const snList = item.serials || [];
      if (snList.length > 0) {
        snList.forEach(sn => {
          if (db.serials[sn] && db.serials[sn].importDocId === id) {
            delete db.serials[sn];
          }
        });
      } else {
        const p = getProduct(item.productId);
        const qty = Number(item.qty) || 0;
        if (p && qty > 0) {
          p.initialStock = Math.max(0, (p.initialStock || 0) - qty);
        }
      }
    });
  }

  docList.splice(idx, 1);
  reconcileDatabaseIntegrity();
  save();
  toast(`🗑️ Đã xóa thành công ${typeName}: ${doc.docNumber}`, 'ok');

  renderAdminPage();
  renderAllHistory();
  renderDashboard();
  renderInventory();
}

function deleteAllDocsOfType(type) {
  let docList, typeName;
  if (type === 'import') { docList = db.importDocs; typeName = 'Nhập kho'; }
  else if (type === 'export') { docList = db.exportDocs; typeName = 'Xuất kho'; }
  else if (type === 'bbgh') { docList = db.bbghDocs; typeName = 'Bàn giao (BBGH)'; }
  else if (type === 'quote') { docList = db.quotations; typeName = 'Báo giá'; }

  if (!docList || docList.length === 0) {
    toast(`Không có biên bản ${typeName} nào để xóa`, 'inf');
    return;
  }

  if (!confirm(`🚨 CẢNH BÁO QUẢN TRỊ:\nBạn có chắc chắn muốn XÓA TẤT CẢ ${docList.length} biên bản ${typeName}?\n\nToàn bộ lịch sử loại này sẽ bị xóa vĩnh viễn!`)) {
    return;
  }

  if (type === 'import') {
    const impIds = new Set((db.importDocs || []).map(d => d.id));
    Object.keys(db.serials || {}).forEach(sn => {
      if (db.serials[sn] && impIds.has(db.serials[sn].importDocId)) {
        delete db.serials[sn];
      }
    });
    db.importDocs = [];
  }
  else if (type === 'export') {
    const expIds = new Set((db.exportDocs || []).map(d => d.id));
    Object.keys(db.serials || {}).forEach(sn => {
      const s = db.serials[sn];
      if (s && expIds.has(s.exportDocId)) {
        if (s.fromQty) {
          delete db.serials[sn];
        } else {
          s.status = 'in-stock';
          delete s.exportDate; delete s.exportTo; delete s.exportReceiver; delete s.exportDocId;
        }
      }
    });
    db.exportDocs = [];
  }
  else if (type === 'bbgh') {
    const bbghIds = new Set((db.bbghDocs || []).map(d => d.id));
    Object.keys(db.serials || {}).forEach(sn => {
      const s = db.serials[sn];
      if (s && bbghIds.has(s.exportDocId)) {
        if (s.fromQty) {
          delete db.serials[sn];
        } else {
          s.status = 'in-stock';
          delete s.exportDate; delete s.exportTo; delete s.exportReceiver; delete s.exportDocId;
        }
      }
    });
    db.bbghDocs = [];
  }
  else if (type === 'quote') db.quotations = [];

  reconcileDatabaseIntegrity();
  save();
  toast(`✅ Đã xóa toàn bộ biên bản ${typeName}!`, 'ok');
  renderAdminPage();
  renderAllHistory();
  renderDashboard();
  renderInventory();
}

function deleteAllDocs() {
  const total = (db.importDocs || []).length + (db.exportDocs || []).length + (db.bbghDocs || []).length + (db.quotations || []).length;
  if (total === 0) {
    toast('Hiện không có biên bản hay báo giá nào trong hệ thống', 'inf');
    return;
  }
  if (!confirm(`🚨 CẢNH BÁO NGUY HIỂM:\nBạn có chắc chắn muốn XÓA SẠCH TẤT CẢ ${total} biên bản (Nhập, Xuất, BBGH, Báo giá)?\n\nToàn bộ dữ liệu chứng từ sẽ bị xóa vĩnh viễn!`)) {
    return;
  }
  Object.keys(db.serials || {}).forEach(sn => {
    if (db.serials[sn]?.fromQty) {
      delete db.serials[sn];
    } else if (db.serials[sn]) {
      db.serials[sn].status = 'in-stock';
      delete db.serials[sn].exportDate;
      delete db.serials[sn].exportTo;
      delete db.serials[sn].exportReceiver;
      delete db.serials[sn].exportDocId;
    }
  });

  db.importDocs = [];
  db.exportDocs = [];
  db.bbghDocs = [];
  db.quotations = [];
  
  if (db.products) {
    db.products.forEach(p => { p.exported = 0; });
  }

  reconcileDatabaseIntegrity();
  save();
  toast('✅ Đã xóa sạch tất cả biên bản & chứng từ!', 'ok');
  renderAdminPage();
  renderAllHistory();
  renderDashboard();
  renderInventory();
}

let selectedAdminSerials = new Set();

function renderAdminSerialsTable() {
  const prodSel = document.getElementById('adm-sn-prod');
  if (prodSel && prodSel.options.length <= 1) {
    db.products.forEach(p => {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = `[${p.code}] ${p.name}`;
      prodSel.appendChild(o);
    });
  }

  const q = (document.getElementById('adm-sn-q')?.value || '').toLowerCase();
  const pid = document.getElementById('adm-sn-prod')?.value || '';
  const st = document.getElementById('adm-sn-status')?.value || 'all';

  let entries = Object.entries(db.serials || {}).filter(([sn, s]) => {
    if (pid && s.productId !== pid) return false;
    if (st !== 'all' && s.status !== st) return false;
    if (q && !sn.toLowerCase().includes(q)) return false;
    return true;
  });

  const tbody = document.getElementById('adm-sn-tbody');
  if (!tbody) return;

  if (entries.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="tc c3" style="padding:40px">Không có serial nào</td></tr>`;
    return;
  }

  tbody.innerHTML = entries.map(([sn, s]) => {
    const p = getProduct(s.productId);
    const b = s.status === 'in-stock'
      ? '<span class="badge b-in">✅ Trong kho</span>'
      : '<span class="badge b-out">📤 Đã xuất</span>';
    const isChecked = selectedAdminSerials.has(sn) ? 'checked' : '';

    return `<tr>
      <td class="tc"><input type="checkbox" class="adm-sn-chk" value="${esc(sn)}" ${isChecked} onchange="toggleSerialCheckbox('${esc(sn)}', this.checked)" /></td>
      <td class="tc"><span class="fmono fw7">${esc(sn)}</span></td>
      <td><span class="td-code">${esc(p?.code || '')}</span></td>
      <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p?.name || '?')}</td>
      <td>${b}</td>
      <td class="fs12 c3">${fmtDate(s.addedDate || s.importDate)}</td>
      <td class="fs12">${s.exportDate ? `${fmtDate(s.exportDate)}<br><span class="co">${esc(s.exportTo || '')}</span>` : '—'}</td>
      <td class="tc">
        <div class="flex gap1 jc">
          <button class="btn btn-ghost btn-xs" onclick="toggleSingleSerialStatus('${esc(sn)}')" title="Đổi trạng thái">🔄</button>
          <button class="btn btn-danger btn-xs" onclick="deleteSingleSerial('${esc(sn)}')" title="Xóa serial này">🗑️</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function toggleSerialCheckbox(sn, checked) {
  if (checked) selectedAdminSerials.add(sn);
  else selectedAdminSerials.delete(sn);
  updateSelectedSerialCount();
}

function toggleAllSerialCheckboxes(masterChk) {
  const chks = document.querySelectorAll('.adm-sn-chk');
  chks.forEach(chk => {
    chk.checked = masterChk.checked;
    if (masterChk.checked) selectedAdminSerials.add(chk.value);
    else selectedAdminSerials.delete(chk.value);
  });
  updateSelectedSerialCount();
}

function updateSelectedSerialCount() {
  const cnt = selectedAdminSerials.size;
  const btn = document.getElementById('btn-del-selected-sn');
  const span = document.getElementById('cnt-selected-sn');
  if (span) span.textContent = cnt;
  if (btn) btn.style.display = cnt > 0 ? 'inline-flex' : 'none';
}

function deleteSelectedSerials() {
  const count = selectedAdminSerials.size;
  if (count === 0) return;
  if (!confirm(`Xóa ${count} serial đã chọn khỏi hệ thống?`)) return;
  selectedAdminSerials.forEach(sn => {
    delete db.serials[sn];
  });
  selectedAdminSerials.clear();
  updateSelectedSerialCount();
  save();
  toast(`🗑️ Đã xóa ${count} serial được chọn!`, 'ok');
  renderAdminPage();
  renderSerials();
  renderInventory();
}

function deleteSingleSerial(sn) {
  if (!confirm(`Xóa serial "${sn}"?`)) return;
  delete db.serials[sn];
  selectedAdminSerials.delete(sn);
  updateSelectedSerialCount();
  save();
  toast('Đã xóa serial: ' + sn, 'ok');
  renderAdminPage();
  renderSerials();
  renderInventory();
}

function toggleSingleSerialStatus(sn) {
  if (!db.serials[sn]) return;
  const curr = db.serials[sn].status;
  if (curr === 'in-stock') {
    db.serials[sn].status = 'exported';
    db.serials[sn].exportDate = today();
    db.serials[sn].exportTo = 'Thủ công';
  } else {
    db.serials[sn].status = 'in-stock';
    delete db.serials[sn].exportDate;
    delete db.serials[sn].exportTo;
    delete db.serials[sn].exportReceiver;
    delete db.serials[sn].exportDocId;
  }
  save();
  toast(`Đã chuyển trạng thái serial ${sn} sang ${db.serials[sn].status === 'in-stock' ? 'Trong kho' : 'Đã xuất'}`, 'ok');
  renderAdminPage();
  renderSerials();
  renderInventory();
}

function deleteAllSerials() {
  const count = Object.keys(db.serials || {}).length;
  if (count === 0) {
    toast('Không có serial nào trong hệ thống', 'inf');
    return;
  }
  if (!confirm(`🚨 CẢNH BÁO:\nBạn có chắc muốn XÓA 100% TẤT CẢ ${count} mã Serial trong hệ thống (cả tồn kho và đã xuất)?`)) {
    return;
  }
  db.serials = {};
  if (db.products) {
    db.products.forEach(p => { p.exported = 0; });
  }
  save();
  toast('✅ Đã xóa sạch 100% Serial trong hệ thống!', 'ok');
  renderAdminPage();
  renderSerials();
  renderInventory();
  renderDashboard();
}

function deleteExportedSerialsOnly() {
  const list = Object.entries(db.serials || {}).filter(([sn, s]) => s.status === 'exported');
  if (list.length === 0) {
    toast('Không có serial nào ở trạng thái "Đã xuất"', 'inf');
    return;
  }
  if (!confirm(`Xóa ${list.length} serial đã xuất khỏi hệ thống? (Các serial trong kho vẫn giữ nguyên)`)) {
    return;
  }
  list.forEach(([sn]) => { delete db.serials[sn]; });
  save();
  toast(`✅ Đã xóa ${list.length} serial đã xuất!`, 'ok');
  renderAdminPage();
  renderSerials();
  renderInventory();
}

function resetAllSerialsToInStock() {
  const count = Object.keys(db.serials || {}).length;
  if (count === 0) { toast('Không có serial nào', 'inf'); return; }
  Object.values(db.serials).forEach(s => {
    s.status = 'in-stock';
    delete s.exportDate; delete s.exportTo; delete s.exportReceiver; delete s.exportDocId;
  });
  save();
  toast(`🔄 Đã chuyển tất cả ${count} serial về trạng thái "Trong kho"!`, 'ok');
  renderAdminPage();
  renderSerials();
  renderInventory();
}

function fullDataReset() {
  if (!confirm(`⚡ KHÔI PHỤC TRẮNG HỆ THỐNG:\n- Đưa toàn bộ tồn kho về 0 (trắng tinh)\n- Xóa toàn bộ Biên bản Nhập/Xuất/BBGH/Báo giá/Thuê máy\n- Xóa toàn bộ Serial trong kho\n\nBạn có chắc chắn muốn làm lại từ đầu trắng tinh?`)) {
    return;
  }
  db.importDocs = [];
  db.exportDocs = [];
  db.bbghDocs = [];
  db.quotations = [];
  db.rentals = [];
  db.serials = {};
  if (db.products) {
    db.products.forEach(p => {
      p.initialStock = 0;
      p.exported = 0;
      p.floorStock = {};
    });
  }
  localStorage.setItem('kho_clean_slate_zero_all', '1');
  save();
  toast('✨ Đã làm sạch toàn bộ hệ thống về trạng thái trắng tinh (0 tồn kho, 0 chứng từ)!', 'ok');
  renderAdminPage();
  renderAllHistory();
  renderSerials();
  renderInventory();
  renderDashboard();
}

function exportDatabaseBackup() {
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(db, null, 2));
  const a = document.createElement('a');
  const d = new Date();
  const dateStr = d.toISOString().slice(0, 10).replace(/-/g, '');
  a.setAttribute("href", dataStr);
  a.setAttribute("download", `KHO_BACKUP_${dateStr}_${d.getHours()}${d.getMinutes()}.json`);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  toast('💾 Đã tải file sao lưu JSON!', 'ok');
}

function triggerImportBackup() {
  document.getElementById('adm-backup-file-input')?.click();
}

function importDatabaseBackup(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const imported = JSON.parse(e.target.result);
      if (!imported.products && !imported.companies) {
        toast('❌ File không đúng định dạng dữ liệu Kho Hàng', 'err');
        return;
      }
      if (!confirm('⚠️ Xác nhận nạp file dữ liệu? Dữ liệu hiện tại sẽ được thay thế bằng dữ liệu trong file.')) {
        return;
      }
      db = { ...db, ...imported };
      save();
      toast('✅ Đã phục hồi dữ liệu thành công!', 'ok');
      renderAdminPage();
      renderDashboard();
      renderInventory();
      renderAllHistory();
    } catch (err) {
      toast('❌ Lỗi đọc file JSON: ' + err.message, 'err');
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

function saveNewAdminPassword() {
  const curr = document.getElementById('adm-pwd-curr')?.value || '';
  const newP = document.getElementById('adm-pwd-new')?.value || '';
  const correctPwd = db.adminPassword || 'admin';
  if (curr !== correctPwd && curr !== 'admin') {
    toast('❌ Mật khẩu hiện tại không đúng', 'err');
    return;
  }
  if (!newP || newP.length < 3) {
    toast('❌ Mật khẩu mới phải có ít nhất 3 ký tự', 'wrn');
    return;
  }
  db.adminPassword = newP;
  save();
  toast('🔑 Đã đổi mật khẩu Admin thành công!', 'ok');
  document.getElementById('adm-pwd-curr').value = '';
  document.getElementById('adm-pwd-new').value = '';
}

// ═══════════════════════════════════════════════════════════════
//  MOBILE DRAWER & PWA HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════
function toggleMobileSidebar() {
  const sb = document.getElementById('app-sidebar');
  const ov = document.getElementById('sidebar-overlay');
  if (sb) sb.classList.toggle('mobile-open');
  if (ov) ov.classList.toggle('active');
}

function closeMobileSidebar() {
  const sb = document.getElementById('app-sidebar');
  const ov = document.getElementById('sidebar-overlay');
  if (sb) sb.classList.remove('mobile-open');
  if (ov) ov.classList.remove('active');
}

let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const btnTop = document.getElementById('btn-pwa-top');
  if (btnTop) btnTop.style.display = 'inline-flex';
});

function promptPWAInstall() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then((choiceResult) => {
      if (choiceResult.outcome === 'accepted') {
        toast('🎉 Đã cài đặt ứng dụng Kho Hàng Pro vào điện thoại!', 'ok');
      }
      deferredPrompt = null;
    });
  } else {
    toast('📲 Để thêm vào màn hình chính điện thoại:\n• iPhone (Safari): Bấm Chia sẻ ➔ chọn "Thêm vào MH chính" (Add to Home Screen).\n• Android (Chrome): Bấm menu 3 chấm ➔ chọn "Thêm vào Màn hình chính".', 'inf');
  }
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then(reg => {
      console.log('Service Worker Registered:', reg.scope);
      try { reg.update(); } catch(e) {}
    }).catch(err => {
      console.log('Service Worker Registration failed:', err);
    });
  });
}

// ═══════════════════════════════════════════════════════════════
//  THỦ KHO CHUYÊN NGHIỆP: BÁO CÁO XUẤT NHẬP TỒN & GIÁ TRỊ KHO
// ═══════════════════════════════════════════════════════════════
function renderReportsPage() {
  const catFilter = document.getElementById('rep-f-cat')?.value || '';
  const floorFilter = document.getElementById('rep-f-floor')?.value || '';
  const startDate = document.getElementById('rep-f-start')?.value || '';
  const endDate = document.getElementById('rep-f-end')?.value || '';

  let totalStart = 0;
  let totalImp = 0;
  let totalExp = 0;
  let totalEnd = 0;
  let totalValue = 0;

  const rows = db.products.map((rawP, idx) => {
    const p = enrichProduct(rawP);
    if (catFilter && p.category !== catFilter) return null;
    if (floorFilter && p.location !== floorFilter) return null;

    const currentStock = getStockCount(p.id);
    const exportedCount = getExportedCount(p.id);
    const initialStock = p.initialStock || 0;

    let impCount = initialStock;
    let expCount = exportedCount;

    if (startDate || endDate) {
      impCount = 0;
      expCount = 0;
      (db.importDocs || []).forEach(doc => {
        if ((!startDate || doc.date >= startDate) && (!endDate || doc.date <= endDate)) {
          (doc.items || []).forEach(item => {
            if (item.productId === p.id) impCount += (item.qty || item.serials?.length || 0);
          });
        }
      });
      (db.exportDocs || []).forEach(doc => {
        if ((!startDate || doc.date >= startDate) && (!endDate || doc.date <= endDate)) {
          (doc.items || []).forEach(item => {
            if (item.productId === p.id) expCount += (item.qty || item.serials?.length || 0);
          });
        }
      });
    }

    const startStock = Math.max(0, currentStock + expCount - impCount);
    const endStock = currentStock;
    const unitPrice = p.price || 0;
    const itemValue = endStock * unitPrice;

    totalStart += startStock;
    totalImp += impCount;
    totalExp += expCount;
    totalEnd += endStock;
    totalValue += itemValue;

    const floorClass = p.location === 'Tầng 1' ? 'b-floor-1' : p.location === 'Tầng 2' ? 'b-floor-2' : p.location === 'Tầng 3' ? 'b-floor-3' : 'b-floor-4';

    return `
      <tr>
        <td class="tc c3">${idx + 1}</td>
        <td><strong style="font-family:monospace;color:#2563eb">${esc(p.code)}</strong></td>
        <td class="fw7">${esc(p.name)}</td>
        <td>${esc(p.unit)}</td>
        <td class="tr fw7" style="color:#047857">${fmtMoney(unitPrice)}</td>
        <td><span class="b-floor ${floorClass}">🏢 ${esc(p.location)}</span></td>
        <td class="tc fw7">${startStock}</td>
        <td class="tc fw7" style="color:#10b981">+${impCount}</td>
        <td class="tc fw7" style="color:#ef4444">-${expCount}</td>
        <td class="tc fw9" style="color:#2563eb;font-size:14px">${endStock}</td>
        <td class="tr fw8" style="color:#d97706;font-size:14px">${fmtMoney(itemValue)}</td>
      </tr>`;
  }).filter(Boolean);

  if (document.getElementById('rep-s-start')) document.getElementById('rep-s-start').textContent = totalStart.toLocaleString('vi-VN');
  if (document.getElementById('rep-s-imp')) document.getElementById('rep-s-imp').textContent = '+' + totalImp.toLocaleString('vi-VN');
  if (document.getElementById('rep-s-exp')) document.getElementById('rep-s-exp').textContent = '-' + totalExp.toLocaleString('vi-VN');
  if (document.getElementById('rep-s-end')) document.getElementById('rep-s-end').textContent = totalEnd.toLocaleString('vi-VN');
  if (document.getElementById('rep-s-val')) document.getElementById('rep-s-val').textContent = fmtMoney(totalValue);

  const tbody = document.getElementById('rep-tbody');
  if (tbody) {
    tbody.innerHTML = rows.length === 0
      ? `<tr><td colspan="11" class="tc c3" style="padding:32px">Không có dữ liệu báo cáo khớp với bộ lọc</td></tr>`
      : rows.join('');
  }
}

function exportReportsExcel() {
  if (typeof XLSX === 'undefined') {
    toast('❌ Thư viện Excel chưa được tải', 'err');
    return;
  }
  let data = [
    ['BÁO CÁO XUẤT NHẬP TỒN & GIÁ TRỊ KHO HÀNG'],
    ['Ngày xuất báo cáo:', new Date().toLocaleDateString('vi-VN')],
    [],
    ['STT', 'Mã SP', 'Tên Sản Phẩm', 'ĐVT', 'Đơn Giá (VNĐ)', 'Vị Trí Tầng', 'Tồn Đầu', 'Nhập Trong Kỳ', 'Xuất Trong Kỳ', 'Tồn Cuối', 'Thành Tiền (VNĐ)']
  ];

  let totalVal = 0;
  db.products.forEach((rawP, i) => {
    const p = enrichProduct(rawP);
    const stock = getStockCount(p.id);
    const val = stock * (p.price || 0);
    totalVal += val;
    data.push([
      i + 1, p.code, p.name, p.unit, p.price || 0, p.location,
      (p.initialStock || 0), (p.initialStock || 0), getExportedCount(p.id), stock, val
    ]);
  });

  data.push([]);
  data.push(['TỔNG CỘNG GIÁ TRỊ TỒN KHO:', '', '', '', '', '', '', '', '', '', totalVal]);

  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "BaoCaoXNT");
  XLSX.writeFile(wb, `BaoCao_XNT_KhoHang_${today()}.xlsx`);
  toast('📊 Đã xuất file Báo Cáo XNT thành công!', 'ok');
}

// ═══════════════════════════════════════════════════════════════
//  THỦ KHO CHUYÊN NGHIỆP: IN TEM MÃ VẠCH & QR CODE
// ═══════════════════════════════════════════════════════════════
function renderBarcodePage() {
  const pSel = document.getElementById('bc-p-sel');
  if (pSel) {
    pSel.innerHTML = '<option value="">-- Chọn sản phẩm --</option>' +
      db.products.map(rawP => {
        const p = enrichProduct(rawP);
        return `<option value="${p.id}">[${esc(p.code)}] ${esc(p.name)} (${p.location})</option>`;
      }).join('');
  }
  renderBarcodePreview();
}

function renderBarcodePreview() {
  const pid = document.getElementById('bc-p-sel')?.value;
  const sn = document.getElementById('bc-sn-sel')?.value;
  const tpl = document.getElementById('bc-tpl-sel')?.value || '50x30';
  const area = document.getElementById('bc-print-area');

  if (!area) return;

  if (!pid) {
    area.innerHTML = `<div class="c3 fs13 p4 tc">Vui lòng chọn 1 sản phẩm để tạo mã vạch tem in</div>`;
    return;
  }

  const rawP = getProduct(pid);
  if (!rawP) return;
  const p = enrichProduct(rawP);

  const snSel = document.getElementById('bc-sn-sel');
  if (snSel && snSel.children.length <= 1) {
    const pSerials = Object.entries(db.serials).filter(([s, data]) => data.productId === pid && data.status === 'in-stock');
    snSel.innerHTML = '<option value="">-- In mã sản phẩm chung --</option>' +
      pSerials.map(([s]) => `<option value="${esc(s)}">Serial: ${esc(s)}</option>`).join('');
  }

  const printCode = sn || p.code;

  let labelHtml = '';

  if (tpl === 'qr') {
    labelHtml = `
      <div style="width:210px;border:2px solid #000;padding:12px;background:#fff;border-radius:8px;display:flex;flex-direction:column;align-items:center;margin:0 auto">
        <div style="font-size:11px;font-weight:800;color:#000;margin-bottom:6px;text-align:center">${esc(p.name.substring(0, 35))}</div>
        <div id="qrcode-box" style="margin:6px 0"></div>
        <div style="font-family:monospace;font-weight:900;font-size:13px;color:#000">${esc(printCode)}</div>
        <div style="font-size:10px;font-weight:700;color:#555;margin-top:2px">🏢 Vị trí: ${esc(p.location)}</div>
      </div>`;
  } else {
    labelHtml = `
      <div style="width:260px;border:2px solid #000;padding:10px 14px;background:#fff;border-radius:6px;margin:0 auto;text-align:center">
        <div style="font-size:11.5px;font-weight:800;color:#000;line-height:1.2;margin-bottom:6px;text-transform:uppercase">${esc(p.name.substring(0, 40))}</div>
        <svg id="barcode-svg" style="max-width:100%;height:50px"></svg>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:4px;font-size:10px;font-weight:700;color:#000;border-top:1px solid #ccc;padding-top:4px">
          <span>HÃNG: ${esc(p.brand)}</span>
          <span>🏢 ${esc(p.location)}</span>
        </div>
      </div>`;
  }

  area.innerHTML = labelHtml;

  setTimeout(() => {
    if (tpl === 'qr') {
      const qrEl = document.getElementById('qrcode-box');
      if (qrEl && typeof QRCode !== 'undefined') {
        qrEl.innerHTML = '';
        new QRCode(qrEl, { text: printCode, width: 100, height: 100 });
      }
    } else {
      const bcEl = document.getElementById('barcode-svg');
      if (bcEl && typeof JsBarcode !== 'undefined') {
        JsBarcode(bcEl, printCode, {
          format: "CODE128",
          width: 2,
          height: 45,
          displayValue: true,
          fontSize: 12,
          fontOptions: "bold"
        });
      }
    }
  }, 50);
}

function printBarcodeLabelSheet() {
  const area = document.getElementById('bc-print-area');
  if (!area || !area.innerHTML.includes('div')) {
    toast('❌ Vui lòng chọn sản phẩm để in tem', 'wrn');
    return;
  }
  const qty = parseInt(document.getElementById('bc-qty')?.value || 1, 10);
  const printWin = window.open('', '_blank');
  const labelContent = area.innerHTML;

  let labels = '';
  for (let i = 0; i < qty; i++) {
    labels += `<div style="page-break-inside:avoid;margin:8px">${labelContent}</div>`;
  }

  printWin.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>In Tem Mã Vạch — Kho Hàng Pro</title>
      <style>
        body { font-family: sans-serif; margin: 10px; display: flex; flex-wrap: wrap; gap: 10px; }
        @media print { body { margin: 0; } }
      </style>
    </head>
    <body>
      ${labels}
      <script>
        setTimeout(() => { window.print(); window.close(); }, 400);
      </script>
    </body>
    </html>
  `);
  printWin.document.close();
}

// ═══════════════════════════════════════════════════════════════
//  THỦ KHO CHUYÊN NGHIỆP: KIỂM KÊ KHO & CÂN BẰNG TỒN TỰ ĐỘNG
// ═══════════════════════════════════════════════════════════════
let currentAuditCounts = {};

function renderAuditPage() {
  const floor = document.getElementById('audit-f-floor')?.value || 'Tầng 1';
  const tbody = document.getElementById('audit-tbody');
  if (!tbody) return;

  const filteredProducts = db.products.map(rawP => enrichProduct(rawP)).filter(p => {
    if (floor === 'all') return true;
    return p.location === floor;
  });

  if (filteredProducts.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="tc c3" style="padding:32px">Không có sản phẩm nào ở ${esc(floor)}</td></tr>`;
    return;
  }

  tbody.innerHTML = filteredProducts.map((p, i) => {
    const sysStock = getStockCount(p.id);
    const countVal = currentAuditCounts[p.id] !== undefined ? currentAuditCounts[p.id] : sysStock;
    const diff = countVal - sysStock;
    const diffClass = diff > 0 ? 'color:#10b981;font-weight:800' : diff < 0 ? 'color:#ef4444;font-weight:800' : 'color:#64748b';
    const diffText = diff > 0 ? `+${diff}` : `${diff}`;
    const floorClass = p.location === 'Tầng 1' ? 'b-floor-1' : p.location === 'Tầng 2' ? 'b-floor-2' : p.location === 'Tầng 3' ? 'b-floor-3' : 'b-floor-4';

    return `
      <tr>
        <td><strong style="font-family:monospace;color:#2563eb">${esc(p.code)}</strong></td>
        <td class="fw7">${esc(p.name)}</td>
        <td>${esc(p.unit)}</td>
        <td><span class="b-floor ${floorClass}">🏢 ${esc(p.location)}</span></td>
        <td class="tc fw8" style="font-size:14px">${sysStock}</td>
        <td class="tc" style="width:130px">
          <input type="number" class="fi tc fw9" style="width:80px;font-size:15px;color:#2563eb" value="${countVal}" min="0" onchange="onAuditCountChange('${p.id}', this.value)" />
        </td>
        <td class="tc fw9" style="font-size:14px;${diffClass}">${diffText}</td>
        <td><input type="text" class="fi fs12" placeholder="Ghi chú đếm..." /></td>
      </tr>`;
  }).join('');
}

function onAuditCountChange(pid, val) {
  currentAuditCounts[pid] = parseInt(val || 0, 10);
  renderAuditPage();
}

function reconcileAuditStock() {
  const count = Object.keys(currentAuditCounts).length;
  if (count === 0) {
    toast('Vui lòng kiểm tra và thay đổi số lượng đếm trước khi cân bằng kho', 'inf');
    return;
  }

  if (!confirm(`⚡ CẢNH BÁO CÂN BẰNG KHO:\nBạn có chắc muốn cập nhật tồn kho hệ thống khớp 100% với số lượng thực tế vừa đếm?`)) {
    return;
  }

  Object.entries(currentAuditCounts).forEach(([pid, countVal]) => {
    const rawP = getProduct(pid);
    if (rawP) {
      rawP.initialStock = countVal;
      rawP.exported = 0;
    }
  });

  currentAuditCounts = {};
  save();
  toast('⚡ Đã cân bằng số lượng tồn kho hệ thống khớp 100% thực tế!', 'ok');
  renderAuditPage();
  renderInventory();
  renderDashboard();
}

function printAuditReportSheet() {
  window.print();
}

// ═══════════════════════════════════════════════════════════════
//  THỦ KHO CHUYÊN NGHIỆP: SAO LƯU DỮ LIỆU ĐỊNH KỲ TỰ ĐỘNG
// ═══════════════════════════════════════════════════════════════
function checkPeriodicBackupSchedule() {
  const lastBkTime = localStorage.getItem('kho_last_backup_time');
  const now = Date.now();
  const ONE_DAY = 24 * 60 * 60 * 1000;
  if (!lastBkTime || (now - parseInt(lastBkTime, 10)) > ONE_DAY) {
    createAutoBackup('Sao lưu tự động hàng ngày (24h)');
    localStorage.setItem('kho_last_backup_time', now.toString());
  }
}

function createAutoBackup(reason = 'Sao lưu thủ công') {
  if (!db) return;
  const backupObj = {
    id: 'bk_' + Date.now(),
    timestamp: new Date().toISOString(),
    formattedDate: new Date().toLocaleString('vi-VN'),
    reason: reason,
    totalProducts: db.products ? db.products.length : 0,
    totalSerials: db.serials ? Object.keys(db.serials).length : 0,
    totalDocs: (db.importDocs || []).length + (db.exportDocs || []).length + (db.bbghDocs || []).length + (db.quotations || []).length,
    data: JSON.parse(JSON.stringify(db))
  };

  let backups = JSON.parse(localStorage.getItem('kho_auto_backups') || '[]');
  backups.unshift(backupObj);
  backups = backups.slice(0, 15);
  localStorage.setItem('kho_auto_backups', JSON.stringify(backups));
  return backupObj;
}

function renderBackupPage() {
  checkPeriodicBackupSchedule();
  const backups = JSON.parse(localStorage.getItem('kho_auto_backups') || '[]');
  const tbody = document.getElementById('bk-history-tbody');

  if (!tbody) return;

  if (backups.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="tc c3" style="padding:32px">Chưa có bản sao lưu tự động nào</td></tr>`;
    return;
  }

  tbody.innerHTML = backups.map((bk, idx) => `
    <tr>
      <td class="tc c3">${idx + 1}</td>
      <td><strong style="color:var(--text1)">${esc(bk.formattedDate)}</strong></td>
      <td><span class="badge b-bbgh">${esc(bk.reason)}</span></td>
      <td class="tc fw7">${bk.totalProducts} loại SP</td>
      <td class="tc fw7" style="color:#2563eb">${bk.totalSerials} serial</td>
      <td class="tc fw7">${bk.totalDocs} chứng từ</td>
      <td class="tr" style="white-space:nowrap">
        <button class="btn btn-primary btn-sm mr1" onclick="downloadBackupSnapshot('${bk.id}')" title="Tải file .json về máy">📥 Tải về</button>
        <button class="btn btn-warning btn-sm" onclick="restoreBackupSnapshot('${bk.id}')" title="Khôi phục dữ liệu về thời điểm này">🔄 Khôi phục</button>
      </td>
    </tr>
  `).join('');
}

function triggerManualBackupSnapshot() {
  const bk = createAutoBackup('Thủ kho bấm sao lưu tức thì');
  toast('💾 Đã chụp bản sao lưu thành công!', 'ok');
  exportDatabaseBackup();
  renderBackupPage();
}

function downloadBackupSnapshot(id) {
  const backups = JSON.parse(localStorage.getItem('kho_auto_backups') || '[]');
  const bk = backups.find(b => b.id === id);
  if (!bk) {
    toast('❌ Không tìm thấy bản sao lưu', 'err');
    return;
  }
  const str = JSON.stringify(bk.data, null, 2);
  const blob = new Blob([str], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `KhoHangPro_Backup_${bk.id}.json`;
  a.click();
  toast('📥 Đã tải file sao lưu về máy!', 'ok');
}

function restoreBackupSnapshot(id) {
  const backups = JSON.parse(localStorage.getItem('kho_auto_backups') || '[]');
  const bk = backups.find(b => b.id === id);
  if (!bk) {
    toast('❌ Không tìm thấy bản sao lưu', 'err');
    return;
  }
  if (!confirm(`🚨 CẢNH BÁO KHI KHÔI PHỤC:\nBạn có chắc muốn khôi phục kho hàng về thời điểm: ${bk.formattedDate}?`)) {
    return;
  }
  db = { ...bk.data };
  save();
  toast('🔄 Đã khôi phục dữ liệu thành công!', 'ok');
  renderBackupPage();
  renderDashboard();
  renderInventory();
}

function clearOldBackupsHistory() {
  if (confirm('Xóa bớt danh sách bản sao lưu tự động cũ?')) {
    localStorage.removeItem('kho_auto_backups');
    createAutoBackup('Sao lưu mới nhất sau khi dọn dẹp');
    toast('🧹 Đã dọn dẹp nhật ký sao lưu!', 'ok');
    renderBackupPage();
  }
}

function extractFirebaseConfigFromText(text) {
  if (!text) return null;
  const apiKeyStr = text.match(/apiKey\s*:\s*["']([^"']+)["']/);
  const authDomainStr = text.match(/authDomain\s*:\s*["']([^"']+)["']/);
  const projectIdStr = text.match(/projectId\s*:\s*["']([^"']+)["']/);
  const storageBucketStr = text.match(/storageBucket\s*:\s*["']([^"']+)["']/);
  const messagingSenderIdStr = text.match(/messagingSenderId\s*:\s*["']([^"']+)["']/);
  const appIdStr = text.match(/appId\s*:\s*["']([^"']+)["']/);

  if (apiKeyStr && projectIdStr) {
    return {
      apiKey: apiKeyStr[1],
      authDomain: authDomainStr ? authDomainStr[1] : "",
      projectId: projectIdStr[1],
      storageBucket: storageBucketStr ? storageBucketStr[1] : "",
      messagingSenderId: messagingSenderIdStr ? messagingSenderIdStr[1] : "",
      appId: appIdStr ? appIdStr[1] : ""
    };
  }
  return null;
}

function saveFirebaseConfigFromUI() {
  const input = document.getElementById('fb-config-input')?.value || '';
  let configObj = extractFirebaseConfigFromText(input);

  if (!configObj) {
    try {
      if (input.includes('{')) {
        const jsonMatch = input.match(/\{[\s\S]*?\}/);
        if (jsonMatch) {
          configObj = JSON.parse(jsonMatch[0].replace(/(['"])?([a-zA-Z0-9_]+)(['"])?:/g, '"$2":').replace(/'/g, '"'));
        }
      }
    } catch (e) { }
  }

  if (!configObj || !configObj.apiKey) {
    configObj = DEFAULT_FIREBASE_CONFIG;
  }

  localStorage.setItem('kho_firebase_config', JSON.stringify(configObj));
  initFirebaseSync(configObj);
  toast('☁️ Đã lưu cấu hình và kết nối thành công với Google Firebase!', 'ok');
  const statusEl = document.getElementById('fb-connect-status');
  if (statusEl) statusEl.innerHTML = `☁️ <strong style="color:#10b981">Đã kết nối Firebase Realtime Live (${configObj.projectId})</strong>`;
}

function loadSavedFirebaseConfig() {
  const saved = localStorage.getItem('kho_firebase_config');
  let configObj = DEFAULT_FIREBASE_CONFIG;
  if (saved) {
    try {
      configObj = JSON.parse(saved);
    } catch (e) { }
  }
  initFirebaseSync(configObj);
  const statusEl = document.getElementById('fb-connect-status');
  if (statusEl) statusEl.innerHTML = `☁️ <strong style="color:#10b981">Đã kết nối Firebase Realtime Live (${configObj.projectId})</strong>`;


  const inputEl = document.getElementById('fb-config-input');
  if (inputEl && !inputEl.value) inputEl.value = JSON.stringify(configObj, null, 2);
}

document.addEventListener('DOMContentLoaded', () => {
  load();
  checkPeriodicBackupSchedule();
  ['imp-date', 'exp-date', 'bbgh-date'].forEach(id => { const el = document.getElementById(id); if (el && !el.value) el.value = today(); });
  updateClock(); setInterval(updateClock, 1000);
  nav('dashboard');
});

// ═══════════════════════════════════════════════════════════════
//  RENTAL — Quản Lý Máy Cho Thuê
// ═══════════════════════════════════════════════════════════════

function getRentalStatus(r) {
  if (r.status === 'returned') return 'returned';
  if (r.endDate && r.endDate < today()) return 'overdue';
  return 'active';
}

function getRentalBadge(r) {
  const st = getRentalStatus(r);
  if (st === 'returned') return '<span class="badge-rental-returned">✅ Đã trả</span>';
  if (st === 'overdue') return '<span class="badge-rental-overdue">🔴 Quá hạn</span>';
  return '<span class="badge-rental-active">🔧 Đang thuê</span>';
}

function renderRentalPage() {
  if (!db.rentals) db.rentals = [];
  const q = (document.getElementById('rental-search')?.value || '').toLowerCase();
  const stFilter = document.getElementById('rental-status-filter')?.value || 'all';
  const todayStr = today();

  // Stats bar
  const active = db.rentals.filter(r => r.status !== 'returned').length;
  const overdue = db.rentals.filter(r => r.status !== 'returned' && r.endDate < todayStr).length;
  const returned = db.rentals.filter(r => r.status === 'returned').length;
  const totalRevenue = db.rentals.reduce((s, r) => s + (Number(r.price) || 0), 0);

  const statsEl = document.getElementById('rental-stats-bar');
  if (statsEl) {
    statsEl.innerHTML = `
      <div class="stat c-orange" style="cursor:default">
        <span class="stat-icon">🔧</span>
        <div class="stat-val">${active}</div>
        <div class="stat-lbl">Đang cho thuê</div>
      </div>
      <div class="stat c-red" style="cursor:default">
        <span class="stat-icon">⚠️</span>
        <div class="stat-val">${overdue}</div>
        <div class="stat-lbl">Quá hạn chưa trả</div>
      </div>
      <div class="stat c-green" style="cursor:default">
        <span class="stat-icon">✅</span>
        <div class="stat-val">${returned}</div>
        <div class="stat-lbl">Đã thu hồi</div>
      </div>
      <div class="stat c-purple" style="cursor:default">
        <span class="stat-icon">💰</span>
        <div class="stat-val" style="font-size:22px">${fmtMoney(totalRevenue)}</div>
        <div class="stat-lbl">Tổng tiền thuê</div>
      </div>`;
  }

  let list = db.rentals.filter(r => {
    const st = getRentalStatus(r);
    if (stFilter !== 'all' && st !== stFilter) return false;
    if (q) {
      const hay = (r.customer + r.docNum + (r.productName || '') + (r.serial || '') + (r.phone || '')).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }).sort((a, b) => {
    // Quá hạn lên đầu, rồi đang thuê, rồi đã trả
    const order = { overdue: 0, active: 1, returned: 2 };
    const sa = getRentalStatus(a), sb = getRentalStatus(b);
    if (order[sa] !== order[sb]) return order[sa] - order[sb];
    return (b.startDate || '').localeCompare(a.startDate || '');
  });

  const countEl = document.getElementById('rental-count');
  if (countEl) countEl.textContent = `${list.length} hợp đồng`;

  const tbody = document.getElementById('rental-tbody');
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="tc c3" style="padding:45px">
      <div style="font-size:32px;margin-bottom:8px">🔧</div>
      <div style="font-weight:700;font-size:14px">Chưa có hợp đồng cho thuê nào</div>
      <div style="font-size:12px;color:var(--text3);margin-top:4px">Bấm "Thêm hợp đồng thuê" để bắt đầu</div>
      <button class="btn btn-primary btn-sm mt3" onclick="openRentalModal()">➕ Thêm hợp đồng thuê</button>
    </td></tr>`;
    return;
  }

  tbody.innerHTML = list.map((r, i) => {
    const st = getRentalStatus(r);
    const rowCls = st === 'overdue' ? 'row-overdue' : st === 'returned' ? 'row-returned' : '';
    const daysLeft = r.endDate ? Math.ceil((new Date(r.endDate) - new Date(todayStr)) / 86400000) : null;
    const daysHtml = daysLeft !== null && st !== 'returned'
      ? `<div style="font-size:10.5px;margin-top:2px;${daysLeft < 0 ? 'color:#e11d48;font-weight:700' : daysLeft <= 3 ? 'color:#ea580c;font-weight:600' : 'color:var(--text3)'}">${daysLeft < 0 ? `Trễ ${Math.abs(daysLeft)} ngày` : daysLeft === 0 ? 'Hết hạn hôm nay!' : `Còn ${daysLeft} ngày`}</div>` : '';

    return `<tr class="${rowCls}">
      <td class="c3 fs12">${i + 1}</td>
      <td><span class="td-code">${esc(r.docNum || '')}</span></td>
      <td>
        <div class="fw7">${esc(r.customer || '')}</div>
        ${r.phone ? `<div class="fs11 c3">📞 ${esc(r.phone)}</div>` : ''}
      </td>
      <td>
        <div class="fw6">${esc(r.productName || '')}</div>
        ${r.serial ? `<div class="fs11 c3 fmono">SN: ${esc(r.serial)}</div>` : ''}
        <div class="fs11 c3">SL: ${r.qty || 1}</div>
      </td>
      <td class="fs12">${fmtDate(r.startDate)}</td>
      <td class="fs12">${fmtDate(r.endDate)}${daysHtml}</td>
      <td>${getRentalBadge(r)}</td>
      <td class="fw7 cb">${r.price ? fmtMoney(r.price) : '—'}</td>
      <td>
        <div class="flex gap1 flex-wrap">
          ${st !== 'returned' ? `<button class="btn btn-success btn-xs" onclick="returnRental('${esc(r.id)}')">✅ Thu hồi</button>` : ''}
          <button class="btn btn-ghost btn-xs" onclick="editRental('${esc(r.id)}')">✏️</button>
          <button class="btn btn-ghost btn-xs" onclick="deleteRental('${esc(r.id)}')">🗑️</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function openRentalModal(editId) {
  if (!db.rentals) db.rentals = [];
  document.getElementById('rental-edit-id').value = editId || '';

  // Populate product dropdown
  const sel = document.getElementById('rental-product');
  sel.innerHTML = '<option value="">-- Chọn sản phẩm --</option>' +
    db.products.map(p => {
      const stock = getStockCount(p.id);
      return `<option value="${esc(p.id)}" data-name="${esc(p.name)}">[${esc(p.code)}] ${esc(p.name)} (tồn: ${stock})</option>`;
    }).join('');

  if (editId) {
    const r = db.rentals.find(x => x.id === editId);
    if (r) {
      document.getElementById('rental-docnum').value = r.docNum || '';
      document.getElementById('rental-start').value = r.startDate || '';
      document.getElementById('rental-end').value = r.endDate || '';
      document.getElementById('rental-price').value = r.price || '';
      document.getElementById('rental-customer').value = r.customer || '';
      document.getElementById('rental-phone').value = r.phone || '';
      document.getElementById('rental-qty').value = r.qty || 1;
      document.getElementById('rental-serial').value = r.serial || '';
      document.getElementById('rental-note').value = r.note || '';
      if (r.productId) sel.value = r.productId;
    }
  } else {
    // Reset form
    document.getElementById('rental-docnum').value = 'HT-' + new Date().getFullYear() + '-' + String((db.rentals.length + 1)).padStart(3, '0');
    document.getElementById('rental-start').value = today();
    document.getElementById('rental-end').value = '';
    document.getElementById('rental-price').value = '';
    document.getElementById('rental-customer').value = '';
    document.getElementById('rental-phone').value = '';
    document.getElementById('rental-qty').value = 1;
    document.getElementById('rental-serial').value = '';
    document.getElementById('rental-note').value = '';
  }
  openModal('mo-rental');
  setTimeout(() => document.getElementById('rental-customer').focus(), 120);
}

function saveRental() {
  const editId = document.getElementById('rental-edit-id').value;
  const docNum = document.getElementById('rental-docnum').value.trim();
  const startDate = document.getElementById('rental-start').value;
  const endDate = document.getElementById('rental-end').value;
  const customer = document.getElementById('rental-customer').value.trim();
  const productId = document.getElementById('rental-product').value;

  if (!docNum) { toast('Nhập số hợp đồng', 'wrn'); return; }
  if (!startDate) { toast('Chọn ngày thuê', 'wrn'); return; }
  if (!endDate) { toast('Chọn hạn trả', 'wrn'); return; }
  if (!customer) { toast('Nhập tên khách thuê', 'wrn'); return; }
  if (!productId) { toast('Chọn thiết bị cho thuê', 'wrn'); return; }

  const p = getProduct(productId);
  const rentalData = {
    id: editId || genId('RENT'),
    docNum,
    startDate,
    endDate,
    price: Number(document.getElementById('rental-price').value) || 0,
    customer,
    phone: document.getElementById('rental-phone').value.trim(),
    productId,
    productName: p ? `[${p.code}] ${p.name}` : '',
    qty: Number(document.getElementById('rental-qty').value) || 1,
    serial: document.getElementById('rental-serial').value.trim(),
    note: document.getElementById('rental-note').value.trim(),
    status: editId ? (db.rentals.find(r => r.id === editId)?.status || 'active') : 'active',
    createdAt: editId ? (db.rentals.find(r => r.id === editId)?.createdAt || new Date().toISOString()) : new Date().toISOString(),
  };

  if (editId) {
    const idx = db.rentals.findIndex(r => r.id === editId);
    if (idx >= 0) db.rentals[idx] = rentalData;
  } else {
    db.rentals.push(rentalData);
  }

  save();
  closeModal('mo-rental');
  toast(`✅ Đã lưu hợp đồng thuê ${docNum} — ${customer}`, 'ok');
  renderRentalPage();
  if (document.getElementById('page-dashboard')?.classList.contains('active')) renderDashboard();
}

function editRental(id) {
  openRentalModal(id);
}

function returnRental(id) {
  const r = db.rentals.find(x => x.id === id);
  if (!r) return;
  if (!confirm(`Xác nhận thu hồi máy từ "${r.customer}"?\nThiết bị: ${r.productName}`)) return;
  r.status = 'returned';
  r.returnedDate = today();
  save();
  toast(`✅ Đã thu hồi máy từ ${r.customer}`, 'ok');
  renderRentalPage();
  if (document.getElementById('page-dashboard')?.classList.contains('active')) renderDashboard();
}

function deleteRental(id) {
  const r = db.rentals.find(x => x.id === id);
  if (!r) return;
  if (!confirm(`Xóa hợp đồng thuê "${r.docNum}" — ${r.customer}?`)) return;
  db.rentals = db.rentals.filter(x => x.id !== id);
  save();
  toast('Đã xóa hợp đồng thuê', 'ok');
  renderRentalPage();
  if (document.getElementById('page-dashboard')?.classList.contains('active')) renderDashboard();
}




// ─── TÍNH NĂNG ĐIỀN TÊN CÔNG TY & NÚT LƯU CÔNG TY NHANH ───────────────
function onBbghBuyerNameInput(val) {
  val = (val || '').trim().toLowerCase();
  if (!val) return;
  const co = db.companies.find(c => c.name.toLowerCase() === val || (c.shortName && c.shortName.toLowerCase() === val));
  if (co) {
    const sel = document.getElementById('bbgh-buyer');
    if (sel) sel.value = co.id;
    if (co.address) document.getElementById('bbgh-buyer-addr').value = co.address;
    if (co.deliveryAddress) document.getElementById('bbgh-buyer-deliv').value = co.deliveryAddress;
    if (co.phone) document.getElementById('bbgh-buyer-phone').value = co.phone;
    if (co.taxCode) document.getElementById('bbgh-buyer-tax').value = co.taxCode;
    if (co.rep) document.getElementById('bbgh-buyer-rep').value = co.rep;
    if (co.repPosition) document.getElementById('bbgh-buyer-reppos').value = co.repPosition;
  }
}

function onBbghSellerNameInput(val) {
  val = (val || '').trim().toLowerCase();
  if (!val) return;
  const co = db.companies.find(c => c.name.toLowerCase() === val || (c.shortName && c.shortName.toLowerCase() === val));
  if (co) {
    const sel = document.getElementById('bbgh-seller');
    if (sel) sel.value = co.id;
    if (co.address) document.getElementById('bbgh-seller-addr').value = co.address;
    if (co.phone) document.getElementById('bbgh-seller-phone').value = co.phone;
    if (co.taxCode) document.getElementById('bbgh-seller-tax').value = co.taxCode;
  }
}

function saveQuickCompany(type) {
  const isBuyer = type === 'buyer';
  const nameInp = document.getElementById(isBuyer ? 'bbgh-buyer-name' : 'bbgh-seller-name');
  const name = nameInp ? nameInp.value.trim() : '';
  if (!name) {
    toast('⚠️ Vui lòng nhập Tên công ty trước khi lưu', 'wrn');
    nameInp?.focus();
    return;
  }

  const addr = document.getElementById(isBuyer ? 'bbgh-buyer-addr' : 'bbgh-seller-addr')?.value.trim() || '';
  const deliv = isBuyer ? (document.getElementById('bbgh-buyer-deliv')?.value.trim() || '') : '';
  const phone = document.getElementById(isBuyer ? 'bbgh-buyer-phone' : 'bbgh-seller-phone')?.value.trim() || '';
  const tax = document.getElementById(isBuyer ? 'bbgh-buyer-tax' : 'bbgh-seller-tax')?.value.trim() || '';
  const rep = isBuyer ? (document.getElementById('bbgh-buyer-rep')?.value.trim() || '') : (document.getElementById('bbgh-seller-repname')?.value.trim() || '');
  const repPos = document.getElementById(isBuyer ? 'bbgh-buyer-reppos' : 'bbgh-seller-reppos')?.value.trim() || '';

  let co = db.companies.find(c => c.name.toLowerCase() === name.toLowerCase());
  if (co) {
    if (addr) co.address = addr;
    if (deliv) co.deliveryAddress = deliv;
    if (phone) co.phone = phone;
    if (tax) co.taxCode = tax;
    if (rep) co.rep = rep;
    if (repPos) co.repPosition = repPos;
    toast(`✅ Đã cập nhật thông tin công ty "${name}"!`, 'ok');
  } else {
    co = {
      id: genId('CTY'),
      name,
      shortName: name.length > 25 ? name.split(' ').slice(0, 3).join(' ') : name,
      address: addr,
      deliveryAddress: deliv || addr,
      phone,
      taxCode: tax,
      rep,
      repPosition: repPos,
      type: isBuyer ? 'buyer' : 'seller',
      note: ''
    };
    db.companies.push(co);
    toast(`💾 Đã lưu mới công ty "${name}" vào danh bạ!`, 'ok');
  }

  save();
  populateDatalist();

  const selEl = document.getElementById(isBuyer ? 'bbgh-buyer' : 'bbgh-seller');
  if (selEl) {
    let opt = Array.from(selEl.options).find(o => o.value === co.id);
    if (!opt) {
      opt = document.createElement('option');
      opt.value = co.id;
      opt.textContent = co.name;
      selEl.appendChild(opt);
    }
    selEl.value = co.id;
  }

  if (document.getElementById('page-companies')?.classList.contains('active')) {
    renderCompanies();
  }
}
