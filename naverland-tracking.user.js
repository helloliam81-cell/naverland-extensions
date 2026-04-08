// ==UserScript==
// @name         Naver Land 단지 트레킹
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  네이버 부동산 단지 트레킹 - 매매/전세 최저호가 조회 (층수 필터 설정 가능)
// @author       You
// @match        https://new.land.naver.com/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const STORAGE_KEY  = 'naverland_tracking_v1';
    const FLOOR_KEY    = 'naverland_floor_settings_v1';
    const HISTORY_KEY  = 'naverland_history_v1';
    const EXPORT_KEY   = 'naverland_last_export_v1';
    const HISTORY_DAYS = 90;

    // ══════════════════════════════════════════════
    // 데이터 관리 (localStorage)
    // ══════════════════════════════════════════════
    function getTracked() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
        catch { return []; }
    }

    function saveTracked(list) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    }

    function getFloorSettings() {
        try {
            const s = JSON.parse(localStorage.getItem(FLOOR_KEY) || 'null');
            if (s && s.buy && s.rent) return s;
        } catch {}
        return {
            buy:  { includeLow: false, excludeBelow: 3 },
            rent: { includeLow: true,  excludeBelow: 0 },
        };
    }

    function saveFloorSettings(s) {
        localStorage.setItem(FLOOR_KEY, JSON.stringify(s));
    }

    // ── 이력 관리 ──
    function getHistory() {
        try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '{}'); }
        catch { return {}; }
    }

    function getStorageUsageRatio() {
        let used = 0;
        for (const key in localStorage) {
            if (!localStorage.hasOwnProperty(key)) continue;
            used += (key.length + localStorage[key].length) * 2;
        }
        return used / (5 * 1024 * 1024); // 5MB 기준
    }

    function checkStorageWarning() {
        const warn = document.getElementById('nl-storage-warning');
        if (!warn) return;
        warn.style.display = getStorageUsageRatio() >= 0.9 ? 'flex' : 'none';
    }

    function saveHistory(hist) {
        // 90일 초과 데이터 삭제
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - HISTORY_DAYS);
        const cutoffStr = cutoff.toISOString().slice(0, 10);
        Object.keys(hist).forEach(d => { if (d < cutoffStr) delete hist[d]; });
        try {
            localStorage.setItem(HISTORY_KEY, JSON.stringify(hist));
        } catch {}
        checkStorageWarning();
    }

    function todayStr() {
        const d = new Date();
        const yyyy = d.getFullYear();
        const mm   = String(d.getMonth() + 1).padStart(2, '0');
        const dd   = String(d.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }

    function saveHistoryForComplex(complexId, name, result) {
        const hist  = getHistory();
        const today = todayStr();
        if (!hist[today]) hist[today] = {};
        const areas = (result.areas || []).map(({ area2 }) => ({
            area2,
            sale: result.buy[area2]  ?? null,
            rent: result.rent[area2] ?? null,
        }));
        hist[today][complexId] = { name, areas };
        saveHistory(hist);
    }

    function buildAllRows() {
        const hist = getHistory();
        const trackedIds = new Set(getTracked().map(x => x.complexId));
        const allRows = [];
        Object.keys(hist).sort().forEach(date => {
            const points = [];
            Object.entries(hist[date]).forEach(([complexId, { name, areas }]) => {
                if (!trackedIds.has(complexId)) return; // 삭제된 단지 제외
                areas.forEach(({ area2, sale, rent }) => {
                    const gap = (sale != null && rent != null) ? sale - rent : '';
                    points.push({ name, area2, sale: sale ?? '', rent: rent ?? '', gap });
                });
            });
            if (!points.length) return;
            allRows.push(['날짜',         ...points.map(() => date)]);
            allRows.push(['단지명',       ...points.map(p => p.name)]);
            allRows.push(['전용면적(㎡)',  ...points.map(p => p.area2)]);
            allRows.push(['매매최저(만원)',...points.map(p => p.sale)]);
            allRows.push(['전세최저(만원)',...points.map(p => p.rent)]);
            allRows.push(['매전갭(만원)', ...points.map(p => p.gap)]);
            allRows.push([]);
        });
        return allRows;
    }

    function doDownloadCSV(allRows) {
        const csv  = allRows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `naverland_history_${todayStr()}.csv`;
        a.click();
        URL.revokeObjectURL(url);

        const now = new Date();
        const ts  = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
        localStorage.setItem(EXPORT_KEY, ts);
        const el = document.getElementById('nl-last-export');
        if (el) el.textContent = `마지막 내보내기: ${ts}`;
    }

    function exportCSV() {
        const allRows = buildAllRows();

        if (!allRows.length) {
            alert('내보낼 이력 데이터가 없습니다.');
            return;
        }

        // ── 미리보기 모달 ──
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position:fixed;inset:0;z-index:2147483648;
            background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;`;

        const modal = document.createElement('div');
        modal.style.cssText = `
            background:#fff;border-radius:10px;
            box-shadow:0 8px 32px rgba(0,0,0,.28);
            display:flex;flex-direction:column;
            max-width:90vw;max-height:80vh;overflow:hidden;`;

        // 헤더
        const mHead = document.createElement('div');
        mHead.style.cssText = 'padding:14px 18px;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center;background:#fafafa;border-radius:10px 10px 0 0;';
        mHead.innerHTML = `<span style="font-weight:bold;font-size:14px;color:#333;">📋 내보내기 미리보기</span>`;

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '✕';
        closeBtn.style.cssText = 'background:none;border:none;font-size:16px;cursor:pointer;color:#888;padding:0 4px;';
        closeBtn.onclick = () => overlay.remove();
        mHead.appendChild(closeBtn);

        // 테이블 영역
        const tableWrap = document.createElement('div');
        tableWrap.style.cssText = 'overflow:auto;flex:1;padding:12px 16px;';

        const table = document.createElement('table');
        table.style.cssText = 'border-collapse:collapse;font-size:11px;white-space:nowrap;';

        const LABEL_STYLE = 'padding:5px 10px;background:#f0f4ff;color:#333;font-weight:bold;border:1px solid #dde;text-align:left;position:sticky;left:0;z-index:1;';
        const DATE_STYLE  = 'padding:5px 10px;background:#e8f5e9;color:#2e7d32;border:1px solid #dde;text-align:center;';
        const NAME_STYLE  = 'padding:5px 10px;border:1px solid #eee;color:#555;text-align:center;max-width:90px;overflow:hidden;text-overflow:ellipsis;';
        const NUM_STYLE   = 'padding:5px 10px;border:1px solid #eee;color:#333;text-align:right;';
        const BUY_STYLE   = 'padding:5px 10px;border:1px solid #eee;color:#c62828;text-align:right;';
        const RENT_STYLE  = 'padding:5px 10px;border:1px solid #eee;color:#1565c0;text-align:right;';
        const GAP_STYLE   = 'padding:5px 10px;border:1px solid #eee;color:#6a1fa0;text-align:right;';

        const CELL_STYLES = [DATE_STYLE, NAME_STYLE, NUM_STYLE, BUY_STYLE, RENT_STYLE, GAP_STYLE];

        allRows.forEach((row, ri) => {
            if (!row.length) return; // 빈 구분 행 건너뜀
            const tr = document.createElement('tr');
            row.forEach((cell, ci) => {
                const td = document.createElement('td');
                td.textContent = cell;
                td.style.cssText = ci === 0 ? LABEL_STYLE : (CELL_STYLES[ri % 7] || NUM_STYLE);
                tr.appendChild(td);
            });
            table.appendChild(tr);
        });

        tableWrap.appendChild(table);

        // 하단 버튼
        const mFoot = document.createElement('div');
        mFoot.style.cssText = 'padding:12px 18px;border-top:1px solid #eee;display:flex;justify-content:flex-end;gap:8px;background:#fafafa;border-radius:0 0 10px 10px;';

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = '취소';
        cancelBtn.style.cssText = 'padding:7px 18px;border:1px solid #ddd;background:#f3f4f6;color:#555;border-radius:5px;cursor:pointer;font-size:13px;';
        cancelBtn.onclick = () => overlay.remove();

        const downloadBtn = document.createElement('button');
        downloadBtn.textContent = '📥 CSV 다운로드';
        downloadBtn.style.cssText = 'padding:7px 18px;border:none;background:#03C75A;color:#fff;border-radius:5px;cursor:pointer;font-size:13px;font-weight:bold;';
        downloadBtn.onclick = () => {
            doDownloadCSV(allRows);
            overlay.remove();
        };

        const clearAllBtn = document.createElement('button');
        clearAllBtn.textContent = '🗑 이력 모두 비우기';
        clearAllBtn.style.cssText = 'padding:7px 18px;border:1px solid #fca5a5;background:#fff1f1;color:#dc2626;border-radius:5px;cursor:pointer;font-size:13px;margin-right:auto;';
        clearAllBtn.onclick = () => {
            if (!confirm('모든 이력을 삭제하시겠습니까?')) return;
            localStorage.removeItem(HISTORY_KEY);
            checkStorageWarning();
            overlay.remove();
        };

        mFoot.appendChild(clearAllBtn);
        mFoot.appendChild(cancelBtn);
        mFoot.appendChild(downloadBtn);

        modal.appendChild(mHead);
        modal.appendChild(tableWrap);
        modal.appendChild(mFoot);
        overlay.appendChild(modal);
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
        document.body.appendChild(overlay);
    }

    function isTracked(complexId) {
        return getTracked().some(x => x.complexId === complexId);
    }

    function addTracked(complexId, name) {
        const list = getTracked();
        if (list.find(x => x.complexId === complexId)) return false;
        list.push({ complexId, name, areas: [], selectedArea: null, priceCache: null, addedAt: Date.now() });
        saveTracked(list);
        return true;
    }

    function removeTracked(complexId) {
        saveTracked(getTracked().filter(x => x.complexId !== complexId));
        // 이력은 유지 (내보내기 시 현재 트레킹 목록 기준으로 필터링)
    }

    // ══════════════════════════════════════════════
    // API 유틸
    // ══════════════════════════════════════════════
    let _cachedToken = null;

    async function fetchToken() {
        if (_cachedToken) return _cachedToken;
        const res = await fetch('https://new.land.naver.com/complexes');
        const text = await res.text();
        const start = text.indexOf('token') + 17;
        const end = text.indexOf('"', start);
        _cachedToken = `Bearer ${text.substring(start, end)}`;
        // 10분 후 캐시 만료
        setTimeout(() => { _cachedToken = null; }, 10 * 60 * 1000);
        return _cachedToken;
    }

    function parsePrice(p) {
        if (!p) return null;
        if (p.includes('억')) {
            const parts = p.split('억');
            let val = parseInt(parts[0]) * 10000;
            if (parts[1]) val += parseInt(parts[1].replace(/,/g, '')) || 0;
            return val;
        }
        return parseInt(p.replace(/,/g, ''));
    }

    function formatPrice(manwon) {
        if (manwon === null || manwon === undefined) return '-';
        const eok = Math.floor(manwon / 10000);
        const rem = manwon % 10000;
        if (eok > 0 && rem > 0) return `${eok}억 ${rem.toLocaleString()}`;
        if (eok > 0) return `${eok}억`;
        return `${manwon.toLocaleString()}만`;
    }

    function shouldExclude(floorInfo, { includeLow, excludeBelow }) {
        if (!floorInfo) return !includeLow;
        const floorStr = floorInfo.split('/')[0].trim();
        if (floorStr === '저') return !includeLow;
        const floorNum = parseInt(floorStr);
        if (!isNaN(floorNum) && excludeBelow > 0 && floorNum <= excludeBelow) return true;
        return false;
    }

    // 특정 거래 유형의 전체 매물 목록 수집
    async function fetchAllArticles(complexId, tradeType, token) {
        let all = [];
        let page = 1;
        const MAX_PAGE = 50;
        while (page <= MAX_PAGE) {
            const url = `https://new.land.naver.com/api/articles/complex/${complexId}` +
                `?realEstateType=APT&tradeType=${tradeType}&order=prc&page=${page}`;
            const res = await fetch(url, { headers: { authorization: token } });
            const data = await res.json();
            const list = data.articleList || [];
            all = all.concat(list);
            if (list.length < 20) break;
            page++;
            await new Promise(r => setTimeout(r, 300));
        }
        return all;
    }

    // 전체 매물 일괄 수집 → 면적·타입별 최저가 계산 → 캐시 반환
    async function fetchAllPrices(complexId, token, floorSettings) {
        const [buyArticles, rentArticles] = await Promise.all([
            fetchAllArticles(complexId, 'A1', token),
            fetchAllArticles(complexId, 'B1', token),
        ]);

        // 전용면적(area2) → 공급면적(area1) 타입 목록 수집
        // 같은 전용면적에 공급면적이 다르면 별도 타입으로 분류
        const areaTypeMap = new Map(); // Map<area2, Set<area1>>
        [...buyArticles, ...rentArticles].forEach(a => {
            if (a.area2 == null) return;
            const e2 = Math.floor(a.area2);
            const e1 = a.area1 != null ? Math.floor(a.area1) : null;
            if (!areaTypeMap.has(e2)) areaTypeMap.set(e2, new Set());
            if (e1 !== null) areaTypeMap.get(e2).add(e1);
        });

        // areas: [{ area2: 59, types: [74, 78] }, { area2: 84, types: [105, 108] }, ...]
        const areas = [...areaTypeMap.entries()]
            .sort(([a], [b]) => a - b)
            .map(([area2, typeSet]) => ({
                area2,
                types: [...typeSet].sort((a, b) => a - b),
            }));

        function minPrice(articles) {
            const prices = articles.map(a => parsePrice(a.dealOrWarrantPrc)).filter(p => p !== null);
            return prices.length ? Math.min(...prices) : null;
        }

        const fs        = floorSettings || getFloorSettings();
        const buyValid  = buyArticles.filter(a => !shouldExclude(a.floorInfo, fs.buy));
        const rentValid = rentArticles.filter(a => !shouldExclude(a.floorInfo, fs.rent));

        const buy  = { all: minPrice(buyValid)  };
        const rent = { all: minPrice(rentValid) };

        for (const { area2, types } of areas) {
            // 전용면적 전체 (타입 무관)
            buy[area2]  = minPrice(buyValid.filter(a => Math.floor(a.area2) === area2));
            rent[area2] = minPrice(rentValid.filter(a => Math.floor(a.area2) === area2));

            // 타입별 (전용 + 공급면적 조합)
            for (const area1 of types) {
                const key = `${area2}_${area1}`;
                buy[key]  = minPrice(buyValid.filter(a =>
                    Math.floor(a.area2) === area2 && Math.floor(a.area1) === area1));
                rent[key] = minPrice(rentValid.filter(a =>
                    Math.floor(a.area2) === area2 && Math.floor(a.area1) === area1));
            }
        }

        return { areas, buy, rent };
    }

    // 단지명을 API로 가져오기 (article의 complexName 필드 활용)
    async function fetchComplexName(complexId, token) {
        try {
            const url = `https://new.land.naver.com/api/articles/complex/${complexId}` +
                `?realEstateType=APT&tradeType=A1&order=prc&page=1`;
            const res = await fetch(url, { headers: { authorization: token } });
            const data = await res.json();
            if (data.articleList && data.articleList.length > 0 && data.articleList[0].complexName) {
                return data.articleList[0].complexName;
            }
            // A1 없으면 B1 시도
            const url2 = `https://new.land.naver.com/api/articles/complex/${complexId}` +
                `?realEstateType=APT&tradeType=B1&order=prc&page=1`;
            const res2 = await fetch(url2, { headers: { authorization: token } });
            const data2 = await res2.json();
            if (data2.articleList && data2.articleList.length > 0 && data2.articleList[0].complexName) {
                return data2.articleList[0].complexName;
            }
        } catch {}
        return null;
    }

    // ══════════════════════════════════════════════
    // 트레킹 패널 UI
    // ══════════════════════════════════════════════
    let _panelCreated = false;
    let _panelEl = null;   // 패널 DOM 참조 (SPA 이동 후 재부착용)

    const STYLES = {
        panel: `
            position:fixed; top:60px; right:10px; z-index:2147483647;
            font-family:-apple-system,BlinkMacSystemFont,'Malgun Gothic',sans-serif;
            font-size:13px; user-select:none;
        `,
        toggleBtn: `
            background:#03C75A; color:white; border:none; border-radius:6px;
            padding:8px 14px; cursor:pointer; font-size:13px; font-weight:bold;
            display:block; margin-left:auto;
            box-shadow:0 2px 8px rgba(0,0,0,.25);
            white-space:nowrap;
        `,
        dropdown: `
            display:none; background:white;
            border:1px solid #ddd; border-radius:8px;
            box-shadow:0 4px 20px rgba(0,0,0,.18);
            margin-top:6px; min-width:400px; max-height:540px;
            overflow-y:auto;
        `,
    };

    function createPanel() {
        if (_panelCreated) return;
        _panelCreated = true;

        const panel = document.createElement('div');
        panel.id = 'nl-track-panel';
        panel.style.cssText = STYLES.panel;
        _panelEl = panel;

        const toggleBtn = document.createElement('button');
        toggleBtn.id = 'nl-track-toggle';
        toggleBtn.style.cssText = STYLES.toggleBtn;
        toggleBtn.onclick = toggleDropdown;

        const dropdown = document.createElement('div');
        dropdown.id = 'nl-track-dropdown';
        dropdown.style.cssText = STYLES.dropdown;

        // ── 헤더 (고정) ──
        const header = document.createElement('div');
        header.style.cssText = 'padding:12px 16px;border-bottom:1px solid #eee;display:flex;flex-direction:column;background:#fafafa;border-radius:8px 8px 0 0;';
        const lastExport = localStorage.getItem(EXPORT_KEY);
        header.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;">
                <span style="font-weight:bold;color:#333;">트레킹 목록</span>
                <div style="display:flex;gap:6px;align-items:center;">
                    <span id="nl-last-export" style="font-size:10px;color:#aaa;white-space:nowrap;">
                        ${lastExport ? `마지막 내보내기: ${lastExport}` : ''}
                    </span>
                    <button id="nl-export-btn"
                        style="background:#f0f9ff;color:#0369a1;border:1px solid #bae6fd;border-radius:4px;
                               padding:5px 10px;cursor:pointer;font-size:12px;">
                        📥 내보내기
                    </button>
                    <button id="nl-run-all-btn"
                        style="background:#03C75A;color:white;border:none;border-radius:4px;
                               padding:5px 14px;cursor:pointer;font-size:12px;font-weight:bold;">
                        전체 실행
                    </button>
                </div>
            </div>
            <div id="nl-storage-warning"
                style="display:none;margin-top:6px;padding:5px 8px;background:#fff7ed;border:1px solid #fed7aa;
                       border-radius:5px;align-items:center;justify-content:space-between;gap:8px;">
                <span style="font-size:11px;color:#c2410c;">⚠️ 누적 기록 용량 부족 — 데이터 초기화 필요</span>
                <button id="nl-clear-history-btn"
                    style="background:#fff1f1;color:#dc2626;border:1px solid #fca5a5;border-radius:4px;
                           padding:3px 10px;cursor:pointer;font-size:11px;white-space:nowrap;">
                    이력 초기화
                </button>
            </div>`;
        header.querySelector('#nl-export-btn').onclick = exportCSV;
        header.querySelector('#nl-run-all-btn').onclick = () => window.__nlRunAll();
        header.querySelector('#nl-clear-history-btn').onclick = () => {
            localStorage.removeItem(HISTORY_KEY);
            checkStorageWarning();
        };
        checkStorageWarning();

        // ── 층수 필터 (고정, 접기/펼치기 가능) ──
        const filterWrap = document.createElement('div');
        filterWrap.style.cssText = 'border-bottom:1px solid #eee;background:#f5f8ff;font-size:11px;';

        // 필터 헤더 (클릭으로 접기/펼치기)
        const filterHeader = document.createElement('div');
        filterHeader.style.cssText = 'padding:6px 14px;display:flex;justify-content:space-between;align-items:center;cursor:pointer;user-select:none;';
        filterHeader.innerHTML = `
            <span style="font-weight:bold;color:#555;">층수 필터</span>
            <span id="nl-filter-arrow" style="color:#aaa;font-size:10px;">▲ 접기</span>`;

        const filterDiv = document.createElement('div');
        filterDiv.id = 'nl-floor-filter';
        filterDiv.style.cssText = 'padding:0 14px 8px;';

        let filterOpen = true;
        filterHeader.addEventListener('click', () => {
            filterOpen = !filterOpen;
            filterDiv.style.display = filterOpen ? '' : 'none';
            filterHeader.querySelector('#nl-filter-arrow').textContent = filterOpen ? '▲ 접기' : '▼ 펼치기';
        });

        filterWrap.appendChild(filterHeader);
        filterWrap.appendChild(filterDiv);

        const fs = getFloorSettings();

        // 토글 버튼 스타일 적용 함수
        function applyToggleStyle(btn, active) {
            btn.textContent = active ? '저층 포함' : '저층 미포함';
            btn.style.cssText = active
                ? 'background:#dbeafe;color:#1d4ed8;border:1px solid #93c5fd;border-radius:4px;padding:2px 10px;cursor:pointer;font-size:11px;font-weight:bold;'
                : 'background:#f3f4f6;color:#9ca3af;border:1px solid #d1d5db;border-radius:4px;padding:2px 10px;cursor:pointer;font-size:11px;';
        }

        // select 옵션 생성 함수
        function makeSelect(id, val) {
            const sel = document.createElement('select');
            sel.id = id;
            sel.style.cssText = 'font-size:11px;padding:2px 4px;border:1px solid #ccc;border-radius:3px;background:white;cursor:pointer;';
            [['0','제외안함'],['1','1층 이하'],['2','2층 이하'],['3','3층 이하'],['4','4층 이하']].forEach(([v, label]) => {
                const opt = document.createElement('option');
                opt.value = v;
                opt.textContent = label;
                if (parseInt(v) === val) opt.selected = true;
                sel.appendChild(opt);
            });
            return sel;
        }

        const rerunNote = document.createElement('div');
        rerunNote.style.cssText = 'color:#aaa;font-size:10px;margin-bottom:7px;';
        rerunNote.textContent = '변경 후 재실행 필요';
        filterDiv.appendChild(rerunNote);

        // 매매 행
        const buyRow = document.createElement('div');
        buyRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:5px;';
        const buyLabel = document.createElement('span');
        buyLabel.style.cssText = 'color:#d44;min-width:26px;font-weight:bold;';
        buyLabel.textContent = '매매';
        const buyToggle = document.createElement('button');
        applyToggleStyle(buyToggle, fs.buy.includeLow);
        const buySelect = makeSelect('nl-buy-excbelow', fs.buy.excludeBelow);
        const buyExcLabel = document.createElement('span');
        buyExcLabel.style.cssText = 'color:#aaa;';
        buyExcLabel.textContent = '제외';
        buyRow.appendChild(buyLabel);
        buyRow.appendChild(buyToggle);
        buyRow.appendChild(buySelect);
        buyRow.appendChild(buyExcLabel);

        // 전세 행
        const rentRow = document.createElement('div');
        rentRow.style.cssText = 'display:flex;align-items:center;gap:8px;';
        const rentLabel = document.createElement('span');
        rentLabel.style.cssText = 'color:#269;min-width:26px;font-weight:bold;';
        rentLabel.textContent = '전세';
        const rentToggle = document.createElement('button');
        applyToggleStyle(rentToggle, fs.rent.includeLow);
        const rentSelect = makeSelect('nl-rent-excbelow', fs.rent.excludeBelow);
        const rentExcLabel = document.createElement('span');
        rentExcLabel.style.cssText = 'color:#aaa;';
        rentExcLabel.textContent = '제외';
        rentRow.appendChild(rentLabel);
        rentRow.appendChild(rentToggle);
        rentRow.appendChild(rentSelect);
        rentRow.appendChild(rentExcLabel);

        filterDiv.appendChild(buyRow);
        filterDiv.appendChild(rentRow);

        // 저장 함수
        const saveFloor = () => {
            saveFloorSettings({
                buy:  { includeLow: buyToggle.dataset.active === '1',  excludeBelow: parseInt(buySelect.value)  },
                rent: { includeLow: rentToggle.dataset.active === '1', excludeBelow: parseInt(rentSelect.value) },
            });
        };

        // 토글 버튼 클릭 이벤트
        buyToggle.dataset.active = fs.buy.includeLow ? '1' : '0';
        buyToggle.addEventListener('click', () => {
            const next = buyToggle.dataset.active !== '1';
            buyToggle.dataset.active = next ? '1' : '0';
            applyToggleStyle(buyToggle, next);
            saveFloor();
        });

        rentToggle.dataset.active = fs.rent.includeLow ? '1' : '0';
        rentToggle.addEventListener('click', () => {
            const next = rentToggle.dataset.active !== '1';
            rentToggle.dataset.active = next ? '1' : '0';
            applyToggleStyle(rentToggle, next);
            saveFloor();
        });

        buySelect.addEventListener('change', saveFloor);
        rentSelect.addEventListener('change', saveFloor);

        // ── 목록 영역 (동적) ──
        const listDiv = document.createElement('div');
        listDiv.id = 'nl-track-list';

        dropdown.appendChild(header);
        dropdown.appendChild(filterWrap);
        dropdown.appendChild(listDiv);

        panel.appendChild(toggleBtn);
        panel.appendChild(dropdown);
        document.body.appendChild(panel);

        renderPanel();
    }

    function toggleDropdown() {
        const dd = document.getElementById('nl-track-dropdown');
        if (!dd) return;
        const isOpen = dd.style.display === 'block';
        dd.style.display = isOpen ? 'none' : 'block';
        if (!isOpen) renderPanel();
    }

    function renderPanel() {
        const list = getTracked();

        // 토글 버튼 텍스트
        const toggle = document.getElementById('nl-track-toggle');
        if (toggle) toggle.textContent = `📍 트레킹 (${list.length})`;

        checkStorageWarning();

        const dd = document.getElementById('nl-track-dropdown');
        if (!dd || dd.style.display === 'none') return;

        // 목록 영역만 업데이트 (필터 섹션은 createPanel에서 고정 생성됨)
        const listDiv = document.getElementById('nl-track-list');
        if (!listDiv) return;

        if (!list.length) {
            listDiv.innerHTML = `
                <div style="padding:24px;text-align:center;color:#888;line-height:1.7;">
                    트레킹 중인 단지가 없습니다.<br/>
                    <span style="font-size:12px;">단지 패널의 📌 아이콘을 클릭하여 추가하세요.</span>
                </div>`;
            return;
        }

        const rows = list.map(item => {
            const areaKey = item.selectedArea !== null ? item.selectedArea : 'all';
            const cache   = item.priceCache;

            const buyDisplay  = cache
                ? (cache.buy[areaKey]  != null ? formatPrice(cache.buy[areaKey])  : '매물없음')
                : '-';
            const rentDisplay = cache
                ? (cache.rent[areaKey] != null ? formatPrice(cache.rent[areaKey]) : '매물없음')
                : '-';

            const areasNorm = (item.areas || []).map(a =>
                typeof a === 'number' ? { area2: a, types: [] } : a);

            const areaWidget = !cache
                ? `<span style="font-size:10px;color:#bbb;">실행 후 선택 가능</span>`
                : (() => {
                    const opts = areasNorm.map(({ area2, types }) => {
                        const selArea = item.selectedArea === area2 ? 'selected' : '';
                        if (types.length >= 2) {
                            const typeOpts = types.map(area1 => {
                                const key = `${area2}_${area1}`;
                                const sel = item.selectedArea === key ? 'selected' : '';
                                return `<option value="${key}" ${sel}>${area2}㎡ · 공급${area1}㎡</option>`;
                            }).join('');
                            return `<optgroup label="${area2}㎡">
                                        <option value="${area2}" ${selArea}>${area2}㎡ 전체</option>
                                        ${typeOpts}
                                    </optgroup>`;
                        }
                        return `<option value="${area2}" ${selArea}>${area2}㎡</option>`;
                    }).join('');
                    return `<select onchange="window.__nlSetArea('${item.complexId}', this.value)"
                                style="font-size:11px;padding:2px 4px;
                                       border:1px solid #ddd;border-radius:3px;color:#444;
                                       background:white;cursor:pointer;max-width:120px;">
                                <option value="">전체</option>
                                ${opts}
                            </select>`;
                })();

            return `
            <tr id="nl-row-${item.complexId}" style="border-top:1px solid #f0f0f0;">
                <td style="padding:10px 14px;max-width:120px;">
                    <a href="/complexes/${item.complexId}"
                       onclick="sessionStorage.setItem('nl_reopen','1');"
                       style="font-weight:500;color:#333;text-decoration:none;
                              overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
                              display:block;max-width:120px;cursor:pointer;"
                       title="${item.name}"
                       onmouseover="this.style.textDecoration='underline'"
                       onmouseout="this.style.textDecoration='none'">${item.name}</a>
                </td>
                <td style="padding:10px 8px;text-align:center;">${areaWidget}</td>
                <td id="nl-buy-${item.complexId}"
                    style="padding:10px 8px;text-align:right;color:#d44;min-width:80px;">${buyDisplay}</td>
                <td id="nl-rent-${item.complexId}"
                    style="padding:10px 8px;text-align:right;color:#269;min-width:80px;">${rentDisplay}</td>
                <td style="padding:10px 10px;text-align:center;white-space:nowrap;">
                    <button onclick="window.__nlRun('${item.complexId}')"
                        style="background:#e8f4ff;color:#0284c7;border:1px solid #bae0fd;
                               border-radius:4px;padding:3px 9px;cursor:pointer;font-size:11px;">실행</button>
                    <button onclick="window.__nlRemove('${item.complexId}')"
                        style="background:#fff1f1;color:#dc2626;border:1px solid #fca5a5;
                               border-radius:4px;padding:3px 7px;cursor:pointer;font-size:11px;margin-left:3px;">✕</button>
                </td>
            </tr>`;
        }).join('');

        listDiv.innerHTML = `
            <table style="width:100%;border-collapse:collapse;">
                <thead>
                    <tr style="background:#f8f8f8;font-size:11px;color:#999;">
                        <th style="padding:7px 14px;text-align:left;font-weight:normal;">단지명</th>
                        <th style="padding:7px 8px;text-align:center;font-weight:normal;">전용면적</th>
                        <th style="padding:7px 8px;text-align:right;font-weight:normal;">매매최저 ▲</th>
                        <th style="padding:7px 8px;text-align:right;font-weight:normal;">전세최저</th>
                        <th style="padding:7px 10px;"></th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>`;
    }

    // ══════════════════════════════════════════════
    // 가격 조회 실행
    // ══════════════════════════════════════════════
    async function runForComplex(complexId) {
        const buyEl  = document.getElementById(`nl-buy-${complexId}`);
        const rentEl = document.getElementById(`nl-rent-${complexId}`);
        if (!buyEl || !rentEl) return;

        buyEl.textContent  = '⏳';
        rentEl.textContent = '⏳';

        try {
            const token  = await fetchToken();
            const result = await fetchAllPrices(complexId, token, getFloorSettings());

            // 캐시 저장
            const list = getTracked();
            const item = list.find(x => x.complexId === complexId);
            if (item) {
                item.areas      = result.areas;
                item.priceCache = { buy: result.buy, rent: result.rent };
                saveTracked(list);
                saveHistoryForComplex(complexId, item.name, result);
            }

            // 패널 전체 다시 그리기 (드롭다운 + 가격 모두 반영)
            renderPanel();
        } catch (e) {
            buyEl.textContent  = '오류';
            rentEl.textContent = '오류';
            console.error('[NL트레킹] 가격 조회 실패:', complexId, e);
        }
    }

    window.__nlRun = async (complexId) => {
        await runForComplex(complexId);
    };

    window.__nlRunAll = async (queue) => {
        const ids = queue || getTracked().map(x => x.complexId);
        for (const complexId of ids) {
            // 남은 큐를 sessionStorage에 계속 갱신 (페이지 이동 대비)
            const remaining = ids.slice(ids.indexOf(complexId));
            sessionStorage.setItem('nl_run_queue', JSON.stringify(remaining));

            await runForComplex(complexId);
            await new Promise(r => setTimeout(r, 600));
        }
        sessionStorage.removeItem('nl_run_queue');
    };

    window.__nlSetArea = (complexId, areaStr) => {
        const list = getTracked();
        const item = list.find(x => x.complexId === complexId);
        if (!item) return;
        // null=전체, number=전용면적 전체, "59_74"=타입 지정
        if (!areaStr)                item.selectedArea = null;
        else if (areaStr.includes('_')) item.selectedArea = areaStr;
        else                         item.selectedArea = parseInt(areaStr);
        saveTracked(list);

        // 캐시에서 즉시 가격 표시 (API 재호출 없음)
        if (!item.priceCache) return;
        const key     = item.selectedArea !== null ? item.selectedArea : 'all';
        const buyVal  = item.priceCache.buy[key];
        const rentVal = item.priceCache.rent[key];
        const buyEl   = document.getElementById(`nl-buy-${complexId}`);
        const rentEl  = document.getElementById(`nl-rent-${complexId}`);
        if (buyEl)  buyEl.textContent  = buyVal  !== null && buyVal  !== undefined ? formatPrice(buyVal)  : '매물없음';
        if (rentEl) rentEl.textContent = rentVal !== null && rentVal !== undefined ? formatPrice(rentVal) : '매물없음';
    };

    window.__nlRemove = (complexId) => {
        removeTracked(complexId);
        renderPanel();
        refreshTrackingIcon(complexId, false);
    };


    // ══════════════════════════════════════════════
    // 단지 패널 아이콘 주입
    // ══════════════════════════════════════════════
    let _lastInjectedId = null;

    function getCurrentComplexId() {
        const m = location.pathname.match(/\/complexes\/(\d+)/);
        return m ? m[1] : null;
    }

    // 단지명 DOM에서 추출
    function getComplexNameFromDOM() {
        const el = findNameEl();
        if (el) return el.textContent.replace(/[☆★]/g, '').trim();
        // 폴백: document.title ("단지명 : 네이버 부동산" / "단지명 - 네이버 부동산")
        const titleMatch = document.title.match(/^(.+?)\s*[\:\-\|]/);
        if (titleMatch) return titleMatch[1].trim();
        return null;
    }

    /**
     * 단지명 요소 탐색 전략 (우선순위 순)
     *
     * 1) [class*="complex"][class*="name"] 류 복합 속성 셀렉터
     *    → Next.js 해시 클래스에도 "complex"+"name" 두 단어가 들어가면 매칭
     * 2) 단지 detail 영역 안 첫 번째 <strong> 또는 heading
     * 3) Naver 즐겨찾기(☆/★) 버튼의 인접 형제 또는 부모 heading
     * 4) 없으면 null → 재시도 or 플로팅 버튼 폴백
     */
    function findNameEl() {
        // 전략 1: 복합 class 속성 매칭 (대소문자 4가지 조합)
        const compound = [
            '[class*="complex"][class*="name"]',
            '[class*="Complex"][class*="name"]',
            '[class*="complex"][class*="Name"]',
            '[class*="Complex"][class*="Name"]',
            '[class*="complex"][class*="title"]',
            '[class*="Complex"][class*="Title"]',
            '[class*="complex_title"]',
            '[class*="complexTitle"]',
            '[class*="ComplexTitle"]',
            '[class*="complex-title"]',
        ];
        for (const sel of compound) {
            const el = document.querySelector(sel);
            // 자식에 또 다른 블록 요소가 있으면 건너뜀 (컨테이너일 가능성)
            if (el && el.textContent.trim() && el.children.length <= 3) return el;
        }

        // 전략 2: "complex" 포함 컨테이너 안의 heading/strong
        const containers = document.querySelectorAll(
            '[class*="complex"],[class*="Complex"],[class*="detail"],[class*="Detail"]'
        );
        for (const c of containers) {
            const h = c.querySelector('h1,h2,h3,strong');
            if (h && h.textContent.trim().length > 1 && !h.querySelector('svg,img')) return h;
        }

        // 전략 3: Naver 즐겨찾기 버튼(☆) 인접 요소
        const starBtns = [...document.querySelectorAll('button,span,i')]
            .filter(el => /[☆★]/.test(el.textContent) || (el.getAttribute('aria-label') || '').includes('관심'));
        for (const btn of starBtns) {
            // 형제 요소 중 텍스트가 있는 heading
            const parent = btn.parentElement;
            if (!parent) continue;
            const sibling = parent.querySelector('h1,h2,h3,strong,[class*="name"],[class*="title"]');
            if (sibling && sibling !== btn && sibling.textContent.trim()) return sibling;
            // 한 단계 위
            const gp = parent.parentElement;
            if (gp) {
                const cousin = gp.querySelector('h1,h2,h3,strong');
                if (cousin && cousin.textContent.trim()) return cousin;
            }
        }

        return null;
    }

    function refreshTrackingIcon(_complexId, tracked) {
        const icon = document.getElementById('nl-track-icon');
        if (!icon) return;
        icon.textContent = tracked ? '📍' : '📌';
        icon.title       = tracked ? '트레킹 중 (클릭하여 제거)' : '트레킹에 추가';
    }

    function injectTrackingIcon(complexId) {
        if (_lastInjectedId === complexId) return;

        // 기존 아이콘 제거
        document.getElementById('nl-track-icon')?.remove();

        const nameEl = findNameEl();

        // ── 폴백: 요소 못 찾으면 플로팅 버튼으로 표시 ──────────────
        if (!nameEl) {
            // 플로팅 버튼은 이미 트레킹 패널 위에 있으므로
            // 여기서는 재시도만 허용 (null 반환 → interval이 재시도)
            console.debug('[NL트레킹] 단지명 요소 미발견, 재시도 대기...');
            return;
        }

        const icon = document.createElement('button');
        icon.id = 'nl-track-icon';
        icon.style.cssText = `
            background:none; border:none; cursor:pointer;
            font-size:18px; padding:0 4px; vertical-align:middle;
            line-height:1; outline:none;
            transition:transform 0.15s;
        `;
        icon.onmouseenter = () => { icon.style.transform = 'scale(1.3)'; };
        icon.onmouseleave = () => { icon.style.transform = 'scale(1)'; };

        const tracked = isTracked(complexId);
        icon.textContent = tracked ? '📍' : '📌';
        icon.title       = tracked ? '트레킹 중 (클릭하여 제거)' : '트레킹에 추가';

        icon.onclick = async () => {
            if (isTracked(complexId)) {
                removeTracked(complexId);
                icon.textContent = '📌';
                icon.title = '트레킹에 추가';
            } else {
                // 단지명 추출 (DOM 우선, 없으면 API)
                let name = getComplexNameFromDOM() || `단지#${complexId}`;
                // API로도 시도
                if (name.startsWith('단지#')) {
                    try {
                        const token = await fetchToken();
                        const apiName = await fetchComplexName(complexId, token);
                        if (apiName) name = apiName;
                    } catch {}
                }
                addTracked(complexId, name);
                icon.textContent = '📍';
                icon.title = '트레킹 중 (클릭하여 제거)';
            }
            renderPanel();
        };

        nameEl.appendChild(icon);
        _lastInjectedId = complexId;
    }

    // ══════════════════════════════════════════════
    // URL 변경 감지 (SPA 대응)
    // ══════════════════════════════════════════════
    function onRouteChange() {
        // SPA 이동 후 패널이 DOM에서 제거됐으면 드롭다운 상태 유지하며 재부착
        if (_panelEl && !document.body.contains(_panelEl)) {
            document.body.appendChild(_panelEl);
        }

        const complexId = getCurrentComplexId();
        if (!complexId) {
            _lastInjectedId = null;
            document.getElementById('nl-track-icon')?.remove();
            return;
        }

        // DOM이 로드될 때까지 재시도
        let attempts = 0;
        const timer = setInterval(() => {
            injectTrackingIcon(complexId);
            attempts++;
            if (_lastInjectedId === complexId || attempts >= 30) {
                clearInterval(timer);
            }
        }, 300);
    }

    // history.pushState / replaceState 오버라이드
    ['pushState', 'replaceState'].forEach(method => {
        const orig = history[method].bind(history);
        history[method] = function (...args) {
            orig(...args);
            setTimeout(onRouteChange, 150);
        };
    });
    window.addEventListener('popstate', () => setTimeout(onRouteChange, 150));

    // MutationObserver: DOM 변경 시 아이콘 재주입 시도
    const observer = new MutationObserver(() => {
        const complexId = getCurrentComplexId();
        if (complexId && _lastInjectedId !== complexId) {
            injectTrackingIcon(complexId);
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // ══════════════════════════════════════════════
    // 초기화
    // ══════════════════════════════════════════════
    createPanel();
    onRouteChange();

    // 트래킹 목록 링크 클릭 후 페이지 리로드 → 패널 자동 복원 + 실행 이어받기
    if (sessionStorage.getItem('nl_reopen') === '1') {
        sessionStorage.removeItem('nl_reopen');
        const dd = document.getElementById('nl-track-dropdown');
        if (dd) {
            dd.style.display = 'block';
            renderPanel();
        }
        // 실행 중이던 큐가 있으면 이어서 실행
        const savedQueue = sessionStorage.getItem('nl_run_queue');
        if (savedQueue) {
            const queue = JSON.parse(savedQueue);
            if (queue && queue.length > 0) {
                setTimeout(() => window.__nlRunAll(queue), 800);
            }
        }
    }

})();
