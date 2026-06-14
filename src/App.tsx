import React, { useState, useEffect } from "react";
import { 
  motion, AnimatePresence 
} from "motion/react";
import { 
  User, CheckCircle2, ShieldAlert, Users, QrCode, ClipboardCheck, Sparkles, LogIn, ArrowRight
} from "lucide-react";
import AttendeeForm from "./components/AttendeeForm";
import DashboardAdmin from "./components/DashboardAdmin";
import { initAuth, googleSignIn, logout } from "./lib/auth";
import { User as FirebaseUser } from "firebase/auth";

type ViewMode = "form" | "admin";

export default function App() {
  const [viewMode, setViewMode] = useState<ViewMode>("form");
  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState(false);
  const [adminUser, setAdminUser] = useState<FirebaseUser | null>(null);
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [isPublicSessionActive, setIsPublicSessionActive] = useState(false);

  // Success ticket state (when participant completes draw signature + check-in)
  const [successTicket, setSuccessTicket] = useState<{
    id: string;
    name: string;
    checkInTime: string;
  } | null>(null);

  // 1. Fetch backend state to see if public/smartphone form is open
  const checkPublicSession = async () => {
    try {
      const res = await fetch("/api/session-status");
      const data = await res.json();
      setIsPublicSessionActive(data.active);
    } catch (err) {
      console.error("Failed to fetch public session status:", err);
    }
  };

  useEffect(() => {
    checkPublicSession();
    // Poll public session state every 8 seconds
    const statusInterval = setInterval(checkPublicSession, 8000);

    // 2. Initialize Firebase authentication listener
    const unsubscribe = initAuth(
      (user, token) => {
        setIsAdminLoggedIn(true);
        setAdminUser(user);
        setAdminToken(token);
        setIsPublicSessionActive(true); // If admin is logged in locally, session is active
      },
      () => {
        setIsAdminLoggedIn(false);
        setAdminUser(null);
        setAdminToken(null);
      }
    );

    return () => {
      unsubscribe();
      clearInterval(statusInterval);
    };
  }, []);

  // Handle Admin Google Sign-In
  const handleAdminLogin = async () => {
    try {
      const result = await googleSignIn();
      if (result) {
        setIsAdminLoggedIn(true);
        setAdminUser(result.user);
        setAdminToken(result.accessToken);
        setIsPublicSessionActive(true);
        // Switch view to Admin panel directly
        setViewMode("admin");
      }
    } catch (err) {
      console.error("Login failure:", err);
    }
  };

  // Handle Admin Log-Out
  const handleAdminLogout = async () => {
    const confirmLogout = window.confirm("Apakah Anda yakin ingin keluar dari akun Admin?");
    if (!confirmLogout) return;
    
    await logout();
    setIsAdminLoggedIn(false);
    setAdminUser(null);
    setAdminToken(null);
    setViewMode("form"); // Redirect back to form
    checkPublicSession();
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans flex flex-col transition-all duration-300">
      
      {/* Dynamic Deep Indigo Header styled precisely based on user UI specifications */}
      <header className="sticky top-0 z-40 bg-slate-900 border-b border-slate-950 px-4 md:px-8 py-3.5 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-md shadow-indigo-600/30">
            <ClipboardCheck className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-sm md:text-base font-extrabold text-white tracking-tight leading-none">AbsenKita</h1>
            <span className="inline-block text-[9px] text-indigo-300 font-semibold tracking-wider uppercase mt-1">Smart Presence System</span>
          </div>
        </div>

        {/* Tab switcher Controls / Quick Actions */}
        <div className="flex items-center gap-1.5 bg-slate-950/40 p-1 rounded-xl border border-white/5">
          <button
            onClick={() => {
              setViewMode("form");
              setSuccessTicket(null); // Close active success card
            }}
            className={`px-4 py-1.8 rounded-lg text-xs font-bold transition-all relative cursor-pointer flex items-center gap-1.5 ${
              viewMode === "form" 
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/20" 
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <User className="w-3.5 h-3.5" />
            Isi Absen
          </button>
          
          <button
            onClick={() => setViewMode("admin")}
            className={`px-4 py-1.8 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
              viewMode === "admin" 
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/20" 
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Dashboard Admin
            {isPublicSessionActive && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse self-center" title="Sesi publik aktif"></span>
            )}
          </button>
        </div>
      </header>

      {/* Main Container Stage */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-8 flex flex-col justify-center">
        <AnimatePresence mode="wait">
          {viewMode === "form" ? (
            <motion.div
              key="form-view"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="w-full"
            >
              {successTicket ? (
                /* Ticket success screen block - styled elegantly as a standard web modal card */
                <div className="max-w-md mx-auto my-6 bg-white rounded-3xl shadow-xl border border-slate-150 overflow-hidden text-center transition-all">
                  <div className="bg-emerald-600 p-6 text-white text-center flex flex-col items-center">
                    <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center mb-3">
                      <CheckCircle2 className="w-7 h-7 text-white" />
                    </div>
                    <h3 className="text-base font-bold">Presensi Berhasil Terdaftar</h3>
                    <p className="text-[10px] text-emerald-100 mt-0.5">ID: {successTicket.id}</p>
                  </div>
                  
                  <div className="p-5 space-y-4 text-left">
                    <div className="space-y-0.5">
                      <span className="text-[9px] text-slate-400 uppercase font-semibold tracking-wide">Nama Lengkap</span>
                      <p className="text-sm font-bold text-slate-800">{successTicket.name}</p>
                    </div>

                    <div className="space-y-0.5 border-t border-slate-100 pt-2.5">
                      <span className="text-[9px] text-slate-400 uppercase font-semibold tracking-wide">Waktu Registrasi</span>
                      <p className="text-xs font-mono font-semibold text-slate-600">{successTicket.checkInTime}</p>
                    </div>

                    <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-100 inline-block w-full text-center">
                      <p className="text-[10px] font-medium text-emerald-800 leading-relaxed">
                        Terima kasih! Kehadiran Anda telah direkam langsung ke Google Spreadsheet dan tanda tangan Anda aman tersimpan pada folder Google Drive.
                      </p>
                    </div>

                    <button
                      onClick={() => setSuccessTicket(null)}
                      className="w-full mt-2 bg-slate-900 hover:bg-slate-800 text-white font-bold py-2.5 px-4 rounded-xl text-xs transition flex items-center justify-center gap-1 cursor-pointer"
                    >
                      Kembali / Absen Orang Lain <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ) : (
                /* Elegant, clean full responsive form layout card (completely free of smartphone frame simulator restrictions) */
                <div className="max-w-2xl mx-auto my-4 bg-white rounded-3xl shadow-xl shadow-slate-100/50 border border-slate-150 overflow-hidden transition-all duration-300">
                  <div className="p-6 md:p-8">
                    <AttendeeForm 
                      onSuccess={(ticket) => setSuccessTicket(ticket)} 
                      sessionActive={isPublicSessionActive} 
                    />
                  </div>
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="admin-view"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="w-full"
            >
              {isAdminLoggedIn ? (
                /* Authenticated Dashboard Admin */
                <DashboardAdmin
                  accessToken={adminToken}
                  onLogin={handleAdminLogin}
                  onLogout={handleAdminLogout}
                />
              ) : (
                /* Auth login gate for admin */
                <div className="bg-white rounded-2xl shadow-xl shadow-slate-100/40 border border-slate-100 p-6 sm:p-8 max-w-sm mx-auto text-center my-6">
                  <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
                    <LogIn className="w-6 h-6" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 mb-1">Otoritas Admin</h3>
                  <p className="text-xs text-slate-400 leading-relaxed mb-6">
                    Akses dashboard terbatas. Silakan masuk (sign-in) dengan akun Google milik penyelenggara acara.
                  </p>
                  
                  <button
                    onClick={handleAdminLogin}
                    className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-3 px-4 rounded-xl text-xs transition flex items-center justify-center gap-1.5 shadow-md shadow-slate-900/10 cursor-pointer"
                  >
                    Masuk dengan Akun Google
                  </button>

                  {/* High fidelity Smartphone WebView & Popup helper tips */}
                  <div className="mt-6 text-left p-4 bg-amber-50/70 border border-amber-100 rounded-2xl space-y-2">
                    <h4 className="text-[11px] font-bold text-amber-800 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-amber-600 animate-pulse" />
                      Tips Akses HP / Smartphone:
                    </h4>
                    <p className="text-[10px] text-slate-600 leading-relaxed">
                      Sistem login Google Workspace memerlukan pemuatan jendela baru (redirect/popup). Jika login tidak merespon di HP Anda:
                    </p>
                    <ol className="list-decimal list-inside text-[9.5px] text-slate-500 space-y-1 leading-relaxed pl-1">
                      <li>
                        Jangan membukanya langsung dari dalam aplikasi chat seperti <strong>WhatsApp atau Telegram</strong> (In-App WebView biasanya memblokir autentikasi eksternal).
                      </li>
                      <li>
                        Ketuk ikon <strong>tiga titik</strong> di pojok kanan atas layar HP Anda, lalu pilih <strong>&quot;Buka di Browser&quot;</strong> atau <strong>&quot;Buka di Safari/Chrome&quot;</strong>.
                      </li>
                    </ol>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Humble Footer branding */}
      <footer className="py-5 border-t border-slate-150/50 bg-white text-center text-[10px] text-slate-450 mt-10">
        <p className="font-medium">AbsenKehadiran digital &middot; Google Workspace Cloud Integration</p>
        <p className="text-[9px] text-slate-400 mt-1">Google Sheets &amp; Drive Cloud Integration Active</p>
      </footer>
    </div>
  );
}
