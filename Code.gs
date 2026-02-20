/**
 * Home Brew Tracker — Google Apps Script backend
 *
 * Setup:
 * 1. Create a Google Sheet with header row: id | name | readings | notes | ingredients
 * 2. In Apps Script: either bind this script to the sheet (Extensions > Apps Script)
 *    and use getActiveSpreadsheet(), OR set SPREADSHEET_ID below to your sheet ID.
 * 3. Deploy as Web App: Execute as "Me", Who has access: "Anyone" (or "Anyone with Google account").
 * 4. Copy the /exec URL into script.js as GAS_WEB_APP_URL.
 */

// Set to your spreadsheet ID if the script is NOT bound to the sheet.
// Find it in the sheet URL: .../d/SPREADSHEET_ID/edit
// Leave empty string to use the spreadsheet this script is bound to.
const SPREADSHEET_ID = '1QFOA0Owxn75G-90AwqMqu6cLwp3A0peqNJKa98RxaTY';

/**
 * Returns the sheet to read/write. Uses SPREADSHEET_ID if set, otherwise the active spreadsheet.
 */
function getSheet() {
  if (SPREADSHEET_ID) {
    return SpreadsheetApp.openById(SPREADSHEET_ID).getActiveSheet();
  }
  return SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
}

/**
 * Handles POST from the front end. Body: { id, name, readings, notes, ingredients }
 * readings and ingredients are arrays; stored as JSON strings in the sheet.
 * Creates a new row if id not found, otherwise updates the existing row.
 */
function doPost(e) {
  const output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);

  try {
    if (!e || !e.postData || !e.postData.contents) {
      output.setContent(JSON.stringify({ success: false, error: 'Missing request body' }));
      return output;
    }

    const payload = JSON.parse(e.postData.contents);
    const id = payload.id ? String(payload.id).trim() : '';
    const name = payload.name != null ? String(payload.name) : '';
    const readings = Array.isArray(payload.readings) ? payload.readings : [];
    const notes = payload.notes != null ? String(payload.notes) : '';
    const ingredients = Array.isArray(payload.ingredients) ? payload.ingredients : [];

    if (!id) {
      output.setContent(JSON.stringify({ success: false, error: 'Missing id' }));
      return output;
    }

    const sheet = getSheet();
    const data = sheet.getDataRange().getValues();
    const headers = data[0] || [];
    const dataRows = data.slice(1);

    const colA = 0;
    let rowIndex = -1;
    for (let i = 0; i < dataRows.length; i++) {
      if (String(dataRows[i][colA]).trim() === id) {
        rowIndex = i + 2;
        break;
      }
    }

    const readingsStr = JSON.stringify(readings);
    const ingredientsStr = JSON.stringify(ingredients);
    const row = [id, name, readingsStr, notes, ingredientsStr];

    if (rowIndex > 0) {
      sheet.getRange(rowIndex, 1, 1, 5).setValues([row]);
    } else {
      sheet.appendRow(row);
    }

    output.setContent(JSON.stringify({ success: true }));
    return output;
  } catch (err) {
    output.setContent(JSON.stringify({ success: false, error: err.message || String(err) }));
    return output;
  }
}
