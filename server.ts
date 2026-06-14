import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";

const app = express();
const PORT = 3000;
const SESSION_FILE = path.join(process.cwd(), "admin_session.json");

// Middleware to parse JSON payloads with Base64 signature images (up to 10MB)
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

interface AdminSession {
  accessToken: string;
  savedAt: number;
  spreadsheetId?: string;
  driveFolderId?: string;
}

// Helper to load admin session from file
function loadSession(): AdminSession | null {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      const data = fs.readFileSync(SESSION_FILE, "utf-8");
      const parsed = JSON.parse(data);
      // Ensure token is less than 3 hours old (Google tokens expire in 1 hr, but let's check basic freshness)
      if (Date.now() - parsed.savedAt < 3 * 3600 * 1000) {
        return parsed;
      }
    }
  } catch (err) {
    console.error("Error reading admin session file:", err);
  }
  return null;
}

// Helper to save admin session to file
function saveSession(accessToken: string, spreadsheetId?: string, driveFolderId?: string) {
  try {
    const session: AdminSession = {
      accessToken,
      savedAt: Date.now(),
      spreadsheetId,
      driveFolderId
    };
    fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2), "utf-8");
    console.log("Admin session saved to file.");
  } catch (err) {
    console.error("Error writing admin session file:", err);
  }
}

// Helper to delete admin session
function clearSession() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      fs.unlinkSync(SESSION_FILE);
      console.log("Admin session file cleared.");
    }
  } catch (err) {
    console.error("Error deleting admin session file:", err);
  }
}

// ==========================================
// API ENDPOINTS
// ==========================================

// Get session status (checks if check-in mode is active)
app.get("/api/session-status", (req, res) => {
  const session = loadSession();
  if (session) {
    res.json({ 
      active: true, 
      savedAt: session.savedAt,
      spreadsheetId: session.spreadsheetId || null,
      driveFolderId: session.driveFolderId || null
    });
  } else {
    res.json({ active: false });
  }
});

// Admin saves token for public check-ins
app.post("/api/save-token", (req, res) => {
  const { accessToken, spreadsheetId, driveFolderId } = req.body;
  if (!accessToken) {
    return res.status(400).json({ error: "Access token is required" });
  }
  saveSession(accessToken, spreadsheetId, driveFolderId);
  res.json({ status: "success", message: "Admin session registered on server." });
});

// Admin clears token
app.post("/api/clear-token", (req, res) => {
  clearSession();
  res.json({ status: "success", message: "Admin session removed." });
});

// Public Submit Attendance
app.post("/api/submit-attendance", async (req, res) => {
  const session = loadSession();
  if (!session || !session.accessToken) {
    return res.status(401).json({
      error: "Sesi registrasi belum diaktifkan oleh admin. Harap minta admin untuk login terlebih dahulu."
    });
  }

  const { name, instansi, nip, jabatan, email, signature } = req.body;

  if (!name || !instansi || !nip || !jabatan || !signature) {
    return res.status(400).json({ error: "Nama, Instansi, Jabatan, NIP, dan tanda tangan wajib diisi." });
  }

  try {
    const token = session.accessToken;

    // 1. Upload signature image to Google Drive
    console.log(`Starting signature upload for: ${name}`);
    const signatureFileId = await uploadSignatureToDrive(token, name, signature, session.driveFolderId);
    console.log(`Signature uploaded successfully. File ID: ${signatureFileId}`);

    // FORMAT TIME: current local time (using the user's current date/time)
    // Format: YYYY-MM-DD HH:mm:ss
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, "0");
    const checkInTime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    // 2. Append row to Google Sheets
    console.log(`Appending attendee row to Google Sheets: ${name}`);
    await appendAttendeeToSheet(token, {
      nip,
      name,
      instansi,
      jabatan,
      email: email || "-",
      checkInTime,
      signatureFileId
    }, session.spreadsheetId);
    console.log(`Attendee registered successfully: ${name}`);

    res.json({
      success: true,
      data: {
        id: nip,
        name,
        checkInTime
      }
    });
  } catch (error: any) {
    console.error("Detailed attendance submission error:", error);
    res.status(500).json({
      error: `Pendaftaran gagal: ${error.message || "Kesalahan sistem internal"}`
    });
  }
});

// Helper for Google Drive Upload
async function uploadSignatureToDrive(token: string, name: string, signatureBase64: string, customFolderId?: string): Promise<string> {
  const folderId = customFolderId || '1UseBW7ICFFT-cUPD1HC3KrJUhLCVgEgR';
  
  // Create File Metadata
  const metaResponse = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name: `TandaTangan_${name.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}.png`,
      parents: [folderId],
      mimeType: "image/png"
    })
  });

  if (!metaResponse.ok) {
    const errorText = await metaResponse.text();
    throw new Error(`Google Drive Create Metadata Failed: ${errorText}`);
  }

  const metaData = (await metaResponse.json()) as { id: string };
  const fileId = metaData.id;

  // Upload Binary Media
  const base64Data = signatureBase64.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(base64Data, "base64");

  const uploadResponse = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
    method: "PATCH",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "image/png"
    },
    body: buffer
  });

  if (!uploadResponse.ok) {
    const errText = await uploadResponse.text();
    throw new Error(`Google Drive Media Upload Failed: ${errText}`);
  }

  return fileId;
}

// Helper for Google Sheets Row Appending
async function appendAttendeeToSheet(token: string, data: {
  nip: string;
  name: string;
  instansi: string;
  jabatan: string;
  email: string;
  checkInTime: string;
  signatureFileId: string;
}, customSpreadsheetId?: string) {
  const spreadsheetId = customSpreadsheetId || '1Fu2MejKfS_Nm7AdqwERfaU22QBanPeYG8fQeILciwpw';

  // 1. Fetch sheet title
  const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`, {
    headers: { "Authorization": `Bearer ${token}` }
  });

  if (!metaRes.ok) {
    const errText = await metaRes.text();
    throw new Error(`Google Sheets Metadata Fetch Failed: ${errText}`);
  }

  const spreadsheetMeta = (await metaRes.json()) as { sheets: any[] };
  const sheets = spreadsheetMeta.sheets || [];
  if (sheets.length === 0) {
    throw new Error("No sheets found in Google Spreadsheet");
  }
  const firstSheetTitle = sheets[0].properties.title;

  // 2. Read first row to see if headers are needed
  const readRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(firstSheetTitle)}!A1:H1`, {
    headers: { "Authorization": `Bearer ${token}` }
  });
  
  let needsHeaders = true;
  if (readRes.ok) {
    const readData = (await readRes.json()) as { values?: any[][] };
    if (readData.values && readData.values.length > 0) {
      needsHeaders = false;
    }
  }

  const rowsToAppend = [];
  if (needsHeaders) {
    rowsToAppend.push([
      "No",
      "NIP",
      "Nama Lengkap",
      "Instansi",
      "Jabatan",
      "Email",
      "Waktu Hadir",
      "Link Tanda Tangan"
    ]);
  }

  // Read A:A to determine next participant number
  const totalRowsRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(firstSheetTitle)}!A:A`, {
    headers: { "Authorization": `Bearer ${token}` }
  });
  let nextNo = 1;
  if (totalRowsRes.ok) {
    const rData = (await totalRowsRes.json()) as { values?: any[][] };
    const values = rData.values || [];
    const actualRowCount = values.length;
    // If we're writing headers, next No is 1. If headers exist, count number of records
    if (!needsHeaders) {
      nextNo = Math.max(1, actualRowCount); // Rows count matches next index (assuming header is index 1)
    }
  }

  const viewUrl = `https://drive.google.com/thumbnail?id=${data.signatureFileId}&sz=w500`;

  rowsToAppend.push([
    nextNo,
    data.nip,
    data.name,
    data.instansi,
    data.jabatan,
    data.email,
    data.checkInTime,
    viewUrl
  ]);

  // Append data row
  const appendRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(firstSheetTitle)}!A:H:append?valueInputOption=USER_ENTERED`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      values: rowsToAppend
    })
  });

  if (!appendRes.ok) {
    const errText = await appendRes.text();
    throw new Error(`Google Sheets Append Values Failed: ${errText}`);
  }
}

// Proxy endpoint to fetch signature images and bypass CORS restrictions
app.get("/api/proxy-signature", async (req, res) => {
  const { url } = req.query;
  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "URL is required" });
  }

  try {
    // Resolve Authorization token (try request headers, and fallback to server session)
    let authHeader = req.headers.authorization;
    if (!authHeader) {
      const session = loadSession();
      if (session && session.accessToken) {
        authHeader = `Bearer ${session.accessToken}`;
      }
    }

    const headers: Record<string, string> = {};
    if (authHeader) {
      headers["Authorization"] = authHeader;
    }

    const fetchRes = await fetch(url, { headers });
    if (!fetchRes.ok) {
      throw new Error(`Failed to fetch image: ${fetchRes.statusText} (${fetchRes.status})`);
    }

    const contentType = fetchRes.headers.get("content-type") || "image/png";
    const arrayBuffer = await fetchRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=604800"); // Cache for 7 days
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.send(buffer);
  } catch (err: any) {
    console.error("Signature proxy error:", err);
    res.status(500).json({ error: `Gagal memproksi gambar tanda tangan: ${err.message}` });
  }
});

// ==========================================
// VITE AND STATIC SERVING MAIN SETUP
// ==========================================
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Full-Stack Attendance app running on http://localhost:${PORT}`);
  });
}

startServer();
