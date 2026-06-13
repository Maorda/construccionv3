/**
 * SHEET-ODM CORE ENGINE
 * Motor de persistencia para Google Sheets.
 * * NOTA: Este archivo es la fuente. Al empaquetar la librería, 
 * el proceso de build lo ofuscará antes de subirlo a Drive.
 */

// --- CONFIGURACIÓN GLOBAL ---
const INDEX_PREFIX = "__idx_";
const QUEUE_SHEET_NAME = "__system_queue";
const INDEX_INDICATOR = "*";
const STATUS_COLUMN_NAME = "Status";
const EXCLUDED_STATUSES = ["eliminado", "inactivo", "deleted", "inactive"];

/**
 * 1. PUNTO DE ENTRADA ÚNICO (API EXECUTION)
 * NestJS invocará exclusivamente esta función.
 */
function executeSheetOdmOperation(payload) {
  try {
    if (!payload || !payload.action || !payload.sheet) {
      throw new Error("Parámetros inválidos. Se requiere 'action' y 'sheet'.");
    }

    const { action, sheet: sheetName, data } = payload;
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(sheetName);

    if (!sheet) throw new Error("La hoja '" + sheetName + "' no existe.");

    // Enrutador de operaciones
    switch (action) {
      case 'findOne': return findOne(sheetName, data.column, data.value);
      case 'findMany': return findMany(sheetName, data.column, data.value);
      case 'find': return findAll(sheetName);
      case 'insert': return handleSingleInsert(sheet, data);
      case 'update': return handleSingleUpdate(sheet, data);
      case 'delete': return handleSingleDelete(sheet, data);
      case 'batchCommit': return handleBatchCommit(sheet, data);
      default: throw new Error("Acción '" + action + "' no soportada.");
    }
  } catch (e) {
    // Retornamos el error formateado para que NestJS pueda capturarlo como una Exception
    throw new Error("GAS_ENGINE_ERROR: " + e.message);
  }
}

// --- 2. MOTOR DE INDEXACIÓN (Búsqueda Binaria) ---

function onEdit(e) { if (e) enqueueReindex(e.source.getActiveSheet().getName()); }

function enqueueReindex(sheetName) {
  if (sheetName.startsWith(INDEX_PREFIX) || sheetName === QUEUE_SHEET_NAME) return;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let queueSheet = ss.getSheetByName(QUEUE_SHEET_NAME) || ss.insertSheet(QUEUE_SHEET_NAME);
  queueSheet.hideSheet();
  queueSheet.appendRow([sheetName, new Date()]);
}

function processIndexQueue() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const queueSheet = ss.getSheetByName(QUEUE_SHEET_NAME);
    if (!queueSheet || queueSheet.getLastRow() === 0) return;
    const sheetsToReindex = [...new Set(queueSheet.getDataRange().getValues().map(row => row[0]))];
    queueSheet.clearContents();

    sheetsToReindex.forEach(sheetName => {
      const dataSheet = ss.getSheetByName(sheetName);
      if (!dataSheet) return;
      const headers = dataSheet.getRange(1, 1, 1, dataSheet.getLastColumn()).getValues()[0];
      const statusColIndex = headers.indexOf(STATUS_COLUMN_NAME);
      headers.forEach((h, i) => {
        if (String(h).endsWith(INDEX_INDICATOR)) rebuildIndex(dataSheet, sheetName, String(h).replace(INDEX_INDICATOR, "").trim(), i, statusColIndex);
      });
    });
  } finally { lock.releaseLock(); }
}

function rebuildIndex(dataSheet, sheetName, columnName, colIndex, statusColIndex) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const indexSheetName = `${INDEX_PREFIX}${sheetName}_${columnName}`;
  let indexSheet = ss.getSheetByName(indexSheetName) || ss.insertSheet(indexSheetName);
  indexSheet.hideSheet();
  
  const lastRow = dataSheet.getLastRow();
  if (lastRow <= 1) { indexSheet.clearContents(); return; }

  const data = dataSheet.getRange(2, colIndex + 1, lastRow - 1, 1).getValues();
  const statusData = statusColIndex !== -1 ? dataSheet.getRange(2, statusColIndex + 1, lastRow - 1, 1).getValues() : null;

  const indexData = [];
  data.forEach((row, i) => {
    const val = String(row[0]).trim().toLowerCase();
    if (!val || val === "null" || (statusData && EXCLUDED_STATUSES.includes(String(statusData[i][0]).trim().toLowerCase()))) return;
    indexData.push([val, i + 2]);
  });
  
  indexSheet.clearContents();
  if (indexData.length > 0) {
    const range = indexSheet.getRange(1, 1, indexData.length, 2);
    range.setValues(indexData);
    range.sort(1);
  }
}

// --- 3. QUERIES (FINDERS) ---

function findOne(sheetName, columnName, value) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const indexSheet = ss.getSheetByName(`${INDEX_PREFIX}${sheetName}_${columnName}`);
  if (!indexSheet) throw new Error("Índice no encontrado");
  
  const indexData = indexSheet.getDataRange().getValues();
  const target = String(value).toLowerCase().trim();
  
  let left = 0, right = indexData.length - 1, targetRow = -1;
  while (left <= right) {
    let mid = Math.floor((left + right) / 2);
    if (String(indexData[mid][0]) === target) { targetRow = indexData[mid][1]; break; }
    if (String(indexData[mid][0]) < target) left = mid + 1; else right = mid - 1;
  }
  
  if (targetRow === -1) return null;
  const sheet = ss.getSheetByName(sheetName);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const rowData = sheet.getRange(targetRow, 1, 1, sheet.getLastColumn()).getValues()[0];
  
  let doc = { _row: targetRow };
  headers.forEach((h, i) => doc[String(h).replace(INDEX_INDICATOR, "").trim()] = rowData[i]);
  return doc;
}

function findMany(sheetName, filterColumn, filterValue) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const indexSheet = ss.getSheetByName(`${INDEX_PREFIX}${sheetName}_${filterColumn}`);
  if (!indexSheet) throw new Error("Índice no encontrado");
  
  const indexData = indexSheet.getDataRange().getValues();
  const target = String(filterValue).toLowerCase().trim();
  
  let left = 0, right = indexData.length - 1, first = -1;
  while (left <= right) {
    let mid = Math.floor((left + right) / 2);
    if (String(indexData[mid][0]) === target) { first = mid; right = mid - 1; }
    else if (String(indexData[mid][0]) < target) left = mid + 1; else right = mid - 1;
  }
  
  if (first === -1) return [];
  const rows = [];
  for (let i = first; i < indexData.length && String(indexData[i][0]) === target; i++) rows.push(indexData[i][1]);
  
  const sheet = ss.getSheetByName(sheetName);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  return rows.map(r => {
    const rowData = sheet.getRange(r, 1, 1, sheet.getLastColumn()).getValues()[0];
    let doc = { _row: r };
    headers.forEach((h, i) => doc[String(h).replace(INDEX_INDICATOR, "").trim()] = rowData[i]);
    return doc;
  });
}

function findAll(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  const dataRange = sheet.getDataRange().getValues();
  const headers = dataRange[0];
  const rows = dataRange.slice(1);
  const statusColIndex = headers.indexOf(STATUS_COLUMN_NAME);
  
  const results = [];
  rows.forEach((rowValues, rowIndex) => {
    if (statusColIndex !== -1 && EXCLUDED_STATUSES.includes(String(rowValues[statusColIndex]).trim().toLowerCase())) return;
    let doc = { _row: rowIndex + 2 };
    headers.forEach((h, i) => doc[String(h).replace(INDEX_INDICATOR, "").trim()] = rowValues[i]);
    results.push(doc);
  });
  return results;
}

// --- 4. ESCRITURA Y CRUD ---

function handleSingleInsert(sheet, data) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const rowValues = headers.map(h => data[String(h).replace(INDEX_INDICATOR, "").trim()] !== undefined ? data[String(h).replace(INDEX_INDICATOR, "").trim()] : "");
  sheet.appendRow(rowValues);
  enqueueReindex(sheet.getName());
  return { row: sheet.getLastRow() };
}

function handleSingleUpdate(sheet, data) {
  const targetRow = data._row;
  if (!targetRow) throw new Error("Fila no especificada.");
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const currentValues = sheet.getRange(targetRow, 1, 1, headers.length).getValues()[0];
  const mergedValues = headers.map((h, i) => data[String(h).replace(INDEX_INDICATOR, "").trim()] !== undefined ? data[String(h).replace(INDEX_INDICATOR, "").trim()] : currentValues[i]);
  sheet.getRange(targetRow, 1, 1, mergedValues.length).setValues([mergedValues]);
  enqueueReindex(sheet.getName());
  return { row: targetRow };
}

function handleSingleDelete(sheet, data) {
  const targetRow = data._row;
  if (!targetRow || targetRow <= 1) throw new Error("Fila inválida.");
  const colIdx = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].indexOf(STATUS_COLUMN_NAME);
  if (colIdx !== -1) sheet.getRange(targetRow, colIdx + 1).setValue("deleted");
  else sheet.deleteRow(targetRow);
  enqueueReindex(sheet.getName());
  return { row: targetRow };
}

function handleBatchCommit(sheet, batchData) {
  const { inserts, updates, deletes } = batchData;
  if (inserts && inserts.length > 0) sheet.getRange(sheet.getLastRow() + 1, 1, inserts.length, inserts[0].length).setValues(inserts);
  if (updates && updates.length > 0) updates.forEach(u => sheet.getRange(u.row, 1, 1, u.values.length).setValues([u.values]));
  if (deletes && deletes.length > 0) deletes.sort((a, b) => b - a).forEach(row => { if (row > 1) sheet.deleteRow(row); });
  enqueueReindex(sheet.getName());
  return { success: true };
}