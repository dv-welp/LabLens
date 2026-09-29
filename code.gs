/**
 * Mobile Lab Notebook Web App — server side (Code.gs)
 * Revised for safe mixed-format cells, rich text/background rendering,
 * editable Day view, and fewer initial reads.
 */

const HISTORY_SHEET_NAME = '_History';
const MAX_DAY_VIEW_SHEETS = 8;

function doGet() {
  return HtmlService.createTemplateFromFile('index').evaluate()
    .setTitle('Lab Notebook')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ============================== UTIL =========================================
function isDateValue_(v) { return v instanceof Date && !isNaN(v.getTime()); }
function tz_() { return Session.getScriptTimeZone() || 'Etc/UTC'; }
function isoFromDate_(d) { return Utilities.formatDate(d, tz_(), 'yyyy-MM-dd'); }
function dateFromIso_(iso) {
  const p = iso.split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
}
function weekdayAbbrev_(d) { return Utilities.formatDate(d, tz_(), 'EEE'); }
function todayIso_() { return isoFromDate_(new Date()); }
function normText_(v) { return v === null || v === undefined ? '' : String(v).trim(); }
function isBlank_(v) { return normText_(v) === ''; }

// ============================== CLASSIFICATION ================================
function classifySheet_(data) {
  const nRows = data.length;
  const colA = data.map(function (r) { return r[0]; });
  let nextRowIdx = -1, beforeRowIdx = -1;
  for (let r = 0; r < nRows; r++) {
    const t = normText_(colA[r]).toLowerCase();
    if (t === 'next' && nextRowIdx === -1) nextRowIdx = r;
    if (t === 'before' && beforeRowIdx === -1) beforeRowIdx = r;
  }
  const dateRowIdxs = [];
  for (let r = 0; r < nRows; r++) if (isDateValue_(colA[r])) dateRowIdxs.push(r);
  if (dateRowIdxs.length >= 1) {
    return {
      type: 'dateMatrix',
      dateRowIdxs: dateRowIdxs,
      nextRowIdx: nextRowIdx,
      beforeRowIdx: beforeRowIdx,
      // Plan-like when there are no special summary rows. Individual cells
      // on Experiment-like sheets are still classified by their own content.
      planLike: nextRowIdx === -1 && beforeRowIdx === -1,
      headerRowIdx: findPlanHeaderRow_(data, dateRowIdxs, nextRowIdx, beforeRowIdx)
    };
  }

  const maxHeaderScan = Math.min(3, nRows);
  for (let hr = 0; hr < maxHeaderScan; hr++) {
    const row = data[hr] || [];
    let nextColIdx = -1, beforeColIdx = -1, labelColIdx = -1;
    for (let c = 0; c < row.length; c++) {
      const t = normText_(row[c]).toLowerCase();
      if (t === 'next' && nextColIdx === -1) nextColIdx = c;
      if (t === 'before' && beforeColIdx === -1) beforeColIdx = c;
      if (t === 'genotype' && labelColIdx === -1) labelColIdx = c;
    }
    const dateColIdxs = [];
    for (let c = 0; c < row.length; c++) if (isDateValue_(row[c])) dateColIdxs.push(c);
    if (dateColIdxs.length >= 2 && (nextColIdx >= 0 || beforeColIdx >= 0)) {
      if (labelColIdx === -1) {
        for (let c = 0; c < dateColIdxs[0]; c++) {
          if (c === nextColIdx || c === beforeColIdx) continue;
          if (!isBlank_(row[c])) { labelColIdx = c; break; }
        }
      }
      return {
        type: 'invertedDateMatrix',
        headerRowIdx: hr,
        dateColIdxs: dateColIdxs,
        nextColIdx: nextColIdx,
        beforeColIdx: beforeColIdx,
        labelColIdx: labelColIdx
      };
    }
  }
  return { type: 'generic' };
}

function findPlanHeaderRow_(data, dateRowIdxs, nextRowIdx, beforeRowIdx) {
  if (nextRowIdx >= 0 || beforeRowIdx >= 0 || !Array.isArray(dateRowIdxs) || dateRowIdxs.length === 0) return -1;
  const firstDate = Math.min.apply(null, dateRowIdxs);
  // The Plan sheet has a literal Date header in column A on the row above its
  // first date. Prefer that row; otherwise fall back to the nearest non-summary
  // row above the first date.
  for (let r = firstDate - 1; r >= 0; r--) {
    if (normText_(data[r] && data[r][0]).toLowerCase() === 'date') return r;
  }
  return firstDate > 0 ? firstDate - 1 : -1;
}

function resolveColumnHeaderCell_(data, backgrounds, rich, beforeRow, col, specialRows) {
  const safeData = data || [], safeBg = backgrounds || [], safeRich = rich || [], specials = specialRows || [];
  for (let r = beforeRow - 1; r >= 0; r--) {
    if (specials.indexOf(r) !== -1) continue;
    const row = safeData[r] || [];
    if (!isBlank_(row[col])) {
      const b = (safeBg[r] || [])[col] || null;
      const rr = (safeRich[r] || [])[col] || null;
      return { row: r, cell: richCell_(row[col], b, rr) };
    }
  }
  return { row: -1, cell: richCell_('(col ' + (col + 1) + ')', null, null) };
}

function resolveColumnHeader_(data, beforeRow, col, specialRows) {
  for (let r = beforeRow - 1; r >= 0; r--) {
    if (specialRows.indexOf(r) !== -1) continue;
    if (!isBlank_(data[r][col])) return normText_(data[r][col]);
  }
  return '(col ' + (col + 1) + ')';
}

function richTextRuns_(rt) {
  if (!rt || typeof rt.getText !== 'function') return [];
  let text = '';
  try { text = rt.getText() || ''; } catch (e) { return []; }
  let runs = null;
  try { runs = rt.getRuns(); } catch (e) { runs = null; }
  if (!runs || typeof runs.length !== 'number' || runs.length === 0) {
    if (!text) return [];
    try {
      const st = rt.getTextStyle();
      return [{ start: 0, end: text.length, bold: !!st.isBold(), italic: !!st.isItalic(),
        underline: !!st.isUnderline(), strikethrough: !!st.isStrikethrough() }];
    } catch (e) {
      return [{ start: 0, end: text.length, bold: false, italic: false, underline: false, strikethrough: false }];
    }
  }
  const out = [];
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    if (!run) continue;
    try {
      const st = run.getTextStyle();
      out.push({ start: run.getStartIndex(), end: run.getEndIndex(),
        bold: !!st.isBold(), italic: !!st.isItalic(),
        underline: !!st.isUnderline(), strikethrough: !!st.isStrikethrough() });
    } catch (e) {}
  }
  return out;
}

function richCell_(value, background, rt) {
  const text = value === null || value === undefined ? '' : String(value);
  return { text: text, background: background || null, runs: richTextRuns_(rt) };
}

function sliceRuns_(runs, start, end) {
  // `runs` may be an Apps Script server-side collection, not a native
  // JavaScript Array. Iterate by index rather than calling Array.map().
  const out = [];
  if (!runs || !runs.length) return out;
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    const a = Math.max(r.start, start), b = Math.min(r.end, end);
    if (a >= b) continue;
    out.push({
      start: a - start, end: b - start,
      bold: !!r.bold, italic: !!r.italic,
      underline: !!r.underline, strikethrough: !!r.strikethrough
    });
  }
  return out;
}

function bulletObjects_(text, runs, start, end, separator) {
  const chunk = text.slice(start, end);
  if (!chunk.trim()) return [];
  const parts = chunk.split(separator);
  const out = [];
  let cursor = start;
  parts.forEach(function (part, i) {
    const pStart = cursor, pEnd = cursor + part.length;
    if (part.trim()) {
      const leading = part.search(/\S|$/);
      const trailing = part.replace(/\s+$/, '').length;
      const actualStart = pStart + leading;
      const actualEnd = pStart + trailing;
      out.push({ text: text.slice(actualStart, actualEnd), runs: sliceRuns_(runs, actualStart, actualEnd) });
    }
    cursor = pEnd + (i < parts.length - 1 ? separator.length : 0);
  });
  return out;
}

// ============================== SHEET READ ====================================
function readSheet_(sh) {
  const lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (!lastRow || !lastCol) return { data: [], backgrounds: [], rich: [] };
  const range = sh.getRange(1, 1, lastRow, lastCol);
  return {
    data: range.getValues(),
    backgrounds: range.getBackgrounds(),
    rich: range.getRichTextValues()
  };
}

function getSheetMeta_() {
  const ss = SpreadsheetApp.getActive();
  return ss.getSheets().filter(function (sh) { return sh.getName() !== HISTORY_SHEET_NAME; }).map(function (sh) {
    const lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
    let structure = { type: 'generic' };
    if (lastRow && lastCol) {
      // Classification only needs column A plus the first three header rows.
      // Do not read formatting/rich text, or the whole workbook, just to build the menu.
      const colA = sh.getRange(1, 1, lastRow, 1).getValues();
      const dates = colA.filter(function (r) { return isDateValue_(r[0]); }).length;
      if (dates >= 2) {
        let nextRowIdx = -1, beforeRowIdx = -1;
        colA.forEach(function (r, i) {
          const t = normText_(r[0]).toLowerCase();
          if (t === 'next' && nextRowIdx === -1) nextRowIdx = i;
          if (t === 'before' && beforeRowIdx === -1) beforeRowIdx = i;
        });
        const dateRowIdxs = [];
        colA.forEach(function (r, i) { if (isDateValue_(r[0])) dateRowIdxs.push(i); });
        structure = { type: 'dateMatrix', dateRowIdxs: dateRowIdxs, nextRowIdx: nextRowIdx,
          beforeRowIdx: beforeRowIdx, planLike: nextRowIdx === -1 && beforeRowIdx === -1,
          headerRowIdx: (nextRowIdx === -1 && beforeRowIdx === -1) ? findPlanHeaderRow_(colA, dateRowIdxs, nextRowIdx, beforeRowIdx) : -1 };
      } else {
        const scanRows = Math.min(3, lastRow);
        const top = sh.getRange(1, 1, scanRows, lastCol).getValues();
        structure = classifySheet_(top);
      }
    }
    return { sheet: sh, name: sh.getName(), structure: structure,
      supportsDayView: structure.type === 'dateMatrix' || structure.type === 'invertedDateMatrix' };
  });
}

function classifyAllSheets_() {
  // Kept as a compatibility helper for callers that need fully-read sheets.
  return getSheetMeta_().map(function (x) {
    x.read = readSheet_(x.sheet);
    return x;
  });
}

function getWorkbookMeta() {
  return getSheetMeta_().map(function (x) {
    return { name: x.name, type: x.structure.type, supportsDayView: x.supportsDayView };
  });
}

function buildDateMatrixGrid_(sheetName, read, structure) {
  const data = read.data || [], bg = read.backgrounds || [], rich = read.rich || [];
  const dateRows = Array.isArray(structure.dateRowIdxs) ? structure.dateRowIdxs : [];
  if (!dateRows.length || !data.length) return { type:'dateMatrix', sheetName:sheetName, dateCol:0, planLike:!!structure.planLike, columns:[], rows:[] };
  const special = [structure.nextRowIdx, structure.beforeRowIdx].filter(function (i) { return typeof i === 'number' && i >= 0; });
  const firstDateRow = Math.min.apply(null, dateRows);
  const nCols = data[0] && typeof data[0].length === 'number' ? data[0].length : 0;
  const columns = [];
  for (let c = 1; c < nCols; c++) {
    const hc = resolveColumnHeaderCell_(data, bg, rich, firstDateRow, c, special).cell;
    const nr = structure.nextRowIdx >= 0 ? (data[structure.nextRowIdx] || [])[c] : null;
    const nb = structure.beforeRowIdx >= 0 ? (data[structure.beforeRowIdx] || [])[c] : null;
    const nbg = structure.nextRowIdx >= 0 ? ((bg[structure.nextRowIdx] || [])[c] || null) : null;
    const bbg = structure.beforeRowIdx >= 0 ? ((bg[structure.beforeRowIdx] || [])[c] || null) : null;
    const nrt = structure.nextRowIdx >= 0 ? ((rich[structure.nextRowIdx] || [])[c] || null) : null;
    const brt = structure.beforeRowIdx >= 0 ? ((rich[structure.beforeRowIdx] || [])[c] || null) : null;
    columns.push({ col:c, header:hc.text, headerCell:hc, next:structure.nextRowIdx >= 0 ? richCell_(nr,nbg,nrt):null, before:structure.beforeRowIdx >= 0 ? richCell_(nb,bbg,brt):null });
  }
  const rows = dateRows.map(function (r) {
    const row=data[r]||[], brow=bg[r]||[], rrow=rich[r]||[], cells={};
    for (let c=1;c<nCols;c++) {
      const value=normText_(row[c]), color=brow[c];
      if (value!=='' || (color && String(color).toLowerCase()!=='#ffffff')) cells[c]=richCell_(value,color,rrow[c]);
    }
    const d=row[0];
    return {row:r,date:isDateValue_(d)?isoFromDate_(d):'',weekday:isDateValue_(d)?weekdayAbbrev_(d):'',labelCell:richCell_(d,brow[0],rrow[0]),cells:cells};
  });
  return {type:'dateMatrix',sheetName:sheetName,dateCol:0,planLike:!!structure.planLike,columns:columns,rows:rows};
}

function buildInvertedGrid_(sheetName, read, structure) {
  const data = (read && read.data) || [], bg = (read && read.backgrounds) || [], rich = (read && read.rich) || [];
  const headerRow = data[structure.headerRowIdx];
  const dateColumns = structure.dateColIdxs.map(function (c) {
    const d = headerRow[c];
    return { col: c, date: isoFromDate_(d), weekday: weekdayAbbrev_(d), headerCell: richCell_(d, bg[structure.headerRowIdx][c], rich[structure.headerRowIdx][c]) };
  });
  const entities = [];
  for (let r = structure.headerRowIdx + 1; r < data.length; r++) {
    const labelVal = structure.labelColIdx >= 0 ? normText_(data[r][structure.labelColIdx]) : '';
    const hasAny = structure.dateColIdxs.some(function (c) { return !isBlank_(data[r][c]); });
    if (labelVal === '' && !hasAny) continue;
    const cells = {};
    structure.dateColIdxs.forEach(function (c) {
      const value = normText_(data[r][c]);
      if (value !== '' || (bg[r][c] && bg[r][c].toLowerCase() !== '#ffffff')) cells[c] = richCell_(value, bg[r][c], rich[r][c]);
    });
    entities.push({ row: r, label: labelVal || '(row ' + (r + 1) + ')', labelCell: richCell_(data[r][structure.labelColIdx], bg[r][structure.labelColIdx], rich[r][structure.labelColIdx]),
      next: structure.nextColIdx >= 0 ? richCell_(data[r][structure.nextColIdx], bg[r][structure.nextColIdx], rich[r][structure.nextColIdx]) : null,
      before: structure.beforeColIdx >= 0 ? richCell_(data[r][structure.beforeColIdx], bg[r][structure.beforeColIdx], rich[r][structure.beforeColIdx]) : null, cells: cells });
  }
  return { type: 'invertedDateMatrix', sheetName: sheetName,
    labelCol: structure.labelColIdx, dateColumns: dateColumns, entities: entities };
}

function buildGenericGrid_(sheetName, read) {
  const data = read.data, bg = read.backgrounds, rich = read.rich;
  return { type: 'generic', sheetName: sheetName, rows: (data || []).map(function (r, ri) {
    r = r || []; const br = bg[ri] || [], rr = rich[ri] || [];
    return r.map(function (v, ci) { return richCell_(v, br[ci], rr[ci]); });
  }) };
}

function getGrid(sheetName) {
  const sh = SpreadsheetApp.getActive().getSheetByName(sheetName);
  if (!sh) throw new Error('Sheet not found: ' + sheetName);
  const read = readSheet_(sh);
  if (!read.data.length) return { type: 'generic', sheetName: sheetName, rows: [] };
  const structure = classifySheet_(read.data);
  if (structure.type === 'dateMatrix') return buildDateMatrixGrid_(sheetName, read, structure);
  if (structure.type === 'invertedDateMatrix') return buildInvertedGrid_(sheetName, read, structure);
  return buildGenericGrid_(sheetName, read);
}

function readDaySheet_(sh, structure, dateIso) {
  const lastRow=sh.getLastRow(), lastCol=sh.getLastColumn();
  if (!lastRow || !lastCol) return {data:[],backgrounds:[],rich:[]};
  const data=[], backgrounds=[], rich=[];
  function ensureRow(r){ while(data.length<=r) data.push([]); while(backgrounds.length<=r) backgrounds.push([]); while(rich.length<=r) rich.push([]); }
  function copyRange(row,col,nr,nc){
    if(row<1||col<1||nr<=0||nc<=0)return;
    const rg=sh.getRange(row,col,nr,nc), vals=rg.getValues(), bgs=rg.getBackgrounds(), rts=rg.getRichTextValues();
    for(let r=0;r<nr;r++){ ensureRow(row-1+r); for(let c=0;c<nc;c++){ data[row-1+r][col-1+c]=(vals[r]&&vals[r][c]!==undefined)?vals[r][c]:''; backgrounds[row-1+r][col-1+c]=(bgs[r]&&bgs[r][c])?bgs[r][c]:'#ffffff'; rich[row-1+r][col-1+c]=(rts[r]&&rts[r][c])?rts[r][c]:null; }}
  }
  if(structure.type==='dateMatrix'){
    const colA=sh.getRange(1,1,lastRow,1).getValues(); let target=-1,firstDate=-1;
    for(let r=0;r<lastRow;r++){const v=colA[r]&&colA[r][0]; if(!isDateValue_(v))continue; if(firstDate<0)firstDate=r; if(isoFromDate_(v)===dateIso)target=r;}
    if(firstDate<0)return {data:[],backgrounds:[],rich:[]};
    if(structure.planLike){
      let hr=typeof structure.headerRowIdx==='number'?structure.headerRowIdx:-1;
      if(hr<0){for(let r=firstDate-1;r>=0;r--){if(normText_((colA[r]||[])[0]).toLowerCase()==='date'){hr=r;break;}}}
      if(hr>=0)copyRange(hr+1,1,1,lastCol);
      if(target>=0)copyRange(target+1,1,1,lastCol);
    } else {
      copyRange(1,1,Math.min(firstDate+1,lastRow),lastCol);
      if(target>=0)copyRange(target+1,1,1,lastCol);
      if(structure.nextRowIdx>=0)copyRange(structure.nextRowIdx+1,1,1,lastCol);
      if(structure.beforeRowIdx>=0)copyRange(structure.beforeRowIdx+1,1,1,lastCol);
    }
    for(let r=0;r<lastRow;r++){ensureRow(r);data[r][0]=(colA[r]&&colA[r][0]!==undefined)?colA[r][0]:'';}
    return {data:data,backgrounds:backgrounds,rich:rich};
  }
  if(structure.type==='invertedDateMatrix'){
    const hr=structure.headerRowIdx; copyRange(hr+1,1,1,lastCol); const header=(data[hr]||[]); let dc=-1;
    for(let c=0;c<header.length;c++)if(isDateValue_(header[c])&&isoFromDate_(header[c])===dateIso){dc=c;break;}
    if(dc>=0&&hr+2<=lastRow)copyRange(hr+2,dc+1,lastRow-(hr+1),1);
    [structure.labelColIdx,structure.nextColIdx,structure.beforeColIdx].forEach(function(c){if(c>=0&&hr+2<=lastRow)copyRange(hr+2,c+1,lastRow-(hr+1),1);});
    return {data:data,backgrounds:backgrounds,rich:rich};
  }
  return readSheet_(sh);
}

function buildDayTable_(sheetName, read, structure, dateIso) {
  const data = read.data, bg = read.backgrounds, rich = read.rich;
  const entries = [];

  function visibleCell_(r, c) {
    const value = normText_(data[r] && data[r][c]);
    const color = bg[r] && bg[r][c];
    return value !== '' || (color && color.toLowerCase() !== '#ffffff');
  }

  function addCell_(label, row, col) {
    const raw = normText_((data[row] || [])[col]);
    const background = (bg[row] && bg[row][col]) || null;
    const runs = (rich[row] && rich[row][col]) || [];
    const parsed = parseCellSectionsRich_(raw, runs);

    if (structure.planLike) {
      const display = splitPlanDisplay_(raw);
      const bullets = bulletObjects_(display.text, runs, 0, display.text.length, '\\n');
      if (!display.text && (!background || background.toLowerCase() === '#ffffff')) return;
      entries.push({
        row: row, col: col, label: label, mode: 'planText',
        text: bullets, rich: bullets, writtenDates: display.writtenDates,
        background: background
      });
      return;
    }

    const sections = parsed.sections || {log: [], comment: [], next: []};
    if (!sections.log.length && !sections.comment.length && !sections.next.length &&
        (!background || background.toLowerCase() === '#ffffff')) return;

    entries.push({
      row: row, col: col, label: label, mode: 'delimited',
      sections: sections, background: background
    });
  }

  if (structure.type === 'dateMatrix') {
    let target = -1;
    for (let r = 0; r < data.length; r++) {
      if (isDateValue_(data[r][0]) && isoFromDate_(data[r][0]) === dateIso) {
        target = r; break;
      }
    }
    if (target < 0) return { sheetName: sheetName, entries: [] };

    const firstDateRow = structure.dateRowIdxs && structure.dateRowIdxs.length ? Math.min.apply(null, structure.dateRowIdxs) : target;
    const special = [structure.nextRowIdx, structure.beforeRowIdx].filter(function(i){ return i >= 0; });
    const headerRow = structure.planLike && structure.headerRowIdx >= 0 ? structure.headerRowIdx : -1;
    const row = data[target] || [];
    for (let c = 1; c < row.length; c++) {
      if (!visibleCell_(target, c)) continue;
      let label;
      if (headerRow >= 0) label = normText_((data[headerRow] || [])[c]);
      else label = resolveColumnHeaderCell_(data, bg, rich, firstDateRow, c, special).cell.text;
      addCell_(label || '(col ' + (c + 1) + ')', target, c);
    }
  } else if (structure.type === 'invertedDateMatrix') {
    const hr = structure.headerRowIdx, headerRow = data[hr] || [];
    let targetCol = -1;
    for (let c = 0; c < headerRow.length; c++) {
      if (isDateValue_(headerRow[c]) && isoFromDate_(headerRow[c]) === dateIso) {
        targetCol = c; break;
      }
    }
    if (targetCol < 0) return { sheetName: sheetName, entries: [] };

    for (let r = hr + 1; r < data.length; r++) {
      if (!visibleCell_(r, targetCol)) continue;
      const label = structure.labelColIdx >= 0
        ? normText_(data[r][structure.labelColIdx])
        : '(row ' + (r + 1) + ')';
      addCell_(label, r, targetCol);
    }
  }

  return { sheetName: sheetName, entries: entries };
}

function getInitialAppData() {
  const metaSheets = getSheetMeta_();
  const meta = metaSheets.map(function (x) { return { name: x.name, type: x.structure.type, supportsDayView: x.supportsDayView }; });
  const daySheets = metaSheets.filter(function (x) { return x.supportsDayView; }).slice(0, MAX_DAY_VIEW_SHEETS);
  const today = todayIso_();
  // Only fully read the sheets needed for the first screen. Generic sheets and
  // formatting-heavy data are deferred until the user opens them.
  const tables = daySheets.map(function (x) {
    try {
      return buildDayTable_(x.name, readDaySheet_(x.sheet, x.structure, today), x.structure, today);
    } catch (e) {
      return { sheetName: x.name, entries: [], error: String(e && e.message ? e.message : e) };
    }
  });
  return { today: today, meta: meta,
    day: { date: today, weekday: weekdayAbbrev_(dateFromIso_(today)), tables: tables } };
}

function getDayView(dateIso) {
  const metaSheets = getSheetMeta_();
  const relevant = metaSheets.filter(function (x) { return x.supportsDayView; }).slice(0, MAX_DAY_VIEW_SHEETS);
  return { date: dateIso, weekday: weekdayAbbrev_(dateFromIso_(dateIso)),
    tables: relevant.map(function (x) {
      try {
        return buildDayTable_(x.name, readDaySheet_(x.sheet, x.structure, dateIso), x.structure, dateIso);
      } catch (e) {
        return { sheetName: x.name, entries: [], error: String(e && e.message ? e.message : e) };
      }
    }) };
}

// ============================== DELIMITERS ====================================
const DELIM_RE = /(?:^|\n)[ \t]*([LCNlcn]):[ \t]*/g;
function parseCellSectionsRich_(rawText, runs) {
  const text = rawText || '';
  const matches = []; let m;
  DELIM_RE.lastIndex = 0;
  while ((m = DELIM_RE.exec(text)) !== null) matches.push({ letter: m[1].toUpperCase(), start: m.index, contentStart: m.index + m[0].length });
  if (!matches.length) {
    const bullets = bulletObjects_(text, runs, 0, text.length, '\n');
    return { sections: { log: bullets }, log: bullets, logRich: bullets, noDelimiter: text, noDelimiterRich: bullets };
  }
  const result = { log: [], comment: [], next: [] };
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i], end = i + 1 < matches.length ? matches[i + 1].start : text.length;
    const bullets = bulletObjects_(text, runs, cur.contentStart, end, '///');
    const key = cur.letter === 'L' ? 'log' : (cur.letter === 'C' ? 'comment' : 'next');
    result[key] = result[key].concat(bullets);
  }
  return { sections: result };
}

function parseCellSections_(rawText) {
  const p = parseCellSectionsRich_(rawText, []);
  return { log: (p.sections.log || []).map(function (b) { return b.text; }),
    comment: (p.sections.comment || []).map(function (b) { return b.text; }),
    next: (p.sections.next || []).map(function (b) { return b.text; }) };
}

function plainBulletTexts_(items) { return (items || []).map(function (b) { return typeof b === 'string' ? b : (b.text || ''); }); }
function serializeBulletList_(items) { return plainBulletTexts_(items).filter(Boolean).join(' /// '); }
function serializeCellSections_(sections) {
  const lines = [];
  const l = serializeBulletList_(sections.log), c = serializeBulletList_(sections.comment), n = serializeBulletList_(sections.next);
  if (l) lines.push('L: ' + l);
  if (c) lines.push('C: ' + c);
  if (n) lines.push('N: ' + n);
  return lines.join('\n');
}

function writeRichText_(cell, text, runs) {
  if (!runs || !runs.length) { cell.setValue(text); return; }
  const builder = SpreadsheetApp.newRichTextValue().setText(text);
  runs.forEach(function (r) {
    const style = SpreadsheetApp.newTextStyle()
      .setBold(!!r.bold).setItalic(!!r.italic)
      .setUnderline(!!r.underline).setStrikethrough(!!r.strikethrough).build();
    if (r.end > r.start) builder.setTextStyle(r.start, r.end, style);
  });
  cell.setRichTextValue(builder.build());
}

function buildCombinedRich_(sections) {
  const pieces = [];
  function addSection(marker, items) {
    if (!items || !items.length) return;
    if (pieces.length) pieces.push({ text: '\n', runs: [] });
    pieces.push({ text: marker + ' ', runs: [] });
    items.forEach(function (b, i) {
      if (i) pieces.push({ text: ' /// ', runs: [] });
      pieces.push({ text: b.text || '', runs: b.runs || [] });
    });
  }
  addSection('L:', sections.log); addSection('C:', sections.comment); addSection('N:', sections.next);
  const text = pieces.map(function (p) { return p.text; }).join('');
  let offset = 0, runs = [];
  pieces.forEach(function (p) {
    (p.runs || []).forEach(function (r) { runs.push({ start: offset + r.start, end: offset + r.end,
      bold: !!r.bold, italic: !!r.italic, underline: !!r.underline, strikethrough: !!r.strikethrough }); });
    offset += p.text.length;
  });
  return { text: text, runs: runs };
}

function buildRichTextFromBullets_(items) {
  const list = items || [];
  const text = list.map(function (b) { return b.text || ''; }).join('\n');
  let offset = 0, runs = [];
  list.forEach(function (b, i) {
    (b.runs || []).forEach(function (r) { runs.push({ start: offset + r.start, end: offset + r.end,
      bold: !!r.bold, italic: !!r.italic, underline: !!r.underline, strikethrough: !!r.strikethrough }); });
    offset += (b.text || '').length + (i < list.length - 1 ? 1 : 0);
  });
  return { text: text, runs: runs };
}

// ============================== WRITE =========================================
function saveCell(sheetName, row, col, payload) {
  const sh = SpreadsheetApp.getActive().getSheetByName(sheetName);
  if (!sh) throw new Error('Sheet not found: ' + sheetName);
  const cell = sh.getRange(row + 1, col + 1);
  const oldRaw = String(cell.getValue() == null ? '' : cell.getValue());
  const oldValue = normText_(oldRaw);
  let newRaw = '', richPayload = null;
  if (payload.sections) {
    richPayload = buildCombinedRich_(payload.sections);
    newRaw = richPayload.text;
  } else if (payload.planText !== undefined) {
    richPayload = buildRichTextFromBullets_(payload.planText.items || []);
    newRaw = writePlanText_(oldRaw, richPayload.text);
    // WRITTEN metadata is deliberately plain text; preserve rich formatting only on display text.
    if (newRaw && richPayload.runs.length) {
      const displayText = richPayload.text;
      const metaStart = newRaw.indexOf('\nWRITTEN:');
      const displayRuns = richPayload.runs;
      const builder = SpreadsheetApp.newRichTextValue().setText(newRaw);
      displayRuns.forEach(function (r) {
        builder.setTextStyle(r.start, r.end,
          SpreadsheetApp.newTextStyle().setBold(!!r.bold).setItalic(!!r.italic)
            .setUnderline(!!r.underline).setStrikethrough(!!r.strikethrough).build());
      });
      cell.setRichTextValue(builder.build());
      if (oldValue !== normText_(newRaw)) appendHistory_(sheetName, cell.getA1Notation(), oldRaw);
      return { ok: true, savedRaw: newRaw };
    }
  } else {
    richPayload = buildRichTextFromBullets_(payload.rawText && payload.rawText.items || []);
    newRaw = richPayload.text;
  }
  if (oldValue !== normText_(newRaw)) appendHistory_(sheetName, cell.getA1Notation(), oldRaw);
  if (richPayload && richPayload.runs && richPayload.runs.length) writeRichText_(cell, newRaw, richPayload.runs);
  else cell.setValue(newRaw);
  if (payload.sections && payload.sections.next !== undefined) recomputeNext_(sh, sheetName, row, col);
  return { ok: true, savedRaw: newRaw };
}

function writePlanText_(oldRaw, newPlanText) {
  const oldWritten = extractWrittenDates_(oldRaw), today = todayIso_();
  const dates = oldWritten.indexOf(today) === -1 ? oldWritten.concat([today]) : oldWritten;
  let out = (newPlanText || '').replace(/\n?[ \t]*WRITTEN:[^\n]*/gi, '').trim();
  if (out !== '') out += '\nWRITTEN:' + dates.join(',');
  return out;
}
function extractWrittenDates_(raw) {
  const m = /WRITTEN:([0-9,\-]*)/i.exec(raw || '');
  return m && m[1] ? m[1].split(',').filter(Boolean) : [];
}
function splitPlanDisplay_(raw) {
  return { text: (raw || '').replace(/\n?[ \t]*WRITTEN:[^\n]*/gi, '').trim(), writtenDates: extractWrittenDates_(raw) };
}

function recomputeNext_(sh, sheetName, row, col) {
  const read = readSheet_(sh), data = read.data, structure = classifySheet_(data);
  if (structure.type === 'dateMatrix' && structure.nextRowIdx >= 0) {
    let best = null, bestText = '';
    structure.dateRowIdxs.forEach(function (r) {
      const raw = normText_(data[r][col]), p = parseCellSections_(raw);
      if (!p.next.length) return;
      const d = data[r][0]; if (!best || d > best) { best = d; bestText = p.next.join(' /// '); }
    });
    sh.getRange(structure.nextRowIdx + 1, col + 1).setValue(bestText);
  } else if (structure.type === 'invertedDateMatrix' && structure.nextColIdx >= 0) {
    let best = null, bestText = '';
    structure.dateColIdxs.forEach(function (c) {
      const raw = normText_(data[row][c]), p = parseCellSections_(raw);
      if (!p.next.length) return;
      const d = data[structure.headerRowIdx][c]; if (!best || d > best) { best = d; bestText = p.next.join(' /// '); }
    });
    sh.getRange(row + 1, structure.nextColIdx + 1).setValue(bestText);
  }
}

function appendHistory_(sheetName, a1, oldValue) {
  const ss = SpreadsheetApp.getActive(); let hist = ss.getSheetByName(HISTORY_SHEET_NAME);
  if (!hist) { hist = ss.insertSheet(HISTORY_SHEET_NAME); hist.appendRow(['Timestamp','Sheet','Cell','Old Value']); hist.hideSheet(); }
  hist.appendRow([new Date(), sheetName, a1, oldValue]);
}

// ============================== STRUCTURAL EDITS ===============================
function appendRowOrColumn(sheetName, kind, newHeaderLabel) {
  const sh = SpreadsheetApp.getActive().getSheetByName(sheetName), lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  const data = lastRow && lastCol ? sh.getRange(1,1,lastRow,lastCol).getValues() : [], structure = data.length ? classifySheet_(data) : {type:'generic'};
  if (kind === 'row') {
    if (structure.type === 'dateMatrix') {
      // Date rows live above the fixed Next/Before summary rows. Append the new
      // date immediately before those summary rows so the summaries move down
      // with the data instead of becoming stranded in the middle of the sheet.
      let latestDate = null;
      (structure.dateRowIdxs || []).forEach(function (ri) {
        const d = data[ri][0];
        if (isDateValue_(d) && (!latestDate || d.getTime() > latestDate.getTime())) latestDate = new Date(d.getTime());
      });
      const nextDate = latestDate || new Date();
      nextDate.setDate(nextDate.getDate() + 1);
      const summaryRows = [structure.nextRowIdx, structure.beforeRowIdx].filter(function(i){return i>=0;});
      const insertAt = summaryRows.length ? Math.min.apply(null, summaryRows) + 1 : (lastRow || 1) + 1;
      sh.insertRowBefore(insertAt);
      const target = sh.getRange(insertAt, 1);
      target.setValue(nextDate);
      if (latestDate && structure.dateRowIdxs.length) {
        const templateRow = structure.dateRowIdxs[structure.dateRowIdxs.length - 1] + 1;
        target.setNumberFormat(sh.getRange(templateRow, 1).getNumberFormat());
      }
    } else {
      sh.insertRowsAfter(lastRow || 1, 1);
      if (structure.type === 'invertedDateMatrix' && structure.labelColIdx >= 0) sh.getRange((lastRow || 1) + 1, structure.labelColIdx + 1).setValue(newHeaderLabel || '');
      else if (newHeaderLabel) sh.getRange((lastRow || 1) + 1, 1).setValue(newHeaderLabel);
    }
  } else {
    sh.insertColumnsAfter(lastCol || 1, 1);
    if (structure.type === 'dateMatrix') sh.getRange(1, (lastCol || 1) + 1).setValue(newHeaderLabel || '');
    else if (structure.type === 'invertedDateMatrix') sh.getRange(structure.headerRowIdx + 1, (lastCol || 1) + 1).setValue(new Date());
    else if (newHeaderLabel) sh.getRange(1, (lastCol || 1) + 1).setValue(newHeaderLabel);
  }
  return getGrid(sheetName);
}
function insertRowOrColumn(sheetName, kind, index, position) {
  const sh = SpreadsheetApp.getActive().getSheetByName(sheetName), at = position === 'before' ? index + 1 : index + 2;
  if (kind === 'row') sh.insertRowBefore(at); else sh.insertColumnBefore(at);
  return getGrid(sheetName);
}
function describeRowOrColumn(sheetName, kind, index) {
  const grid = getGrid(sheetName);
  if (kind === 'row') {
    if (grid.type === 'dateMatrix') { const r = grid.rows.filter(function(x){return x.row===index;})[0]; return r ? r.date : 'row '+(index+1); }
    if (grid.type === 'invertedDateMatrix') { const e = grid.entities.filter(function(x){return x.row===index;})[0]; return e ? e.label : 'row '+(index+1); }
    return 'row '+(index+1);
  }
  if (grid.type === 'dateMatrix') { const c=grid.columns.filter(function(x){return x.col===index;})[0]; return c?c.header:'column '+(index+1); }
  if (grid.type === 'invertedDateMatrix') { const d=grid.dateColumns.filter(function(x){return x.col===index;})[0]; return d?d.date:'column '+(index+1); }
  return 'column '+(index+1);
}
function deleteRowOrColumn(sheetName, kind, index) {
  const sh = SpreadsheetApp.getActive().getSheetByName(sheetName);
  if (kind === 'row') sh.deleteRow(index + 1); else sh.deleteColumn(index + 1);
  return getGrid(sheetName);
}
