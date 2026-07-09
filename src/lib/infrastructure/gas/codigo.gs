/**
 * SHEET-ODM CORE ENGINE
 * Motor de persistencia para Google Sheets.
 */

// --- CONFIGURACIÓN GLOBAL ---
const INDEX_PREFIX = "__idx_";
const INDEX_INDICATOR = "*";
const STATUS_COLUMN_NAME = "Status";
const EXCLUDED_STATUSES = ["eliminado", "inactivo", "deleted", "inactive"];

// ==========================================
// 1. PUNTO DE ENTRADA HTTP (NUEVO DOPOST)
// ==========================================
function doPost(e) {
  console.log("📥 Recibido POST en GAS: " + JSON.stringify(e.postData.contents));
  try {
    const payload = JSON.parse(e.postData.contents);
    const expectedApiKey = PropertiesService.getScriptProperties().getProperty("GAS_API_KEY");
    if (!expectedApiKey || payload.apiKey !== expectedApiKey) {
      throw new Error("No autorizado: API Key inválida.");
    }
    const result = executeSheetOdmOperation(payload);
    return ContentService.createTextOutput(JSON.stringify({ success: true, data: result })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.message })).setMimeType(ContentService.MimeType.JSON);
  }
}

// --- HELPER: RESOLUCIÓN DE CONTEXTO ---
function getTargetSpreadsheet(spreadsheetId) {
  if (spreadsheetId) return SpreadsheetApp.openById(spreadsheetId);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error("No se proporcionó 'spreadsheetId' y el script no tiene un libro activo.");
  return ss;
}

/**
 * 2. ENRUTADOR PRINCIPAL
 */
function executeSheetOdmOperation(payload) {
  try {
    if (!payload || !payload.action || !payload.sheet) throw new Error("Parámetros inválidos.");

    const { action, sheet: sheetName, data, spreadsheetId } = payload;
    const ss = getTargetSpreadsheet(spreadsheetId);
    const sheet = ss.getSheetByName(sheetName);

    if (!sheet && action !== 'insert') throw new Error("La hoja '" + sheetName + "' no existe.");
    const activeSheet = sheet || ss.insertSheet(sheetName);

    switch (action) {
      case 'getBoundaries': return getSheetBoundaries(activeSheet);
      case 'findOne':      return findOne(ss, sheetName, data.column, data.value);
      case 'findMany':     return findMany(ss, sheetName, data.column, data.value);
      case 'find':          return findAll(ss, sheetName); 
      case 'insert':        return handleSingleInsert(activeSheet, data);
      case 'update':        return handleSingleUpdate(activeSheet, data);
      case 'delete':        return handleSingleDelete(activeSheet, data);
      case 'batchCommit':   return handleBatchCommit(activeSheet, data);
      case 'notifyMutation': enqueueReindex(ss.getId(), sheetName); return { queued: true }; 
      case 'syncHeaders':   return handleSyncHeaders(activeSheet, data.headers);
      default: throw new Error("Acción '" + action + "' no soportada.");
    }
  } catch (e) {
    throw new Error("GAS_ENGINE_ERROR: " + e.message);
  }
}

// ==========================================
// 3. MOTOR DE INDEXACIÓN (COLA MAESTRA)
// ==========================================

function getMasterQueueSheet() {
  const masterId = PropertiesService.getScriptProperties().getProperty("MASTER_QUEUE_ID");
  if (!masterId) throw new Error("Falta MASTER_QUEUE_ID en Configuración.");
  const masterSs = SpreadsheetApp.openById(masterId);
  let queueSheet = masterSs.getSheetByName("GLOBAL_QUEUE");
  if (!queueSheet) {
    queueSheet = masterSs.insertSheet("GLOBAL_QUEUE");
    queueSheet.appendRow(["SpreadsheetID", "SheetName", "Timestamp"]); 
  }
  return queueSheet;
}

function enqueueReindex(spreadsheetId, sheetName) {
  if (sheetName.startsWith(INDEX_PREFIX)) return;
  try {
    const queueSheet = getMasterQueueSheet();
    queueSheet.appendRow([spreadsheetId, sheetName, new Date().toISOString()]);
  } catch(e) {
    console.error("Fallo al encolar: " + e.message);
  }
}

function processIndexQueue() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;
  try {
    const queueSheet = getMasterQueueSheet();
    const lastRow = queueSheet.getLastRow();
    if (lastRow <= 1) return; 

    const data = queueSheet.getRange(2, 1, lastRow - 1, 2).getValues();
    queueSheet.getRange(2, 1, lastRow - 1, queueSheet.getLastColumn()).clearContent();

    const tasks = {};
    data.forEach(row => {
      const ssId = row[0];
      const sName = row[1];
      if (!ssId || !sName) return;
      if (!tasks[ssId]) tasks[ssId] = new Set();
      tasks[ssId].add(sName);
    });

    for (const ssId in tasks) {
      try {
        const ss = SpreadsheetApp.openById(ssId);
        tasks[ssId].forEach(sheetName => {
          const dataSheet = ss.getSheetByName(sheetName);
          if (!dataSheet) return;

          const headers = dataSheet.getRange(1, 1, 1, dataSheet.getLastColumn()).getValues()[0];
          const statusColIndex = headers.indexOf(STATUS_COLUMN_NAME);

          headers.forEach((h, i) => {
            if (String(h).endsWith(INDEX_INDICATOR)) {
              const columnName = String(h).replace(INDEX_INDICATOR, "").trim().toUpperCase();
              rebuildIndex(dataSheet, sheetName, columnName, i, statusColIndex);
            }
          });
        });
      } catch (e) {
        console.error(`Fallo al reindexar libro ${ssId}: ${e.message}`);
      }
    }
  } finally {
    lock.releaseLock();
  }
}

function rebuildIndex(dataSheet, sheetName, columnName, colIndex, statusColIndex) {
  const ss = dataSheet.getParent(); 
  const indexSheetName = `${INDEX_PREFIX}${sheetName}_${columnName.toUpperCase()}`;
  
  let indexSheet = ss.getSheetByName(indexSheetName);
  if (!indexSheet) {
      indexSheet = ss.insertSheet(indexSheetName);
  }
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

// ==========================================
// 4. QUERIES (FINDERS - OPTIMIZADOS CON AUTO-REPARACIÓN)
// ==========================================

function findOne(ss, sheetName, columnName, value) {
  const results = findMany(ss, sheetName, columnName, value);
  return results.length > 0 ? results[0] : null;
}

function findMany(ss, sheetName, filterColumn, filterValue) {
  const cleanCol = String(filterColumn).replace(INDEX_INDICATOR, "").trim().toUpperCase();
  const indexSheet = ss.getSheetByName(`${INDEX_PREFIX}${sheetName}_${cleanCol}`);
  
  // 🚀 REFACTOR: Eliminamos el "Self-Healing" bloqueante. 
  // Si el índice no existe, lanzamos error (el sistema debería estar indexado).
  if (!indexSheet) throw new Error("Índice no encontrado para: " + filterColumn);
  
  const rowNumbers = getRowNumbersFromIndex(indexSheet, filterValue);
  if (rowNumbers.length === 0) return [];
  
  const sheet = ss.getSheetByName(sheetName);
  return fetchAndMapRows(sheet, rowNumbers);
}

function findAll(ss, sheetName) {
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

// ==========================================
// 5. ESCRITURA Y CRUD
// ==========================================

function handleSingleInsert(sheet, data) {
  const lastCol = sheet.getLastColumn();
  let headers = [];
  
  if (lastCol === 0) {
    headers = Object.keys(data).filter(k => k !== '_row');
    sheet.appendRow(headers);
  } else {
    headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  }

  const rowValues = headers.map(h => {
    const headerStr = String(h).trim();
    const cleanHeader = headerStr.replace(INDEX_INDICATOR, "").trim();

    if (data[cleanHeader] !== undefined) {
      return data[cleanHeader];
    } else if (data[headerStr] !== undefined) { 
      return data[headerStr];
    } else {
      return ""; 
    }
  });

  const isEmptyRow = rowValues.every(val => val === "" || val === null || val === undefined);
  if (isEmptyRow) {
    throw new Error("Mapeo fallido: Las llaves enviadas (" + Object.keys(data).join(', ') + ") no coinciden con ninguna cabecera de la hoja (" + headers.join(', ') + ").");
  }

  sheet.appendRow(rowValues);
  const newRowNumber = sheet.getLastRow();
  
  enqueueReindex(sheet.getParent().getId(), sheet.getName());
  return { row: newRowNumber, insertedData: data };
}

function handleSingleUpdate(sheet, data) {
  const targetRow = data._row;
  if (!targetRow) throw new Error("Fila no especificada.");
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const currentValues = sheet.getRange(targetRow, 1, 1, headers.length).getValues()[0];
  const mergedValues = headers.map((h, i) => data[String(h).replace(INDEX_INDICATOR, "").trim()] !== undefined ? data[String(h).replace(INDEX_INDICATOR, "").trim()] : currentValues[i]);
  sheet.getRange(targetRow, 1, 1, mergedValues.length).setValues([mergedValues]);
  
  enqueueReindex(sheet.getParent().getId(), sheet.getName());
  return { row: targetRow, status: 'updated' };
}

function handleSingleDelete(sheet, data) {
  const targetRow = data._row;
  if (!targetRow || targetRow <= 1) throw new Error("Fila inválida.");
  const colIdx = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].indexOf(STATUS_COLUMN_NAME);
  if (colIdx !== -1) sheet.getRange(targetRow, colIdx + 1).setValue("deleted");
  else sheet.deleteRow(targetRow);
  
  enqueueReindex(sheet.getParent().getId(), sheet.getName());
  return { row: targetRow, status: 'deleted' };
}

function handleBatchCommit(sheet, batchData) {
  const { inserts, updates, deletes } = batchData;
  if (inserts && inserts.length > 0) sheet.getRange(sheet.getLastRow() + 1, 1, inserts.length, inserts[0].length).setValues(inserts);
  if (updates && updates.length > 0) updates.forEach(u => sheet.getRange(u.row, 1, 1, u.values.length).setValues([u.values]));
  if (deletes && deletes.length > 0) deletes.sort((a, b) => b - a).forEach(row => { if (row > 1) sheet.deleteRow(row); });
  
  enqueueReindex(sheet.getParent().getId(), sheet.getName());
  return { success: true };
}

function getSheetBoundaries(sheet) {
  return { lastRow: sheet.getLastRow(), lastColumn: sheet.getLastColumn() };
}

function handleSyncHeaders(sheet, expectedHeaders) {
  const lastCol = sheet.getLastColumn();
  
  if (lastCol === 0) {
    sheet.appendRow(expectedHeaders);
    return { status: "created", details: "Estructura de columnas inicializada con éxito." };
  }
  
  const currentHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
  let changesMade = 0;
  
  expectedHeaders.forEach(expected => {
    const cleanExpected = expected.replace(INDEX_INDICATOR, "").trim();
    const index = currentHeaders.findIndex(h => h.replace(INDEX_INDICATOR, "").trim().toLowerCase() === cleanExpected.toLowerCase());
    
    if (index !== -1 && currentHeaders[index] !== expected) {
      sheet.getRange(1, index + 1).setValue(expected);
      changesMade++;
    }
  });
  
  if (changesMade > 0) {
    enqueueReindex(sheet.getParent().getId(), sheet.getName());
  }
  
  return { status: "synchronized", mutations: changesMade };
}
function findIn(ss, sheetName, filterColumn, filterValuesArray) {
  const cleanCol = String(filterColumn).replace(INDEX_INDICATOR, "").trim().toUpperCase();
  const indexSheetName = `${INDEX_PREFIX}${sheetName}_${cleanCol}`;
  const indexSheet = ss.getSheetByName(indexSheetName);
  
  // 🚀 OPTIMIZACIÓN: Si el índice no existe, retornamos vacío.
  // No disparamos reindexación aquí para evitar latencia de 5-10s en el request HTTP.
  if (!indexSheet) {
    console.warn(`[findIn] Índice no encontrado: ${indexSheetName}. Saltando búsqueda.`);
    return [];
  }

  const indexData = indexSheet.getDataRange().getValues();
  const sheet = ss.getSheetByName(sheetName);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const rowsToFetch = new Set(); // Usamos Set para evitar filas duplicadas

  // Procesamos cada valor buscado
  filterValuesArray.forEach(val => {
    const target = String(val).toLowerCase().trim();
    let left = 0, right = indexData.length - 1, first = -1;

    // Binary Search para encontrar el primer índice de este valor
    while (left <= right) {
      let mid = Math.floor((left + right) / 2);
      if (String(indexData[mid][0]) === target) { first = mid; right = mid - 1; }
      else if (String(indexData[mid][0]) < target) left = mid + 1; else right = mid - 1;
    }

    // Si encontramos, recorremos los adyacentes para traer todas las filas
    if (first !== -1) {
      for (let i = first; i < indexData.length && String(indexData[i][0]) === target; i++) {
        rowsToFetch.add(indexData[i][1]);
      }
    }
  });

  if (rowsToFetch.size === 0) return [];

  // 🚀 OPTIMIZACIÓN DE LECTURA: Fetch masivo (o lo más cercano posible)
  // Nota: Si rowsToFetch es enorme (> 500 filas), considera paginación o límites.
  return Array.from(rowsToFetch).map(r => {
    const rowData = sheet.getRange(r, 1, 1, headers.length).getValues()[0];
    let doc = { _row: r };
    headers.forEach((h, i) => doc[String(h).replace(INDEX_INDICATOR, "").trim()] = rowData[i]);
    return doc;
  });
}
/*function fetchAndMapRows(sheet, rowNumbers) {
  if (!rowNumbers || rowNumbers.length === 0) return [];

  // 🚀 OPTIMIZACIÓN CRÍTICA: Batch Reading
  // En lugar de llamar a getRange() N veces, leemos toda la hoja de una sola vez.
  // Esto reduce las llamadas a la API de N a 1.
  const allData = sheet.getDataRange().getValues();
  const headers = allData[0]; // La primera fila siempre son los encabezados
  
  // Convertimos los IDs de fila a un Set para búsquedas O(1) de alta velocidad
  const targetRowsSet = new Set(rowNumbers);
  
  const results = [];
  
  // Iteramos sobre los datos en memoria (instantáneo comparado con llamadas a API)
  // Empezamos en 1 porque el índice 0 son los headers
  for (let i = 1; i < allData.length; i++) {
    const currentRowIndex = i + 1; // Ajuste: allData[0] es fila 1, allData[1] es fila 2
    
    if (targetRowsSet.has(currentRowIndex)) {
      let doc = { _row: currentRowIndex };
      
      headers.forEach((h, colIdx) => {
        const key = String(h).replace(INDEX_INDICATOR, "").trim();
        doc[key] = allData[i][colIdx];
      });
      
      results.push(doc);
    }
  }
  
  return results;
}*/

function getRowNumbersFromIndex(indexSheet, targetValue) {
  const indexData = indexSheet.getDataRange().getValues();
  const target = String(targetValue).toLowerCase().trim();
  
  let left = 0, right = indexData.length - 1, first = -1;
  while (left <= right) {
    let mid = Math.floor((left + right) / 2);
    if (String(indexData[mid][0]) === target) { first = mid; right = mid - 1; }
    else if (String(indexData[mid][0]) < target) left = mid + 1; else right = mid - 1;
  }
  
  if (first === -1) return [];
  
  const rows = [];
  for (let i = first; i < indexData.length && String(indexData[i][0]) === target; i++) {
    rows.push(indexData[i][1]);
  }
  return rows;
}

function fetchAndMapRows(sheet, rowNumbers) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  
  return rowNumbers.map(r => {
    const rowData = sheet.getRange(r, 1, 1, headers.length).getValues()[0];
    let doc = { _row: r };
    headers.forEach((h, i) => doc[String(h).replace(INDEX_INDICATOR, "").trim()] = rowData[i]);
    return doc;
  });
}