import express from "express";
import path from "path";
import fs from "fs";
import os from "os";
import { createServer as createViteServer } from "vite";
import nodemailer from "nodemailer";
import * as XLSX from "xlsx";
import { initializeApp } from "firebase/app";
import { 
  getFirestore, 
  doc as fDoc, 
  getDoc as fGetDoc, 
  setDoc as fSetDoc, 
  deleteDoc as fDeleteDoc, 
  collection as fCollection, 
  getDocs as fGetDocs 
} from "firebase/firestore";

// Detect if running under serverless/read-only environment (writable path finder helper)
function getWritablePath(filename: string): string {
  const localPath = path.join(process.cwd(), filename);
  try {
    const testFile = path.join(process.cwd(), `.write-test-${Math.random().toString(36).substring(7)}.tmp`);
    fs.writeFileSync(testFile, "test");
    fs.unlinkSync(testFile);
    return localPath;
  } catch (err) {
    // If process.cwd() is read-only (e.g. Vercel), fall back to system temp directory (os.tmpdir())
    return path.join(os.tmpdir(), filename);
  }
}

// Initialize Server-side Firestore using Client/Web SDK (authenticating with API Key instead of Service Account IAM)
let firestoreDb: any = null;
try {
  const firebaseConfigRaw = fs.readFileSync(path.join(process.cwd(), "firebase-applet-config.json"), "utf8");
  const firebaseConfig = JSON.parse(firebaseConfigRaw);
  const firebaseApp = initializeApp(firebaseConfig);
  firestoreDb = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId || "(default)");
  console.log(`[Firestore Client API] Initialized successfully with database ID: ${firebaseConfig.firestoreDatabaseId}`);
} catch (err) {
  console.error("[Firestore Client API] Initialization failed, falling back to local storage only:", err);
}

// Resilient hybrid database adapter (Firestore primary, Local JSON file fallback)
const db = {
  doc(pathStr: string) {
    const parts = pathStr.split("/");
    const collName = parts[0];
    const docId = parts.slice(1).join("/");
    
    // We map settings/xxx and attendees/xxx paths to clean local paths in getWritablePath()
    const filename = `${collName}_${docId.replace(/[\/.]/g, "_")}.json`;
    const filePath = getWritablePath(filename);

    return {
      async get() {
        // Try Firestore first!
        if (firestoreDb) {
          try {
            const docRef = fDoc(firestoreDb, pathStr);
            const snap = await fGetDoc(docRef);
            const exists = typeof snap.exists === "function" ? snap.exists() : snap.exists;
            if (exists) {
              const data = snap.data();
              // Cache locally
              try { fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8"); } catch (e) {}
              return {
                exists: true,
                data() { return data; }
              };
            }
          } catch (err) {
            console.error(`[Firestore GET Error] path: ${pathStr}, falling back to local disk cache:`, err);
          }
        }

        // Fallback to local cache files
        try {
          if (fs.existsSync(filePath)) {
            const raw = fs.readFileSync(filePath, "utf-8");
            const data = JSON.parse(raw);
            return {
              exists: true,
              data() { return data; }
            };
          }
        } catch (e) {}
        
        return {
          exists: false,
          data() { return null; }
        };
      },
      async set(data: any) {
        // Always save locally to ensure zero downtime
        try {
          fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
        } catch (e) {
          console.error(`Error saving settings cache ${pathStr}:`, e);
        }

        // Try Firestore
        if (firestoreDb) {
          try {
            const docRef = fDoc(firestoreDb, pathStr);
            await fSetDoc(docRef, data);
          } catch (err) {
            console.error(`[Firestore SET Error] path: ${pathStr}:`, err);
          }
        }
      },
      async delete() {
        // Delete locally
        try {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        } catch (e) {}

        // Try Firestore
        if (firestoreDb) {
          try {
            const docRef = fDoc(firestoreDb, pathStr);
            await fDeleteDoc(docRef);
          } catch (err) {
            console.error(`[Firestore DELETE Error] path: ${pathStr}:`, err);
          }
        }
      }
    };
  },
  collection(collectionName: string) {
    return {
      async get() {
        // Try Firestore first
        if (firestoreDb) {
          try {
            const collRef = fCollection(firestoreDb, collectionName);
            const snap = await fGetDocs(collRef);
            const wrappedDocs = snap.docs.map(docSnap => {
              const item = docSnap.data();
              // Write a localized copy on-the-fly to keep local cache files in-sync
              const filename = `${collectionName}_${docSnap.id.replace(/[\/.]/g, "_")}.json`;
              const filePath = getWritablePath(filename);
              try { fs.writeFileSync(filePath, JSON.stringify(item, null, 2), "utf-8"); } catch (e) {}

              return {
                id: docSnap.id,
                ref: {
                  async delete() {
                    try { await fDeleteDoc(docSnap.ref); } catch(e){}
                    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch(e){}
                  }
                },
                data() {
                  return item;
                }
              };
            });
            const empty = typeof snap.empty === "function" ? (snap as any).empty() : snap.empty;
            const size = typeof snap.size === "function" ? (snap as any).size() : snap.size;
            return {
              empty,
              size,
              docs: wrappedDocs,
              forEach(callback: (doc: any) => void) {
                wrappedDocs.forEach(callback);
              }
            };
          } catch (err) {
            console.error(`[Firestore Collection GET Error] collection: ${collectionName}, falling back to local files:`, err);
          }
        }

        // Fallback or read-local-cache flow
        if (collectionName === "attendees") {
          const list = await loadLocalAttendees();
          const wrappedDocs = list.map(item => {
            const docId = encodeURIComponent(`${(item.nip || "").trim()}_${(item.name || "").trim()}`.replace(/[\/.]/g, "_"));
            return {
              id: docId,
              ref: {
                async delete() {
                  const refreshed = await loadLocalAttendees();
                  const filtered = refreshed.filter(x => x.nip !== item.nip || x.name !== item.name);
                  await saveLocalAttendees(filtered);
                }
              },
              data() {
                return item;
              }
            };
          });
          return {
            empty: list.length === 0,
            size: list.length,
            docs: wrappedDocs,
            forEach(callback: (doc: any) => void) {
              wrappedDocs.forEach(callback);
            }
          };
        }

        // Otherwise scan the directory for settings_xx files
        try {
          const prefix = `${collectionName}_`;
          const dir = process.cwd();
          const files = fs.readdirSync(dir).filter(f => f.startsWith(prefix) && f.endsWith(".json"));
          const wrappedDocs = files.map(file => {
            const docId = file.substring(prefix.length, file.length - 5);
            try {
              const content = fs.readFileSync(path.join(dir, file), "utf-8");
              const data = JSON.parse(content);
              return {
                id: docId,
                ref: {
                  async delete() {
                     try { fs.unlinkSync(path.join(dir, file)); } catch(e){}
                  }
                },
                data() { return data; }
              };
            } catch(e) {
              return null;
            }
          }).filter(Boolean);

          return {
            empty: wrappedDocs.length === 0,
            size: wrappedDocs.length,
            docs: wrappedDocs,
            forEach(callback: (doc: any) => void) {
              wrappedDocs.forEach(callback);
            }
          };
        } catch(e) {
          console.error("Local Scan error:", e);
        }

        return {
          empty: true,
          size: 0,
          docs: [],
          forEach() {}
        };
      }
    };
  }
};

const app = express();
const PORT = 3000;

const SESSION_FILE = getWritablePath("admin_session.json");
const NOTIFICATION_FILE = getWritablePath("notification_settings.json");
const FORM_RULES_FILE = getWritablePath("form_rules.json");

interface NotificationSettings {
  telegramEnabled: boolean;
  telegramBotToken: string;
  telegramChatId: string;
  whatsappEnabled: boolean;
  whatsappApiProvider: "fonnte" | "webhook";
  whatsappToken: string;
  whatsappTarget: string;
  emailEnabled: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string;
  emailRecipient: string;
}

const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  telegramEnabled: false,
  telegramBotToken: "",
  telegramChatId: "",
  whatsappEnabled: false,
  whatsappApiProvider: "fonnte",
  whatsappToken: "",
  whatsappTarget: "",
  emailEnabled: false,
  smtpHost: "smtp.gmail.com",
  smtpPort: 465,
  smtpSecure: true,
  smtpUser: "",
  smtpPass: "",
  emailRecipient: "",
};

async function loadNotificationSettings(): Promise<NotificationSettings> {
  try {
    const docRef = db.doc("settings/notifications");
    const docSnap = await docRef.get();
    if (docSnap.exists) {
      const data = docSnap.data() as NotificationSettings;
      const merged = { ...DEFAULT_NOTIFICATION_SETTINGS, ...data };
      try { fs.writeFileSync(NOTIFICATION_FILE, JSON.stringify(merged, null, 2), "utf-8"); } catch (e) {}
      return merged;
    }
  } catch (err) {
    console.error("[Firestore] loadNotificationSettings failed, falling back to disk cache:", err);
  }

  try {
    if (fs.existsSync(NOTIFICATION_FILE)) {
      const data = fs.readFileSync(NOTIFICATION_FILE, "utf-8");
      return { ...DEFAULT_NOTIFICATION_SETTINGS, ...JSON.parse(data) };
    }
  } catch (err) {
    console.error("Error reading notification settings file:", err);
  }
  return DEFAULT_NOTIFICATION_SETTINGS;
}

async function saveNotificationSettings(settings: Partial<NotificationSettings>) {
  try {
    const existing = await loadNotificationSettings();
    const updated = { ...existing, ...settings };
    
    // Local save
    try { fs.writeFileSync(NOTIFICATION_FILE, JSON.stringify(updated, null, 2), "utf-8"); } catch (e) {}
    
    // Save to Firestore
    await db.doc("settings/notifications").set(updated);
  } catch (err) {
    console.error("[Firestore] saveNotificationSettings failed:", err);
  }
}

interface FormRules {
  requiredFields: {
    [key: string]: boolean;
  };
}

const DEFAULT_FORM_RULES: FormRules = {
  requiredFields: {
    "Pelatihan / Diklat": true,
    "Rapat Internal / Eksternal": true,
    "Seminar / Sosialisasi / Webinar": true,
    "Kunjungan / Studi Banding": true,
    "Apel / Upacara": true,
    "Lainnya": true,
  }
};

async function loadValidationRules(): Promise<FormRules> {
  try {
    const docRef = db.doc("settings/form_rules");
    const docSnap = await docRef.get();
    if (docSnap.exists) {
      const data = docSnap.data() as FormRules;
      const merged = { 
        requiredFields: { 
          ...DEFAULT_FORM_RULES.requiredFields, 
          ...data.requiredFields 
        } 
      };
      try { fs.writeFileSync(FORM_RULES_FILE, JSON.stringify(merged, null, 2), "utf-8"); } catch (e) {}
      return merged;
    }
  } catch (err) {
    console.error("[Firestore] loadValidationRules failed, falling back to disk cache:", err);
  }

  try {
    if (fs.existsSync(FORM_RULES_FILE)) {
      const data = fs.readFileSync(FORM_RULES_FILE, "utf-8");
      return { 
        requiredFields: { 
          ...DEFAULT_FORM_RULES.requiredFields, 
          ...JSON.parse(data).requiredFields 
        } 
      };
    }
  } catch (err) {
    console.error("Error reading form validation rules file:", err);
  }
  return DEFAULT_FORM_RULES;
}

async function saveValidationRules(rules: Partial<FormRules>) {
  try {
    const existing = await loadValidationRules();
    const updated = { 
      requiredFields: { 
        ...existing.requiredFields, 
        ...(rules.requiredFields || {}) 
      } 
    };

    // Save locally
    try { fs.writeFileSync(FORM_RULES_FILE, JSON.stringify(updated, null, 2), "utf-8"); } catch (e) {}

    // Save to Firestore
    await db.doc("settings/form_rules").set(updated);
  } catch (err) {
    console.error("[Firestore] saveValidationRules failed:", err);
  }
}

// Helper to get Indonesian format date
function getIndonesianDate(): string {
  const date = new Date();
  const days = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
  const months = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember"
  ];
  return `${days[date.getDay()]}, ${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

async function sendTelegramNotification(token: string, chatId: string, text: string) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: "Markdown",
    }),
  });
  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Telegram API Error: ${errorBody}`);
  }
  return await res.json();
}

async function sendWhatsAppNotification(provider: "fonnte" | "webhook", token: string, target: string, text: string, attendeesList: LocalAttendee[]) {
  if (provider === "fonnte") {
    const res = await fetch("https://api.fonnte.com/send", {
      method: "POST",
      headers: {
        "Authorization": token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        target: target,
        message: text,
      }),
    });
    if (!res.ok) {
      const errorBody = await res.text();
      throw new Error(`Fonnte WhatsApp API Error: ${errorBody}`);
    }
    return await res.json();
  } else {
    const res = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "Diklit RSUD dr.H.Jusuf.SK Smart Presence",
        event: "session_ended",
        timestamp: new Date().toISOString(),
        total_attendees: attendeesList.length,
        summary_text: text,
        attendees: attendeesList.map(a => ({
          no: a.no,
          nip: a.nip,
          name: a.name,
          instansi: a.instansi,
          jabatan: a.jabatan,
          email: a.email,
          checkInTime: a.checkInTime
        }))
      }),
    });
    if (!res.ok) {
      const errorBody = await res.text();
      throw new Error(`Webhook Error (${res.status}): ${errorBody}`);
    }
    return { success: true };
  }
}

async function sendEmailNotification(settings: NotificationSettings, text: string, html: string) {
  const transporter = nodemailer.createTransport({
    host: settings.smtpHost,
    port: Number(settings.smtpPort),
    secure: settings.smtpSecure,
    auth: {
      user: settings.smtpUser,
      pass: settings.smtpPass,
    },
  });

  const mailOptions = {
    from: `"E-Absensi Diklit" <${settings.smtpUser || "noreply@rsudjusufsk.go.id"}>`,
    to: settings.emailRecipient,
    subject: `[Laporan Absensi] Diklit RSUD dr.H.Jusuf.SK - ${getIndonesianDate()}`,
    text: text,
    html: html,
  };

  return await transporter.sendMail(mailOptions);
}

async function triggerAutoNotification() {
  const settings = await loadNotificationSettings();
  const list = await loadLocalAttendees();
  
  if (list.length === 0) {
    console.log("[Notification] No attendees registered. Skipping daily summary notification.");
    return;
  }

  const dateStr = getIndonesianDate();
  const listDetails = list
    .map((a, idx) => `${idx + 1}. ${a.name} (NIP: ${a.nip}) - ${a.instansi} (${a.jabatan}) - Jam: ${a.checkInTime.split(" ")[1]}`)
    .join("\n");

  const textMessage = `*RINGKASAN KEHADIRAN HARIAN*
*Diklit RSUD dr.H.Jusuf.SK*

📅 Tanggal: ${dateStr}
👥 Total Kehadiran: ${list.length} Orang

*Daftar Hadir:*
${listDetails}

_Laporan ini dikirim otomatis setelah sesi absensi HP dinonaktifkan oleh Admin._`;

  // Process Telegram
  if (settings.telegramEnabled && settings.telegramBotToken && settings.telegramChatId) {
    try {
      console.log("[Notification] Sending Telegram summary report...");
      await sendTelegramNotification(settings.telegramBotToken, settings.telegramChatId, textMessage);
      console.log("[Notification] Telegram notification sent successfully.");
    } catch (err) {
      console.error("[Notification] Telegram notification dispatch failure:", err);
    }
  }

  // Process WhatsApp
  if (settings.whatsappEnabled && settings.whatsappTarget) {
    try {
      console.log("[Notification] Sending WhatsApp summary report...");
      await sendWhatsAppNotification(settings.whatsappApiProvider, settings.whatsappToken, settings.whatsappTarget, textMessage, list);
      console.log("[Notification] WhatsApp notification sent successfully.");
    } catch (err) {
      console.error("[Notification] WhatsApp notification dispatch failure:", err);
    }
  }

  // Process Email
  if (settings.emailEnabled && settings.emailRecipient) {
    try {
      console.log("[Notification] Sending Email summary report...");
      const htmlRows = list
        .map(
          (a, idx) => `
        <tr>
          <td style="padding: 10px; border: 1px solid #cbd5e1; text-align: center;">${idx + 1}</td>
          <td style="padding: 10px; border: 1px solid #cbd5e1; font-weight: bold; color: #1e293b;">${a.name}</td>
          <td style="padding: 10px; border: 1px solid #cbd5e1; font-family: monospace;">${a.nip}</td>
          <td style="padding: 10px; border: 1px solid #cbd5e1;">${a.instansi}</td>
          <td style="padding: 10px; border: 1px solid #cbd5e1;">${a.jabatan}</td>
          <td style="padding: 10px; border: 1px solid #cbd5e1; text-align: center; color: #64748b;">${a.checkInTime.split(" ")[1]}</td>
        </tr>`
        )
        .join("");

      const htmlEmailMessage = `
      <div style="font-family: sans-serif; max-width: 700px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
        <div style="background-color: #1e1b4b; padding: 24px; border-radius: 10px 10px 0 0; text-align: center; color: #ffffff;">
          <h2 style="margin: 0; font-size: 20px; font-weight: 800; tracking-tight: -0.025em;">DIKLIT RSUD dr.H.Jusuf.SK</h2>
          <p style="margin: 6px 0 0 0; font-size: 13px; color: #c7d2fe; text-transform: uppercase; font-weight: 600; letter-spacing: 0.05em;">Smart Presence System</p>
        </div>
        <div style="padding: 24px;">
          <p style="font-size: 14px; color: #334155; font-weight: 500;">Yth. Admin Diklit RSUD dr.H.Jusuf.SK,</p>
          <p style="font-size: 14px; color: #334155; line-height: 1.5;">Berikut ini adalah laporan ringkasan kehadiran harian peserta yang telah direkam dan dirangkum secara lengkap setelah sesi absensi dinonaktifkan:</p>
          
          <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px; background-color: #f8fafc; border-radius: 8px; border: 1px solid #f1f5f9;">
            <tr>
              <td style="padding: 12px; border-bottom: 1px solid #f1f5f9; font-weight: bold; color: #64748b;">Hari/Tanggal</td>
              <td style="padding: 12px; border-bottom: 1px solid #f1f5f9; text-align: right; font-weight: bold; color: #0f172a;">${dateStr}</td>
            </tr>
            <tr>
              <td style="padding: 12px; font-weight: bold; color: #64748b;">Total Hadir</td>
              <td style="padding: 12px; text-align: right; font-weight: 800; color: #4f46e5; font-size: 18px;">${list.length} Orang</td>
            </tr>
          </table>
          
          <h3 style="font-size: 15px; font-weight: 700; color: #1e1b4b; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px; margin-top: 30px;">Daftar Detail Kehadiran Peserta</h3>
          <table style="width: 100%; border-collapse: collapse; font-size: 12px; text-align: left; margin-top: 12px;">
            <thead>
              <tr style="background-color: #f1f5f9; color: #334155; font-weight: bold;">
                <th style="padding: 10px; border: 1px solid #cbd5e1; text-align: center; width: 40px;">No</th>
                <th style="padding: 10px; border: 1px solid #cbd5e1;">Nama</th>
                <th style="padding: 10px; border: 1px solid #cbd5e1;">NIP</th>
                <th style="padding: 10px; border: 1px solid #cbd5e1;">Instansi</th>
                <th style="padding: 10px; border: 1px solid #cbd5e1;">Jabatan</th>
                <th style="padding: 10px; border: 1px solid #cbd5e1; text-align: center; width: 80px;">Waktu</th>
              </tr>
            </thead>
            <tbody>
              ${htmlRows}
            </tbody>
          </table>
        </div>
        <div style="background-color: #f8fafc; padding: 18px; border-radius: 0 0 10px 10px; text-align: center; color: #64748b; font-size: 11px; border-top: 1px solid #e2e8f0; line-height: 1.4;">
          Laporan dibuat secara otomatis oleh <strong>Sistem Smart Presence Diklit RSUD dr.H.Jusuf.SK</strong>.<br />
          Harap tidak membalas email otomatis ini.
        </div>
      </div>`;

      await sendEmailNotification(settings, textMessage, htmlEmailMessage);
      console.log("[Notification] Email notification sent successfully.");
    } catch (err) {
      console.error("[Notification] Email notification dispatch failure:", err);
    }
  }
}

// Middleware to parse JSON payloads with Base64 signature images (up to 10MB)
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

interface AdminSession {
  accessToken: string | null;
  savedAt: number;
  spreadsheetId?: string;
  driveFolderId?: string;
  isSessionActive?: boolean;
  webAppUrl?: string;
}

const ATTENDEES_FILE = getWritablePath("attendees.json");

interface LocalAttendee {
  no: number;
  nip: string;
  name: string;
  instansi: string;
  jabatan: string;
  jenisKegiatan: string;
  judulKegiatan: string;
  email?: string;
  checkInTime: string;
  signature: string; // Base64 signature image
  signatureUrl: string; // Dynamic local serve url
  signatureFileId?: string; // Google Drive ID if synced
  sheetRowIndex?: number;
}

// Helper to load local attendees with bidirectional sync and deduplication so nothing is lost
async function loadLocalAttendees(): Promise<LocalAttendee[]> {
  let list: LocalAttendee[] = [];
  let loadedFromFirestore = false;

  // Try loading from Firestore first
  if (firestoreDb) {
    try {
      const snap = await fGetDocs(fCollection(firestoreDb, "attendees"));
      const empty = typeof snap.empty === "function" ? (snap as any).empty() : snap.empty;
      if (!empty) {
        snap.forEach(docSnap => {
          const item = docSnap.data() as LocalAttendee;
          if (item.jenisKegiatan === undefined) {
            item.jenisKegiatan = item.email || "-";
          }
          if (item.judulKegiatan === undefined) {
            item.judulKegiatan = "-";
          }
          list.push(item);
        });
        loadedFromFirestore = true;
      }
    } catch (err) {
      console.error("[Firestore] loadLocalAttendees failed, using disk fallback:", err);
    }
  }

  // If Firestore didn't return anything or failed, use local disk
  if (!loadedFromFirestore) {
    try {
      if (fs.existsSync(ATTENDEES_FILE)) {
        const data = fs.readFileSync(ATTENDEES_FILE, "utf-8");
        const rawList = JSON.parse(data) as any[];
        list = rawList.map(a => {
          if (a.jenisKegiatan === undefined) {
            a.jenisKegiatan = a.email || "-";
          }
          if (a.judulKegiatan === undefined) {
            a.judulKegiatan = "-";
          }
          return a as LocalAttendee;
        });
      }
    } catch (err) {
      console.error("Error reading local attendees file:", err);
    }
  }

  // Ensure they are sorted by sequential no
  list.sort((a, b) => (a.no || 0) - (b.no || 0));
  list.forEach((item, index) => {
    item.no = index + 1;
  });

  // Always write back to disk to have a synchronized local cache copy
  try {
    fs.writeFileSync(ATTENDEES_FILE, JSON.stringify(list, null, 2), "utf-8");
  } catch (e) {}

  return list;
}

// Helper to save local attendees with instant disk durability and asynchronous Firestore sync
async function saveLocalAttendees(list: LocalAttendee[]) {
  // Sort and fix sequential numbers list
  list.sort((a, b) => (a.no || 0) - (b.no || 0));
  list.forEach((item, index) => {
    item.no = index + 1;
  });

  // 1. Save to local disk cache
  try {
    fs.writeFileSync(ATTENDEES_FILE, JSON.stringify(list, null, 2), "utf-8");
  } catch (err) {
    console.error("Error writing local attendees file:", err);
  }

  // 2. Synchronize to Firestore documents
  if (firestoreDb) {
    try {
      const promises = list.map(async (a) => {
        const docId = encodeURIComponent(`${(a.nip || "").trim()}_${(a.name || "").trim()}`.replace(/[\/.]/g, "_"));
        const docRef = fDoc(firestoreDb!, "attendees", docId);
        await fSetDoc(docRef, a);
      });
      await Promise.all(promises);
      console.log(`[Firestore Sync] Successfully synchronized ${list.length} attendees.`);
    } catch (err) {
      console.error("[Firestore Sync] Failed to sync attendees to Firestore:", err);
    }
  }
}

// Helper to load admin session from file
async function loadSession(): Promise<AdminSession | null> {
  try {
    const docRef = db.doc("settings/sessions");
    const docSnap = await docRef.get();
    if (docSnap.exists) {
      const data = docSnap.data() as AdminSession;
      const expiry = data.accessToken ? 3 * 3600 * 1000 : 24 * 3600 * 1000;
      if (Date.now() - data.savedAt < expiry) {
        // Cache to local file
        try { fs.writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2), "utf-8"); } catch (e) {}
        return data;
      }
    }
  } catch (err) {
    console.error("[LocalDB] loadSession failed, falling back to disk cache:", err);
  }

  try {
    if (fs.existsSync(SESSION_FILE)) {
      const data = fs.readFileSync(SESSION_FILE, "utf-8");
      const parsed = JSON.parse(data);
      const expiry = parsed.accessToken ? 3 * 3600 * 1000 : 24 * 3600 * 1000;
      if (Date.now() - parsed.savedAt < expiry) {
        return parsed;
      }
    }
  } catch (err) {
    console.error("Error reading admin session file:", err);
  }
  return null;
}

// Helper to save admin session to file
async function saveSession(accessToken: string | null, spreadsheetId?: string, driveFolderId?: string, isSessionActive?: boolean, webAppUrl?: string) {
  try {
    const existing = await loadSession();
    const session: AdminSession = {
      accessToken: accessToken !== undefined ? accessToken : (existing ? existing.accessToken : null),
      savedAt: Date.now(),
      spreadsheetId: spreadsheetId || (existing ? existing.spreadsheetId : undefined),
      driveFolderId: driveFolderId || (existing ? existing.driveFolderId : undefined),
      isSessionActive: isSessionActive !== undefined ? isSessionActive : (existing ? existing.isSessionActive : false),
      webAppUrl: webAppUrl !== undefined ? webAppUrl : (existing ? existing.webAppUrl : undefined)
    };
    
    // Save locally
    try { fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2), "utf-8"); } catch (e) {}
    
    // Save to Local DB adapter
    const docRef = db.doc("settings/sessions");
    await docRef.set(session);
    console.log("[LocalDB] Save session success:", session);
  } catch (err) {
    console.error("[LocalDB] saveSession error:", err);
  }
}

// Helper to delete admin session
async function clearSession() {
  try {
    const docRef = db.doc("settings/sessions");
    await docRef.delete();
  } catch (e) {}

  try {
    if (fs.existsSync(SESSION_FILE)) {
      fs.unlinkSync(SESSION_FILE);
      console.log("Admin session file cleared.");
    }
  } catch (err) {
    console.error("Error deleting admin session file:", err);
  }
}

// In-memory tracker for active admin sessions (clientId -> lastSeenTime)
const activeAdminsTracker = new Map<string, number>();
let lastSpreadsheetCheckTime = 0;
let cachedSpreadsheetStatus: "connected" | "unconfigured" | "error" = "unconfigured";
let cachedSpreadsheetError: string | null = null;

async function checkSpreadsheetConnection(token: string, spreadsheetId: string): Promise<{ status: "connected" | "error"; error: string | null }> {
  if (!token || !spreadsheetId) {
    return { status: "error", error: "Token atau ID Spreadsheet tidak valid." };
  }
  try {
    const checkRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=spreadsheetId`, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    if (checkRes.ok) {
      return { status: "connected", error: null };
    } else {
      const txt = await checkRes.text();
      let shortError = "Gagal menghubungi Google API";
      if (txt.includes("invalid_grant") || txt.includes("expired")) {
        shortError = "Sesi Google telah kadaluarsa (re-login)";
      } else if (txt.includes("not found") || txt.includes("404")) {
        shortError = "Spreadsheet tidak ditemukan";
      }
      return { status: "error", error: shortError };
    }
  } catch (err: any) {
    return { status: "error", error: err.message || "Kesalahan jaringan" };
  }
}

// ==========================================
// API ENDPOINTS
// ==========================================

// Get session status (checks if check-in mode is active)
app.get("/api/session-status", async (req, res) => {
  const session = await loadSession();
  
  // Track active admin administrators
  const adminClientId = req.query.adminClientId as string;
  if (adminClientId) {
    activeAdminsTracker.set(adminClientId, Date.now());
  }

  // Prune inactive admins (older than 25s)
  const now = Date.now();
  for (const [id, lastSeen] of activeAdminsTracker.entries()) {
    if (now - lastSeen > 25000) {
      activeAdminsTracker.delete(id);
    }
  }
  
  // Standard minimum is 1 if they are querying (which means someone is looking at least)
  const activeAdminCount = Math.max(1, activeAdminsTracker.size);

  // Spreadsheet API connections check
  let googleSpreadsheetStatus: "connected" | "unconfigured" | "error" = "unconfigured";
  let googleSpreadsheetError: string | null = null;

  if (session && session.accessToken && session.spreadsheetId) {
    // Cache check results for 15s to keep dashboard updates ultra-fast
    if (now - lastSpreadsheetCheckTime > 15000) {
      lastSpreadsheetCheckTime = now;
      try {
        const check = await checkSpreadsheetConnection(session.accessToken, session.spreadsheetId);
        cachedSpreadsheetStatus = check.status;
        cachedSpreadsheetError = check.error;
      } catch (err: any) {
        cachedSpreadsheetStatus = "error";
        cachedSpreadsheetError = err.message || "Kesalahan tidak diketahui.";
      }
    }
    googleSpreadsheetStatus = cachedSpreadsheetStatus;
    googleSpreadsheetError = cachedSpreadsheetError;
  } else if (session && session.accessToken) {
    googleSpreadsheetStatus = "error";
    googleSpreadsheetError = "Spreadsheet belum dibuat atau diset.";
  } else {
    googleSpreadsheetStatus = "unconfigured";
  }

  if (session) {
    res.json({ 
      active: true, 
      savedAt: session.savedAt,
      spreadsheetId: session.spreadsheetId || null,
      driveFolderId: session.driveFolderId || null,
      webAppUrl: session.webAppUrl || null,
      activeAdminCount,
      googleSpreadsheetStatus,
      googleSpreadsheetError
    });
  } else {
    res.json({ 
      active: true,
      activeAdminCount,
      googleSpreadsheetStatus,
      googleSpreadsheetError
    });
  }
});

// Admin saves token/settings for public check-ins
app.post("/api/save-token", async (req, res) => {
  const { accessToken, spreadsheetId, driveFolderId, isSessionActive, webAppUrl } = req.body;
  const current = await loadSession();
  const wasActive = current ? !!current.isSessionActive : false;
  const nextActive = isSessionActive !== undefined ? !!isSessionActive : (current ? !!current.isSessionActive : true);
  
  await saveSession(
    accessToken !== undefined ? accessToken : (current ? current.accessToken : null),
    spreadsheetId || (current ? current.spreadsheetId : undefined),
    driveFolderId || (current ? current.driveFolderId : undefined),
    nextActive,
    webAppUrl !== undefined ? webAppUrl : (current ? current.webAppUrl : undefined)
  );

  if (wasActive && !nextActive) {
    triggerAutoNotification().catch(e => console.error("Auto notification error:", e));
  }

  res.json({ status: "success", message: "Admin session registered on server." });
});

// Admin logs in via local Username & Password fallback bypass
app.post("/api/admin/local-login", async (req, res) => {
  const { username, password } = req.body;
  
  const userText = (username || "").trim().toLowerCase();
  const passText = (password || "").trim();

  if (!userText || !passText) {
    return res.status(400).json({ error: "Username dan Password harus diisi." });
  }

  // Accept user "admin" with valid passwords
  if (userText === "admin" && (passText === "admin" || passText === "admin123" || passText === "absenkita2026")) {
    const current = await loadSession() || {
      accessToken: null,
      savedAt: Date.now(),
      isSessionActive: false
    };
    await saveSession(
      current.accessToken,
      current.spreadsheetId,
      current.driveFolderId,
      current.isSessionActive
    );
    return res.json({ 
      success: true, 
      message: "Login admin lokal sukses.",
      session: await loadSession()
    });
  } else {
    return res.status(401).json({ error: "Username atau Password salah. Gunakan Username: admin, Password: admin123" });
  }
});

// Admin clears token
app.post("/api/clear-token", async (req, res) => {
  const current = await loadSession();
  const wasActive = current ? !!current.isSessionActive : false;
  if (current) {
    // Keep credentials, just deactivate active public check-in mode.
    await saveSession(current.accessToken, current.spreadsheetId, current.driveFolderId, false);
  } else {
    await clearSession();
  }

  if (wasActive) {
    triggerAutoNotification().catch(e => console.error("Auto notification error:", e));
  }

  res.json({ status: "success", message: "Admin session removed." });
});

// Get notification configuration
app.get("/api/notifications/config", async (req, res) => {
  const current = await loadNotificationSettings();
  res.json(current);
});

// Save notification configuration
app.post("/api/notifications/config", async (req, res) => {
  await saveNotificationSettings(req.body);
  res.json({ success: true, message: "Pengaturan notifikasi berhasil disimpan." });
});

// Get form validation rules configuration
app.get("/api/form-rules/config", async (req, res) => {
  const current = await loadValidationRules();
  res.json(current);
});

// Save form validation rules configuration
app.post("/api/form-rules/config", async (req, res) => {
  await saveValidationRules(req.body);
  res.json({ success: true, message: "Pengaturan validasi berhasil disimpan." });
});

// Test notification
app.post("/api/notifications/test", async (req, res) => {
  const { channel, settings } = req.body;
  if (!channel) {
    return res.status(400).json({ error: "Channel is required for testing." });
  }

  const dateStr = getIndonesianDate();
  const testMessage = `🧪 *TES KONEKSI NOTIFIKASI*
*Diklit RSUD dr.H.Jusuf.SK*

Selamat! Layanan notifikasi absensi harian Anda telah aktif dan terhubung dengan sukses.

📅 Tanggal Tes: ${dateStr}
⏱️ Waktu: ${new Date().toLocaleTimeString()}
✅ Status: Sukses Terhubung

_Pesan simulasi diset dari Panel Pengaturan Admin._`;

  const dummyList = [
    { no: 1, name: "Peserta Simulasi 1", nip: "19950302202611002", instansi: "Bagian Diklit RSUD", jabatan: "Peserta Pelatihan", email: "simulasi@rsudjusufsk.go.id", checkInTime: `${new Date().toLocaleDateString()} 09:15:30`, signature: "", signatureUrl: "" }
  ];

  try {
    if (channel === "telegram") {
      if (!settings.telegramBotToken || !settings.telegramChatId) {
        throw new Error("Token Bot dan Chat ID Telegram wajib diisi.");
      }
      await sendTelegramNotification(settings.telegramBotToken, settings.telegramChatId, testMessage);
    } else if (channel === "whatsapp") {
      if (!settings.whatsappTarget) {
        throw new Error("Target nomor/url WhatsApp wajib diisi.");
      }
      await sendWhatsAppNotification(settings.whatsappApiProvider, settings.whatsappToken, settings.whatsappTarget, testMessage, dummyList as any);
    } else if (channel === "email") {
      if (!settings.emailRecipient || !settings.smtpHost || !settings.smtpUser || !settings.smtpPass) {
        throw new Error("Data SMTP Lengkap & Penerima Email wajib diisi.");
      }
      const testHtml = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
        <div style="background-color: #4f46e5; padding: 24px; border-radius: 8px 8px 0 0; text-align: center; color: #ffffff;">
          <h2 style="margin: 0; font-size: 18px; font-weight: bold;">TES INTEGRASI EMAIL SUKSES</h2>
          <p style="margin: 5px 0 0 0; font-size: 12px; color: #e0e7ff;">Diklit RSUD dr.H.Jusuf.SK</p>
        </div>
        <div style="padding: 24px; text-align: center; color: #334155;">
          <p style="font-size: 15px; font-weight: bold; color: #0f172a; margin-bottom: 8px;">Selamat!</p>
          <p style="font-size: 13px; line-height: 1.5; color: #475569;">Konfigurasi server SMTP Anda berhasil terhubung dengan sistem Smart Presence Diklit RSUD dr.H.Jusuf.SK.</p>
          <div style="display: inline-block; background-color: #ecfdf5; border: 1px solid #a7f3d0; color: #065f46; font-size: 12px; font-weight: bold; padding: 8px 16px; border-radius: 20px; margin: 15px 0;">
            Status: TERHUBUNG / CONNECTED
          </div>
          <p style="font-size: 11px; color: #94a3b8; margin-top: 15px;">Waktu tes: ${new Date().toLocaleString()}</p>
        </div>
      </div>
      `;
      await sendEmailNotification(settings, testMessage, testHtml);
    } else {
      throw new Error(`Saluran tidak dikenal: ${channel}`);
    }

    res.json({ success: true, message: `Berhasil mengirimkan tes notifikasi ke ${channel.toUpperCase()}!` });
  } catch (err: any) {
    console.error(`Test notification failed (${channel}):`, err);
    res.status(500).json({ error: err.message || "Gagal menghubungkan ke layanan tujuan." });
  }
});

// Helper to pull attendees from Google Sheets and save/reconcile with local database
async function pullAttendeesFromSheets(session: AdminSession): Promise<boolean> {
  if (!session || !session.accessToken || !session.spreadsheetId) {
    return false;
  }

  try {
    const token = session.accessToken;
    const spreadsheetId = session.spreadsheetId;

    // 1. Get first sheet name (tab name)
    const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    if (!metaRes.ok) {
      const errText = await metaRes.text();
      console.error(`[Pull Sync] Google Sheet Metadata failed: ${errText}`);
      return false;
    }

    const spreadsheetMeta = (await metaRes.json()) as { sheets: any[] };
    const sheets = spreadsheetMeta.sheets || [];
    if (sheets.length === 0) {
      return false;
    }
    const firstSheetTitle = sheets[0].properties.title;

    // 2. Read values starting from row 2 (skipping header) A2:I
    const valuesRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(firstSheetTitle)}!A2:I`, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    if (!valuesRes.ok) {
      const errText = await valuesRes.text();
      console.error(`[Pull Sync] Google Sheet Values read failed: ${errText}`);
      return false;
    }

    const valuesData = (await valuesRes.json()) as { values?: any[][] };
    const sheetRows = valuesData.values || [];

    const sheetAttendees: LocalAttendee[] = [];
    sheetRows.forEach((row, idx) => {
      if (!row || row.length < 2) return;
      const rowNo = parseInt(String(row[0])) || (idx + 1);
      const rowNip = row[1] ? String(row[1]).trim() : "";
      const rowName = row[2] ? String(row[2]).trim() : "";
      const rowInstansi = row[3] ? String(row[3]).trim() : "";
      const rowJabatan = row[4] ? String(row[4]).trim() : "";
      const rowJenisKegiatan = row[5] ? String(row[5]).trim() : "";
      const rowJudulKegiatan = row[6] ? String(row[6]).trim() : "";
      const rowCheckInTime = row[7] ? String(row[7]).trim() : "";
      const rowSigUrl = row[8] ? String(row[8]).trim() : "";

      if (!rowNip && !rowName) return;

      sheetAttendees.push({
        no: rowNo,
        nip: rowNip,
        name: rowName,
        instansi: rowInstansi,
        jabatan: rowJabatan,
        jenisKegiatan: rowJenisKegiatan || "-",
        judulKegiatan: rowJudulKegiatan || "-",
        checkInTime: rowCheckInTime,
        signature: "", 
        signatureUrl: rowSigUrl || `/api/signatures/${encodeURIComponent(rowNip)}`,
        sheetRowIndex: idx + 2
      });
    });

    const list = await loadLocalAttendees();
    const localMap = new Map<string, LocalAttendee>();
    list.forEach(a => {
      const key = `${(a.nip || "").trim().toLowerCase()}_${(a.name || "").trim().toLowerCase()}`;
      localMap.set(key, a);
    });

    let modified = false;
    sheetAttendees.forEach(sa => {
      const key = `${(sa.nip || "").trim().toLowerCase()}_${(sa.name || "").trim().toLowerCase()}`;
      if (!localMap.has(key)) {
        list.push(sa);
        modified = true;
      } else {
        const existing = localMap.get(key);
        if (existing.sheetRowIndex !== sa.sheetRowIndex) {
          existing.sheetRowIndex = sa.sheetRowIndex;
          modified = true;
        }
        if (!existing.signatureUrl && sa.signatureUrl) {
          existing.signatureUrl = sa.signatureUrl;
          modified = true;
        }
      }
    });

    if (modified) {
      await saveLocalAttendees(list);
    }
    return true;
  } catch (error) {
    console.error("[Pull Sync] Failed pulling sheet rows:", error);
    return false;
  }
}

let lastSheetsSyncTime = 0;

// Get all attendees (stripped of huge base64 signatures to be ultra-fast)
app.get("/api/attendees", async (req, res) => {
  const force = req.query.force === "true" || req.query.sync === "true";
  const session = await loadSession();
  const now = Date.now();
  if (session && session.accessToken && session.spreadsheetId) {
    if (force || now - lastSheetsSyncTime > 15000) {
      lastSheetsSyncTime = now;
      console.log(`[Pull Sync] Running background sheets sync (force: ${force})...`);
      await pullAttendeesFromSheets(session);
    }
  }

  const list = await loadLocalAttendees();
  const stripped = list.map(({ signature, ...rest }) => rest);
  res.json(stripped);
});

// Fetch base64 signature as local PNG file bypassing Google Drive CORS
app.get("/api/signatures/:nip", async (req, res) => {
  const { nip } = req.params;
  const list = await loadLocalAttendees();
  const found = list.find(a => a.nip === nip);
  if (!found || !found.signature) {
    return res.status(404).send("Signature not found");
  }

  try {
    const base64Data = found.signature.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400"); // cache 24h
    res.send(buffer);
  } catch (err: any) {
    console.error("Local signature streaming error:", err);
    res.status(500).send("Gagal mengurai gambar tanda tangan");
  }
});

// Web attendee deletion endpoint (updates local database + optional Sheets)
app.delete("/api/attendees/:nip", async (req, res) => {
  const { nip } = req.params;
  const list = await loadLocalAttendees();
  const index = list.findIndex(a => a.nip === nip);
  
  if (index === -1) {
    return res.status(404).json({ error: "Data peserta tidak ditemukan." });
  }

  const removed = list.splice(index, 1)[0];
  await saveLocalAttendees(list);

  // Clean Firestore individual doc to keep database tidy
  try {
    const docId = encodeURIComponent(`${(removed.nip || "").trim()}_${(removed.name || "").trim()}`.replace(/[\/.]/g, "_"));
    const docRef = db.doc(`attendees/${docId}`);
    await docRef.delete();
  } catch (err) {
    console.error(`[Firestore] Failed to delete attendee doc on delete:`, err);
  }

  // Best-effort delete from Google Sheets if admin has loaded credentials
  const session = await loadSession();
  if (session && session.accessToken && removed.sheetRowIndex) {
    try {
      const token = session.accessToken;
      const sheetId = session.spreadsheetId || "1Fu2MejKfS_Nm7AdqwERfaU22QBanPeYG8fQeILciwpw";
      const rowNum = removed.sheetRowIndex;

      const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (metaRes.ok) {
        const meta = await metaRes.json();
        const firstTabId = meta.sheets[0].properties.sheetId ?? 0;
        
        await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            requests: [
              {
                deleteDimension: {
                  range: {
                    sheetId: firstTabId,
                    dimension: "ROWS",
                    startIndex: rowNum - 1,
                    endIndex: rowNum
                  }
                }
              }
            ]
          })
        });
        console.log(`[Google Sync] Row Deleted on Google Sheets for ${nip}`);
      }
    } catch (gErr) {
      console.error("[Google Sync] Best-effort Google Sheet row deletion failed:", gErr);
    }
  }

  res.json({ success: true, message: "Peserta berhasil dihapus dari data lokal." });
});

// Web attendee edit endpoint (updates local database + optional Sheets)
app.put("/api/attendees/:nip", async (req, res) => {
  const { nip } = req.params;
  const { name, nip: newNip, instansi, jabatan, jenisKegiatan, judulKegiatan, email } = req.body;
  const list = await loadLocalAttendees();
  const index = list.findIndex(a => a.nip === nip);
  
  if (index === -1) {
    return res.status(404).json({ error: "Data peserta tidak ditemukan." });
  }

  list[index].name = name || list[index].name;
  if (newNip) {
    list[index].nip = newNip;
  }
  list[index].instansi = instansi || list[index].instansi;
  list[index].jabatan = jabatan || list[index].jabatan;
  list[index].jenisKegiatan = jenisKegiatan || email || list[index].jenisKegiatan || "-";
  list[index].judulKegiatan = judulKegiatan || list[index].judulKegiatan || "-";

  await saveLocalAttendees(list);

  // Best-effort edit update on Google Sheets
  const session = await loadSession();
  if (session && session.accessToken && list[index].sheetRowIndex) {
    try {
      const token = session.accessToken;
      const sheetId = session.spreadsheetId || "1Fu2MejKfS_Nm7AdqwERfaU22QBanPeYG8fQeILciwpw";
      const rowNum = list[index].sheetRowIndex;

      const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (metaRes.ok) {
        const meta = await metaRes.json();
        const firstTabName = meta.sheets[0].properties.title;
        
        await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(firstTabName)}!A${rowNum}:I${rowNum}?valueInputOption=USER_ENTERED`,
          {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              range: `${firstTabName}!A${rowNum}:I${rowNum}`,
              majorDimension: "ROWS",
              values: [
                [
                  list[index].no,
                  list[index].nip,
                  list[index].name,
                  list[index].instansi,
                  list[index].jabatan,
                  list[index].jenisKegiatan,
                  list[index].judulKegiatan,
                  list[index].checkInTime,
                  list[index].signatureUrl,
                ],
              ],
            }),
          }
        );
        console.log(`[Google Sync] Row edited on Google Sheets for ${nip}`);
      }
    } catch (gErr) {
      console.error("[Google Sync] Best-effort Google Sheet row edit failed:", gErr);
    }
  }

  res.json({ success: true, message: "Perubahan peserta berhasil disimpan." });
});

// Admin clears all attendees
app.post("/api/clear-all", async (req, res) => {
  await saveLocalAttendees([]);
  
  // Clear Firestore attendees collection as well
  try {
    const snapshot = await db.collection("attendees").get();
    for (const d of snapshot.docs) {
      await d.ref.delete();
    }
    console.log("[Firestore] Cleared attendees collection on clear-all");
  } catch (err) {
    console.error("[Firestore] Clear collection failed:", err);
  }

  res.json({ success: true, message: "Seluruh data lokal berhasil dikosongkan." });
});

// Public Submit Attendance
app.post("/api/submit-attendance", async (req, res) => {
  const sessionDoc = await loadSession();
  const session: AdminSession = sessionDoc || { accessToken: null, savedAt: Date.now() };

  const { name, instansi, nip, jabatan, jenisKegiatan, judulKegiatan, email, signature } = req.body;

  if (!name || !instansi || !nip || !jabatan || !signature) {
    return res.status(400).json({ error: "Nama, Instansi, Jabatan, NIP, dan tanda tangan wajib diisi." });
  }

  const resolvedJenisKegiatan = jenisKegiatan || email || "-";
  const resolvedJudulKegiatan = judulKegiatan || "-";

  try {
    const list = await loadLocalAttendees();
    
    // Check duplication based on both NIP and Name to allow multiple dummy/unfilled NIP submissions with different names
    const alreadyRegistered = list.some(
      a => a.nip.trim().toLowerCase() === nip.trim().toLowerCase() && 
           a.name.trim().toLowerCase() === name.trim().toLowerCase()
    );
    if (alreadyRegistered) {
      return res.status(400).json({ error: `Peserta dengan nama "${name}" dan NIP "${nip}" sudah terdaftar.` });
    }

    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, "0");
    const checkInTime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    const nextNo = list.length + 1;
    // Generate clean local signature URL
    const localSigUrl = `/api/signatures/${encodeURIComponent(nip)}?t=${Date.now()}`;

    const newAttendee: LocalAttendee = {
      no: nextNo,
      nip,
      name,
      instansi,
      jabatan,
      jenisKegiatan: resolvedJenisKegiatan,
      judulKegiatan: resolvedJudulKegiatan,
      checkInTime,
      signature,
      signatureUrl: localSigUrl,
      sheetRowIndex: nextNo + 1
    };

    let googleSynced = false;
    let signatureFileId = "";

    // If Google token is live, upload to sheets and drive!
    if (session.accessToken) {
      const token = session.accessToken;
      try {
        console.log(`[Google Sync] Uploading signature image to Drive for: ${name}`);
        signatureFileId = await uploadSignatureToDrive(token, name, signature, session.driveFolderId);
        newAttendee.signatureFileId = signatureFileId;
        
        // Use thumb image or drive direct link
        const driveUrl = `https://drive.google.com/thumbnail?id=${signatureFileId}&sz=w500`;
        newAttendee.signatureUrl = driveUrl; // Fallback to drive on sheets

        console.log(`[Google Sync] Appending row to Google Sheet value row: ${name}`);
        await appendAttendeeToSheet(token, {
          nip,
          name,
          instansi,
          jabatan,
          jenisKegiatan: resolvedJenisKegiatan,
          judulKegiatan: resolvedJudulKegiatan,
          checkInTime,
          signatureFileId
        }, session.spreadsheetId);

        googleSynced = true;
        console.log(`[Google Sync] Successfully synced to Google cloud: ${name}`);
      } catch (gErr) {
        console.error("[Google Sync] Best-effort sync to Google Drive & Google Sheets failed:", gErr);
        // Do not fail the attendance! It is saved locally.
        // Recover signature URL to the local serve URL
        newAttendee.signatureUrl = localSigUrl;
      }
    }

    // ALSO Sync using custom Google Apps Script Macro URL (as a primary or secondary robust dual-write endpoint)
    const webAppUrl = session.webAppUrl || "https://script.google.com/macros/s/AKfycbzIGAemIIOWsesGX1sIhOLlbstRzToQZ9Vv5pat5C5igjsiwKB6DkfeZnPHV4I6Mzwp/exec";
    if (webAppUrl) {
      try {
        console.log(`[Google Apps Script Macro Sync] Posting registration for ${name} to Web App: ${webAppUrl}`);
        const parsedUrl = new URL(webAppUrl);
        parsedUrl.searchParams.append("action", "register");
        parsedUrl.searchParams.append("no", String(nextNo));
        parsedUrl.searchParams.append("nip", nip);
        parsedUrl.searchParams.append("name", name);
        parsedUrl.searchParams.append("nama", name);
        parsedUrl.searchParams.append("instansi", instansi);
        parsedUrl.searchParams.append("jabatan", jabatan);
        parsedUrl.searchParams.append("jenisKegiatan", resolvedJenisKegiatan);
        parsedUrl.searchParams.append("judulKegiatan", resolvedJudulKegiatan);
        parsedUrl.searchParams.append("checkInTime", checkInTime);
        parsedUrl.searchParams.append("waktu", checkInTime);

        const controller = new AbortController();
        const tId = setTimeout(() => controller.abort(), 12000); // 12s timeout

        const fetchRes = await fetch(parsedUrl.toString(), {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            action: "register",
            no: nextNo,
            nip,
            name,
            nama: name,
            instansi,
            jabatan,
            jenisKegiatan: resolvedJenisKegiatan,
            judulKegiatan: resolvedJudulKegiatan,
            checkInTime,
            waktu: checkInTime,
            signature
          }),
          signal: controller.signal
        });
        clearTimeout(tId);

        console.log(`[Google Apps Script Macro Sync] Response status: ${fetchRes.status}`);
        googleSynced = true;
      } catch (macroErr) {
        console.error("[Google Apps Script Macro Sync] Sync failed:", macroErr);
      }
    }

    list.push(newAttendee);
    await saveLocalAttendees(list);

    // Background Automatic Daily Backup check on new sign-in
    try {
      const historyInfo = await loadBackupHistory();
      const nowStr = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
      if (historyInfo.lastBackupDate !== nowStr) {
        performGoogleDriveBackup(false).catch(e => console.error("[Auto Daily Backup on check-in] Failed:", e));
      }
    } catch (e) {
      console.error("[Auto Daily Backup Check] Failed during submission:", e);
    }

    res.json({
      success: true,
      data: {
        id: nip,
        name,
        checkInTime
      },
      syncedWithGoogle: googleSynced
    });
  } catch (error: any) {
    console.error("Attendance submission process failure:", error);
    res.status(500).json({
      error: `Pendaftaran gagal: ${error.message || "Terjadi kesalahan sistem internal."}`
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
  jenisKegiatan: string;
  judulKegiatan: string;
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
  const readRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(firstSheetTitle)}!A1:I1`, {
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
      "Jenis Kegiatan",
      "Judul Kegiatan",
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
    data.jenisKegiatan,
    data.judulKegiatan,
    data.checkInTime,
    viewUrl
  ]);

  // Append data row
  const appendRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(firstSheetTitle)}!A:I:append?valueInputOption=USER_ENTERED`, {
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
      const session = await loadSession();
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
// GOOGLE DRIVE AUTOMATIC DAILY BACKUP SYSTEM
// ==========================================

export interface BackupLog {
  timestamp: number;
  date: string;
  success: boolean;
  fileName: string;
  fileId: string | null;
  error: string | null;
  recordCount: number;
}

export interface BackupHistoryInfo {
  lastBackupDate: string | null;
  lastBackupTime: number | null;
  history: BackupLog[];
}

const BACKUP_HISTORY_FILE = getWritablePath("backup_history.json");

async function loadBackupHistory(): Promise<BackupHistoryInfo> {
  try {
    const docRef = db.doc("settings/backup_history");
    const docSnap = await docRef.get();
    if (docSnap.exists) {
      const data = docSnap.data() as BackupHistoryInfo;
      try {
        fs.writeFileSync(BACKUP_HISTORY_FILE, JSON.stringify(data, null, 2), "utf-8");
      } catch (e) {}
      return data;
    }
  } catch (err) {
    console.error("[Firestore] loadBackupHistory failed, falling back to disk cache:", err);
  }

  try {
    if (fs.existsSync(BACKUP_HISTORY_FILE)) {
      const data = fs.readFileSync(BACKUP_HISTORY_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch (err) {
    console.error("Error reading backup history file:", err);
  }
  return { lastBackupDate: null, lastBackupTime: null, history: [] };
}

async function saveBackupHistory(info: BackupHistoryInfo) {
  try {
    fs.writeFileSync(BACKUP_HISTORY_FILE, JSON.stringify(info, null, 2), "utf-8");
  } catch (err) {
    console.error("Error writing backup history file:", err);
  }

  try {
    await db.doc("settings/backup_history").set(info);
  } catch (err) {
    console.error("[Firestore] saveBackupHistory failed:", err);
  }
}

function generateExcelBuffer(attendees: LocalAttendee[]): Buffer {
  const data = attendees.map((a, index) => ({
    "No": index + 1,
    "NIP": a.nip || "-",
    "Nama Lengkap": a.name || "-",
    "Instansi": a.instansi || "-",
    "Jabatan": a.jabatan || "-",
    "Email": a.email || "-",
    "Waktu Check-In": a.checkInTime || "-",
    "URL Google Drive Tanda Tangan": a.signatureFileId ? `https://drive.google.com/thumbnail?id=${a.signatureFileId}&sz=w500` : (a.signatureUrl || "-")
  }));

  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Daftar Hadir");
  
  // Custom Column Widths
  const widths = [
    { wch: 6 },   // No
    { wch: 22 },  // NIP
    { wch: 30 },  // Nama Lengkap
    { wch: 25 },  // Instansi
    { wch: 25 },  // Jabatan
    { wch: 28 },  // Email
    { wch: 22 },  // Waktu Check-In
    { wch: 45 }   // URL Tanda Tangan
  ];
  worksheet["!cols"] = widths;

  const excelBuffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  return excelBuffer as Buffer;
}

async function performGoogleDriveBackup(isManual = false): Promise<BackupLog> {
  const session = await loadSession();
  const attendees = await loadLocalAttendees();
  
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const timeStr = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const fileName = `Cadangan_Daftar_Hadir_${dateStr.replace(/-/g, "_")}_${timeStr}.xlsx`;

  const log: BackupLog = {
    timestamp: Date.now(),
    date: dateStr,
    success: false,
    fileName,
    fileId: null,
    error: null,
    recordCount: attendees.length
  };

  if (!session || !session.accessToken) {
    log.error = "Token Google Drive belum aktif atau sesi admin kadaluarsa. Hubungkan kembali akun Google Anda di pengaturan panel.";
    await recordBackupLog(log);
    return log;
  }

  try {
    const backupFolderId = session.driveFolderId || '1UseBW7ICFFT-cUPD1HC3KrJUhLCVgEgR';
    const excelBuffer = generateExcelBuffer(attendees);

    // 1. Create File metadata
    const metaResponse = await fetch("https://www.googleapis.com/drive/v3/files", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${session.accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: fileName,
        parents: [backupFolderId],
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      })
    });

    if (!metaResponse.ok) {
      const errText = await metaResponse.text();
      throw new Error(`Gagal membuat metadata backup di Drive: ${errText}`);
    }

    const metaData = (await metaResponse.json()) as { id: string };
    const fileId = metaData.id;

    // 2. Upload binary stream
    const uploadResponse = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
      method: "PATCH",
      headers: {
        "Authorization": `Bearer ${session.accessToken}`,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      },
      body: excelBuffer
    });

    if (!uploadResponse.ok) {
      const errText = await uploadResponse.text();
      throw new Error(`Gagal mengunggah file media backup ke Drive: ${errText}`);
    }

    log.success = true;
    log.fileId = fileId;
    console.log(`[Google Drive Backup_AutoSync] Backup successfully saved to Google Drive: ${fileName} (ID: ${fileId})`);
  } catch (err: any) {
    console.error(`[Google Drive Backup_AutoSync] Backup failed:`, err);
    log.error = err.message || "Kesalahan koneksi ke layanan awan Google Drive.";
  }

  await recordBackupLog(log);
  return log;
}

async function recordBackupLog(log: BackupLog) {
  const info = await loadBackupHistory();
  if (log.success) {
    info.lastBackupDate = log.date;
    info.lastBackupTime = log.timestamp;
  }
  info.history = [log, ...info.history].slice(0, 15);
  await saveBackupHistory(info);
}

// Get Google Drive Backup settings and sync status
app.get("/api/backup/status", async (req, res) => {
  res.json(await loadBackupHistory());
});

// Manually trigger Google Drive Backup
app.post("/api/backup/run", async (req, res) => {
  try {
    const log = await performGoogleDriveBackup(true);
    if (log.success) {
      res.json({ 
        success: true, 
        message: `Cadangan data absensi berhasil disimpan ke Google Drive dengan nama: ${log.fileName}`, 
        log 
      });
    } else {
      res.status(500).json({ error: log.error || "Gagal melakukan backup ke Google Drive." });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Terjadi kesalahan internal saat membuat cadangan absensi." });
  }
});

// Endpoint untuk secara otomatis membuat folder per tanggal dan mengunggah PDF laporan kehadiran
app.post("/api/upload-pdf-to-date-folder", async (req, res) => {
  const { pdfBase64, filename, accessToken: clientToken, driveFolderId: clientFolderId } = req.body;

  if (!pdfBase64) {
    return res.status(400).json({ error: "Sandi biner/Base64 PDF wajib dikirimkan." });
  }

  // Resolve accessToken and driveFolderId
  const session = await loadSession();
  const token = clientToken || session?.accessToken;
  const parentFolderId = clientFolderId || session?.driveFolderId;

  if (!token || token === "bypass") {
    return res.status(400).json({ error: "Sesi otorisasi Google Drive tidak aktif atau tidak ditemukan." });
  }
  if (!parentFolderId) {
    return res.status(400).json({ error: "ID Folder tujuan Google Drive belum dikonfigurasi." });
  }

  try {
    // 1. Get current local date formatted as DD-MM-YYYY
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, "0");
    const folderName = `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()}`;

    // 2. Search if folder per tanggal already exists inside parentFolderId
    const query = `mimeType = 'application/vnd.google-apps.folder' and name = '${folderName}' and '${parentFolderId}' in parents and trashed = false`;
    const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`;
    
    console.log(`[Drive Backend] Mencari folder per tanggal '${folderName}' di bawah folder parent: ${parentFolderId}...`);
    const searchRes = await fetch(searchUrl, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (!searchRes.ok) {
      const errMsg = await searchRes.text();
      return res.status(searchRes.status).json({ error: `Gagal mencari folder tanggal di Drive: ${errMsg}` });
    }

    const searchData = (await searchRes.json()) as { files: Array<{ id: string; name: string }> };
    let targetFolderId = "";

    if (searchData.files && searchData.files.length > 0) {
      targetFolderId = searchData.files[0].id;
      console.log(`[Drive Backend] Folder per tanggal '${folderName}' sudah ada. Menggunakan ID: ${targetFolderId}`);
    } else {
      // Create a new folder
      console.log(`[Drive Backend] Folder per tanggal '${folderName}' tidak ditemukan. Membuat folder baru...`);
      const createFolderRes = await fetch("https://www.googleapis.com/drive/v3/files", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name: folderName,
          mimeType: "application/vnd.google-apps.folder",
          parents: [parentFolderId]
        })
      });

      if (!createFolderRes.ok) {
        const errMsg = await createFolderRes.text();
        return res.status(createFolderRes.status).json({ error: `Gagal membuat folder per tanggal: ${errMsg}` });
      }

      const folderData = (await createFolderRes.json()) as { id: string };
      targetFolderId = folderData.id;
      console.log(`[Drive Backend] Folder per tanggal '${folderName}' berhasil dibuat dengan ID: ${targetFolderId}`);
    }

    // 3. Create file metadata in target dated folder
    const targetFilename = filename || `Laporan_Kehadiran_Peserta_${Date.now()}.pdf`;
    const metaRes = await fetch("https://www.googleapis.com/drive/v3/files", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: targetFilename,
        parents: [targetFolderId],
        mimeType: "application/pdf"
      })
    });

    if (!metaRes.ok) {
      const errMsg = await metaRes.text();
      return res.status(metaRes.status).json({ error: `Gagal membuat metadata file PDF di Drive: ${errMsg}` });
    }

    const fileMeta = (await metaRes.json()) as { id: string };
    const fileId = fileMeta.id;

    // Convert Base64 back to binary Buffer for upload
    let cleanBase64 = pdfBase64;
    if (pdfBase64.includes("base64,")) {
      cleanBase64 = pdfBase64.split("base64,")[1];
    }
    const pdfBuffer = Buffer.from(cleanBase64, "base64");

    // 4. Upload standard media body
    console.log(`[Drive Backend] Mengunggah file PDF '${targetFilename}' ke folder '${folderName}' (ID: ${targetFolderId})...`);
    const uploadRes = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/pdf"
      },
      body: pdfBuffer
    });

    if (!uploadRes.ok) {
      const errMsg = await uploadRes.text();
      return res.status(uploadRes.status).json({ error: `Gagal mengunggah konten biner PDF ke Drive: ${errMsg}` });
    }

    res.json({
      success: true,
      message: `File PDF berhasil diunggah ke Google Drive di folder per tanggal '${folderName}'.`,
      fileId,
      folderId: targetFolderId,
      folderName
    });

  } catch (err: any) {
    console.error("[Drive Backend] Error uploading PDF to date folder:", err);
    res.status(500).json({ error: err.message || "Terjadi kesalahan internal saat memproses unggahan PDF ke Drive." });
  }
});

// ==========================================
// VITE AND STATIC SERVING MAIN SETUP
// ==========================================
async function startServer() {
  // Start a periodic 30-minute interval for automatic daily backups
  setInterval(async () => {
    try {
      const session = await loadSession();
      if (session && session.accessToken) {
        const historyInfo = await loadBackupHistory();
        const nowObj = new Date();
        const nowStr = `${nowObj.getFullYear()}-${(nowObj.getMonth()+1).toString().padStart(2, "0")}-${nowObj.getDate().toString().padStart(2, "0")}`;
        const attendees = await loadLocalAttendees();
        
        if (attendees.length > 0 && historyInfo.lastBackupDate !== nowStr) {
          console.log(`[Auto-Backup Timer] Running scheduled automatic daily backup to Google Drive...`);
          performGoogleDriveBackup(false).catch(e => console.error("Periodic Auto Google Drive Backup failed:", e));
        }
      }
    } catch (e) {
      console.error("[Auto-Backup Timer] Error running timer check:", e);
    }
  }, 1800000); // 30 minutes

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
