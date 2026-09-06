// ================================================================
//  DATA.JS - Danh mục sản phẩm công ty (Tồn kho khởi tạo = 0)
// ================================================================

const INITIAL_PRODUCTS = [
  { id: 'VT-BS01', code: 'VT-BS01', name: 'Bàn phím chuột', unit: 'Bộ', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT-BS02', code: 'VT-BS02', name: '7460 (Ecoit)', unit: 'Cái', initialStock: 0, exported: 0, notes: '' },
  { id: '1103Y43AX0', code: '1103Y43AX0', name: 'Dịch vụ triển khai hệ thống phê duyệt và ban hành tài liệu', unit: 'Gói', initialStock: 0, exported: 0, notes: '' },
  { id: 'OKIP_B433DN', code: 'OKIP_B433DN', name: 'Máy in lazer trắng đen B433DN hiệu OKI', unit: 'Chiếc', initialStock: 0, exported: 0, notes: '' },
  { id: 'OKIP_B513DN', code: 'OKIP_B513DN', name: 'Máy in lazer trắng đen B513DN hiệu OKI', unit: 'Chiếc', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00001', code: 'VT00001', name: 'MỰC MP 3554S', unit: 'Bình', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00002', code: 'VT00002', name: 'CHÂN MÁY 103545', unit: 'Cái', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00014', code: 'VT00014', name: 'MỰC 6210D', unit: 'Bình', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00015', code: 'VT00015', name: 'BỘT TỪ', unit: 'BỊCH', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00026', code: 'VT00026', name: 'Cáp USB 2.0 máy in dài 1.5m JASOZ T-D116', unit: 'Cái', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00027', code: 'VT00027', name: 'Màn hình MSI PRO MP242 E14A (Model: 3PD1) 23.8 inch', unit: 'Cái', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00028', code: 'VT00028', name: 'Màn hình MSI PRO MP275 E14L (Model: 3PF0) 27 inch', unit: 'Cái', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00030', code: 'VT00030', name: 'Thẻ nhớ Hikvision 64G HS-TF-C1', unit: 'Chiếc', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00034', code: 'VT00034', name: '(Mini PC) MSI Cubi 5 12M Core 5-1235U + MSI PRO MP233 E2 21.45"', unit: 'Bộ', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00035', code: 'VT00035', name: 'Máy quét mã vạch ELEMENT P303BT', unit: 'Cái', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00036', code: 'VT00036', name: 'Máy tính để bàn mini MSI PRO DP21 i5-14400 / 16GB DDR5 / 512G SSD / NO OS', unit: 'Bộ', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00037A', code: 'VT00037', name: 'Màn hình LCD MSI Pro MP251L E2 24.5"', unit: 'Chiếc', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00037B', code: 'VT00037', name: 'Máy quét Ricoh iX100 (PA03688-B001)', unit: 'Cái', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00038', code: 'VT00038', name: 'MÁY TÍNH ĐỂ BÀN MINI PC MSI CUBI 5 12M 412BVN I5-1235U/NonOS/3Y', unit: 'Cái', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00040', code: 'VT00040', name: 'Phần mềm Win Pro 11 64Bit Eng Intl 1pk DSP OEI DVD (FQC-10528)', unit: 'Bộ', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00043', code: 'VT00043', name: 'Máy tính bảng Apple 11-inch iPad Wi-Fi 128GB - Silver MD3Y4ZA/A', unit: 'Cái', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00044', code: 'VT00044', name: 'MÁY PHOTOCOPY RICOH IM 2500', unit: 'CÁI', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00047', code: 'VT00047', name: 'Máy in màu HP DesignJet T950 36-in Multifunction Printer', unit: 'Chiếc', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00048', code: 'VT00048', name: 'Hộp mực HP 730B 130-ml Photo Black DesignJet 3ED43A', unit: 'Hộp', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00049', code: 'VT00049', name: 'Hộp mực HP 730 130-ml Cyan Ink Cartridge P2V62A', unit: 'Hộp', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00050', code: 'VT00050', name: 'Hộp mực HP 730B 130-ml Gray DesignJet 3ED44A', unit: 'Hộp', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00051A', code: 'VT00051', name: 'Hộp mực HP 730 130-ml Magenta Ink Cartridge P2V63A', unit: 'Hộp', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00051B', code: 'VT00051', name: 'Máy quét Ricoh SP-1120N (PA03811-B001)', unit: 'CÁI', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00052', code: 'VT00052', name: 'Hộp mực HP 730B 130-ml Matte Black DesignJet 3ED45A', unit: 'Hộp', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00053', code: 'VT00053', name: 'Hộp mực HP 730 130-ml Yellow DesignJet P2V64A', unit: 'Hộp', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00057', code: 'VT00057', name: 'Bộ nạp giấy bản gốc tự động DF3110 (ARDF)', unit: 'Cái', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00065', code: 'VT00065', name: 'Máy tính để bàn Mini PC MSI Cubi 5 12M Core 5-1235U /8GD4/256GSSD', unit: 'Cái', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00066', code: 'VT00066', name: 'MÀN HÌNH MSI PRO MP223 E2 21.45" FHD/VA/100Hz/HDMI/DP', unit: 'Cái', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00070', code: 'VT00070', name: 'Máy quét Ricoh SP-1120N (PA03811-B001)', unit: 'Cái', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00073', code: 'VT00073', name: 'Laptop Microsoft Surface Studio 1964 14.4" Core I7/32Gb/SSD 1TB', unit: 'Cái', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00100', code: 'VT00100', name: 'Khay chứa giấy', unit: 'Cái', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00126', code: 'VT00126', name: 'Đầu bấm dây cáp mạng RJ45 Tenda TEH5E010', unit: 'Hộp', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00129', code: 'VT00129', name: 'Máy tính bảng iPad Air 11/M3/Wi-Fi 128GB Blue MC9X4ZA/A', unit: 'Cái', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00130', code: 'VT00130', name: "Ổ cứng 2.5' SATA III Lexar 256GB LNS100-256RB", unit: 'Chiếc', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00131', code: 'VT00131', name: 'Ổ cứng WD 1TB 3.5" Sata3 Purple WD10PURZ', unit: 'Cái', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00151', code: 'VT00151', name: 'Cáp HDMI 1.4 dài 15m Ugreen', unit: 'Chiếc', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00166', code: 'VT00166', name: 'MÁY TÍNH XÁCH TAY MSI Modern 14 F13MG i5-1335U/8G/512GSSD/W11SL', unit: 'Cái', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00175', code: 'VT00175', name: 'Màn hình MSI PRO MP251L E2 24.5" Full HD 1ms 120Hz IPS', unit: 'Cái', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00176', code: 'VT00176', name: 'BỘ NẠP VÀ ĐẢO BẢN GỐC TỰ ĐỘNG DF3110', unit: 'Cái', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00186', code: 'VT00186', name: 'Màn hình LCD MSI Pro MP242L 23.8"', unit: 'Chiếc', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00195', code: 'VT00195', name: 'Máy tính mini MSI PRO DP21 i5-14400 / 16GB DDR5 / 512G SSD / Wifi 6E', unit: 'Bộ', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00198', code: 'VT00198', name: 'Máy quét Ricoh iX2400 (PA03870-B101)', unit: 'Chiếc', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00199', code: 'VT00199', name: 'Phần mềm Microsoft Windows 11 Home 64 Bit Eng DSP OEI', unit: 'Cái', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00202', code: 'VT00202', name: 'Hút ẩm LG Dual Inverter 19L MD19GQGE0', unit: 'Chiếc', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00203', code: 'VT00203', name: 'Màn hình LCD MSI PRO MP251 E14L 24.5"', unit: 'CÁI', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00204', code: 'VT00204', name: 'Bộ nhớ Ram Laptop 8GB DDR5', unit: 'Cái', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00216', code: 'VT00216', name: 'Máy in laser đen trắng KYOCERA Ecosys P2235dn', unit: 'Cái', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00224', code: 'VT00224', name: 'Hộp mực Sindoh 12k (A620DN) 12.000 trang', unit: 'Hộp', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00225', code: 'VT00225', name: 'Máy in laser KYOCERA ECOSYS PA4000x', unit: 'Cái', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00226', code: 'VT00226', name: 'Hộp mực KYOCERA TK-1265', unit: 'Hộp', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00227', code: 'VT00227', name: 'Hộp mực KYOCERA TK-1158', unit: 'Hộp', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00228', code: 'VT00228', name: 'Thiết bị WiFi Mesh 2.4GHz & 5GHz (2-pack) Halo H30 Mercusys', unit: 'Cái', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00242', code: 'VT00242', name: 'Camera quan sát Ezviz CS-H9C (5MP+5MP)', unit: 'Chiếc', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00243', code: 'VT00243', name: 'Thẻ nhớ MICRO SD CARD ACER 64GB MSC100-64GB', unit: 'Chiếc', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00253', code: 'VT00253', name: 'Hộp mực TK1158, 120g - HL (QH)', unit: 'Hộp', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00274', code: 'VT00274', name: 'Hộp mực TK-1275', unit: 'Hộp', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00275', code: 'VT00275', name: 'Máy scan Ricoh Fi-8250U', unit: 'Chiếc', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00299', code: 'VT00299', name: 'MÁY TÍNH MINI PC MSI CUBI NUC 1M-403BVN CORE 3 100U/WF/BT/3Y', unit: 'Cái', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00300', code: 'VT00300', name: 'MÁY TÍNH MINI PC MSI CUBI 5 12M 412BVN I5-1235U/WF/BT/NonOS/3Y', unit: 'Cái', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00757', code: 'VT00757', name: 'Máy PHOTOCOPY đa chức năng IM 3000', unit: 'Cái', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT00760', code: 'VT00760', name: 'RAM KINGSTON 16G D5-5600 FURY BEAST KF556C40BB-16', unit: 'Cái', initialStock: 0, exported: 0, notes: '' },
  { id: 'VT03500', code: 'VT03500', name: 'Máy photocopy Ricoh IM 3500', unit: 'Cái', initialStock: 0, exported: 0, notes: '' }
];

// ─── SERIAL BAN ĐẦU (0 Serial tồn) ───────────────────────────────
const INITIAL_SERIALS = {};

// ─── CÔNG TY ──────────────────────────────────────────────────────
const INITIAL_COMPANIES = [
  {
    id: 'CTY001',
    name: 'CÔNG TY TNHH THƯƠNG MẠI VÀ CÔNG NGHỆ TIN HỌC TÍN THÀNH',
    shortName: 'Tín Thành',
    address: 'Số 57 ngách 124/49 Phố Do Nha, Phường Tây Mỗ, Quận Nam Từ Liêm, Hà Nội, Việt Nam',
    deliveryAddress: 'Số 22 ngõ 32 Mạc Thái Tổ, Quận Cầu Giấy, TP Hà Nội',
    phone: '',
    taxCode: '',
    rep: 'Nguyễn Quang Huy',
    repPosition: 'Giám đốc',
    type: 'buyer',
    note: 'Khách hàng thường xuyên',
  },
];

// ─── NHÂN VIÊN ────────────────────────────────────────────────────
const INITIAL_EMPLOYEES = [
  { id: 'NV001', name: 'Trương Ngọc Hoà', position: 'Kỹ Thuật Viên ', department: 'Phòng Kỹ Thuật', phone: '' },
  { id: 'NV002', name: 'Nguyễn Long Vũ', position: 'Kỹ Thuật Viên', department: 'PHòng Kỹ Thuật', phone: '' },
];
