import React, { useState, useEffect, useRef } from "react";
import { 
  Users, School, CalendarCheck2, ShieldCheck, RefreshCw, Download, FileDown,
  Search, ShieldAlert, ChevronRight, LogOut, CheckCircle2, QrCode, 
  Settings, ExternalLink, Trash2, Key, Info, HelpCircle, Loader2, X, Pencil,
  Bell, Mail, Send, MessageSquare, Calendar, Filter, Printer, Activity,
  Clock, Award, User, TrendingUp
} from "lucide-react";
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, 
  ResponsiveContainer, AreaChart, Area, PieChart, Pie, Cell,
  LineChart, Line
} from "recharts";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { Attendee, DashboardStats } from "../types";
import { motion, AnimatePresence } from "motion/react";

interface DashboardAdminProps {
  accessToken: string | null;
  onLogin: () => void;
  onLogout: () => void;
}

const SPREADSHEET_ID = "1Fu2MejKfS_Nm7AdqwERfaU22QBanPeYG8fQeILciwpw";
const DRIVE_FOLDER_ID = "1UseBW7ICFFT-cUPD1HC3KrJUhLCVgEgR";

interface Toast {
  id: string;
  type: "success" | "info" | "warning" | "error" | "loading";
  message: string;
}

export default function DashboardAdmin({ accessToken, onLogin, onLogout }: DashboardAdminProps) {
  const [spreadsheetId, setSpreadsheetId] = useState<string>(() => {
    return localStorage.getItem("custom_spreadsheet_id") || "1Fu2MejKfS_Nm7AdqwERfaU22QBanPeYG8fQeILciwpw";
  });
  const [driveFolderId, setDriveFolderId] = useState<string>(() => {
    return localStorage.getItem("custom_drive_folder_id") || "1UseBW7ICFFT-cUPD1HC3KrJUhLCVgEgR";
  });
  const [hasAccessError, setHasAccessError] = useState(false);
  const [isCreatingResources, setIsCreatingResources] = useState(false);
  const [showConfigSettings, setShowConfigSettings] = useState(false);
  const [showNotificationSettings, setShowNotificationSettings] = useState(false);
  const [notificationSettings, setNotificationSettings] = useState({
    telegramEnabled: false,
    telegramBotToken: "",
    telegramChatId: "",
    whatsappEnabled: false,
    whatsappApiProvider: "fonnte" as "fonnte" | "webhook",
    whatsappToken: "",
    whatsappTarget: "",
    emailEnabled: false,
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    smtpSecure: true,
    smtpUser: "",
    smtpPass: "",
    emailRecipient: "",
  });
  const [isSavingNotifications, setIsSavingNotifications] = useState(false);
  const [testingChannel, setTestingChannel] = useState<string | null>(null);

  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isAutoRefreshEnabled, setIsAutoRefreshEnabled] = useState<boolean>(() => {
    return localStorage.getItem("admin_auto_refresh_enabled") !== "false";
  });
  const [autoRefreshInterval, setAutoRefreshInterval] = useState<number>(() => {
    const stored = localStorage.getItem("admin_auto_refresh_interval");
    return stored ? parseInt(stored, 10) : 15; // default to 15 seconds
  });
  const [isBackgroundFetching, setIsBackgroundFetching] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [startDateFilter, setStartDateFilter] = useState("");
  const [endDateFilter, setEndDateFilter] = useState("");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [trendViewType, setTrendViewType] = useState<"minute" | "hour" | "cumulative">("cumulative");

  const showToast = (message: string, type: Toast["type"] = "info", duration = 3500) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, type, message }]);
    
    if (type !== "loading" && duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    }
    return id;
  };

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const updateToast = (id: string, updates: Partial<Omit<Toast, "id">>) => {
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...updates } : t))
    );
  };

  const [isSessionActive, setIsSessionActive] = useState(false);
  const [isActivatingSession, setIsActivatingSession] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [selectedSignature, setSelectedSignature] = useState<string | null>(null);
  const [showQrModal, setShowQrModal] = useState(false);
  const [showConfirmClear, setShowConfirmClear] = useState(false);
  const [clearConfirmationText, setClearConfirmationText] = useState("");
  const [showConfirmToggleSession, setShowConfirmToggleSession] = useState(false);
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [pdfProgressText, setPdfProgressText] = useState("");
  const [showPdfOptions, setShowPdfOptions] = useState(false);

  // Editable Target states
  const [attendanceTarget, setAttendanceTarget] = useState<number>(() => {
    const saved = localStorage.getItem("admin_attendance_target");
    return saved ? parseInt(saved, 10) : 50;
  });
  const [isEditingTarget, setIsEditingTarget] = useState(false);
  const [tempTarget, setTempTarget] = useState(attendanceTarget.toString());

  const [editingAttendee, setEditingAttendee] = useState<Attendee | null>(null);
  const [editName, setEditName] = useState("");
  const [editNip, setEditNip] = useState("");
  const [editInstansi, setEditInstansi] = useState("");
  const [editJabatan, setEditJabatan] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const [deletingAttendee, setDeletingAttendee] = useState<Attendee | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedProfileAttendee, setSelectedProfileAttendee] = useState<Attendee | null>(null);

  // Real-Time System Status & Tracking States
  const [adminClientId] = useState(() => {
    let id = localStorage.getItem("admin_client_id");
    if (!id) {
      id = "admin-" + Math.random().toString(36).substring(2, 11);
      localStorage.setItem("admin_client_id", id);
    }
    return id;
  });
  const [activeAdminCount, setActiveAdminCount] = useState<number>(1);
  const [googleSpreadsheetStatus, setGoogleSpreadsheetStatus] = useState<"connected" | "unconfigured" | "error">("unconfigured");
  const [googleSpreadsheetError, setGoogleSpreadsheetError] = useState<string | null>(null);

  // Google Drive Backup State Management
  const [backupInfo, setBackupInfo] = useState<{
    lastBackupDate: string | null;
    lastBackupTime: number | null;
    history: {
      timestamp: number;
      date: string;
      success: boolean;
      fileName: string;
      fileId: string | null;
      error: string | null;
      recordCount: number;
    }[];
  } | null>(null);
  const [isBackupRunning, setIsBackupRunning] = useState(false);

  const fetchBackupStatus = async () => {
    try {
      const res = await fetch("/api/backup/status");
      if (res.ok) {
        const data = await res.json();
        setBackupInfo(data);
      }
    } catch (err) {
      console.warn("Gagal mengambil status cadangan Google Drive:", err);
    }
  };

  const handleRunBackup = async () => {
    setIsBackupRunning(true);
    const toastId = showToast("Mencadangkan data ke Google Drive...", "loading", 0);
    try {
      const res = await fetch("/api/backup/run", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        showToast(data.message || "Daftar hadir berhasil dicadangkan ke Google Drive!", "success", 4500);
        fetchBackupStatus();
      } else {
        const errorMsg = data.error || "Gagal mencadangkan data.";
        showToast(errorMsg, "error", 6000);
        fetchBackupStatus(); // update logs
      }
    } catch (err: any) {
      showToast(`Kesalahan: ${err.message || "Saluran koneksi bermasalah"}`, "error", 5000);
    } finally {
      setIsBackupRunning(false);
      dismissToast(toastId);
    }
  };

  const [recentAttendeeKeys, setRecentAttendeeKeys] = useState<Record<string, number>>({});

  // Auto clean up keys of recently checked-in attendees to stop highlighting after 15 seconds
  useEffect(() => {
    const keys = Object.keys(recentAttendeeKeys);
    if (keys.length === 0) return;

    const timer = setTimeout(() => {
      const now = Date.now();
      const updated = { ...recentAttendeeKeys };
      let hasChanges = false;
      for (const key of Object.keys(updated)) {
        if (now - updated[key] > 15000) { // Keep highlight for 15 seconds
          delete updated[key];
          hasChanges = true;
        }
      }
      if (hasChanges) {
        setRecentAttendeeKeys(updated);
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [recentAttendeeKeys]);

  const publicUrl = window.location.origin;

  const isFirstLoadRef = useRef<boolean>(true);
  const seenAttendeeKeysRef = useRef<Set<string>>(new Set());

  const fetchNotificationSettings = async () => {
    try {
      const res = await fetch("/api/notifications/config");
      if (res.ok) {
        const contentType = res.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          const data = await res.json();
          setNotificationSettings(data);
        } else {
          console.warn("Notification config response was not JSON.");
        }
      }
    } catch (err) {
      console.error("Error fetching notification settings:", err);
    }
  };

  const handleSaveNotificationSettings = async () => {
    setIsSavingNotifications(true);
    try {
      const res = await fetch("/api/notifications/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(notificationSettings),
      });
      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        throw new Error("Respon server bukan JSON (backend server offline atau hosting statis). Silakan periksa koneksi backend Anda.");
      }
      if (res.ok) {
        showToast("Pengaturan notifikasi berhasil disimpan!", "success");
      } else {
        const data = await res.json();
        throw new Error(data.error || "Gagal menyimpan ke server");
      }
    } catch (error: any) {
      showToast(`Gagal menyimpan: ${error.message}`, "error");
    } finally {
      setIsSavingNotifications(false);
    }
  };

  const handleTestNotification = async (channel: "telegram" | "whatsapp" | "email") => {
    setTestingChannel(channel);
    const toastId = showToast(`Sedang mengirimkan tes notifikasi ${channel.toUpperCase()}...`, "loading", 0);
    try {
      const res = await fetch("/api/notifications/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel,
          settings: notificationSettings,
        }),
      });
      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        throw new Error("Respon server bukan JSON. Kemungkinan server backend tidak aktif atau rute API ini 404 pada Vercel/hosting Anda.");
      }
      const data = await res.json();
      if (res.ok) {
        updateToast(toastId, { message: `Sukses! ${data.message || 'Pesan tes terkirim.'}`, type: "success" });
        setTimeout(() => dismissToast(toastId), 3000);
      } else {
        throw new Error(data.error || "Gagal menghubungkan");
      }
    } catch (error: any) {
      updateToast(toastId, { message: `Tes Gagal: ${error.message}`, type: "error" });
      setTimeout(() => dismissToast(toastId), 5000);
    } finally {
      setTestingChannel(null);
    }
  };

  // 1. Fetch active session state from backend
  const fetchSessionStatus = async () => {
    try {
      const res = await fetch(`/api/session-status?adminClientId=${adminClientId}`);
      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        const text = await res.text();
        if (text.includes("Rate exceeded") || res.status === 429) {
          console.warn("[Rate Limit] Fetch session status deferred.");
          return;
        }
        throw new Error(`Unexpected response type: ${contentType}`);
      }
      const data = await res.json();
      setIsSessionActive(data.active);
      localStorage.setItem("is_public_session_active", String(data.active));
      
      // Update real-time system tracking metrics
      if (typeof data.activeAdminCount === "number") {
        setActiveAdminCount(data.activeAdminCount);
      }
      if (data.googleSpreadsheetStatus) {
        setGoogleSpreadsheetStatus(data.googleSpreadsheetStatus);
      }
      setGoogleSpreadsheetError(data.googleSpreadsheetError || null);

      if (data.spreadsheetId) {
        setSpreadsheetId(data.spreadsheetId);
        localStorage.setItem("custom_spreadsheet_id", data.spreadsheetId);
      }
      if (data.driveFolderId) {
        setDriveFolderId(data.driveFolderId);
        localStorage.setItem("custom_drive_folder_id", data.driveFolderId);
      }
    } catch (err) {
      console.warn("Error fetching session status, falling back to local storage:", err);
      const offlineActive = localStorage.getItem("is_public_session_active") === "true";
      setIsSessionActive(offlineActive);
      const storedSpreadsheetId = localStorage.getItem("custom_spreadsheet_id");
      if (storedSpreadsheetId) {
        setSpreadsheetId(storedSpreadsheetId);
      }
      const storedDriveFolderId = localStorage.getItem("custom_drive_folder_id");
      if (storedDriveFolderId) {
        setDriveFolderId(storedDriveFolderId);
      }
    }
  };

  // 2. Load Attendee list from local Express backend
  const fetchAttendeesFromSheets = async (isBackground = false) => {
    if (isBackground) {
      setIsBackgroundFetching(true);
    } else {
      setIsLoading(true);
    }
    setHasAccessError(false);
    
    let serverAttendees: Attendee[] = [];

    try {
      const res = await fetch("/api/attendees");
      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        if (res.ok) {
          serverAttendees = await res.json();
        } else {
          console.warn("Express backend returned non-ok response.");
        }
      } else {
        const text = await res.text();
        if (text.includes("Rate exceeded") || res.status === 429) {
          console.warn("[Rate Limit] Fetch attendees polling deferred.");
        }
      }
    } catch (err: any) {
      console.warn("Fetch local attendees list error, using offline local registry fallback:", err);
    }

    // Load offline local storage attendees
    let offlineAttendees: Attendee[] = [];
    try {
      const offlineAttendeesStr = localStorage.getItem("local_offline_attendees") || "[]";
      offlineAttendees = JSON.parse(offlineAttendeesStr);
    } catch (err) {
      console.error("Error parsing offline attendees:", err);
    }

    // Merge offline and online. Clean duplicates based on NIP and Name.
    const mergedMap = new Map<string, Attendee>();
    
    // First insert online ones
    serverAttendees.forEach(a => {
      const key = `${(a.nip || "").trim().toLowerCase()}_${(a.name || "").trim().toLowerCase()}`;
      mergedMap.set(key, a);
    });

    // Then offline ones (only if not already existed on server, flag as isOfflineOnly)
    offlineAttendees.forEach(a => {
      const key = `${(a.nip || "").trim().toLowerCase()}_${(a.name || "").trim().toLowerCase()}`;
      if (!mergedMap.has(key)) {
        mergedMap.set(key, { ...a, isOfflineOnly: true }); 
      }
    });

    const parsed = Array.from(mergedMap.values());
    
    // Sort descending by checkInTime (most recent first)
    parsed.sort((a, b) => new Date(b.checkInTime).getTime() - new Date(a.checkInTime).getTime());

    // Re-adjust sequence number index so we show neat numbers count
    parsed.forEach((item, index) => {
      item.no = parsed.length - index;
    });

    // Handle real-time user presences and raise beautiful toast alerts
    if (isFirstLoadRef.current) {
      // First load: seed known attendee keys to prevent spamming pre-existing data on fresh login
      parsed.forEach(a => {
        const key = `${(a.nip || "").trim().toLowerCase()}_${(a.name || "").trim().toLowerCase()}`;
        if (key) {
          seenAttendeeKeysRef.current.add(key);
        }
      });
      isFirstLoadRef.current = false;
    } else {
      const brandNewAttendees: Attendee[] = [];
      parsed.forEach(a => {
        const key = `${(a.nip || "").trim().toLowerCase()}_${(a.name || "").trim().toLowerCase()}`;
        if (key && !seenAttendeeKeysRef.current.has(key)) {
          seenAttendeeKeysRef.current.add(key);
          brandNewAttendees.push(a);
        }
      });

      if (brandNewAttendees.length > 0) {
        // Track the keys & timestamps of newly arrived checked-in attendees for high-contrast highlight effect
        setRecentAttendeeKeys(prev => {
          const updated = { ...prev };
          const now = Date.now();
          brandNewAttendees.forEach(na => {
            const key = `${(na.nip || "").trim().toLowerCase()}_${(na.name || "").trim().toLowerCase()}`;
            if (key) {
              updated[key] = now;
            }
          });
          return updated;
        });

        if (brandNewAttendees.length <= 3) {
          // Individual detailed toast alert
          brandNewAttendees.forEach(na => {
            showToast(
              `🔔 Presensi Baru: ${na.name} (${na.instansi || "Umum"}) berhasil check-in!`,
              "success",
              4500
            );
          });
        } else {
          // Aggregated summary toast alert
          showToast(
            `🔔 ${brandNewAttendees.length} peserta baru telah melakukan presensi pada sistem!`,
            "success",
            5000
          );
        }
      }
    }

    setAttendees(parsed);

    // Record sync time
    const d = new Date();
    setLastSynced(`${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`);
    
    if (isBackground) {
      setIsBackgroundFetching(false);
    } else {
      setIsLoading(false);
    }
  };

  // Toggle Session state on backend (Enable Public Check-ins)
  const handleToggleSession = async () => {
    setIsActivatingSession(true);
    const toastId = showToast(
      isSessionActive 
        ? "Sedang menutup sesi absensi secara manual..." 
        : "Sedang mengaktifkan sesi absensi peserta...",
      "loading",
      0
    );
    try {
      if (isSessionActive) {
        // Disable
        let cleared = false;
        try {
          const res = await fetch("/api/clear-token", { method: "POST" });
          if (res.ok) cleared = true;
        } catch (fetchErr) {
          console.warn("Server offline, performing offline deactivation.");
          cleared = true;
        }

        if (cleared) {
          setIsSessionActive(false);
          localStorage.setItem("is_public_session_active", "false");
          updateToast(toastId, { 
            message: "Sesi absensi HP berhasil ditutup!", 
            type: "success" 
          });
        } else {
          throw new Error("Respon server tidak valid saat menonaktifkan sesi.");
        }
      } else {
        // Enable by uploading access token along with dynamic sheet pointers
        let saved = false;
        try {
          const res = await fetch("/api/save-token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
              accessToken: accessToken === "bypass" ? null : accessToken,
              spreadsheetId,
              driveFolderId,
              isSessionActive: true
            }),
          });
          if (res.ok) saved = true;
        } catch (fetchErr) {
          console.warn("Server offline, performing offline activation.");
          saved = true;
        }

        if (saved) {
          setIsSessionActive(true);
          localStorage.setItem("is_public_session_active", "true");
          updateToast(toastId, { 
            message: "Sesi absensi HP berhasil dibuka secara instan!", 
            type: "success" 
          });
        } else {
          throw new Error("Respon server tidak valid saat mengaktifkan sesi.");
        }
      }
      setTimeout(() => dismissToast(toastId), 3500);
    } catch (err: any) {
      console.error("Toggle session error:", err);
      updateToast(toastId, { 
        message: `Gagal mengubah sesi: ${err.message || err}`, 
        type: "error" 
      });
      setTimeout(() => dismissToast(toastId), 4500);
    } finally {
      setIsActivatingSession(false);
    }
  };

  // Helper for manual data synchronization with Toast
  const [isSyncingManually, setIsSyncingManually] = useState(false);
  const handleManualSync = async () => {
    setIsSyncingManually(true);
    const toastId = showToast("Sinkronisasi real-time dengan Google Sheets...", "loading", 0);
    try {
      await fetchAttendeesFromSheets();
      updateToast(toastId, { 
        message: "Data peserta berhasil diperbarui ke kondisi terbaru!", 
        type: "success" 
      });
      setTimeout(() => dismissToast(toastId), 3000);
    } catch (err: any) {
      console.error("Sync error:", err);
      updateToast(toastId, { 
        message: `Gagal menyinkronkan data: ${err.message || "Masalah koneksi"}`, 
        type: "error" 
      });
      setTimeout(() => dismissToast(toastId), 4000);
    } finally {
      setIsSyncingManually(false);
    }
  };

  // Create dynamic new spreadsheet and folder
  const handleCreateNewSheetAndFolder = async () => {
    if (!accessToken) return;
    setIsCreatingResources(true);
    const toastId = showToast("Sedang membuat folder Google Drive...", "loading");
    
    try {
      // Step A: Create Folder
      const folderRes = await fetch("https://www.googleapis.com/drive/v3/files", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "E-Absensi Digital - Signatures",
          mimeType: "application/vnd.google-apps.folder",
        }),
      });
      
      if (!folderRes.ok) {
        throw new Error("Gagal membuat folder tanda tangan di Google Drive.");
      }
      
      const folderData = await folderRes.json();
      const newFolderId = folderData.id;
      
      updateToast(toastId, { message: "Sedang membuat Google Spreadsheet baru..." });
      
      // Step B: Create Spreadsheet
      const sheetRes = await fetch("https://sheets.googleapis.com/v4/spreadsheets", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          properties: {
            title: "E-Absensi Kehadiran Digital Peserta",
          },
        }),
      });
      
      if (!sheetRes.ok) {
        throw new Error("Gagal membuat Google Spreadsheet baru.");
      }
      
      const sheetData = await sheetRes.json();
      const newSpreadsheetId = sheetData.spreadsheetId;
      const firstTabName = sheetData.sheets?.[0]?.properties?.title || "Sheet1";
      
      updateToast(toastId, { message: "Menulis header kolom tabel..." });
      
      // Step C: Write Headers
      const writeHeadersRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${newSpreadsheetId}/values/${encodeURIComponent(firstTabName)}!A1:H1?valueInputOption=USER_ENTERED`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            range: `${firstTabName}!A1:H1`,
            majorDimension: "ROWS",
            values: [
              [
                "No",
                "NIP",
                "Nama Lengkap",
                "Instansi",
                "Jabatan",
                "Email",
                "Waktu Hadir",
                "Link Tanda Tangan"
              ]
            ],
          }),
        }
      );
      
      if (!writeHeadersRes.ok) {
        throw new Error("Gagal menginisialisasi baris judul kolom.");
      }
      
      // Step D: Enable public sharing for signatures folder so attendees can insert signatures
      updateToast(toastId, { message: "Mengonfigurasi izin akses folder..." });
      await fetch(`https://www.googleapis.com/drive/v3/files/${newFolderId}/permissions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          role: "reader",
          type: "anyone",
        }),
      });
      
      // Step E: Update local state & storage
      localStorage.setItem("custom_spreadsheet_id", newSpreadsheetId);
      localStorage.setItem("custom_drive_folder_id", newFolderId);
      setSpreadsheetId(newSpreadsheetId);
      setDriveFolderId(newFolderId);
      setHasAccessError(false);
      
      // Step F: Sync new credentials with backend server
      await fetch("/api/save-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          accessToken,
          spreadsheetId: newSpreadsheetId,
          driveFolderId: newFolderId
        }),
      });
      
      setIsSessionActive(true);
      
      updateToast(toastId, { 
        type: "success", 
        message: "Yay! Spreadsheet & Folder khusus berhasil dibuat dan dihubungkan pada akun Google Anda!" 
      });
      
    } catch (err: any) {
      console.error("Resource creation error:", err);
      updateToast(toastId, { 
        type: "error", 
        message: `Inisialisasi gagal: ${err.message || "Kesalahan tidak diketahui."}` 
      });
    } finally {
      setIsCreatingResources(false);
    }
  };

  // Truncate/Clear spreadsheet and local database
  const handleClearSpreadsheet = async () => {
    if (clearConfirmationText !== "HAPUS") {
      alert("Konfirmasi tidak cocok. Silakan ketik 'HAPUS' dengan benar.");
      return;
    }

    try {
      setIsLoading(true);
      
      // Wipe backend local database (best-effort)
      try {
        const localClearRes = await fetch("/api/clear-all", { method: "POST" });
        if (!localClearRes.ok) {
          console.warn("Backend local database clear failed/returned non-ok.");
        }
      } catch (backendErr) {
        console.warn("Express backend database clear request failed:", backendErr);
      }

      // Wipe local browser offline cache and state
      localStorage.setItem("local_offline_attendees", "[]");
      localStorage.removeItem("local_offline_attendees");

      // Best effort wipe Google Sheets if authorized
      if (accessToken && accessToken !== "bypass") {
        try {
          const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          const meta = await metaRes.json();
          const firstTabName = meta.sheets[0].properties.title;

          // Clear range sheets values
          await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(firstTabName)}!A2:H500:clear`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
              },
            }
          );
        } catch (gErr) {
          console.error("Best effort Google Sheet wipe failed:", gErr);
        }
      }

      setAttendees([]);
      seenAttendeeKeysRef.current.clear();
      isFirstLoadRef.current = true;
      setShowConfirmClear(false);
      setClearConfirmationText("");
      alert("Semua data absensi berhasil dikosongkan.");
    } catch (err: any) {
      alert(`Gagal mengosongkan data: ${err.message || "Kesalahan koneksi"}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Polling hook
  useEffect(() => {
    fetchSessionStatus();
    fetchBackupStatus();
    fetchNotificationSettings();
    fetchAttendeesFromSheets(false);
  }, [accessToken]);

  // Dynamic automatic refresh polling interval
  useEffect(() => {
    if (!isAutoRefreshEnabled) return;

    const interval = setInterval(() => {
      fetchAttendeesFromSheets(true);
    }, autoRefreshInterval * 1000);

    return () => clearInterval(interval);
  }, [isAutoRefreshEnabled, autoRefreshInterval]);

  // 15-Minute Auto Logout Security Trigger based on inactivity
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;
    let lastActivityTime = Date.now();

    const resetTimer = () => {
      if (timeoutId) clearTimeout(timeoutId);
      // Modeled for exactly 15 minutes: 15 * 60 * 1000 = 900,000 ms
      timeoutId = setTimeout(() => {
        localStorage.setItem("admin_auto_logged_out_due_to_inactivity", "true");
        onLogout();
      }, 15 * 60 * 1000);
    };

    const handleUserActivity = () => {
      const now = Date.now();
      // Throttle event response to once every 2 seconds for high performance
      if (now - lastActivityTime > 2000) {
        lastActivityTime = now;
        resetTimer();
      }
    };

    const activityEvents = ["mousedown", "mousemove", "keypress", "scroll", "touchstart", "click"];

    // Start initial timer
    resetTimer();

    // Register event listeners
    activityEvents.forEach((event) => {
      window.addEventListener(event, handleUserActivity);
    });

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      activityEvents.forEach((event) => {
        window.removeEventListener(event, handleUserActivity);
      });
    };
  }, [onLogout]);

  // Excel Export
  const exportToExcel = () => {
    if (attendees.length === 0) {
      showToast("Belum ada data peserta untuk diekspor!", "warning");
      return;
    }

    setIsExportingExcel(true);
    const toastId = showToast("Sedang menyiapkan data Excel...", "loading", 0);

    // Use setTimeout so the browser can render the spinner/loading state first
    setTimeout(() => {
      try {
        // Convert data to Excel readable properties
        const exportRows = attendees.map((a, index) => ({
          No: index + 1,
          "Nama Lengkap": a.name,
          NIP: a.nip,
          "Instansi": a.instansi,
          "Jabatan": a.jabatan,
          Email: a.email,
          "Waktu Hadir": a.checkInTime,
          "Link Tanda Tangan (Drive Thumbs)": a.signatureUrl,
        }));

        const ws = XLSX.utils.json_to_sheet(exportRows);
        
        // Set cell width patterns
        const colWidths = [
          { wch: 5 },  // No
          { wch: 25 }, // Name
          { wch: 22 }, // NIP
          { wch: 30 }, // Instansi
          { wch: 20 }, // Jabatan
          { wch: 22 }, // Email
          { wch: 20 }, // Date
          { wch: 45 }, // Signature Links
        ];
        ws["!cols"] = colWidths;

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Daftar Kehadiran");
        XLSX.writeFile(wb, `Laporan_Kehadiran_Peserta_${Date.now()}.xlsx`);

        dismissToast(toastId);
        showToast("Laporan Excel berhasil diunduh!", "success");
      } catch (err: any) {
        console.error("Gagal membuat Excel:", err);
        dismissToast(toastId);
        showToast(`Gagal membuat Excel: ${err.message || err}`, "error");
      } finally {
        setIsExportingExcel(false);
      }
    }, 150);
  };

  // PDF Export using jsPDF AutoTable
  const exportToPdf = async (onlyFiltered = false) => {
    const targetSource = onlyFiltered ? filteredAttendees : attendees;
    if (targetSource.length === 0) {
      showToast("Belum ada data peserta untuk diekspor!", "warning");
      return;
    }

    setIsExportingPdf(true);
    setPdfProgressText("Menyiapkan dokumen...");
    const toastId = showToast("Menyiapkan dokumen PDF...", "loading", 0);

    try {
      const doc = new jsPDF("l", "mm", "a4"); // landscape format

      // Header Title
      doc.setFont("helvetica", "bold");
      doc.setFontSize(20);
      doc.text("LAPORAN RESMI DAFTAR KEHADIRAN PESERTA KEGIATAN", 14, 18);
      
      // Metadata block
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text(`Waktu Cetak: ${new Date().toLocaleString("id-ID")}`, 14, 25);
      doc.text(`Total Kehadiran: ${targetSource.length} Orang${onlyFiltered ? " (Sesuai Filter)" : ""}`, 14, 30);

      // Pre-download signature images in parallel using our backend proxy
      setPdfProgressText("Mengunduh gambar TTD...");
      updateToast(toastId, { message: "Mengunduh gambar tanda tangan..." });
      
      const signatureImageMap: Record<number, string> = {};

      await Promise.all(
        targetSource.map(async (a, index) => {
          if (!a.signatureUrl) return;
          try {
            // Check if local or external
            const isLocal = a.signatureUrl.startsWith("/api/");
            const fetchUrl = isLocal ? a.signatureUrl : `/api/proxy-signature?url=${encodeURIComponent(a.signatureUrl)}`;
            
            const response = await fetch(fetchUrl, {
              headers: (accessToken && !isLocal) ? { Authorization: `Bearer ${accessToken}` } : undefined
            });
            if (!response.ok) return;
            const blob = await response.blob();
            
            // Convert blob to base64
            const reader = new FileReader();
            const base64Promise = new Promise<string>((resolve) => {
              reader.onloadend = () => resolve(reader.result as string);
              reader.readAsDataURL(blob);
            });
            const base64 = await base64Promise;
            signatureImageMap[index] = base64;
          } catch (err) {
            console.error(`Gagal memuat tanda tangan untuk baris ${index + 1}:`, err);
          }
        })
      );

      // Format rows (add empty cell at the end for signature drawing)
      const tableBody = targetSource.map((a, idx) => [
        idx + 1,
        a.name,
        a.nip,
        a.instansi,
        a.jabatan,
        a.email,
        a.checkInTime,
        "", // Tanda Tangan placeholder cell
      ]);

      setPdfProgressText("Membuat tabel laporan...");
      updateToast(toastId, { message: "Membuat tabel laporan PDF..." });

      autoTable(doc, {
        startY: 42,
        head: [["No", "Nama Lengkap", "NIP", "Instansi", "Jabatan", "Alamat Email", "Waktu Hadir", "Tanda Tangan"]],
        body: tableBody,
        theme: "grid",
        headStyles: { fillColor: [5, 150, 105], textColor: 255, fontStyle: "bold", halign: "center" },
        styles: { fontSize: 8.5, cellPadding: 2, valign: "middle" },
        columnStyles: {
          0: { cellWidth: 10, halign: "center" },
          1: { cellWidth: 42 },
          2: { cellWidth: 32 },
          3: { cellWidth: 42 },
          4: { cellWidth: 35 },
          5: { cellWidth: 40 },
          6: { cellWidth: 33 },
          7: { cellWidth: 35, minCellHeight: 18 }, // Column 7 is Tanda Tangan, minCellHeight 18 makes it spacious
        },
        didDrawCell: (data) => {
          // If we are in the body section and drawing the "Tanda Tangan" column (index 7)
          if (data.column.index === 7 && data.cell.section === "body") {
            const rowIndex = data.row.index;
            const base64Img = signatureImageMap[rowIndex];
            if (base64Img) {
              const cell = data.cell;
              // Center the image inside the cell padded by 2px
              const wVal = cell.width - 4;
              const hVal = cell.height - 4;
              doc.addImage(base64Img, "PNG", cell.x + 2, cell.y + 2, wVal, hVal);
            }
          }
        }
      });

      setPdfProgressText("Menyimpan & Mencetak file...");
      updateToast(toastId, { message: "Menyimpan file laporan dan memicu dialog cetak..." });
      
      // Configure print integration with jsPDF autoPrint
      doc.autoPrint();
      
      // Save local downloaded file
      const filename = `Laporan_Kehadiran_Peserta_${Date.now()}.pdf`;
      doc.save(filename);

      // Trigger automatic browser printing using a temporary hidden iframe
      try {
        const blob = doc.output("blob");
        const blobUrl = URL.createObjectURL(blob);
        const printIframe = document.createElement("iframe");
        printIframe.style.position = "fixed";
        printIframe.style.width = "0";
        printIframe.style.height = "0";
        printIframe.style.opacity = "0";
        printIframe.style.border = "none";
        printIframe.src = blobUrl;
        document.body.appendChild(printIframe);

        printIframe.onload = () => {
          try {
            printIframe.contentWindow?.focus();
            printIframe.contentWindow?.print();
          } catch (printErr) {
            console.warn("Gagal memicu dialog cetak browser otomatis:", printErr);
          }
          // Safely clean up reference and blob memory after dialog initiation
          setTimeout(() => {
            try {
              document.body.removeChild(printIframe);
              URL.revokeObjectURL(blobUrl);
            } catch (e) {}
          }, 60000);
        };
      } catch (e) {
        console.warn("Printing to invisible iframe failed:", e);
      }
      
      dismissToast(toastId);
      showToast("Laporan PDF berhasil diunduh & dialog cetak dipicu!", "success");
    } catch (err: any) {
      console.error("Gagal membuat PDF:", err);
      dismissToast(toastId);
      showToast(`Gagal memproses ekspor PDF: ${err.message || err}`, "error");
    } finally {
      setIsExportingPdf(false);
      setPdfProgressText("");
    }
  };

  const handleStartEdit = (attendee: Attendee) => {
    setEditingAttendee(attendee);
    setEditName(attendee.name);
    setEditNip(attendee.nip);
    setEditInstansi(attendee.instansi);
    setEditJabatan(attendee.jabatan);
    setEditEmail(attendee.email);
  };

  const handleSaveEdit = async () => {
    if (!editingAttendee) return;
    if (!editName.trim() || !editNip.trim() || !editInstansi.trim() || !editJabatan.trim()) {
      showToast("Semua kolom bertanda * wajib diisi.", "warning");
      return;
    }

    setIsSavingEdit(true);
    const toastId = showToast("Menyimpan perubahan data peserta...", "loading", 0);

    try {
      const res = await fetch(`/api/attendees/${encodeURIComponent(editingAttendee.nip)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName,
          nip: editNip,
          instansi: editInstansi,
          jabatan: editJabatan,
          email: editEmail
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Gagal memperbarui data.");
      }

      dismissToast(toastId);
      showToast("Data peserta berhasil diperbarui!", "success");
      setEditingAttendee(null);
      fetchAttendeesFromSheets();
    } catch (err: any) {
      console.error("Error editing attendee:", err);
      dismissToast(toastId);
      showToast(`Gagal mengedit data: ${err.message || err}`, "error");
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleSaveTarget = () => {
    const value = parseInt(tempTarget, 10);
    if (!isNaN(value) && value > 0) {
      setAttendanceTarget(value);
      localStorage.setItem("admin_attendance_target", value.toString());
      setIsEditingTarget(false);
      showToast(`Target kehadiran diset ke ${value} peserta.`, "success");
    } else {
      showToast("Target harus berupa angka positif!", "warning");
    }
  };

  const handleDeleteAttendee = async () => {
    if (!deletingAttendee) return;

    // Remove deleted attendee's key from tracked set so they can check-in again
    const deKey = `${(deletingAttendee.nip || "").trim().toLowerCase()}_${(deletingAttendee.name || "").trim().toLowerCase()}`;
    seenAttendeeKeysRef.current.delete(deKey);

    setIsDeleting(true);
    const toastId = showToast("Menghapus data peserta...", "loading", 0);

    try {
      let isOfflineDeleted = false;

      // Try searching and purging from local offline state if stored
      const storedStr = localStorage.getItem("local_offline_attendees") || "[]";
      let storedList = JSON.parse(storedStr);
      const initialLength = storedList.length;
      storedList = storedList.filter(
        (a: any) => !(a.nip.trim().toLowerCase() === deletingAttendee.nip.trim().toLowerCase() && 
                      a.name.trim().toLowerCase() === deletingAttendee.name.trim().toLowerCase())
      );
      if (storedList.length < initialLength) {
        localStorage.setItem("local_offline_attendees", JSON.stringify(storedList));
        isOfflineDeleted = true;
      }

      // If the record was purely registered offline, we don't need server request
      if (deletingAttendee.isOfflineOnly) {
        dismissToast(toastId);
        showToast("Data peserta offline berhasil dihapus!", "success");
        setDeletingAttendee(null);
        fetchAttendeesFromSheets();
        return;
      }

      // Otherwise, request deletion from Express service / Google Sheets
      try {
        const res = await fetch(`/api/attendees/${encodeURIComponent(deletingAttendee.nip)}`, {
          method: "DELETE"
        });

        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.error || "Gagal menghapus data di Google Sheets.");
        }

        dismissToast(toastId);
        showToast("Data peserta berhasil dihapus!", "success");
        setDeletingAttendee(null);
        fetchAttendeesFromSheets();
      } catch (err: any) {
        console.warn("Server delete failed, checking offline state purge:", err);
        if (isOfflineDeleted) {
          dismissToast(toastId);
          showToast("Data peserta berhasil dihapus dari cache lokal!", "success");
          setDeletingAttendee(null);
          fetchAttendeesFromSheets();
        } else {
          throw err;
        }
      }
    } catch (err: any) {
      console.error("Error deleting attendee:", err);
      dismissToast(toastId);
      showToast(`Gagal menghapus data: ${err.message || err}`, "error");
    } finally {
      setIsDeleting(false);
    }
  };

  // Filter attendees by query and date range
  const filteredAttendees = attendees.filter((a) => {
    // 1. Search filter
    const q = searchQuery.toLowerCase();
    const matchesSearch = (
      a.name.toLowerCase().includes(q) ||
      a.instansi.toLowerCase().includes(q) ||
      a.nip.toLowerCase().includes(q) ||
      a.jabatan.toLowerCase().includes(q)
    );
    if (!matchesSearch) return false;

    // 2. Date filters
    if (startDateFilter || endDateFilter) {
      if (!a.checkInTime) return false;
      
      const checkInDateOnly = a.checkInTime.trim().split(/[ T]/)[0]; // "YYYY-MM-DD"
      
      if (checkInDateOnly && checkInDateOnly.length >= 10) {
        const formattedDate = checkInDateOnly.substring(0, 10);
        if (startDateFilter && formattedDate < startDateFilter) {
          return false;
        }
        if (endDateFilter && formattedDate > endDateFilter) {
          return false;
        }
      } else {
        try {
          const checkInDate = new Date(a.checkInTime);
          if (startDateFilter) {
            const startD = new Date(startDateFilter + "T00:00:00");
            if (checkInDate < startD) return false;
          }
          if (endDateFilter) {
            const endD = new Date(endDateFilter + "T23:59:59");
            if (checkInDate > endD) return false;
          }
        } catch (e) {
          return false;
        }
      }
    }
    return true;
  });

  // Calculate statistics for visualization
  const getStats = (): DashboardStats => {
    // Top institutions
    const instCounts: Record<string, number> = {};
    attendees.forEach((a) => {
      const inst = a.instansi.trim() || "Umum";
      instCounts[inst] = (instCounts[inst] || 0) + 1;
    });

    const byInstitution = Object.entries(instCounts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6); // Keep top 6 stats

    // Grouping by time blocks for Timeline
    const timeBlocks: Record<string, number> = {};
    attendees.forEach((a) => {
      try {
        // e.g. "2026-10-24 15:35:12" -> get hour block
        const hour = a.checkInTime.split(" ")[1]?.substring(0, 5) || "00:00";
        timeBlocks[hour] = (timeBlocks[hour] || 0) + 1;
      } catch (err) {
        timeBlocks["Lainnya"] = (timeBlocks["Lainnya"] || 0) + 1;
      }
    });

    const timeline = Object.entries(timeBlocks)
      .map(([time, count]) => ({ time, count }))
      .sort((a, b) => a.time.localeCompare(b.time));

    // Grouping by hourly blocks (e.g. "08:00", "09:00", "10:00")
    const hourlyBlocks: Record<string, number> = {};
    attendees.forEach((a) => {
      try {
        const parts = a.checkInTime.split(" ")[1];
        if (parts) {
          const hour = `${parts.split(":")[0].padStart(2, "0")}:00`;
          hourlyBlocks[hour] = (hourlyBlocks[hour] || 0) + 1;
        } else {
          hourlyBlocks["00:00"] = (hourlyBlocks["00:00"] || 0) + 1;
        }
      } catch (err) {
        hourlyBlocks["Lainnya"] = (hourlyBlocks["Lainnya"] || 0) + 1;
      }
    });

    const hourly = Object.entries(hourlyBlocks)
      .map(([hour, count]) => ({ hour, count }))
      .sort((a, b) => a.hour.localeCompare(b.hour));

    // Cumulative attendance in Real-time (sorted chronologically)
    const sorted = [...attendees].sort((a, b) => {
      const timeA = new Date(a.checkInTime).getTime() || 0;
      const timeB = new Date(b.checkInTime).getTime() || 0;
      return timeA - timeB;
    });

    const minuteCounts: Record<string, number> = {};
    sorted.forEach((a) => {
      try {
        const parts = a.checkInTime.split(" ")[1];
        const timeKey = parts ? parts.substring(0, 5) : "00:05";
        minuteCounts[timeKey] = (minuteCounts[timeKey] || 0) + 1;
      } catch (e) {
        minuteCounts["00:00"] = (minuteCounts["00:00"] || 0) + 1;
      }
    });

    const sortedMinutes = Object.entries(minuteCounts).sort((a, b) => a[0].localeCompare(b[0]));

    let totalAccum = 0;
    const cumulative = sortedMinutes.map(([time, count]) => {
      totalAccum += count;
      return {
        time,
        total: totalAccum,
        countAtMinute: count
      };
    });

    // Grouping by day-by-day for daily participation trend
    const dailyCounts: Record<string, number> = {};
    attendees.forEach((a) => {
      try {
        const datePart = a.checkInTime.split(" ")[0]; // "YYYY-MM-DD"
        if (datePart) {
          dailyCounts[datePart] = (dailyCounts[datePart] || 0) + 1;
        } else {
          dailyCounts["Lainnya"] = (dailyCounts["Lainnya"] || 0) + 1;
        }
      } catch (err) {
        dailyCounts["Lainnya"] = (dailyCounts["Lainnya"] || 0) + 1;
      }
    });

    const dailyParticipation = Object.entries(dailyCounts)
      .map(([date, count]) => {
        let displayDate = date;
        try {
          if (date !== "Lainnya") {
            const parts = date.split("-");
            if (parts.length === 3) {
              const [y, m, d] = parts;
              const months = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agt", "Sep", "Okt", "Nov", "Des"];
              const mIdx = parseInt(m, 10) - 1;
              displayDate = `${parseInt(d, 10)} ${months[mIdx] || m}`;
            } else {
              // Try local date format standard
              const localParts = date.split("/");
              if (localParts.length === 3) {
                const [d, m, y] = localParts;
                const months = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agt", "Sep", "Okt", "Nov", "Des"];
                const mIdx = parseInt(m, 10) - 1;
                displayDate = `${parseInt(d, 10)} ${months[mIdx] || m}`;
              }
            }
          }
        } catch (_) {}
        return { date, label: displayDate, count };
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      totalCount: attendees.length,
      byInstitution,
      timeline,
      hourly,
      cumulative,
      dailyParticipation,
    };
  };

  const stats = getStats();

  if (!accessToken) {
    return (
      <div className="bg-white rounded-2xl shadow-xl shadow-slate-100/40 border border-slate-100 p-8 max-w-lg mx-auto text-center my-6">
        <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6">
          <Key className="w-8 h-8" />
        </div>
        <h3 className="text-xl font-bold text-gray-900 mb-2">Login Sebagai Admin</h3>
        <p className="text-sm text-gray-500 leading-relaxed mb-6">
          Gunakan akun Google Anda untuk mengakses panel admin, mencatat daftar kehadiran secara real-time, 
          dan mengaktifkan sesi penandatanganan mandiri dari HP peserta.
        </p>
        <button
          onClick={onLogin}
          className="w-full bg-slate-900 hover:bg-slate-800 text-white font-medium py-3 px-4 rounded-xl text-sm transition-all flex items-center justify-center gap-2 shadow-lg shadow-slate-900/10 cursor-pointer"
        >
          Masuk dengan Akun Google
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header controls */}
      <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between bg-slate-900 text-white p-6 rounded-2xl shadow-xl">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight">Dashboard Pemantauan</h1>
            <span className="bg-emerald-500 text-slate-950 font-bold px-2 py-0.5 rounded text-[10px] animate-pulse uppercase">
              Live
            </span>
          </div>
          <p className="text-xs text-slate-300 mt-1 max-w-lg">
            Terhubung ke Google Spreadsheet dan folder Google Drive secara interaktif. 
            Menampilkan data peserta secara instan dan akurat.
          </p>
          {lastSynced && (
            <p className="text-[10px] text-emerald-400 mt-1 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 self-center"></span>
              Sinkronisasi Terakhir: {lastSynced} (setiap 10s otomatis)
            </p>
          )}

          {/* Real-time Status Panel */}
          <div className="flex flex-wrap items-center gap-2.5 mt-3 pt-3 border-t border-slate-800/80">
            <div className="flex items-center gap-1.5 bg-slate-800/60 border border-slate-700/60 h-7 px-2.5 rounded-lg text-[10px] font-semibold text-slate-300">
              <Users className="w-3.5 h-3.5 text-sky-400" />
              <span>Admin Aktif:</span>
              <span className="text-white font-extrabold bg-sky-500/20 px-1.5 py-0.5 rounded-md min-w-[16px] text-center" title="Jumlah admin yang sedang memantau halaman">{activeAdminCount} Sesi</span>
            </div>

            <div 
              className={`flex items-center gap-1.5 bg-slate-800/60 border h-7 px-2.5 rounded-lg text-[10px] font-semibold transition-all relative group cursor-help ${
                googleSpreadsheetStatus === "connected"
                  ? "border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/5"
                  : googleSpreadsheetStatus === "error"
                  ? "border-rose-500/20 text-rose-400 hover:bg-rose-500/5"
                  : "border-amber-500/20 text-amber-400 hover:bg-amber-500/5"
              }`}
              title={googleSpreadsheetError || "Status Google Sheets API"}
            >
              <div className={`w-1.5 h-1.5 rounded-full ${
                googleSpreadsheetStatus === "connected"
                  ? "bg-emerald-400 animate-pulse"
                  : googleSpreadsheetStatus === "error"
                  ? "bg-rose-400"
                  : "bg-amber-400"
              }`} />
              <Activity className="w-3 h-3" />
              <span>Koneksi API Sheets:</span>
              <span className="uppercase font-extrabold">
                {googleSpreadsheetStatus === "connected" ? "Terhubung" : googleSpreadsheetStatus === "error" ? "Bermasalah" : "Belum Set"}
              </span>

              {/* Advanced Tooltip for specific error logs on hover */}
              {googleSpreadsheetStatus === "error" && googleSpreadsheetError && (
                <div className="absolute top-full left-0 z-50 mt-1.5 hidden group-hover:block transition-all duration-200 w-64 bg-slate-950 text-slate-300 border border-slate-800 text-[9px] p-2.5 rounded-lg shadow-2xl leading-normal font-sans text-left normal-case">
                  <span className="font-bold text-rose-400 block mb-1">Detail Kesalahan Koneksi:</span>
                  {googleSpreadsheetError}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2.5 w-full lg:w-auto items-center">
          {/* Public session toggle as an elegant Switch */}
          <div className="flex items-center gap-3 bg-slate-800 border border-slate-700/80 rounded-xl px-3.5 py-1.5 hover:bg-slate-750 transition-all">
            <div className="flex flex-col text-left">
              <span className="text-[9px] uppercase font-bold text-slate-400 tracking-wider">Sesi Absensi HP</span>
              <span className={`text-[11px] font-bold ${isSessionActive ? "text-emerald-400" : "text-amber-450"}`}>
                {isSessionActive ? "Terbuka" : "Tertutup"}
              </span>
            </div>
            
            <button
              onClick={() => setShowConfirmToggleSession(true)}
              disabled={isActivatingSession}
              className={`relative inline-flex h-5.5 w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-50 ${
                isSessionActive ? "bg-emerald-500" : "bg-slate-600"
              }`}
              title={isSessionActive ? "Klik untuk menutup sesi absensi secara instan" : "Klik untuk membuka sesi absensi secara instan"}
            >
              <span className="sr-only">Toggle Sesi Absensi</span>
              <span
                className={`pointer-events-none relative inline-block h-4.5 w-4.5 transform rounded-full bg-white shadow-md transition duration-200 ease-in-out flex items-center justify-center ${
                  isSessionActive ? "translate-x-4.5" : "translate-x-0"
                }`}
              >
                {isActivatingSession ? (
                  <RefreshCw className="w-2.5 h-2.5 text-slate-600 animate-spin" />
                ) : isSessionActive ? (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                ) : (
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                )}
              </span>
            </button>
          </div>

          {isSessionActive && (
            <button
              onClick={() => setShowQrModal(true)}
              className="bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-750 p-2.5 rounded-xl text-xs font-medium cursor-pointer flex items-center gap-1.5"
              title="Tampilkan Kode QR Sesi Mandiri"
            >
              <QrCode className="w-4 h-4 text-emerald-400" /> Tampilkan QR
            </button>
          )}

          <button
            onClick={handleManualSync}
            disabled={isSyncingManually}
            className="bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-750 p-2.5 rounded-xl text-xs font-medium cursor-pointer flex items-center gap-1.5"
            title="Sinkronkan data peserta secara manual dari Google Sheets"
          >
            <RefreshCw className={`w-4 h-4 text-emerald-400 ${isSyncingManually || isBackgroundFetching ? "animate-spin" : ""}`} /> 
            {isSyncingManually ? "Menyinkronkan..." : "Sinkron Data"}
          </button>

          {/* Auto Refresh Real-Time Panel */}
          <div className="bg-slate-800 border border-slate-700 p-1 rounded-xl flex items-center gap-1.5 text-xs font-medium text-slate-200">
            <button
              onClick={() => {
                const newVal = !isAutoRefreshEnabled;
                setIsAutoRefreshEnabled(newVal);
                localStorage.setItem("admin_auto_refresh_enabled", String(newVal));
                showToast(newVal ? `Auto-Refresh diaktifkan (${autoRefreshInterval}s)` : "Auto-Refresh dimatikan", "info", 1500);
              }}
              className={`px-2 py-1.5 rounded-lg flex items-center gap-1.5 transition-all cursor-pointer ${
                isAutoRefreshEnabled 
                  ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" 
                  : "hover:bg-slate-700 text-slate-400 border border-transparent"
              }`}
              title="Aktifkan/Matikan Auto-Refresh Real-Time"
            >
              <span className={`w-2 h-2 rounded-full ${isAutoRefreshEnabled ? "bg-emerald-500 animate-pulse" : "bg-slate-500"}`}></span>
              <span>Auto-Refresh</span>
            </button>
            
            {isAutoRefreshEnabled && (
              <select
                value={autoRefreshInterval}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  setAutoRefreshInterval(val);
                  localStorage.setItem("admin_auto_refresh_interval", String(val));
                  showToast(`Interval auto-refresh diubah ke ${val} detik`, "info", 1500);
                }}
                className="bg-slate-900 border border-slate-700 text-slate-300 text-[11px] rounded-lg px-2 py-1 focus:outline-none focus:border-emerald-500 cursor-pointer"
                title="Pilih Interval Auto-Refresh"
              >
                <option value="10">10 Detik</option>
                <option value="15">15 Detik</option>
                <option value="30">30 Detik</option>
                <option value="60">60 Detik</option>
                <option value="120">120 Detik</option>
              </select>
            )}

            {isBackgroundFetching && (
              <span className="text-[10px] text-emerald-400 px-1 italic animate-pulse">syncing...</span>
            )}
          </div>

          <button
            onClick={() => {
              setShowConfigSettings(!showConfigSettings);
              setShowNotificationSettings(false);
            }}
            className={`bg-slate-800 border ${showConfigSettings ? 'border-emerald-500 bg-slate-850' : 'border-slate-700'} text-slate-200 hover:bg-slate-750 p-2.5 rounded-xl text-xs font-medium cursor-pointer flex items-center gap-1.5`}
            title="Pengaturan integrasi Google Sheets"
          >
            <Settings className="w-4 h-4 text-slate-400" /> Pengaturan Sheet
          </button>

          <button
            onClick={() => {
              setShowNotificationSettings(!showNotificationSettings);
              setShowConfigSettings(false);
            }}
            className={`bg-slate-800 border ${showNotificationSettings ? 'border-emerald-500 bg-slate-850' : 'border-slate-700'} text-slate-200 hover:bg-slate-750 p-2.5 rounded-xl text-xs font-medium cursor-pointer flex items-center gap-1.5`}
            title="Pengaturan Notifikasi Ringkasan Harian"
          >
            <Bell className="w-4 h-4 text-slate-400" /> Notifikasi Ringkasan
          </button>

          <button
            onClick={onLogout}
            className="bg-rose-955 border border-rose-900/40 text-rose-300 hover:bg-rose-500/10 px-3 py-2.5 rounded-xl text-xs font-medium flex items-center gap-1.5 cursor-pointer ml-auto lg:ml-0"
          >
            <LogOut className="w-3.5 h-3.5" /> Log Out
          </button>
        </div>
      </div>

      {hasAccessError && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }} 
          animate={{ opacity: 1, y: 0 }} 
          className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-5 text-slate-805 space-y-4"
        >
          <div className="flex gap-3">
            <ShieldAlert className="w-6 h-6 text-amber-500 shrink-0 self-start mt-0.5" />
            <div>
              <h2 className="font-bold text-sm text-slate-900">Akses Google Sheets Dibatasi / 403 Forbidden</h2>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                Akun Google aktif Anda (<strong>{accessToken ? "Terkoneksi" : "Tidak Terdeteksi"}</strong>) tidak memiliki izin akses edit ke Spreadsheet default. 
                Ini adalah hal wajar ketika login dengan akun berbeda dari pembuat spreadsheet awal.
              </p>
            </div>
          </div>
          
          <div className="bg-white/80 rounded-xl p-4 border border-amber-200/55 space-y-3">
            <p className="text-xs font-semibold text-slate-700">Solusi Terbaik: Hubungkan Spreadsheet Milik Akun Anda Sendiri</p>
            <p className="text-[11px] text-slate-500 leading-normal">
              Sistem akan membuat file Google Spreadsheet absensi baru dan folder penyimpanan tanda tangan baru di akun Google Drive pribadi Anda saat ini. Semua data tersimpan aman dan terintegrasi penuh.
            </p>
            
            <button
              onClick={handleCreateNewSheetAndFolder}
              disabled={isCreatingResources}
              className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-semibold py-2 px-4 rounded-xl text-xs transition-all flex items-center gap-1.5 shadow-sm cursor-pointer"
            >
              {isCreatingResources ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Menginisialisasi Spreadsheet Akun Anda...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Inisialisasi Spreadsheet & Folder Saya Otomatis (Sangat Direkomendasikan)
                </>
              )}
            </button>
          </div>
        </motion.div>
      )}

      {showConfigSettings && (
        <motion.div 
          initial={{ opacity: 0, height: 0 }} 
          animate={{ opacity: 1, height: "auto" }} 
          className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-4"
        >
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm text-slate-850 flex items-center gap-2">
              <Settings className="w-4 h-4 text-slate-500" /> Pengaturan Integrasi Spreadsheet Akun Google Drive Anda
            </h3>
            <button 
              onClick={() => setShowConfigSettings(false)}
              className="text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">ID Google Spreadsheet Utama</label>
              <input
                type="text"
                value={spreadsheetId}
                onChange={(e) => {
                  const val = e.target.value.trim();
                  setSpreadsheetId(val);
                  localStorage.setItem("custom_spreadsheet_id", val);
                  fetch("/api/save-token", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ accessToken, spreadsheetId: val, driveFolderId })
                  });
                }}
                className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs focus:ring-1 focus:ring-emerald-500 outline-none text-slate-700 font-mono"
                placeholder="Masukkan ID Spreadsheet Anda"
              />
              <p className="text-[10px] text-slate-400 leading-normal">
                Google Spreadsheet tempat menyimpan data kehadiran. Anda bisa menyalinnya dari URL url sheets.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">ID Folder Google Drive (Tanda Tangan)</label>
              <input
                type="text"
                value={driveFolderId}
                onChange={(e) => {
                  const val = e.target.value.trim();
                  setDriveFolderId(val);
                  localStorage.setItem("custom_drive_folder_id", val);
                  fetch("/api/save-token", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ accessToken, spreadsheetId, driveFolderId: val })
                  });
                }}
                className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs focus:ring-1 focus:ring-emerald-500 outline-none text-slate-700 font-mono"
                placeholder="Masukkan ID Folder Drive Anda"
              />
              <p className="text-[10px] text-slate-400 leading-normal">
                Folder tempat menyimpan file gambar tanda tangan PNG peserta.
              </p>
            </div>
          </div>

          <div className="bg-slate-100/50 p-4 rounded-xl border border-slate-200/50 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold text-slate-700 font-medium">Buat Baru Secara Otomatis?</p>
              <p className="text-[10px] text-slate-400 leading-relaxed mt-0.5">
                Jangan khawatir tentang konfigurasi manual. Klik tombol di samping untuk membuat file Spreadsheet dan folder Drive baru di penyimpanan Google Anda sendiri secara instan.
              </p>
            </div>

            <button
              type="button"
              onClick={handleCreateNewSheetAndFolder}
              disabled={isCreatingResources}
              className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-semibold py-2 px-4 rounded-xl text-xs transition-all flex items-center justify-center gap-1.5 shrink-0 self-end md:self-auto cursor-pointer"
            >
              {isCreatingResources ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Menginisialisasi...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" /> Buat Otomatis Sekarang
                </>
              )}
            </button>
          </div>

          {/* Cadangan Google Drive Cadangan Otomatis Section */}
          <div className="border-t border-slate-200/80 pt-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" /> Sinkronisasi & Pencadangan Google Drive Harian Otomatis
                </h4>
                <p className="text-[10px] text-slate-500 leading-normal mt-0.5">
                  Sistem mengekspor dan mencadangkan duplikat data absensi berformat Excel (.xlsx) setiap hari secara otomatis ke aman Drive Anda.
                </p>
              </div>

              <div className="flex items-center gap-1.5 shrink-0 bg-emerald-50 text-emerald-700 text-[10px] font-bold px-2 py-0.5 rounded-md border border-emerald-150 w-fit">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                SINKRONISASI AKTIF
              </div>
            </div>

            <div className="bg-slate-50/50 p-4 rounded-xl border border-slate-150 grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1">
                <span className="text-[10px] text-slate-400 font-semibold uppercase block">Terakhir Cadangkan</span>
                <span className="text-xs font-bold text-slate-700 block">
                  {backupInfo?.lastBackupTime 
                    ? new Date(backupInfo.lastBackupTime).toLocaleString("id-ID", { dateStyle: "long", timeStyle: "medium" }) 
                    : "Belum pernah dicadangkan"}
                </span>
                <span className="text-[9px] text-slate-400 block leading-tight">Hari sinkronisasi: {backupInfo?.lastBackupDate || "-"}</span>
              </div>

              <div className="space-y-1">
                <span className="text-[10px] text-slate-400 font-semibold uppercase block">Lokasi Folder Google Drive</span>
                <span className="text-xs font-semibold text-slate-600 block truncate font-mono">
                  {driveFolderId || "Default Folder"}
                </span>
                <a 
                  href={driveFolderId ? `https://drive.google.com/drive/folders/${driveFolderId}` : "https://drive.google.com/"}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[9px] text-indigo-600 font-semibold hover:underline flex items-center gap-0.5"
                >
                  Buka Folder Drive <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </div>

              <div className="flex items-center justify-end">
                <button
                  type="button"
                  onClick={handleRunBackup}
                  disabled={isBackupRunning}
                  className="w-full md:w-auto bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-semibold py-2 px-4 rounded-xl text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-xs active:scale-95"
                >
                  {isBackupRunning ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Sedang Cadangkan...
                    </>
                  ) : (
                    <>
                      <Printer className="w-3.5 h-3.5" /> Cadangkan Sekarang (.xlsx)
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Backup logs history list */}
            {backupInfo?.history && backupInfo.history.length > 0 && (
              <div className="space-y-2 mt-2">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Riwayat Cadangan Sinkronisasi</span>
                
                <div className="overflow-x-auto rounded-lg border border-slate-150">
                  <table className="w-full text-left text-[11px] text-slate-600">
                    <thead className="bg-slate-50 text-[10px] text-slate-400 font-semibold uppercase border-b border-slate-150">
                      <tr>
                        <th className="p-2 w-32">Waktu Cadangan</th>
                        <th className="p-2">Nama Berkas Cadangan</th>
                        <th className="p-2 text-center w-24">Jumlah Data</th>
                        <th className="p-2 text-center w-24">MimeType</th>
                        <th className="p-2 text-center w-24">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-700 bg-white">
                      {backupInfo.history.slice(0, 5).map((log, index) => (
                        <tr key={index} className="hover:bg-slate-50/50">
                          <td className="p-2 font-mono text-[10px]">
                            {new Date(log.timestamp).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "medium" })}
                          </td>
                          <td className="p-2 font-medium truncate max-w-[200px]" title={log.fileName}>
                            {log.fileName}
                          </td>
                          <td className="p-2 text-center font-bold text-slate-600">
                            {log.recordCount} Baris
                          </td>
                          <td className="p-2 text-center text-[10px] text-slate-400 font-mono">
                            Excel (.xlsx)
                          </td>
                          <td className="p-2 text-center">
                            {log.success ? (
                              <span className="inline-block bg-emerald-50 text-emerald-700 text-[9px] font-bold px-1.5 py-0.5 rounded-md border border-emerald-150">
                                Berhasil
                              </span>
                            ) : (
                              <span 
                                className="inline-block bg-rose-50 text-rose-700 text-[9px] font-bold px-1.5 py-0.5 rounded-md border border-rose-150 cursor-help"
                                title={log.error || "Gagal sinkronisasi"}
                              >
                                Gagal
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      )}

      {showNotificationSettings && (
        <motion.div 
          initial={{ opacity: 0, height: 0 }} 
          animate={{ opacity: 1, height: "auto" }} 
          className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-5 shadow-sm"
        >
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm text-slate-850 flex items-center gap-2">
              <Bell className="w-4 h-4 text-emerald-500 shrink-0" /> Integrasi Notifikasi Laporan Absensi Harian Otomatis
            </h3>
            <button 
              onClick={() => setShowNotificationSettings(false)}
              className="text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="bg-indigo-50/70 border border-indigo-100 p-4 rounded-xl text-[11px] text-indigo-950 leading-relaxed flex gap-2.5 items-start">
            <Info className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-xs text-indigo-900">Sistem Summary Otomatis Setelah Sesi Berakhir</p>
              <p className="mt-0.5">
                Ketika Anda menonaktifkan <strong>Sesi Absensi HP Peserta</strong>, system secara otomatis mengumpulkan daftar hadir harian dan mengirimkan rekapnya ke grup Telegram, nomor WhatsApp, atau email admin yang diaktifkan di bawah ini.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
            {/* Telegram Channel */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col justify-between">
              <div className="space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                  <span className="font-bold text-xs text-slate-800 flex items-center gap-1.5">
                    <MessageSquare className="w-4 h-4 text-sky-500" /> Telegram Group/Channel
                  </span>
                  <label className="relative inline-flex items-center cursor-pointer select-none">
                    <input 
                      type="checkbox" 
                      className="sr-only peer"
                      checked={notificationSettings.telegramEnabled}
                      onChange={(e) => setNotificationSettings(prev => ({ ...prev, telegramEnabled: e.target.checked }))}
                    />
                    <div className="w-8 h-4.5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:bg-sky-500"></div>
                    <span className="text-[10px] font-semibold text-slate-500 ml-1.5">
                      {notificationSettings.telegramEnabled ? "Aktif" : "Nonaktif"}
                    </span>
                  </label>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 block font-medium">Token Bot Telegram</label>
                    <input 
                      type="text"
                      disabled={!notificationSettings.telegramEnabled}
                      value={notificationSettings.telegramBotToken}
                      onChange={(e) => setNotificationSettings(prev => ({ ...prev, telegramBotToken: e.target.value }))}
                      placeholder="123456789:ABCdefGhIJKlmNoPQRsT"
                      className="w-full bg-slate-50/50 border border-slate-200 rounded-lg px-2.5 py-1.5 font-mono text-[11px] outline-none focus:bg-white focus:ring-1 focus:ring-sky-500 disabled:opacity-55"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 block font-medium">Chat ID Penerima</label>
                    <input 
                      type="text"
                      disabled={!notificationSettings.telegramEnabled}
                      value={notificationSettings.telegramChatId}
                      onChange={(e) => setNotificationSettings(prev => ({ ...prev, telegramChatId: e.target.value.trim() }))}
                      placeholder="-1001234567890"
                      className="w-full bg-slate-50/50 border border-slate-200 rounded-lg px-2.5 py-1.5 font-mono text-[11px] outline-none focus:bg-white focus:ring-1 focus:ring-sky-500 disabled:opacity-55"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-3 mt-4 border-t border-slate-100 flex justify-end">
                <button
                  type="button"
                  onClick={() => handleTestNotification("telegram")}
                  disabled={!notificationSettings.telegramEnabled || testingChannel !== null}
                  className="text-[11px] font-bold text-sky-600 hover:text-sky-755 disabled:opacity-40 flex items-center gap-1 cursor-pointer"
                >
                  <Send className="w-3 h-3" /> Kirim Tes Telegram
                </button>
              </div>
            </div>

            {/* WhatsApp Channel */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col justify-between">
              <div className="space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                  <span className="font-bold text-xs text-slate-800 flex items-center gap-1.5">
                    <MessageSquare className="w-4 h-4 text-emerald-500" /> WhatsApp Gateway
                  </span>
                  <label className="relative inline-flex items-center cursor-pointer select-none">
                    <input 
                      type="checkbox" 
                      className="sr-only peer"
                      checked={notificationSettings.whatsappEnabled}
                      onChange={(e) => setNotificationSettings(prev => ({ ...prev, whatsappEnabled: e.target.checked }))}
                    />
                    <div className="w-8 h-4.5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:bg-emerald-500"></div>
                    <span className="text-[10px] font-semibold text-slate-500 ml-1.5">
                      {notificationSettings.whatsappEnabled ? "Aktif" : "Nonaktif"}
                    </span>
                  </label>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 block font-medium">Portal / Gateway API</label>
                    <select
                      disabled={!notificationSettings.whatsappEnabled}
                      value={notificationSettings.whatsappApiProvider}
                      onChange={(e) => setNotificationSettings(prev => ({ ...prev, whatsappApiProvider: e.target.value as "fonnte" | "webhook" }))}
                      className="w-full bg-slate-50/50 border border-slate-200 rounded-lg px-2 py-1.5 outline-none focus:bg-white focus:ring-1 focus:ring-emerald-500 disabled:opacity-55"
                    >
                      <option value="fonnte">Fonnte (Indonesia Gateway)</option>
                      <option value="webhook">Generic URL Webhook (Post)</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 block font-medium">
                      {notificationSettings.whatsappApiProvider === "fonnte" ? "Token API Fonnte" : "API Token Header (Opsional)"}
                    </label>
                    <input 
                      type="text"
                      disabled={!notificationSettings.whatsappEnabled}
                      value={notificationSettings.whatsappToken}
                      onChange={(e) => setNotificationSettings(prev => ({ ...prev, whatsappToken: e.target.value }))}
                      placeholder={notificationSettings.whatsappApiProvider === "fonnte" ? "t0k3nWAdanF0nnt3" : "Bearer ..."}
                      className="w-full bg-slate-50/50 border border-slate-200 rounded-lg px-2.5 py-1.5 font-mono text-[11px] outline-none focus:bg-white focus:ring-1 focus:ring-emerald-500 disabled:opacity-55"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 block font-medium">
                      {notificationSettings.whatsappApiProvider === "fonnte" ? "No Tujuan / ID Grup WA" : "URL Webhook Penerima"}
                    </label>
                    <input 
                      type="text"
                      disabled={!notificationSettings.whatsappEnabled}
                      value={notificationSettings.whatsappTarget}
                      onChange={(e) => setNotificationSettings(prev => ({ ...prev, whatsappTarget: e.target.value.trim() }))}
                      placeholder={notificationSettings.whatsappApiProvider === "fonnte" ? "08123456789 atau group@g.us" : "https://api.domain.com/rekap"}
                      className="w-full bg-slate-50/50 border border-slate-200 rounded-lg px-2.5 py-1.5 font-mono text-[11px] outline-none focus:bg-white focus:ring-1 focus:ring-emerald-500 disabled:opacity-55"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-3 mt-4 border-t border-slate-100 flex justify-end">
                <button
                  type="button"
                  onClick={() => handleTestNotification("whatsapp")}
                  disabled={!notificationSettings.whatsappEnabled || testingChannel !== null}
                  className="text-[11px] font-bold text-emerald-600 hover:text-emerald-755 disabled:opacity-40 flex items-center gap-1 cursor-pointer"
                >
                  <Send className="w-3 h-3" /> Kirim Tes WhatsApp
                </button>
              </div>
            </div>

            {/* Email Channel */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col justify-between">
              <div className="space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                  <span className="font-bold text-xs text-slate-800 flex items-center gap-1.5">
                    <Mail className="w-4 h-4 text-indigo-500" /> Ringkasan Laporan Email
                  </span>
                  <label className="relative inline-flex items-center cursor-pointer select-none">
                    <input 
                      type="checkbox" 
                      className="sr-only peer"
                      checked={notificationSettings.emailEnabled}
                      onChange={(e) => setNotificationSettings(prev => ({ ...prev, emailEnabled: e.target.checked }))}
                    />
                    <div className="w-8 h-4.5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:bg-indigo-500"></div>
                    <span className="text-[10px] font-semibold text-slate-500 ml-1.5">
                      {notificationSettings.emailEnabled ? "Aktif" : "Nonaktif"}
                    </span>
                  </label>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 block font-medium">Email Penerima (Admin)</label>
                    <input 
                      type="email"
                      disabled={!notificationSettings.emailEnabled}
                      value={notificationSettings.emailRecipient}
                      onChange={(e) => setNotificationSettings(prev => ({ ...prev, emailRecipient: e.target.value.trim() }))}
                      placeholder="admin@rsudjusufsk.go.id"
                      className="w-full bg-slate-50/50 border border-slate-200 rounded-lg px-2.5 py-1.5 outline-none focus:bg-white focus:ring-1 focus:ring-indigo-500 disabled:opacity-55"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 block font-medium">Host SMTP</label>
                      <input 
                        type="text"
                        disabled={!notificationSettings.emailEnabled}
                        value={notificationSettings.smtpHost}
                        onChange={(e) => setNotificationSettings(prev => ({ ...prev, smtpHost: e.target.value.trim() }))}
                        placeholder="smtp.gmail.com"
                        className="w-full bg-slate-50/50 border border-slate-200 rounded-lg px-2 py-1.5 font-mono text-[11px] outline-none focus:bg-white focus:ring-1 focus:ring-indigo-500 disabled:opacity-55"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 block font-medium">Port SMTP</label>
                      <input 
                        type="number"
                        disabled={!notificationSettings.emailEnabled}
                        value={notificationSettings.smtpPort}
                        onChange={(e) => setNotificationSettings(prev => ({ ...prev, smtpPort: parseInt(e.target.value) || 465 }))}
                        placeholder="465"
                        className="w-full bg-slate-50/50 border border-slate-200 rounded-lg px-2 py-1.5 font-mono text-[11px] outline-none focus:bg-white focus:ring-1 focus:ring-indigo-500 disabled:opacity-55"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-1">
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 block font-medium">Username / Pengirim</label>
                      <input 
                        type="text"
                        disabled={!notificationSettings.emailEnabled}
                        value={notificationSettings.smtpUser}
                        onChange={(e) => setNotificationSettings(prev => ({ ...prev, smtpUser: e.target.value.trim() }))}
                        placeholder="admin.diklit@gmail.com"
                        className="w-full bg-slate-50/50 border border-slate-200 rounded-lg px-2.5 py-1.5 font-mono text-[11px] outline-none focus:bg-white focus:ring-1 focus:ring-indigo-500 disabled:opacity-55"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 block font-medium">Sandi SMTP (App Password)</label>
                      <input 
                        type="password"
                        disabled={!notificationSettings.emailEnabled}
                        value={notificationSettings.smtpPass}
                        onChange={(e) => setNotificationSettings(prev => ({ ...prev, smtpPass: e.target.value }))}
                        placeholder="••••••••••••••••"
                        className="w-full bg-slate-50/50 border border-slate-200 rounded-lg px-2.5 py-1.5 font-mono text-[11px] outline-none focus:bg-white focus:ring-1 focus:ring-indigo-500 disabled:opacity-55"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-3 mt-4 border-t border-slate-100 flex justify-end">
                <button
                  type="button"
                  onClick={() => handleTestNotification("email")}
                  disabled={!notificationSettings.emailEnabled || testingChannel !== null}
                  className="text-[11px] font-bold text-indigo-600 hover:text-indigo-755 disabled:opacity-40 flex items-center gap-1 cursor-pointer"
                >
                  <Send className="w-3 h-3" /> Kirim Tes Email
                </button>
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={handleSaveNotificationSettings}
              disabled={isSavingNotifications}
              className="bg-emerald-600 hover:bg-emerald-700 hover:shadow-lg disabled:bg-slate-300 text-white font-bold py-2.5 px-6 rounded-xl text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer"
            >
              {isSavingNotifications ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Sedang menyimpan...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" /> Simpan Integrasi Notifikasi
                </>
              )}
            </button>
          </div>
        </motion.div>
      )}
      {/* Numerical Stats Widgets with Interactive Summary and Sparklines */}
      {(() => {
        const now = new Date();
        const pad = (num: number) => String(num).padStart(2, "0");
        const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
        const currentMonthStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
        
        // Month name mapper in Indonesia
        const monthsIndo = [
          "Januari", "Februari", "Maret", "April", "Mei", "Juni",
          "Juli", "Agustus", "September", "Oktober", "November", "Desember"
        ];
        const monthName = monthsIndo[now.getMonth()];
        const todayDateFormatted = `${now.getDate()} ${monthName}`;
        const monthYearFormatted = `${monthName} ${now.getFullYear()}`;

        const todayAttendees = attendees.filter((a) => a.checkInTime && a.checkInTime.trim().startsWith(todayStr));
        const monthAttendees = attendees.filter((a) => a.checkInTime && a.checkInTime.trim().startsWith(currentMonthStr));

        const todayCount = todayAttendees.length;
        const monthCount = monthAttendees.length;
        
        // Target calculation
        const percentage = attendanceTarget > 0 ? Math.round((attendees.length / attendanceTarget) * 100) : 0;

        // Custom tooltip for Sparklines
        const CustomSparklineTooltip = ({ active, payload }: any) => {
          if (active && payload && payload.length) {
            return (
              <div className="bg-slate-900/90 text-[10px] text-white px-2 py-0.5 rounded shadow border border-slate-700/50 font-sans font-medium">
                {payload[0].value} Hadir
              </div>
            );
          }
          return null;
        };

        // Today hourly sparkline (group into 2-hourly periods for rendering)
        const hoursList = ["08:00", "10:00", "12:00", "14:00", "16:00", "18:00"];
        const todayHours: Record<string, number> = {};
        hoursList.forEach(h => { todayHours[h] = 0; });
        todayAttendees.forEach(a => {
          try {
            const parts = a.checkInTime.split(" ")[1];
            if (parts) {
              const hr = parseInt(parts.split(":")[0], 10);
              if (hr < 10) todayHours["08:00"]++;
              else if (hr < 12) todayHours["10:00"]++;
              else if (hr < 14) todayHours["12:00"]++;
              else if (hr < 16) todayHours["14:00"]++;
              else if (hr < 18) todayHours["16:00"]++;
              else todayHours["18:00"]++;
            }
          } catch(e){}
        });
        const todaySparkData = hoursList.map(h => ({ name: h, count: todayHours[h] }));

        // Month weekly sparkline
        const weeksList = ["Mg-1", "Mg-2", "Mg-3", "Mg-4"];
        const monthWeeks: Record<string, number> = { "Mg-1": 0, "Mg-2": 0, "Mg-3": 0, "Mg-4": 0 };
        monthAttendees.forEach(a => {
          try {
            const datePart = a.checkInTime.split(" ")[0];
            const day = parseInt(datePart.split("-")[2], 10);
            if (day <= 7) monthWeeks["Mg-1"]++;
            else if (day <= 14) monthWeeks["Mg-2"]++;
            else if (day <= 21) monthWeeks["Mg-3"]++;
            else monthWeeks["Mg-4"]++;
          } catch(e){}
        });
        const monthSparkData = weeksList.map(w => ({ name: w, count: monthWeeks[w] }));

        // Target Recharts donut slices
        const targetPercentData = [
          { name: "Sesuai Target", value: Math.min(attendees.length, attendanceTarget), color: "#6366f1" },
          { name: "Sisa Target", value: Math.max(0, attendanceTarget - attendees.length), color: "#f1f5f9" }
        ];

        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Card 1: Today's Attendance */}
            <div className="bg-white p-5 rounded-2xl border border-slate-150/60 shadow-sm flex flex-col justify-between h-[124px] relative overflow-hidden transition-all hover:shadow-md hover:border-indigo-100 group">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Kehadiran Hari Ini</span>
                  <span className="text-3xl font-extrabold text-slate-800 mt-1 block tracking-tight group-hover:text-indigo-600 transition-colors">{todayCount}</span>
                </div>
                <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-500 flex items-center justify-center transition-transform group-hover:scale-105 duration-300">
                  <CalendarCheck2 className="w-4 h-4" />
                </div>
              </div>
              <div className="flex items-end justify-between mt-auto">
                <span className="text-[10.5px] font-medium text-slate-400 block">{todayDateFormatted}</span>
                {/* Recharts Mini sparkline area chart */}
                <div className="w-[110px] h-[36px] -mb-1 select-none">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={todaySparkData} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
                      <defs>
                        <linearGradient id="colorTodayGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25}/>
                          <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <Area type="monotone" dataKey="count" stroke="#6366f1" strokeWidth={1.5} fillOpacity={1} fill="url(#colorTodayGrad)" />
                      <Tooltip content={<CustomSparklineTooltip />} cursor={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Card 2: This Month's Attendance */}
            <div className="bg-white p-5 rounded-2xl border border-slate-150/60 shadow-sm flex flex-col justify-between h-[124px] relative overflow-hidden transition-all hover:shadow-md hover:border-emerald-100 group">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Peserta Bulan Ini</span>
                  <span className="text-3xl font-extrabold text-slate-800 mt-1 block tracking-tight group-hover:text-emerald-600 transition-colors">{monthCount}</span>
                </div>
                <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-500 flex items-center justify-center transition-transform group-hover:scale-105 duration-300">
                  <Calendar className="w-4 h-4" />
                </div>
              </div>
              <div className="flex items-end justify-between mt-auto">
                <span className="text-[10.5px] font-medium text-slate-400 block">{monthYearFormatted}</span>
                {/* Recharts Mini sparkline bar chart */}
                <div className="w-[110px] h-[36px] -mb-1 select-none">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monthSparkData} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
                      <Bar dataKey="count" fill="#10b981" radius={[2, 2, 0, 0]} barSize={12} />
                      <Tooltip content={<CustomSparklineTooltip />} cursor={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Card 3: Attendance percentage compared to target */}
            <div className="bg-white p-5 rounded-2xl border border-slate-150/60 shadow-sm flex flex-col justify-between h-[124px] relative overflow-hidden transition-all hover:shadow-md hover:border-violet-100 group">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Pencapaian Target</span>
                  <span className="text-3xl font-extrabold text-slate-800 mt-1 block tracking-tight">{percentage}%</span>
                </div>
                
                {/* Circular Donut Recharts Progress */}
                <div className="w-[48px] h-[48px] relative flex items-center justify-center select-none shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={targetPercentData}
                        cx="50%"
                        cy="50%"
                        innerRadius={15}
                        outerRadius={22}
                        paddingAngle={1}
                        dataKey="value"
                        startAngle={90}
                        endAngle={-270}
                      >
                        {targetPercentData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <span className="text-[8.5px] font-extrabold text-indigo-600">{Math.min(999, percentage)}%</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between mt-auto">
                {isEditingTarget ? (
                  <div className="flex items-center gap-1 bg-slate-50 border border-indigo-200 px-1.5 py-1 rounded-lg">
                    <input
                      type="number"
                      value={tempTarget}
                      onChange={(e) => setTempTarget(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveTarget();
                        if (e.key === 'Escape') setIsEditingTarget(false);
                      }}
                      className="w-12 bg-white px-1 py-0.5 border border-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500 rounded text-center text-[11px] font-bold text-slate-800"
                      autoFocus
                    />
                    <button
                      onClick={handleSaveTarget}
                      className="p-1 bg-emerald-500 hover:bg-emerald-600 text-white rounded-md cursor-pointer transition-colors flex items-center justify-center"
                      title="Simpan"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setIsEditingTarget(false)}
                      className="p-1 bg-slate-200 hover:bg-slate-300 text-slate-600 rounded-md cursor-pointer transition-colors flex items-center justify-center"
                      title="Batal"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 text-[11px] text-slate-500 font-medium">
                    <span>Target: <strong className="text-slate-800">{attendanceTarget}</strong></span>
                    <button
                      onClick={() => {
                        setTempTarget(attendanceTarget.toString());
                        setIsEditingTarget(true);
                      }}
                      className="p-1 hover:bg-slate-100 text-indigo-600 hover:text-indigo-800 rounded-md transition duration-200 cursor-pointer"
                      title="Ubah Target"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
                <span className="text-[10px] text-slate-400 font-semibold uppercase">{attendees.length} / {attendanceTarget}</span>
              </div>
            </div>

            {/* Card 4: Cloud Integration Summary */}
            <div className="bg-white p-5 rounded-2xl border border-slate-150/60 shadow-sm flex flex-col justify-between h-[124px] relative overflow-hidden transition-all hover:shadow-md group">
              <div className="space-y-1.5 text-xs text-slate-500 w-full">
                <span className="font-semibold text-slate-700 flex items-center gap-1 text-[11px]">
                  <Settings className="w-3.5 h-3.5 text-indigo-500" /> Cloud Sync:
                </span>
                <div className="flex items-center justify-between text-[10px] bg-slate-50 hover:bg-slate-100/80 p-1.5 rounded-lg border border-slate-100 transition-colors">
                  <span className="font-medium text-slate-500">Spreadsheet</span>
                  <a
                    href={`https://docs.google.com/spreadsheets/d/${spreadsheetId}`}
                    target="_blank"
                    rel="no-referrer"
                    className="text-emerald-600 font-semibold hover:underline flex items-center gap-0.5"
                  >
                    Buka Excel <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                </div>
                <div className="flex items-center justify-between text-[10px] bg-slate-50 hover:bg-slate-100/80 p-1.5 rounded-lg border border-slate-100 transition-colors">
                  <span className="font-medium text-slate-500">Tanda Tangan</span>
                  <a
                    href={`https://drive.google.com/drive/folders/${driveFolderId}`}
                    target="_blank"
                    rel="no-referrer"
                    className="text-emerald-600 font-semibold hover:underline flex items-center gap-0.5"
                  >
                    Buka Folder <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                </div>
              </div>
              <div className="flex items-center justify-between text-[10.5px] mt-2 border-t border-slate-50 pt-1.5">
                <span className="font-bold text-slate-400 select-none">TOTAL HADIR</span>
                <span className="font-extrabold text-slate-800">{stats.totalCount} Orang</span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Visual Analytics Charts */}
      {attendees.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Trend Time Plot */}
          <div className="bg-white rounded-xl border border-slate-150/60 shadow-sm p-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
                <CalendarCheck2 className="w-4 h-4 text-emerald-600" /> Analisis Waktu & Tren Hadir Real-Time
              </h3>
              
              <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200/80 text-[10.5px] font-semibold self-start sm:self-auto shadow-xs">
                <button
                  type="button"
                  onClick={() => setTrendViewType("cumulative")}
                  className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                    trendViewType === "cumulative" 
                      ? "bg-white text-emerald-700 shadow-xs" 
                      : "text-slate-500 hover:text-slate-850"
                  }`}
                >
                  Realtime (Kumulatif)
                </button>
                <button
                  type="button"
                  onClick={() => setTrendViewType("hour")}
                  className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                    trendViewType === "hour" 
                      ? "bg-white text-emerald-750 shadow-xs" 
                      : "text-slate-500 hover:text-slate-850"
                  }`}
                >
                  Per Jam
                </button>
                <button
                  type="button"
                  onClick={() => setTrendViewType("minute")}
                  className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                    trendViewType === "minute" 
                      ? "bg-white text-emerald-750 shadow-xs" 
                      : "text-slate-500 hover:text-slate-850"
                  }`}
                >
                  Menit ke Menit
                </button>
              </div>
            </div>

            <div className="h-64 w-full text-xs">
              <ResponsiveContainer width="100%" height="100%">
                {trendViewType === "cumulative" ? (
                  <AreaChart data={stats.cumulative || []} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorCumulative" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="time" stroke="#94a3b8" />
                    <YAxis stroke="#94a3b8" allowDecimals={false} />
                    <Tooltip 
                      contentStyle={{ fontSize: "11px", borderRadius: "8px", border: "1px solid #e2e8f0" }}
                      formatter={(value) => [`${value} Orang`, "Total Terakumulasi"]}
                    />
                    <Area type="monotone" dataKey="total" name="Total Hadir" stroke="#10b981" strokeWidth={2.5} fillOpacity={1} fill="url(#colorCumulative)" />
                  </AreaChart>
                ) : trendViewType === "hour" ? (
                  <BarChart data={stats.hourly || []} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="hour" stroke="#94a3b8" />
                    <YAxis stroke="#94a3b8" allowDecimals={false} />
                    <Tooltip 
                      contentStyle={{ fontSize: "11px", borderRadius: "8px", border: "1px solid #e2e8f0" }}
                      formatter={(value) => [`${value} Orang`, "Jumlah Check-in"]}
                    />
                    <Bar dataKey="count" name="Jumlah Peserta" fill="#059669" radius={[4, 4, 0, 0]} barSize={35} />
                  </BarChart>
                ) : (
                  <AreaChart data={stats.timeline} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorArrival" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="time" stroke="#94a3b8" />
                    <YAxis stroke="#94a3b8" allowDecimals={false} />
                    <Tooltip contentStyle={{ fontSize: "11px", borderRadius: "8px", border: "1px solid #e2e8f0" }} />
                    <Area type="monotone" dataKey="count" name="Jumlah Peserta" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorArrival)" />
                  </AreaChart>
                )}
              </ResponsiveContainer>
            </div>
          </div>

          {/* Org Breakdown Plot */}
          <div className="bg-white rounded-xl border border-slate-150/60 shadow-sm p-5">
            <h3 className="text-sm font-semibold text-slate-800 mb-4 flex items-center gap-1.5">
              <School className="w-4 h-4 text-blue-600" /> Kontribusi Asal Institusi / Instansi Teratas
            </h3>
            <div className="h-64 w-full text-xs">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.byInstitution} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="name" stroke="#94a3b8" tickFormatter={(v) => v.length > 8 ? `${v.substring(0,8)}...` : v} />
                  <YAxis stroke="#94a3b8" allowDecimals={false} />
                  <Tooltip contentStyle={{ fontSize: "11px", borderRadius: "8px", border: "1px solid #e2e8f0" }} />
                  <Bar dataKey="value" name="Total Orang" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={30} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Tren Kehadiran Panel - LineChart */}
          <div className="bg-white rounded-xl border border-slate-150/60 shadow-sm p-5 lg:col-span-2">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
                  <Calendar className="w-4 h-4 text-indigo-600" /> Tren Kehadiran Peserta (Harian)
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Visualisasi tingkat partisipasi dan jumlah peserta yang hadir dari hari ke hari
                </p>
              </div>

              <div className="text-[11px] font-medium text-slate-500 bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-100">
                Total Hari Terdeteksi: <span className="font-bold text-slate-800">{(stats.dailyParticipation || []).length} Hari</span>
              </div>
            </div>

            <div className="h-64 w-full text-xs">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={stats.dailyParticipation || []} margin={{ top: 15, right: 20, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis 
                    dataKey="label" 
                    stroke="#94a3b8" 
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis 
                    stroke="#94a3b8" 
                    allowDecimals={false} 
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip 
                    contentStyle={{ fontSize: "11px", borderRadius: "8px", border: "1px solid #e2e8f0" }}
                    formatter={(value) => [`${value} Orang`, "Kehadiran"]}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="count" 
                    name="Peserta Hadir" 
                    stroke="#4f46e5" 
                    strokeWidth={3} 
                    activeDot={{ r: 7, strokeWidth: 0 }}
                    dot={{ stroke: '#4f46e5', strokeWidth: 2, r: 4, fill: '#fff' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* Main Table Grid and Data Exporters */}
      <div className="bg-white rounded-xl border border-slate-150/60 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-slate-800">Daftar Kehadiran Riil Peserta</h2>
            <span className="bg-emerald-50 text-emerald-800 font-medium px-2 py-0.5 rounded-full text-[10px] border border-emerald-100">
              {filteredAttendees.length} dari {stats.totalCount} Sesuai Filter
            </span>
          </div>

          <div className="flex flex-wrap gap-2 w-full md:w-auto items-center">
            {/* Search Input */}
            <div className="relative w-full md:w-72">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                <Search className="w-4 h-4 text-slate-400" />
              </div>
              <input
                type="text"
                placeholder="Cari nama, instansi, NIP, atau jabatan..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-8 py-2 border border-slate-200 bg-slate-50/50 hover:bg-white focus:bg-white rounded-xl text-xs focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 focus:outline-none transition-all duration-200 font-medium text-slate-700 placeholder-slate-400 shadow-sm"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                  title="Hapus Pencarian"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Export buttons */}
            <button
              onClick={exportToExcel}
              disabled={isExportingExcel || isExportingPdf}
              className={`bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all ${
                isExportingExcel ? "opacity-75 cursor-wait" : "hover:scale-[1.01] active:scale-[0.99] cursor-pointer"
              }`}
              title="Download format Excel"
            >
              {isExportingExcel ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              {isExportingExcel ? "Mengekspor..." : "Excel"}
            </button>
            <button
              onClick={() => setShowPdfOptions(true)}
              disabled={isExportingPdf || isExportingExcel}
              className={`bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200 px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                isExportingPdf ? "opacity-75 cursor-wait" : "hover:scale-[1.01] active:scale-[0.99] cursor-pointer"
              }`}
              title="Unduh Laporan PDF Cetak"
            >
              {isExportingPdf ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <FileDown className="w-3.5 h-3.5" />
              )}
              {isExportingPdf ? pdfProgressText || "Mengolah PDF..." : "Unduh Laporan PDF"}
            </button>
            <button
              onClick={() => exportToPdf(true)}
              disabled={isExportingPdf || isExportingExcel || filteredAttendees.length === 0}
              className={`bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all ${
                isExportingPdf ? "opacity-[0.80] cursor-wait" : "hover:scale-[1.01] active:scale-[0.99] cursor-pointer"
              } ${filteredAttendees.length === 0 ? "opacity-50 cursor-not-allowed" : ""}`}
              title="Cetak massal seluruh data peserta yang terfilter saat ini"
            >
              {isExportingPdf ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Printer className="w-3.5 h-3.5" />
              )}
              Cetak Massal ({filteredAttendees.length})
            </button>

            {/* Clean data button */}
            <button
              onClick={() => setShowConfirmClear(true)}
              className="bg-slate-100 text-slate-600 hover:bg-red-50 hover:text-red-700 border border-slate-250 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer flex items-center gap-1"
              title="Kosongkan Database Absensi"
            >
              <Trash2 className="w-3.5 h-3.5" /> Bersihkan
            </button>
          </div>
        </div>

        {/* Date Filter & Advanced Filters Row */}
        <div className="px-5 py-3.5 border-b border-slate-100 bg-slate-50/40 flex flex-col lg:flex-row lg:items-center justify-between gap-4 text-xs text-slate-600 transition-all duration-300">
          <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
            <span className="font-bold text-slate-700 flex items-center gap-1.5 shrink-0">
              <Filter className="w-3.5 h-3.5 text-indigo-600" />
              Filter Tanggal Kehadiran :
            </span>
            
            {/* Start Date */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-slate-500 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                Mulai:
              </span>
              <input
                type="date"
                value={startDateFilter}
                onChange={(e) => setStartDateFilter(e.target.value)}
                className="px-2.5 py-1.5 border border-slate-200 hover:border-slate-350 focus:border-indigo-500 bg-white rounded-xl text-xs focus:ring-4 focus:ring-indigo-100 focus:outline-none transition-all duration-200 text-slate-700 font-semibold shadow-sm cursor-pointer"
              />
            </div>

            {/* End Date */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-slate-500 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                Sampai:
              </span>
              <input
                type="date"
                value={endDateFilter}
                onChange={(e) => setEndDateFilter(e.target.value)}
                className="px-2.5 py-1.5 border border-slate-200 hover:border-slate-350 focus:border-indigo-500 bg-white rounded-xl text-xs focus:ring-4 focus:ring-indigo-100 focus:outline-none transition-all duration-200 text-slate-700 font-semibold shadow-sm cursor-pointer"
              />
            </div>

            {/* Reset Button */}
            {(startDateFilter || endDateFilter) && (
              <button
                type="button"
                onClick={() => {
                  setStartDateFilter("");
                  setEndDateFilter("");
                }}
                className="bg-rose-50 hover:bg-rose-100 text-rose-600 hover:text-rose-700 border border-rose-100 hover:border-rose-200 px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer transition-all duration-200 flex items-center gap-1 shadow-sm shrink-0 font-mono text-[10.5px]"
                title="Hapus filter tanggal"
              >
                <X className="w-3 h-3" /> Hapus Filter Tanggal
              </button>
            )}
          </div>

          {/* Quick presets */}
          <div className="flex flex-wrap items-center gap-1.5 select-none self-start lg:self-auto shrink-0">
            <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold mr-1">Preset Cepat:</span>
            <button
              type="button"
              onClick={() => {
                const todayStr = new Date().toLocaleDateString("sv-SE"); // Returns YYYY-MM-DD locally
                setStartDateFilter(todayStr);
                setEndDateFilter(todayStr);
              }}
              className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-100 px-3 py-1.5 rounded-xl text-[10.5px] font-bold cursor-pointer transition-all duration-200"
            >
              Hari Ini
            </button>
            <button
              type="button"
              onClick={() => {
                const now = new Date();
                const day = now.getDay();
                const monday = new Date(now);
                monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
                const mondayStr = monday.toLocaleDateString("sv-SE");
                const sunday = new Date(monday);
                sunday.setDate(monday.getDate() + 6);
                const sundayStr = sunday.toLocaleDateString("sv-SE");

                setStartDateFilter(mondayStr);
                setEndDateFilter(sundayStr);
              }}
              className="bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 px-3 py-1.5 rounded-xl text-[10.5px] font-bold cursor-pointer transition-all duration-200"
            >
              Minggu Ini
            </button>
          </div>
        </div>

        {/* Data list view */}
        {isLoading && attendees.length === 0 ? (
          <div className="py-20 text-center text-slate-400 space-y-2">
            <RefreshCw className="w-8 h-8 animate-spin mx-auto text-emerald-600" />
            <p className="text-xs">Mengunduh baris data dari Google Spreadsheet...</p>
          </div>
        ) : filteredAttendees.length === 0 ? (
          <div className="py-20 text-center text-slate-400">
            <Info className="w-8 h-8 mx-auto mb-2 text-slate-330" />
            <p className="text-xs font-semibold">Belum Menemukan Data Peserta</p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {attendees.length === 0 
                ? "Gunakan formulir atau aktifkan sesi absen mandiri untuk mengisi data." 
                : "Tidak ada baris data yang cocok dengan kriteria pencarian Anda."}
            </p>
          </div>
        ) : (
          <div>
            {/* Unified Wide Data Table (Smooth horizontal scrolling on all screen sizes) */}
            <div className="overflow-x-auto w-full">
              <table className="w-full text-left border-collapse min-w-[800px]">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100 text-[11px] uppercase tracking-wider font-semibold text-slate-500">
                    <th className="py-3 px-4 w-12 text-center">No</th>
                    <th className="py-3 px-4">Nama Lengkap</th>
                    <th className="py-3 px-4 w-36">NIP</th>
                    <th className="py-3 px-4">Instansi</th>
                    <th className="py-3 px-4 text-slate-500">Jabatan</th>
                    <th className="py-3 px-4 w-36">Check-In</th>
                    <th className="py-3 px-4 w-28 text-center">Tandatangan</th>
                    <th className="py-3 px-4 w-24 text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
                  <AnimatePresence initial={false}>
                    {filteredAttendees.map((a, idx) => {
                      const rowKey = `${(a.nip || "").trim().toLowerCase()}_${(a.name || "").trim().toLowerCase()}`;
                      const isHighlighted = recentAttendeeKeys[rowKey] !== undefined;

                      return (
                        <motion.tr
                          key={a.nip + "-" + idx}
                          initial={{ opacity: 0, y: 12 }}
                          animate={{ 
                            opacity: 1, 
                            y: 0,
                            backgroundColor: isHighlighted ? "rgba(16, 185, 129, 0.12)" : "rgba(255, 255, 255, 0)"
                          }}
                          exit={{ opacity: 0, y: -12 }}
                          layout="position"
                          transition={{ duration: 0.35, ease: "easeInOut" }}
                          className={`transition-all duration-700 ${
                            isHighlighted 
                              ? "border-l-4 border-l-emerald-500 text-emerald-950 dark:text-emerald-100 font-medium shadow-xs" 
                              : "hover:bg-slate-50/50"
                          }`}
                        >
                          <td className="py-2.5 px-4 text-center font-medium text-slate-400">
                            {isHighlighted ? (
                              <span className="inline-flex items-center justify-center bg-emerald-500 text-white text-[9px] font-extrabold px-1.5 py-0.5 rounded-sm animate-pulse">
                                BARU
                              </span>
                            ) : (
                              idx + 1
                            )}
                          </td>
                        <td className="py-2.5 px-4">
                          <button
                            type="button"
                            onClick={() => setSelectedProfileAttendee(a)}
                            className="font-bold text-slate-800 hover:text-indigo-600 hover:underline transition-all duration-150 text-left cursor-pointer flex items-center gap-1 group/name"
                            title="Klik untuk melihat profil & statistik lengkap"
                          >
                            <span>{a.name}</span>
                            <ChevronRight className="w-3 h-3 opacity-0 group-hover/name:opacity-100 group-hover/name:translate-x-0.5 text-indigo-500 transition-all duration-150" />
                          </button>
                        </td>
                        <td className="py-2.5 px-4 font-mono text-[10.5px] text-slate-600">{a.nip}</td>
                        <td className="py-2.5 px-4 text-slate-600">{a.instansi}</td>
                        <td className="py-2.5 px-4 text-slate-600">{a.jabatan}</td>
                        <td className="py-2.5 px-4 font-mono text-[10.5px] text-slate-500">{a.checkInTime}</td>
                        <td className="py-2 px-4 text-center">
                          {a.signatureUrl ? (
                            <div className="inline-block">
                              <img
                                src={a.signatureUrl}
                                alt="Tanda Tangan"
                                className="max-h-10 max-w-[100px] object-contain mx-auto border border-slate-150 rounded-lg bg-white p-0.5 shadow-xs hover:shadow-md hover:scale-105 transition-all duration-205 cursor-zoom-in active:scale-95"
                                onClick={() => setSelectedSignature(a.signatureUrl)}
                                referrerPolicy="no-referrer"
                                onError={(e) => {
                                  const target = e.currentTarget;
                                  target.style.display = "none";
                                  const parent = target.parentElement;
                                  if (parent) {
                                    const btn = document.createElement("button");
                                    btn.className = "px-1.5 py-0.5 bg-slate-100 text-slate-600 hover:bg-slate-250 border border-slate-200 text-[10px] rounded font-semibold cursor-pointer transition";
                                    btn.innerText = "Lihat TTD";
                                    btn.onclick = () => setSelectedSignature(a.signatureUrl);
                                    parent.appendChild(btn);
                                  }
                                }}
                              />
                            </div>
                          ) : (
                            <span className="text-xs italic text-slate-400">Tidak ada</span>
                          )}
                        </td>
                        <td className="py-2 px-4 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => handleStartEdit(a)}
                              title="Edit Data"
                              className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition duration-200 cursor-pointer"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setDeletingAttendee(a)}
                              title="Hapus Data"
                              className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition duration-200 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </motion.tr>
                    );
                    })}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Participant Profile & Statistics Modal */}
      {selectedProfileAttendee && (() => {
        const p = selectedProfileAttendee;
        // Calculate dynamic personal stats safely
        const sameInst = attendees.filter(x => x.instansi === p.instansi).length;
        const totalCount = attendees.length || 1;
        const pctSameInst = Math.round((sameInst / totalCount) * 100);
        
        // Find check-in sequence number
        const chronologicallySorted = [...attendees].sort((a, b) => {
          return new Date(a.checkInTime).getTime() - new Date(b.checkInTime).getTime();
        });
        const sequenceIndex = chronologicallySorted.findIndex(x => x.nip === p.nip) + 1;
        const nthLabel = sequenceIndex > 0 ? `Peserta Ke-${sequenceIndex}` : "Selesai Terdaftar";
        
        // Calculate status badge based on entry hour
        let checkInHour = 8; // fallback
        try {
          const timePart = p.checkInTime.split(" ")[1];
          if (timePart) {
            checkInHour = parseInt(timePart.split(":")[0], 10);
          }
        } catch (e) {}

        const isEarly = checkInHour < 9;
        const timeBadgeText = isEarly ? "Hadir Awal (Tepat Waktu)" : "Hadir Normal";

        // Assign honorary titles/badges
        let rankTitle = "Utusan Khusus";
        if (sequenceIndex === 1) rankTitle = "Pionir Kehadiran (Ke-1)";
        else if (sequenceIndex <= 5) rankTitle = "Early Bird Prioritas";
        else if (sameInst > 5 && p.jabatan?.toLowerCase().includes("pimpinan")) rankTitle = "Senior Delegat";
        else if (p.jabatan?.toLowerCase().includes("kepala") || p.jabatan?.toLowerCase().includes("kabag") || p.jabatan?.toLowerCase().includes("kasi")) rankTitle = "Pimpinan Delegasi";
        else if (sameInst > 3) rankTitle = "Perwakilan Utama";

        const initials = p.name ? p.name.trim().split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase() : "P";

        return (
          <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4 backdrop-blur-xs">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl relative border border-slate-150"
            >
              {/* Modal Header banner with solid modern color */}
              <div className="bg-gradient-to-r from-slate-900 via-indigo-900 to-slate-900 p-6 text-white relative">
                <button
                  type="button"
                  onClick={() => setSelectedProfileAttendee(null)}
                  className="absolute top-4 right-4 p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-all duration-200 cursor-pointer border-0"
                  title="Tutup Panel"
                >
                  <X className="w-4 h-4" />
                </button>
                <div className="flex items-center gap-4">
                  {/* High contrast initials avatar */}
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-amber-400 to-indigo-500 flex items-center justify-center text-white font-black text-lg shadow-md shrink-0 border-2 border-white/25">
                    {initials}
                  </div>
                  <div className="space-y-0.5 truncate">
                    <span className="bg-amber-400 text-slate-950 text-[9px] font-black px-2 py-0.5 rounded-sm uppercase tracking-wide">
                      {rankTitle}
                    </span>
                    <h3 className="text-base font-bold truncate leading-tight mt-1">{p.name}</h3>
                    <p className="text-[11px] text-slate-300 font-mono tracking-wider">{p.nip || "NIP Belum Diisi"}</p>
                  </div>
                </div>
              </div>

              {/* Modal Body scrollable area */}
              <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto text-slate-700">
                {/* 1. Core Profile Details Grid */}
                <div className="space-y-3">
                  <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
                    <User className="w-3.5 h-3.5 text-indigo-600" /> Informasi Pribadi & Tugas
                  </h4>
                  <div className="bg-slate-50 border border-slate-200/85 rounded-xl p-3.5 grid grid-cols-2 gap-x-4 gap-y-3.5">
                    <div className="space-y-0.5">
                      <span className="text-[10px] text-slate-400 font-semibold block uppercase">Nama Lengkap</span>
                      <span className="text-xs font-bold text-slate-700 block">{p.name || "-"}</span>
                    </div>
                    <div className="space-y-0.5">
                      <span className="text-[10px] text-slate-400 font-semibold block uppercase">Nomor Induk Pegawai (NIP)</span>
                      <span className="text-xs font-bold font-mono text-slate-700 block">{p.nip || "-"}</span>
                    </div>
                    <div className="space-y-0.5">
                      <span className="text-[10px] text-slate-400 font-semibold block uppercase">Instansi Satuan Kerja</span>
                      <span className="text-xs font-bold text-slate-700 block">{p.instansi || "-"}</span>
                    </div>
                    <div className="space-y-0.5">
                      <span className="text-[10px] text-slate-400 font-semibold block uppercase">Jabatan Struktural / Peran</span>
                      <span className="text-xs font-bold text-slate-700 block">{p.jabatan || "-"}</span>
                    </div>
                    <div className="space-y-0.5 col-span-2 border-t border-slate-200/50 pt-2.5">
                      <span className="text-[10px] text-slate-400 font-semibold block uppercase">Alamat Email Kerja</span>
                      <span className="text-xs font-semibold text-slate-600 block">{p.email || "-"}</span>
                    </div>
                  </div>
                </div>

                {/* 2. Statistical Metrics Benchmarking Cards */}
                <div className="space-y-3">
                  <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
                    <TrendingUp className="w-3.5 h-3.5 text-indigo-600" /> Analisis Kehadiran & Statistik Kontribusi
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="bg-slate-50 border border-slate-200/85 rounded-xl p-3 space-y-1">
                      <span className="text-[9px] text-slate-400 font-bold block uppercase leading-tight">Urutan Masuk</span>
                      <span className="text-xs font-extrabold text-slate-700 block">{nthLabel}</span>
                      <span className="text-[9px] text-indigo-600 block font-semibold leading-tight">
                        Dari {totalCount} total pendaftar
                      </span>
                    </div>

                    <div className="bg-slate-50 border border-slate-200/85 rounded-xl p-3 space-y-1">
                      <span className="text-[9px] text-slate-400 font-bold block uppercase leading-tight">Status Waktu</span>
                      <span className="text-xs font-extrabold text-slate-700 block text-ellipsis truncate">{timeBadgeText}</span>
                      <span className="text-[9px] text-slate-400 block font-semibold leading-tight">
                        Jam: {p.checkInTime.split(" ")[1] || "08:00"}
                      </span>
                    </div>

                    <div className="bg-slate-50 border border-slate-200/85 rounded-xl p-3 space-y-1">
                      <span className="text-[9px] text-slate-400 font-bold block uppercase leading-tight">Kontribusi Instansi</span>
                      <span className="text-xs font-extrabold text-slate-700 block">{sameInst} Orang ({pctSameInst}%)</span>
                      <span className="text-[9px] text-slate-400 block font-semibold leading-tight">
                        Mengirim delegasi terbanyak
                      </span>
                    </div>
                  </div>
                </div>

                {/* 3. Digital Signature Verified Canvas Area */}
                <div className="space-y-3">
                  <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" /> Lembar Tanda Tangan Digital Terverifikasi
                  </h4>
                  <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex flex-col items-center justify-center min-h-[120px] relative overflow-hidden">
                    {p.signatureUrl ? (
                      <>
                        <img 
                          src={p.signatureUrl} 
                          alt={`Tanda Tangan ${p.name}`} 
                          className="max-h-[85px] object-contain select-none bg-white p-1 rounded-lg border border-slate-200"
                          referrerPolicy="no-referrer"
                        />
                        <div className="absolute right-3.5 bottom-3 text-[9px] px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md font-bold uppercase tracking-wider flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          Terverifikasi Aman
                        </div>
                      </>
                    ) : (
                      <span className="text-xs italic text-slate-400">Tanda tangan kosong atau tersemat offline</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Modal Footer with interactive buttons */}
              <div className="bg-slate-50 border-t border-slate-100 p-4 flex justify-between items-center">
                <span className="text-[10px] text-slate-400 font-mono">
                  Mendaftar pada: {p.checkInTime}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedProfileAttendee(null)}
                  className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-all duration-150 pointer-events-auto cursor-pointer active:scale-95 shadow-xs border-0"
                >
                  Tutup Profil
                </button>
              </div>
            </motion.div>
          </div>
        );
      })()}

      {/* Signature viewer modal */}
      {selectedSignature && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl relative">
            <h3 className="text-sm font-bold text-slate-850 mb-3 border-b border-slate-100 pb-2">Pratinjau Tanda Tangan</h3>
            
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex items-center justify-center min-h-[160px] overflow-hidden my-4">
              <img 
                src={selectedSignature} 
                alt="Digital Signature preview" 
                className="max-h-[140px] object-contain select-none"
                referrerPolicy="no-referrer"
                onError={(e) => {
                  // Fallback if direct thumbnail rendering meets CORS or access issues
                  const target = e.currentTarget;
                  target.style.display = "none";
                  const container = target.parentElement;
                  if (container) {
                    const errorMsg = document.createElement("div");
                    errorMsg.className = "text-center text-[10px] text-gray-400 p-4 leading-relaxed";
                    errorMsg.innerHTML = `Tidak dapat memuat pratinjau langsung.<br/>Silakan klik ttd di Spreadsheet Google melalui tombol "Buka Excel" di atas.`;
                    container.appendChild(errorMsg);
                  }
                }}
              />
            </div>

            <div className="flex gap-2 justify-end mt-4">
              <button
                onClick={() => setSelectedSignature(null)}
                className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-semibold cursor-pointer hover:bg-slate-800 transition"
              >
                Tutup jendela
              </button>
            </div>
          </div>
        </div>
      )}

      {/* QR code modal for public checkin */}
      {showQrModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl text-center">
            <h3 className="text-base font-bold text-slate-900 mb-2">QR Code Pengisian Mandiri</h3>
            <p className="text-xs text-slate-500 mb-4 px-2">
              Peserta dapat memindai (scan) kode QR di bawah menggunakan smartphone untuk mengisikan absensi mandiri + tanda tangan.
            </p>

            <div className="bg-slate-50 border border-slate-200 p-5 rounded-2xl inline-block shadow-inner mb-4">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(publicUrl)}`}
                alt="QR Code public presence portal"
                className="w-[200px] h-[200px] mx-auto select-none"
              />
              <div className="mt-2 text-[11px] font-mono font-semibold text-slate-600 truncate max-w-[240px]">
                {publicUrl}
              </div>
            </div>

            <div className="flex gap-2 justify-center mt-2">
              <button
                onClick={() => setShowQrModal(false)}
                className="px-6 py-2.5 bg-slate-900 text-white rounded-xl text-xs font-bold cursor-pointer hover:bg-slate-800 transition"
              >
                Tutup QR
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Truncate confirm modal */}
      {showConfirmClear && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-rose-100">
            <h3 className="text-base font-bold text-slate-900 mb-2 flex items-center gap-1.5">
              <ShieldAlert className="w-5 h-5 text-rose-600" /> PERHATIAN: Tindakan Destruktif
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed mb-4">
              Apakah Anda benar-benar ingin menghapus **SEMUA** data absensi dari Google Spreadsheet?<br />
              Tindakan ini tidak bisa dibatalkan tetapi header kolom akan dipertahankan.
            </p>

            <div className="bg-rose-50 border border-rose-100 p-3 rounded-xl text-xs text-rose-700 font-medium mb-4 flex items-center gap-2">
              <Info className="w-4 h-4 flex-shrink-0" />
              <span>Untuk melanjutkan, ketik kata kunci <strong>HAPUS</strong> di bawah ini:</span>
            </div>

            <input
              type="text"
              required
              placeholder="Ketik HAPUS di sini..."
              value={clearConfirmationText}
              onChange={(e) => setClearConfirmationText(e.target.value)}
              className="w-full px-3.5 py-2 border border-slate-300 rounded-xl text-xs mb-6 focus:ring-1 focus:ring-rose-500 focus:outline-none uppercase font-bold text-center"
            />

            <div className="flex gap-2.5 justify-end">
              <button
                type="button"
                onClick={() => {
                  setShowConfirmClear(false);
                  setClearConfirmationText("");
                }}
                className="px-4 py-2 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-xl text-xs font-medium cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleClearSpreadsheet}
                className="px-4 py-2 bg-rose-600 text-white hover:bg-rose-700 rounded-xl text-xs font-bold cursor-pointer transition flex items-center gap-1"
              >
                Saya Yakin, Hapus Semua
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Attendee Modal */}
      {editingAttendee && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-150">
            <h3 className="text-sm font-bold text-slate-800 mb-4 pb-2 border-b border-slate-100 flex items-center gap-2">
              <Pencil className="w-4 h-4 text-emerald-500" />
              Edit Data Peserta
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Nama Lengkap <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 focus:outline-none transition bg-slate-50/50 font-medium font-sans"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  NIP <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={editNip}
                  onChange={(e) => setEditNip(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 focus:outline-none transition bg-slate-50/50 font-medium font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Instansi <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={editInstansi}
                  onChange={(e) => setEditInstansi(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 focus:outline-none transition bg-slate-50/50 font-medium font-sans"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Jabatan <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={editJabatan}
                  onChange={(e) => setEditJabatan(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 focus:outline-none transition bg-slate-50/50 font-medium font-sans"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Alamat Email (Opsional)
                </label>
                <input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 focus:outline-none transition bg-slate-50/50 font-medium font-sans"
                />
              </div>
            </div>

            <div className="flex gap-2.5 justify-end mt-6 font-sans">
              <button
                type="button"
                onClick={() => setEditingAttendee(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-medium cursor-pointer transition"
                disabled={isSavingEdit}
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                disabled={isSavingEdit}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold cursor-pointer transition flex items-center gap-1.5"
              >
                {isSavingEdit ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Menyimpan...
                  </>
                ) : (
                  "Simpan Perubahan"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Attendee Confirmation Modal */}
      {deletingAttendee && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-rose-100">
            <h3 className="text-sm font-bold text-slate-900 mb-2 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-rose-600" />
              Hapus Data Peserta
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed mb-4 font-sans">
              Apakah Anda yakin ingin menghapus data absensi peserta <strong>{deletingAttendee.name}</strong> dari Google Spreadsheet?<br />
              Tindakan ini tidak dapat dibatalkan.
            </p>

            <div className="flex gap-2.5 justify-end font-sans">
              <button
                type="button"
                onClick={() => setDeletingAttendee(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-medium cursor-pointer transition"
                disabled={isDeleting}
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleDeleteAttendee}
                disabled={isDeleting}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold cursor-pointer transition flex items-center gap-1.5"
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Menghapus...
                  </>
                ) : (
                  "Ya, Hapus Data"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PDF Options Scope Chooser Modal */}
      {showPdfOptions && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <FileDown className="w-5 h-5 text-indigo-600" />
                Pilihan Unduh Laporan PDF
              </h3>
              <button 
                onClick={() => setShowPdfOptions(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <p className="text-xs text-slate-500 leading-relaxed mb-5">
              Silakan tentukan cakupan baris data kehadiran yang ingin Anda ekspor ke dalam dokumen PDF resmi RSUD Dr. H. Jusuf SK.
            </p>

            <div className="flex flex-col gap-3 mb-6">
              {/* Option 1: Filtered results */}
              <button
                type="button"
                onClick={() => {
                  setShowPdfOptions(false);
                  exportToPdf(true);
                }}
                disabled={filteredAttendees.length === 0}
                className={`text-left p-4 rounded-xl border transition flex items-start gap-3.5 hover:scale-[1.01] ${
                  searchQuery 
                    ? "border-emerald-205 bg-emerald-50/40 hover:bg-emerald-50/80 hover:border-emerald-300 cursor-pointer" 
                    : "border-slate-100 bg-slate-50/50 hover:bg-slate-50 hover:border-slate-200 cursor-pointer text-slate-600"
                }`}
              >
                <div className={`p-2 rounded-lg ${searchQuery ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"} flex-shrink-0 mt-0.5`}>
                  <Search className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-xs text-slate-900">Sesuai Filter Pencarian</span>
                    <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold ${searchQuery ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"}`}>
                      {filteredAttendees.length} Peserta
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                    Hanya mengunduh data peserta yang aktif dicari / terfilter saat ini.
                  </p>
                </div>
              </button>

              {/* Option 2: All results */}
              <button
                type="button"
                onClick={() => {
                  setShowPdfOptions(false);
                  exportToPdf(false);
                }}
                disabled={attendees.length === 0}
                className="text-left p-4 rounded-xl border border-indigo-100 bg-indigo-50/30 hover:bg-indigo-50/70 hover:border-indigo-200 transition flex items-start gap-3.5 cursor-pointer hover:scale-[1.01]"
              >
                <div className="p-2 rounded-lg bg-indigo-100 text-indigo-700 flex-shrink-0 mt-0.5">
                  <Users className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-xs text-slate-900">Semua Data Daftar Hadir</span>
                    <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-800 rounded-full text-[9px] font-bold">
                      {attendees.length} Peserta
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                    Mengunduh seluruh baris data daftar hadir tanpa memedulikan filter pencarian.
                  </p>
                </div>
              </button>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={() => setShowPdfOptions(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold cursor-pointer transition"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Session Toggle Confirmation Modal */}
      {showConfirmToggleSession && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-slate-100 font-sans">
            <h3 className="text-sm font-bold text-slate-900 mb-2 flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-indigo-600" />
              Ubah Status Sesi Absensi
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed mb-5">
              Apakah Anda yakin ingin <strong>{isSessionActive ? "MENUTUP" : "MEMBUKA"}</strong> sesi absensi kehadiran digital?<br /><br />
              {isSessionActive 
                ? "Menutup sesi akan menghentikan pengisian absensi baru dari perangkat HP/Smartphone peserta secara langsung." 
                : "Membuka sesi akan mengizinkan pengisian absensi dari perangkat HP/Smartphone peserta secara seketika berdasarkan koordinat lokasi dan QR Code."
              }
            </p>

            <div className="flex gap-2.5 justify-end">
              <button
                type="button"
                onClick={() => setShowConfirmToggleSession(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-medium cursor-pointer transition select-none"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowConfirmToggleSession(false);
                  handleToggleSession();
                }}
                className={`px-4 py-2 text-white rounded-xl text-xs font-bold cursor-pointer transition select-none ${
                  isSessionActive ? "bg-amber-600 hover:bg-amber-700 shadow-sm shadow-amber-500/20" : "bg-emerald-600 hover:bg-emerald-700 shadow-sm shadow-emerald-500/20"
                }`}
              >
                {isSessionActive ? "Ya, Tutup Sesi" : "Ya, Buka Sesi"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast notifications container */}
      <div className="fixed bottom-5 right-5 z-55 flex flex-col gap-3 max-w-sm w-full pointer-events-none">
        <AnimatePresence>
          {toasts.map((toast) => {
            let typeClasses = "bg-slate-900 border-slate-800 text-slate-100";
            if (toast.type === "success") {
              typeClasses = "bg-slate-900 border-l-4 border-l-emerald-500 border-y-slate-800 border-r-slate-800 text-emerald-50 shadow-lg shadow-emerald-950/20";
            } else if (toast.type === "error") {
              typeClasses = "bg-slate-900 border-l-4 border-l-rose-500 border-y-slate-800 border-r-slate-800 text-rose-50 shadow-lg shadow-rose-950/20";
            } else if (toast.type === "warning") {
              typeClasses = "bg-slate-900 border-l-4 border-l-amber-500 border-y-slate-800 border-r-slate-800 text-amber-50 shadow-lg shadow-amber-950/20";
            } else if (toast.type === "loading") {
              typeClasses = "bg-slate-900 border-l-4 border-l-sky-500 border-y-slate-800 border-r-slate-800 text-sky-50 shadow-lg shadow-sky-950/10";
            } else if (toast.type === "info") {
              typeClasses = "bg-slate-900 border-l-4 border-l-blue-500 border-y-slate-800 border-r-slate-800 text-slate-100 shadow-lg shadow-blue-950/10";
            }

            return (
              <motion.div
                key={toast.id}
                initial={{ opacity: 0, y: 30, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -20, scale: 0.95, transition: { duration: 0.15 } }}
                layout
                className={`pointer-events-auto w-full border rounded-xl shadow-xl px-4 py-3.5 flex items-center justify-between gap-3 text-xs overflow-hidden relative ${typeClasses}`}
              >
                <div className="flex items-center gap-2.5">
                  {toast.type === "loading" && (
                    <Loader2 className="w-4 h-4 text-sky-400 animate-spin flex-shrink-0" />
                  )}
                  {toast.type === "success" && (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  )}
                  {toast.type === "info" && (
                    <Info className="w-4 h-4 text-blue-400 flex-shrink-0" />
                  )}
                  {toast.type === "warning" && (
                    <ShieldAlert className="w-4 h-4 text-amber-500 flex-shrink-0" />
                  )}
                  {toast.type === "error" && (
                    <ShieldAlert className="w-4 h-4 text-rose-500 flex-shrink-0" />
                  )}
                  <span className="font-semibold text-[11.5px] leading-relaxed">{toast.message}</span>
                </div>
                
                {toast.type !== "loading" && (
                  <button
                    onClick={() => dismissToast(toast.id)}
                    className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-850/60 cursor-pointer transition flex-shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}

                {/* Progress bar accent line */}
                {toast.type === "loading" && (
                  <div className="absolute bottom-0 left-0 h-0.5 bg-sky-500 w-full animate-pulse" />
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
