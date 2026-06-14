import React, { useState, useEffect } from "react";
import { User, School, Hash, Mail, CheckCircle2, Loader2, Sparkles, AlertCircle, Briefcase } from "lucide-react";
import SignaturePad from "./SignaturePad";

interface AttendeeFormProps {
  onSuccess: (data: { id: string; name: string; checkInTime: string }) => void;
  sessionActive: boolean;
}

export default function AttendeeForm({ onSuccess, sessionActive }: AttendeeFormProps) {
  const [name, setName] = useState("");
  const [instansi, setInstansi] = useState("");
  const [nip, setNip] = useState("");
  const [jabatan, setJabatan] = useState("");
  const [email, setEmail] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Load cached form values on mount
  useEffect(() => {
    const cachedName = localStorage.getItem("absen_cached_name");
    const cachedInstansi = localStorage.getItem("absen_cached_instansi");
    const cachedNip = localStorage.getItem("absen_cached_nip");
    const cachedJabatan = localStorage.getItem("absen_cached_jabatan");
    const cachedEmail = localStorage.getItem("absen_cached_email");

    if (cachedName) setName(cachedName);
    if (cachedInstansi) setInstansi(cachedInstansi);
    if (cachedNip) setNip(cachedNip);
    if (cachedJabatan) setJabatan(cachedJabatan);
    if (cachedEmail) setEmail(cachedEmail);
  }, []);

  // Cache updates to local storage
  useEffect(() => {
    localStorage.setItem("absen_cached_name", name);
  }, [name]);

  useEffect(() => {
    localStorage.setItem("absen_cached_instansi", instansi);
  }, [instansi]);

  useEffect(() => {
    localStorage.setItem("absen_cached_nip", nip);
  }, [nip]);

  useEffect(() => {
    localStorage.setItem("absen_cached_jabatan", jabatan);
  }, [jabatan]);

  useEffect(() => {
    localStorage.setItem("absen_cached_email", email);
  }, [email]);

  // Clear specific local storage keys
  const clearLocalStorageCache = () => {
    localStorage.removeItem("absen_cached_name");
    localStorage.removeItem("absen_cached_instansi");
    localStorage.removeItem("absen_cached_nip");
    localStorage.removeItem("absen_cached_jabatan");
    localStorage.removeItem("absen_cached_email");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    // Form Validations
    if (!name.trim()) return setErrorMessage("Nama Lengkap wajib diisi.");
    if (!instansi.trim()) return setErrorMessage("Instansi wajib diisi.");
    if (!nip.trim()) return setErrorMessage("NIP wajib diisi.");
    if (!jabatan.trim()) return setErrorMessage("Jabatan wajib diisi.");
    if (!signature) return setErrorMessage("Tanda Tangan Digital wajib digambar.");

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/submit-attendance", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: name.trim(),
          instansi: instansi.trim(),
          nip: nip.trim(),
          jabatan: jabatan.trim(),
          email: email.trim(),
          signature,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Gagal mengirim data.");
      }

      // Clear local storage on success
      clearLocalStorageCache();

      // Trigger success screen
      onSuccess({
        id: result.data.id,
        name: result.data.name,
        checkInTime: result.data.checkInTime,
      });

      // Clear Form state keys for next person
      setName("");
      setInstansi("");
      setNip("");
      setJabatan("");
      setEmail("");
      setSignature(null);
    } catch (err: any) {
      console.error("Attendance submission client error:", err);
      setErrorMessage(err.message || "Koneksi terputus atau sesi admin tidak aktif. Silakan hubungi operator kegiatan.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!sessionActive) {
    return (
      <div className="bg-white rounded-2xl shadow-xl border border-rose-100 p-8 max-w-lg mx-auto text-center">
        <div className="w-16 h-16 bg-rose-50 text-rose-500 rounded-full flex items-center justify-center mx-auto mb-6">
          <AlertCircle className="w-8 h-8" />
        </div>
        <h3 className="text-xl font-bold text-gray-900 mb-2">Sesi Absensi Belum Aktif</h3>
        <p className="text-sm text-gray-500 leading-relaxed mb-6">
          Sesi pengisian absensi mandiri melalui smartphone belum diaktifkan oleh Admin. 
          Silakan hubungi panitia acara atau minta Admin untuk mengaktifkan sesi publik di dashboard terlebih dahulu.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full mx-auto px-1 py-2">
      <div className="text-center mb-5">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 mb-1.5 uppercase tracking-wide">
          <Sparkles className="w-3 h-3 animate-pulse" /> Sesi Absensi Aktif
        </span>
        <h2 className="text-xl font-extrabold text-slate-800 tracking-tight">Presensi Kehadiran</h2>
        <p className="text-[10px] text-slate-500 mt-0.5">Lengkapi formulir di bawah ini dengan lengkap untuk mendaftar</p>
      </div>

      {errorMessage && (
        <div className="p-4 mb-5 bg-rose-50 border border-rose-100 rounded-xl flex items-start gap-2.5 text-rose-700 text-sm">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <span>{errorMessage}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">
            Nama Lengkap <span className="text-rose-500">*</span>
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
              <User className="w-4 h-4" />
            </div>
            <input
              type="text"
              required
              placeholder="Contoh: Budi Santoso"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all bg-slate-50/50"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">
            NIP <span className="text-rose-500">*</span>
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
              <Hash className="w-4 h-4" />
            </div>
            <input
              type="text"
              required
              placeholder="Contoh: 198203112009031002"
              value={nip}
              onChange={(e) => setNip(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all bg-slate-50/50"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">
            Instansi <span className="text-rose-500">*</span>
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
              <School className="w-4 h-4" />
            </div>
            <input
              type="text"
              required
              placeholder="Contoh: Dinas Kesehatan / RSUD"
              value={instansi}
              onChange={(e) => setInstansi(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all bg-slate-50/50"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">
            Jabatan <span className="text-rose-500">*</span>
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
              <Briefcase className="w-4 h-4" />
            </div>
            <input
              type="text"
              required
              placeholder="Contoh: Kepala Seksi / Dokter Madya"
              value={jabatan}
              onChange={(e) => setJabatan(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all bg-slate-50/50"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">
            Alamat Email <span className="text-slate-400 text-xs font-normal">(Opsional)</span>
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
              <Mail className="w-4 h-4" />
            </div>
            <input
              type="email"
              placeholder="Contoh: alamat@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all bg-slate-50/50"
            />
          </div>
        </div>

        <div className="pt-2">
          <SignaturePad onChange={(base64) => setSignature(base64)} />
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full mt-6 bg-emerald-600 hover:bg-emerald-700 text-white font-medium py-3 px-4 rounded-xl text-sm transition-all focus:ring-4 focus:ring-emerald-100 flex items-center justify-center gap-2 cursor-pointer disabled:bg-emerald-400 disabled:cursor-not-allowed shadow-md shadow-emerald-600/10"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Memproses Kehadiran Anda...
            </>
          ) : (
            "Hadir & Kirim Absen"
          )}
        </button>
      </form>
    </div>
  );
}
