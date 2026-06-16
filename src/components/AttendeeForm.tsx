import React, { useState, useEffect } from "react";
import { User, School, Hash, Mail, CheckCircle2, Loader2, Sparkles, AlertCircle, Briefcase, ChevronRight, ChevronLeft, Check, FileText, PenTool } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import SignaturePad from "./SignaturePad";

interface AttendeeFormProps {
  onSuccess: (data: { id: string; name: string; checkInTime: string }) => void;
  sessionActive: boolean;
}

const slideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 40 : -40,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
    transition: {
      x: { type: "spring", stiffness: 380, damping: 30 },
      opacity: { duration: 0.2 },
    },
  },
  exit: (direction: number) => ({
    x: direction < 0 ? 40 : -40,
    opacity: 0,
    transition: {
      x: { type: "spring", stiffness: 380, damping: 30 },
      opacity: { duration: 0.15 },
    },
  }),
};

export default function AttendeeForm({ onSuccess, sessionActive }: AttendeeFormProps) {
  // Safe Image URL loader for ImgBB direct hosting with multiple candidate permutations
  const LOGO_CANDIDATES = [
    "https://i.ibb.co.com/pGQk2Hg/LOGO-KALIMANTAN-UTARA-koleksilogo-com-2.png",
    "https://i.ibb.co/pGQk2Hg/LOGO-KALIMANTAN-UTARA-koleksilogo-com-2.png",
    "https://ibb.co.com/w372ynT"
  ];
  const [logoIndex, setLogoIndex] = useState(0);
  const handleLogoError = () => {
    if (logoIndex < LOGO_CANDIDATES.length - 1) {
      setLogoIndex(prev => prev + 1);
    }
  };

  const [step, setStep] = useState(1);
  const [direction, setDirection] = useState(1); // 1 = forward, -1 = backward

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

  const validateStep1 = () => {
    setErrorMessage(null);
    if (!name.trim()) {
      setErrorMessage("Nama Lengkap wajib diisi.");
      return false;
    }
    if (!instansi.trim()) {
      setErrorMessage("Instansi wajib diisi.");
      return false;
    }
    if (!nip.trim()) {
      setErrorMessage("NIP wajib diisi.");
      return false;
    }
    if (!jabatan.trim()) {
      setErrorMessage("Jabatan wajib diisi.");
      return false;
    }
    return true;
  };

  const validateStep2 = () => {
    setErrorMessage(null);
    if (!signature) {
      setErrorMessage("Tanda Tangan Digital wajib digambar.");
      return false;
    }
    return true;
  };

  const handleNextToStep2 = () => {
    if (validateStep1()) {
      setDirection(1);
      setStep(2);
    }
  };

  const handleNextToStep3 = () => {
    if (validateStep2()) {
      setDirection(1);
      setStep(3);
    }
  };

  const handleBackToStep1 = () => {
    setErrorMessage(null);
    setDirection(-1);
    setStep(1);
  };

  const handleBackToStep2 = () => {
    setErrorMessage(null);
    setDirection(-1);
    setStep(2);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    // Final multi-step confirmation validations
    if (!validateStep1()) {
      setStep(1);
      return;
    }
    if (!validateStep2()) {
      setStep(2);
      return;
    }

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
      setStep(1);
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
    <div className="w-full">
      {/* Top Professional Header Banner */}
      <div 
        className="bg-indigo-950 px-6 py-8 md:px-8 text-white rounded-t-2xl relative overflow-hidden border-b border-indigo-900/40 bg-cover bg-center bg-no-repeat"
        style={{
          backgroundImage: `linear-gradient(to bottom, rgba(15, 23, 42, 0.82), rgba(15, 23, 42, 0.95)), url('https://i.ibb.co.com/5WkSVh9y/Gemini-Generated-Image-kvy41okvy41okvy4.png')`,
          height: '400px',
          paddingTop: '11px',
          paddingBottom: '5px',
          marginLeft: '0px',
          marginTop: '-4px',
          marginBottom: '0px'
        }}
      >
        {/* Subtle background abstract shapes */}
        <div className="absolute top-0 right-0 w-80 h-80 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute -bottom-10 -left-10 w-60 h-60 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none"></div>

        <div className="relative z-10 flex flex-col items-center sm:items-start text-center sm:text-left">
          {/* Glass-styled status badge */}
          <div className="mb-4">
            <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] font-bold bg-white/5 text-indigo-300 border border-white/10 uppercase tracking-widest backdrop-blur-md shadow-xs">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              Formulir Kehadiran Digital
            </span>
          </div>

          {/* Symmetrical / Responsive Brand and Greeting Layout */}
          <div className="flex flex-col sm:flex-row items-center gap-5 md:gap-6 w-full">
            <div className="relative group flex-shrink-0">
              {/* Backshadow glow for the logo */}
              <div className="absolute -inset-1.5 bg-indigo-500/20 rounded-full blur-lg group-hover:bg-indigo-500/35 transition-all duration-300"></div>
              <img 
                src={LOGO_CANDIDATES[logoIndex]} 
                onError={handleLogoError}
                alt="Logo Kalimantan Utara" 
                className="relative h-16 w-16 sm:h-20 sm:w-20 object-contain transition-all duration-300 hover:scale-[1.03]"
                referrerPolicy="no-referrer"
                id="header-brand-logo"
                style={{
                  width: '129px',
                  height: '197px',
                  marginLeft: '1px',
                  paddingTop: '27px',
                  paddingLeft: '1px',
                  paddingBottom: '-12px',
                  marginRight: '-3px',
                  marginBottom: '7px'
                }}
              />
            </div>
            
            <div className="hidden sm:block w-[1px] h-14 bg-white/10 self-center"></div>
            
            <div className="flex flex-col">
              <h2 
                className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white leading-tight drop-shadow-sm"
                style={{
                  width: '309px',
                  marginLeft: '-1px',
                  paddingTop: '11px',
                  paddingLeft: '0px',
                  paddingRight: '0px',
                  paddingBottom: '7px'
                }}
              >
                Selamat Datang!
              </h2>
              <p className="text-[10px] sm:text-xs text-indigo-300 font-bold tracking-widest uppercase mt-0.5">
                Sistem Absensi Kehadiran Digital
              </p>
              <p 
                className="text-[9px] sm:text-[10px] text-indigo-400 tracking-wide uppercase opacity-85"
                style={{
                  width: '311px',
                  height: '33px',
                  fontSize: '10px',
                  fontWeight: 'bold'
                }}
              >
                Provinsi Kalimantan Utara • RSUD Dr. H. Jusuf SK Kota Tarakan
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Progress Step Indicator */}
      <div 
        className="px-6 md:px-8 border-b border-slate-100"
        style={{
          marginRight: '2px',
          marginBottom: '4px',
          marginTop: '18px',
          marginLeft: '-1px',
          paddingTop: '11px',
          paddingLeft: '24px',
          paddingRight: '24px'
        }}
      >
        <div className="flex items-center justify-between max-w-sm mx-auto">
          {/* Step 1 */}
          <button 
            type="button"
            onClick={() => step > 1 && handleBackToStep1()}
            disabled={step === 1}
            className="flex flex-col items-center group cursor-pointer disabled:cursor-default"
          >
            <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs transition-all duration-350 ${
              step === 1 
                ? "bg-indigo-600 text-white ring-4 ring-indigo-100 shadow-md" 
                : step > 1 
                  ? "bg-emerald-500 text-white group-hover:bg-emerald-600" 
                  : "bg-slate-100 text-slate-400 border border-slate-200"
            }`}>
              {step > 1 ? <Check className="w-4 h-4" /> : "1"}
            </div>
            <span className={`text-[10px] font-bold mt-1.5 uppercase tracking-wider transition-colors duration-300 ${
              step === 1 ? "text-indigo-600" : "text-slate-400"
            }`}>Profil</span>
          </button>

          {/* Line 1 */}
          <div className="flex-1 h-0.5 bg-slate-100 mx-3 -mt-5">
            <div className="h-full bg-indigo-600 transition-all duration-350" style={{ width: step > 1 ? "100%" : "0%" }}></div>
          </div>

          {/* Step 2 */}
          <button 
            type="button"
            onClick={() => (step === 3 ? handleBackToStep2() : step === 1 && handleNextToStep2())}
            disabled={step === 2 || (step === 1 && !(name.trim() && instansi.trim() && nip.trim() && jabatan.trim()))}
            className="flex flex-col items-center group cursor-pointer disabled:cursor-default"
          >
            <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs transition-all duration-350 ${
              step === 2 
                ? "bg-indigo-600 text-white ring-4 ring-indigo-100 shadow-md" 
                : step > 2 
                  ? "bg-emerald-500 text-white group-hover:bg-emerald-600" 
                  : "bg-slate-100 text-slate-400 border border-slate-200"
            }`}>
              {step > 2 ? <Check className="w-4 h-4" /> : "2"}
            </div>
            <span className={`text-[10px] font-bold mt-1.5 uppercase tracking-wider transition-colors duration-300 ${
              step === 2 ? "text-indigo-600" : "text-slate-400"
            }`}>Tanda Tangan</span>
          </button>

          {/* Line 2 */}
          <div className="flex-1 h-0.5 bg-slate-100 mx-3 -mt-5">
            <div className="h-full bg-indigo-600 transition-all duration-350" style={{ width: step > 2 ? "100%" : "0%" }}></div>
          </div>

          {/* Step 3 */}
          <div className="flex flex-col items-center">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs transition-all duration-350 ${
              step === 3 
                ? "bg-indigo-600 text-white ring-4 ring-indigo-100 shadow-md" 
                : "bg-slate-100 text-slate-400 border border-slate-200"
            }`}>
              3
            </div>
            <span className={`text-[10px] font-bold mt-1.5 uppercase tracking-wider transition-colors duration-300 ${
              step === 3 ? "text-indigo-600" : "text-slate-400"
            }`}>Konfirmasi</span>
          </div>
        </div>
      </div>

      <div className="p-6 md:p-8">
        {errorMessage && (
          <div className="p-4 mb-5 bg-rose-50 border border-rose-100 rounded-xl flex items-start gap-2.5 text-rose-700 text-xs font-semibold">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-rose-500" />
            <span>{errorMessage}</span>
          </div>
        )}

        <AnimatePresence mode="wait" custom={direction}>
          {step === 1 && (
            <motion.div
              key="step-profile"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              className="space-y-4"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Nama Lengkap */}
                <div className="md:col-span-2">
                  <label 
                    className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 select-none"
                    style={{ paddingBottom: '1px', marginRight: '1px', marginLeft: '0px', marginTop: '-16px' }}
                  >
                    Nama Lengkap <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                      <User className="w-4 h-4 text-indigo-600" />
                    </div>
                    <input
                      type="text"
                      placeholder="Contoh: Budi Santoso, M.Kom"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all bg-white text-slate-800 placeholder-slate-400 font-medium font-sans"
                      style={{
                        width: '282px',
                        height: '40px',
                        marginLeft: '-3px',
                        marginRight: '-4px',
                        marginTop: '3px',
                        paddingTop: '8px',
                        paddingBottom: '9px',
                        paddingLeft: '34px',
                        fontSize: '12px',
                        lineHeight: '16px'
                      }}
                    />
                  </div>
                </div>

                {/* Instansi */}
                <div className="md:col-span-2">
                  <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 select-none">
                    Instansi / Universitas / Perusahaan <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                      <School className="w-4 h-4 text-indigo-600" />
                    </div>
                    <input
                      type="text"
                      placeholder="Contoh: Universitas Indonesia / Dinas Kesehatan / Umum"
                      value={instansi}
                      onChange={(e) => setInstansi(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all bg-white text-slate-800 placeholder-slate-400 font-medium font-sans"
                    />
                  </div>
                </div>

                {/* NIP */}
                <div className="col-span-1">
                  <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 select-none">
                    NIP <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                      <Hash className="w-4 h-4 text-indigo-600" />
                    </div>
                    <input
                      type="text"
                      placeholder="Contoh: 198203112009031002"
                      value={nip}
                      onChange={(e) => setNip(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all bg-white text-slate-800 placeholder-slate-400 font-mono font-medium"
                    />
                  </div>
                </div>

                {/* Jabatan */}
                <div className="col-span-1">
                  <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 select-none">
                    Jabatan <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                      <Briefcase className="w-4 h-4 text-indigo-600" />
                    </div>
                    <input
                      type="text"
                      placeholder="Contoh: Kepala Seksi / Dosen / Peserta"
                      value={jabatan}
                      onChange={(e) => setJabatan(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all bg-white text-slate-800 placeholder-slate-400 font-medium font-sans"
                    />
                  </div>
                </div>

                {/* Alamat Email */}
                <div className="md:col-span-2">
                  <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 select-none">
                    Alamat Email <span className="text-slate-400 text-[10px] font-normal lowercase">(opsional)</span>
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                      <Mail className="w-4 h-4 text-indigo-600" />
                    </div>
                    <input
                      type="email"
                      placeholder="Contoh: alamat@email.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all bg-white text-slate-800 placeholder-slate-400 font-medium font-sans"
                    />
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={handleNextToStep2}
                className="w-full mt-6 bg-indigo-600 hover:bg-indigo-700 active:scale-[99] text-white font-bold py-3.5 px-5 rounded-xl text-xs sm:text-sm transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md shadow-indigo-600/10"
              >
                <span>Lanjut ke Tanda Tangan</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div
              key="step-signature"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              className="space-y-4"
            >
              <div className="p-4 bg-indigo-50/40 rounded-2xl border border-indigo-100/50 mb-3 text-left">
                <h4 className="text-xs font-bold text-indigo-950 flex items-center gap-1.5">
                  <PenTool className="w-4 h-4 text-indigo-600" />
                  Instruksi Tanda Tangan:
                </h4>
                <p className="text-[11px] text-slate-600 mt-1 leading-relaxed">
                  Gunakan jari tangan Anda atau stylus pen untuk menandatangani kotak canvas di bawah ini. Pastikan goresan digambar dengan jelas.
                </p>
              </div>

              <div>
                <SignaturePad 
                  onChange={(base64) => setSignature(base64)} 
                  initialValue={signature}
                />
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  type="button"
                  onClick={handleBackToStep1}
                  className="flex-1 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold py-3.5 px-4 rounded-xl text-xs sm:text-sm border border-slate-200 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span>Ubah Identitas</span>
                </button>
                <button
                  type="button"
                  onClick={handleNextToStep3}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3.5 px-4 rounded-xl text-xs sm:text-sm transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-md shadow-indigo-600/10"
                >
                  <span>Lanjut Konfirmasi</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}

          {step === 3 && (
            <motion.div
              key="step-confirmation"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              className="space-y-5"
            >
              <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-2xl text-left">
                <h4 className="text-xs font-bold text-emerald-800 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  Pratinjau Kehadiran Anda
                </h4>
                <p className="text-[10.5px] text-slate-600 mt-1 leading-relaxed">
                  Tinjau kembali data diri Anda di bawah sebelum mengirim absensi. Data yang dikirim akan tersimpan di sistem utama admin.
                </p>
              </div>

              {/* Summary Details Card */}
              <div className="border border-slate-150 rounded-2xl bg-white overflow-hidden text-left shadow-xs">
                <div className="bg-slate-50 px-4 py-3 border-b border-slate-150 flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-indigo-500" />
                    Detail Identitas
                  </span>
                  <button 
                    type="button"
                    onClick={handleBackToStep1}
                    className="text-[10.5px] font-bold text-indigo-600 hover:text-indigo-700 cursor-pointer hover:underline"
                  >
                    Edit Data
                  </button>
                </div>
                <div className="p-4 space-y-3 Divide-y divide-slate-100 text-xs text-slate-700">
                  <div className="grid grid-cols-3 py-1">
                    <span className="text-slate-400 font-medium">Nama Lengkap</span>
                    <span className="col-span-2 font-bold text-slate-800">{name}</span>
                  </div>
                  <div className="grid grid-cols-3 pt-2">
                    <span className="text-slate-400 font-medium">Instansi</span>
                    <span className="col-span-2 font-semibold text-slate-800">{instansi}</span>
                  </div>
                  <div className="grid grid-cols-3 pt-2">
                    <span className="text-slate-400 font-medium">NIP</span>
                    <span className="col-span-2 font-mono font-bold text-slate-800">{nip}</span>
                  </div>
                  <div className="grid grid-cols-3 pt-2">
                    <span className="text-slate-400 font-medium">Jabatan</span>
                    <span className="col-span-2 font-semibold text-slate-800">{jabatan}</span>
                  </div>
                  {email.trim() && (
                    <div className="grid grid-cols-3 pt-2">
                      <span className="text-slate-400 font-medium">Email</span>
                      <span className="col-span-2 font-semibold text-slate-800">{email}</span>
                    </div>
                  )}
                </div>

                <div className="bg-slate-50 px-4 py-3 border-t border-b border-slate-150 flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1.5">
                    <PenTool className="w-3.5 h-3.5 text-indigo-500" />
                    Tanda Tangan Digital
                  </span>
                  <button 
                    type="button"
                    onClick={handleBackToStep2}
                    className="text-[10.5px] font-bold text-indigo-600 hover:text-indigo-700 cursor-pointer hover:underline"
                  >
                    Ulangi Tanda Tangan
                  </button>
                </div>
                <div className="p-4 bg-slate-50/50 flex justify-center">
                  {signature ? (
                    <img
                      src={signature}
                      alt="Tanda Tangan Konfirmasi"
                      className="max-h-24 object-contain border border-slate-200 rounded-xl bg-white px-6 py-2 shadow-inner"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <span className="text-xs text-rose-500">Tanda tangan tidak ditemukan.</span>
                  )}
                </div>
              </div>

              {/* Actions Footer */}
              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleBackToStep2}
                  disabled={isSubmitting}
                  className="sm:order-1 flex-1 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold py-3.5 px-4 rounded-xl text-xs sm:text-sm border border-slate-200 transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span>Kembali</span>
                </button>
                
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={isSubmitting}
                  className="sm:order-2 flex-[2] bg-indigo-600 hover:bg-indigo-700 active:scale-[99] text-white font-bold py-3.5 px-5 rounded-xl text-xs sm:text-sm transition-all flex items-center justify-center gap-2 cursor-pointer disabled:bg-slate-300 disabled:cursor-not-allowed shadow-md shadow-indigo-600/10"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-white" />
                      <span>Mengirim Kehadiran...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      <span>Hadir &amp; Kirim Absen</span>
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
